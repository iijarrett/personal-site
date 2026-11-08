// A small stand-in for the parts of the browser that src/scripts/hero.ts touches, so
// the hero's behaviour can be tested in Node with no browser and no dependency.
//
// It is deliberately dumb: elements have rectangles worked out from a font size (a
// monospace glyph is 0.6em wide, a line 1.25em tall, as in global.css), the canvas
// context records what is drawn, and animation frames and the clock are driven by the
// test. Nothing here is a spec-accurate DOM.

import { FRAME } from "../../src/lib/ascii-field.ts";

class FakeContext {
  constructor() {
    this.font = "";
    this.textBaseline = "";
    this.fillStyle = "";
    this.globalAlpha = 1;
    this.draws = []; // one array of glyphs per clearRect(), which hero.ts calls once per draw
    this.transforms = [];
  }
  setTransform(...matrix) {
    this.transforms.push(matrix);
  }
  clearRect() {
    this.draws.push([]);
  }
  fillText(text, x, y) {
    this.draws.at(-1)?.push({ text, x, y, alpha: this.globalAlpha, font: this.font });
  }
  measureText() {
    const px = Number.parseFloat(/([\d.]+)px/.exec(this.font)?.[1] ?? "0");
    return { width: px * 0.6, fontBoundingBoxAscent: px * 0.95, fontBoundingBoxDescent: px * 0.3 };
  }
}

export function installFakeDom({ viewportWidth = 1000, heroHeight = 600, fontPx = 12.8 } = {}) {
  const state = {
    fontPx,
    viewportWidth,
    heroHeight,
    clock: 0,
    nextFrame: 1,
    hidden: false,
    accent: "#bb9af7",
  };
  const pending = new Map(); // requestAnimationFrame callbacks waiting for a frame
  const cancelled = [];
  const idleTasks = [];
  const resizeObservers = [];
  const intersectionObservers = [];
  const mutationObservers = [];
  const documentListeners = new Map();

  const charWidth = () => state.fontPx * 0.6;
  const lineHeight = () => state.fontPx * 1.25;

  class FakeElement {
    constructor(tag, className = "", role = "") {
      this.tagName = tag.toUpperCase();
      this.role = role;
      this.children = [];
      this.parent = null;
      this.listeners = new Map();
      this.attributes = new Map();
      this.hidden = false;
      this.style = { height: "", setProperty() {} };
      this.width = 300;
      this.height = 150;
      this.className = className;
      this.ctx = null;
    }
    set className(value) {
      this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
    }
    get className() {
      return [...this.classes].join(" ");
    }
    get classList() {
      return {
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
        contains: (name) => this.classes.has(name),
      };
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    }
    after(node) {
      node.parent = this.parent;
      this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node);
    }
    matches(selector) {
      return selector.startsWith(".")
        ? this.classes.has(selector.slice(1))
        : this.tagName === selector.toUpperCase();
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const deeper = child.querySelector(selector);
        if (deeper) return deeper;
      }
      return null;
    }
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
    getContext() {
      this.ctx ??= new FakeContext();
      return this.ctx;
    }
    getBoundingClientRect() {
      const rect = (left, top, width, height) => ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      });
      if (this.role === "hero") return rect(0, 0, state.viewportWidth, state.heroHeight);
      if (this.role === "pre") {
        const width = 100 * charWidth();
        const height = FRAME.rows * lineHeight();
        return rect((state.viewportWidth - width) / 2, state.heroHeight - height, width, height);
      }
      const height = Number.parseFloat(this.style.height) || FRAME.rows * 16; // the CSS fallback is the frame's rows in rem
      return rect(0, state.heroHeight - height, state.viewportWidth, height);
    }
  }

  // The hero section: .hero > .ascii > three <pre> layers, as Astro renders it.
  const root = new FakeElement("body");
  const hero = new FakeElement("section", "hero", "hero");
  const stack = new FakeElement("div", "ascii");
  const pres = [0, 1, 2].map(() => new FakeElement("pre", "", "pre"));
  root.append(hero);
  hero.append(stack);
  stack.append(...pres);

  const document = {
    readyState: "complete",
    get hidden() {
      return state.hidden;
    },
    documentElement: new FakeElement("html"),
    fonts: { load: async () => [] },
    createElement: (tag) => new FakeElement(tag),
    querySelector: (selector) => root.querySelector(selector),
    addEventListener(type, listener) {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
    },
  };

  class FakeObserver {
    constructor(callback, list) {
      this.callback = callback;
      this.targets = [];
      list.push(this);
    }
    observe(target, options) {
      this.targets.push(target);
      this.options = options;
    }
  }

  const installed = {
    window: globalThis,
    document,
    devicePixelRatio: 1,
    addEventListener() {},
    requestIdleCallback: (task) => idleTasks.push(task),
    getComputedStyle: (element) =>
      element.role === "pre"
        ? {
            fontWeight: "400",
            fontSize: `${state.fontPx}px`,
            fontFamily: '"JetBrains Mono", monospace',
          }
        : { getPropertyValue: (name) => (name === "--accent" ? state.accent : "") },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ResizeObserver: class extends FakeObserver {
      constructor(callback) {
        super(callback, resizeObservers);
      }
    },
    MutationObserver: class extends FakeObserver {
      constructor(callback) {
        super(callback, mutationObservers);
      }
    },
    IntersectionObserver: class extends FakeObserver {
      constructor(callback) {
        super(callback, intersectionObservers);
      }
    },
    requestAnimationFrame: (callback) => {
      const id = state.nextFrame++;
      pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => {
      if (pending.delete(id)) cancelled.push(id);
    },
    performance: { now: () => state.clock },
  };
  const saved = new Map();
  for (const [name, value] of Object.entries(installed)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  return {
    hero,
    stack,
    pres,
    get canvas() {
      return hero.children.find((child) => child.tagName === "CANVAS");
    },
    get ctx() {
      return this.canvas?.ctx;
    },
    /** Runs the work hero.ts queued for after first paint, then lets its async start finish. */
    async boot() {
      for (const task of idleTasks.splice(0)) task();
      await settle();
    },
    /** One display frame `ms` later: calls whatever requestAnimationFrame callbacks are waiting. */
    advance(ms) {
      state.clock += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(state.clock);
    },
    frames(count, ms = 1000 / 60) {
      for (let i = 0; i < count; i++) this.advance(ms);
    },
    pendingFrames: () => pending.size,
    cancelledFrames: () => [...cancelled],
    setFontPx(px) {
      state.fontPx = px;
    },
    /** The browser telling every ResizeObserver that something it watches changed size. */
    resize() {
      for (const observer of resizeObservers) observer.callback([]);
    },
    intersect(isIntersecting) {
      for (const observer of intersectionObservers) observer.callback([{ isIntersecting }]);
    },
    /** The theme changing: --accent now computes to `accent`, and attribute observers fire. */
    setTheme(accent) {
      state.accent = accent;
      for (const observer of mutationObservers) observer.callback([]);
    },
    get themeObservers() {
      return mutationObservers;
    },
    documentElement: document.documentElement,
    setTabHidden(hidden) {
      state.hidden = hidden;
      for (const listener of documentListeners.get("visibilitychange") ?? []) listener();
    },
    charWidth,
    lineHeight,
    restore() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}
