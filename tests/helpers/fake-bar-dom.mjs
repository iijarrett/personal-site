// A small stand-in for the parts of the browser that src/scripts/bar.ts touches: the window's
// scroll, wheel and pointer events, the <html> classes, the header's focus events and a media
// query. Nothing here is a spec-accurate DOM.

// `focusVisible` puts keyboard focus inside the header before the script starts (a late bundle).
// `scrollHeight` and `innerHeight` give the page its real scroll range, 0 to scrollHeight -
// innerHeight. `failHeaderListener` makes header.addEventListener throw for that event type.
export function installBarDom({
  wide = true,
  scrollY = 0,
  focusVisible = false,
  scrollHeight = 5000,
  innerHeight = 800,
  failHeaderListener = null,
} = {}) {
  const state = { scrollY, wide };
  const windowListeners = new Map();
  const rootListeners = new Map();
  const headerListeners = new Map();
  const mediaListeners = [];
  const classes = new Set();

  const add = (map) => (type, listener) => map.set(type, [...(map.get(type) ?? []), listener]);
  const fire = (map, type, event = {}) => {
    for (const listener of map.get(type) ?? []) listener(event);
  };

  const inside = { name: "a link inside the header" };
  const addToHeader = add(headerListeners);
  const header = {
    addEventListener(type, listener) {
      if (type === failHeaderListener) throw new Error(`cannot listen for ${type}`);
      addToHeader(type, listener);
    },
    contains: (node) => node === inside,
    getBoundingClientRect: () => ({ bottom: 61 }),
    matches: (selector) => selector === ":has(:focus-visible)" && focusVisible,
  };
  const root = {
    scrollHeight,
    addEventListener: add(rootListeners),
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
  };
  const document = {
    documentElement: root,
    querySelector: (selector) => (selector === ".site-header" ? header : null),
  };
  const media = {
    get matches() {
      return state.wide;
    },
    addEventListener: (_type, listener) => mediaListeners.push(listener),
  };

  const installed = {
    document,
    innerHeight,
    addEventListener: add(windowListeners),
    matchMedia: () => media,
  };
  const saved = new Map();
  for (const [name, value] of Object.entries(installed)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  saved.set("scrollY", Object.getOwnPropertyDescriptor(globalThis, "scrollY"));
  Object.defineProperty(globalThis, "scrollY", { get: () => state.scrollY, configurable: true });

  return {
    /** "bar-on", "bar-off" or "" when the script has not decided yet. */
    get bar() {
      return classes.has("bar-on") ? "bar-on" : classes.has("bar-off") ? "bar-off" : "";
    },
    classes: () => [...classes].sort(),
    inside,
    scrollTo(y) {
      state.scrollY = y;
      fire(windowListeners, "scroll");
    },
    wheel: (deltaY) => fire(windowListeners, "wheel", { deltaY }),
    pointer: (clientY, pointerType = "mouse") =>
      fire(windowListeners, "pointermove", { clientY, pointerType }),
    pointerLeaveWindow: () => fire(rootListeners, "pointerleave"),
    /** Focus arriving in the header. `visible` is true for keyboard focus. */
    focusIn: (visible = true) =>
      fire(headerListeners, "focusin", { target: { matches: () => visible } }),
    /** Focus leaving the header, for `to` (a node inside it, or elsewhere / nothing). */
    focusOut: (to = null) => fire(headerListeners, "focusout", { relatedTarget: to }),
    setWide(value) {
      state.wide = value;
      for (const listener of mediaListeners) listener();
    },
    restore() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}
