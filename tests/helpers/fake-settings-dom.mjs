// A small stand-in for the parts of the browser that src/scripts/settings.ts touches, so
// the menu's behaviour can be tested in Node. Events bubble from the target up through its
// parents to the document, as in a browser, and focus moves the way a keyboard or a mouse
// would move it. Nothing here is a spec-accurate DOM.

class FakeElement {
  constructor(page, tag, { dataset = {}, hidden = false } = {}) {
    this.page = page;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = dataset;
    this.classes = new Set();
    this.focusVisible = false;
    this.isHidden = hidden;
  }
  get hidden() {
    return this.isHidden;
  }
  set hidden(value) {
    this.isHidden = value;
    // A browser blurs whatever had focus inside something that has just been hidden.
    if (value && this.contains(this.page.document.activeElement)) this.page.moveFocus(null);
  }
  get classList() {
    return { add: (name) => this.classes.add(name), contains: (name) => this.classes.has(name) };
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }
  contains(node) {
    for (let at = node; at; at = at.parent) if (at === this) return true;
    return false;
  }
  closest(selector) {
    for (let at = this; at; at = at.parent) if (at.matches(selector)) return at;
    return null;
  }
  matches(selector) {
    if (selector === ":focus-visible") return this.focusVisible;
    if (selector === "button[data-key]") return this.tagName === "BUTTON" && "key" in this.dataset;
    if (selector.startsWith(".")) return this.classes.has(selector.slice(1));
    return false;
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  /** Programmatic focus, as in the page's own button.focus(): it counts as keyboard focus. */
  focus() {
    this.page.moveFocus(this, true);
  }
}

export function installSettingsDom({ theme, storage = "ok" } = {}) {
  const documentListeners = new Map();
  const page = {};

  const root = { dataset: theme ? { theme } : {} };
  const meta = new FakeElement(page, "meta");
  meta.setAttribute("content", "#16161e");

  const button = new FakeElement(page, "button");
  button.classes.add("settings-btn");
  button.setAttribute("aria-expanded", "false");
  const choice = (key, value, pressed) => {
    const element = new FakeElement(page, "button", { dataset: { key, value } });
    element.setAttribute("aria-pressed", pressed);
    return element;
  };
  const choices = {
    dark: choice("theme", "dark", "true"),
    light: choice("theme", "light", "false"),
    on: choice("motion", "on", "true"),
    off: choice("motion", "off", "false"),
  };
  const panel = new FakeElement(page, "div", { hidden: true });
  panel.classes.add("settings-panel");
  panel.append(...Object.values(choices));
  const box = new FakeElement(page, "div");
  box.classes.add("settings");
  box.append(button, panel);
  const header = new FakeElement(page, "header");
  header.append(box);
  const outside = new FakeElement(page, "a");
  const body = new FakeElement(page, "body");
  body.append(header, outside);

  const document = {
    documentElement: root,
    activeElement: null,
    querySelector: (selector) =>
      selector === ".settings" ? box : selector === 'meta[name="theme-color"]' ? meta : null,
    addEventListener(type, listener) {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
    },
  };
  page.document = document;

  /** Sends an event to `target` and up through its parents, then to the document. */
  const dispatch = (target, type, init = {}, { bubbles = true } = {}) => {
    const event = {
      type,
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...init,
    };
    for (let at = target; at; at = bubbles ? at.parent : null) {
      for (const listener of at.listeners.get(type) ?? []) listener(event);
    }
    if (bubbles) for (const listener of documentListeners.get(type) ?? []) listener(event);
    return event;
  };

  /** Focus moving to `to` (or to nothing): focusout on the old element, focusin on the new. */
  page.moveFocus = (to, visible = false) => {
    const from = document.activeElement;
    if (from === to) return;
    document.activeElement = to;
    if (to) to.focusVisible = visible;
    if (from) dispatch(from, "focusout", { relatedTarget: to });
    if (to) dispatch(to, "focusin", { relatedTarget: from });
  };

  const stored = new Map();
  const localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem(key, value) {
      if (storage === "blocked") throw new Error("storage is blocked");
      stored.set(key, value);
    },
  };

  const installed = { document, localStorage };
  const saved = new Map();
  for (const [name, value] of Object.entries(installed)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  const motionCalls = [];
  let motionOn = true;
  return {
    box,
    button,
    panel,
    choices,
    outside,
    meta,
    root,
    stored,
    motion: {
      isOn: () => motionOn,
      set(on) {
        motionOn = on;
        motionCalls.push(on);
      },
    },
    motionCalls,
    document,
    get open() {
      return !panel.hidden;
    },
    get expanded() {
      return button.getAttribute("aria-expanded");
    },
    pressed: () =>
      Object.fromEntries(
        Object.entries(choices).map(([name, element]) => [
          name,
          element.getAttribute("aria-pressed"),
        ]),
      ),
    /** The mouse (or a touch, or a pen) arriving at or leaving the menu. */
    pointerEnter: (pointerType = "mouse") =>
      dispatch(box, "pointerenter", { pointerType }, { bubbles: false }),
    pointerLeave: (pointerType = "mouse") =>
      dispatch(box, "pointerleave", { pointerType }, { bubbles: false }),
    /** A press anywhere: pointerdown on the target, and for a mouse, mousedown too. */
    pointerDown: (target) => dispatch(target, "pointerdown", { pointerType: "mouse" }),
    mouseDown: (target) => dispatch(target, "mousedown"),
    click: (target) => dispatch(target, "click"),
    key: (key) => dispatch(document.activeElement ?? body, "keydown", { key }),
    /** Tab or a click moving focus. `visible` is true for the keyboard. */
    focusTo: (target, visible = true) => page.moveFocus(target, visible),
    dispatch,
    restore() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}
