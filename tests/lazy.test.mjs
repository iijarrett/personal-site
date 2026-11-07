import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createGate } from "../src/lib/lazy-gate.ts";
import { initLazy } from "../src/scripts/lazy.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

// ---- the gate: both conditions, once -------------------------------------------------

test("the gate opens once, when the footer is near and a visitor has acted, in either order", () => {
  for (const order of [
    (g) => {
      g.setNear(true);
      g.setActed();
    },
    (g) => {
      g.setActed();
      g.setNear(true);
    },
  ]) {
    let opened = 0;
    const gate = createGate(() => opened++);
    order(gate);
    assert.equal(opened, 1);
    gate.setNear(false);
    gate.setNear(true);
    gate.setActed();
    assert.equal(opened, 1, "it never opens twice");
  }
});

test("the gate stays shut with only one of the two", () => {
  let opened = 0;
  const near = createGate(() => opened++);
  near.setNear(true);
  const acted = createGate(() => opened++);
  acted.setActed();
  const left = createGate(() => opened++);
  left.setActed();
  left.setNear(true);
  left.setNear(false); // opened above, already counted
  assert.equal(opened, 1);
});

test("a footer that was near and then scrolled away does not open on a later action alone", () => {
  let opened = 0;
  const gate = createGate(() => opened++);
  gate.setNear(true);
  gate.setNear(false);
  gate.setActed();
  assert.equal(opened, 0);
});

// ---- the wiring, in a fake browser -------------------------------------------------

/** Installs the few globals lazy.ts touches and returns handles to drive them. */
function install(t, { footer = { dataset: {} }, observer = true, saveData = false } = {}) {
  const saved = new Map();
  const set = (name, value) => {
    if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const listeners = new Map();
  const removed = [];
  const observers = [];
  set("document", { querySelector: (selector) => (selector === ".site-footer" ? footer : null) });
  set("navigator", { connection: { saveData } });
  set("addEventListener", (name, fn, options) => listeners.set(name, { fn, options }));
  // Like a browser: it only removes a listener when the callback is the same function and
  // the capture flag matches (the loader adds with capture off).
  set("removeEventListener", (name, fn, options) => {
    removed.push(name);
    const added = listeners.get(name);
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    if (added && added.fn === fn && capture === !!added.options?.capture) listeners.delete(name);
  });
  set(
    "IntersectionObserver",
    observer
      ? class {
          constructor(callback, options) {
            this.callback = callback;
            this.options = options;
            this.observed = [];
            this.disconnected = false;
            observers.push(this);
          }
          observe(element) {
            this.observed.push(element);
          }
          disconnect() {
            this.disconnected = true;
          }
        }
      : undefined,
  );
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    footer,
    listeners,
    removed,
    observers,
    act: (name = "keydown", isTrusted = true) => listeners.get(name).fn({ isTrusted }),
    see: (isIntersecting) => observers[0].callback([{ isIntersecting }]),
  };
}

const env = { isOn: () => true, subscribe() {} };

function loader() {
  const calls = { load: 0, init: [] };
  return {
    calls,
    load: () => {
      calls.load++;
      return Promise.resolve({ initArcade: (arg) => calls.init.push(arg) });
    },
  };
}

test("a page that is only opened never requests the chunk, near the footer or not", async (t) => {
  const dom = install(t);
  const { load, calls } = loader();
  initLazy(load, env);
  dom.see(true); // a short page: the footer is on screen from the start
  await settle();
  assert.equal(calls.load, 0);
});

test("it watches the footer with a fixed 800px margin", (t) => {
  const dom = install(t);
  initLazy(loader().load, env);
  assert.equal(dom.observers.length, 1);
  assert.deepEqual(dom.observers[0].observed, [dom.footer]);
  assert.equal(dom.observers[0].options.rootMargin, "800px 0px");
});

test("real presses, touches, wheels and keys count; scroll and pointer moves do not", (t) => {
  const dom = install(t);
  initLazy(loader().load, env);
  assert.deepEqual([...dom.listeners.keys()].sort(), [
    "keydown",
    "pointerdown",
    "touchstart",
    "wheel",
  ]);
  for (const { options } of dom.listeners.values()) assert.equal(options.passive, true);
});

test("an action alone, or the footer alone, is not enough", async (t) => {
  const dom = install(t);
  const { load, calls } = loader();
  initLazy(load, env);
  dom.act();
  await settle();
  assert.equal(calls.load, 0, "action without the footer near");
  dom.see(true);
  await settle();
  assert.equal(calls.load, 1, "now both are true");
});

test("a script-made event is ignored", async (t) => {
  const dom = install(t);
  const { load, calls } = loader();
  initLazy(load, env);
  dom.see(true);
  dom.act("keydown", false);
  dom.act("pointerdown", false);
  await settle();
  assert.equal(calls.load, 0);
  dom.act("wheel", true);
  await settle();
  assert.equal(calls.load, 1);
});

test("it loads once, then lets go of its listeners and the observer", async (t) => {
  const dom = install(t);
  const { load, calls } = loader();
  initLazy(load, env);
  dom.see(true);
  dom.act("touchstart");
  await settle();
  assert.equal(calls.load, 1);
  assert.equal(dom.listeners.size, 0);
  assert.deepEqual([...dom.removed].sort(), ["keydown", "pointerdown", "touchstart", "wheel"]);
  assert.equal(dom.observers[0].disconnected, true);
  dom.see(false);
  dom.see(true);
  await settle();
  assert.equal(calls.load, 1);
});

test("the chunk gets the footer and the motion hooks, and nothing else", async (t) => {
  const dom = install(t);
  const { load, calls } = loader();
  initLazy(load, env);
  dom.see(true);
  dom.act("pointerdown");
  await settle();
  assert.equal(calls.init.length, 1);
  assert.deepEqual(Object.keys(calls.init[0]).sort(), ["footer", "isOn", "subscribe"]);
  assert.equal(calls.init[0].footer, dom.footer);
});

test("a failed load is swallowed and does not retry", async (t) => {
  const dom = install(t);
  let loads = 0;
  initLazy(() => {
    loads++;
    return Promise.reject(new Error("offline"));
  }, env);
  dom.see(true);
  dom.act();
  await settle();
  dom.see(false);
  dom.see(true);
  await settle();
  assert.equal(loads, 1);
});

test("a chunk that throws on start is swallowed too", async (t) => {
  const dom = install(t);
  initLazy(
    () =>
      Promise.resolve({
        initArcade() {
          throw new Error("boom");
        },
      }),
    env,
  );
  dom.see(true);
  dom.act();
  await settle();
});

test("it does nothing without a footer, without IntersectionObserver, or when the visitor saves data", (t) => {
  for (const options of [{ footer: null }, { observer: false }, { saveData: true }]) {
    const dom = install(t, options);
    const { load, calls } = loader();
    initLazy(load, env);
    assert.equal(dom.listeners.size, 0, JSON.stringify(options));
    assert.equal(dom.observers.length, 0, JSON.stringify(options));
    assert.equal(calls.load, 0);
  }
});

// ---- the source: one literal import(), nothing the checker has to guess -----------------

test("the page script names the lazy file with an exact import(), and nothing else imports lazily", () => {
  const entry = read("../src/scripts/interactive.ts");
  assert.equal(entry.match(/\bimport\(/g)?.length, 1);
  assert.match(entry, /import\("\.\/arcade\.ts"\)/);
  for (const file of [
    "lazy.ts",
    "arcade.ts",
    "bar.ts",
    "hero.ts",
    "settings.ts",
    "motion-state.ts",
  ]) {
    assert.doesNotMatch(read(`../src/scripts/${file}`), /\bimport\(/, file);
  }
});

test("the lazy file imports only types, so the build cannot make a shared chunk or import from the page script", () => {
  const source = read("../src/scripts/arcade.ts");
  const imports = source.match(/^import .*$/gm) ?? [];
  assert.ok(imports.length > 0);
  for (const line of imports) assert.match(line, /^import type /, line);
});

test("the loader is plain: no network, no timers, no storage, no script elements", () => {
  for (const file of ["../src/scripts/lazy.ts", "../src/lib/lazy-gate.ts"]) {
    const source = read(file);
    for (const word of [
      "fetch",
      "XMLHttpRequest",
      "setTimeout",
      "setInterval",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      'createElement("script")',
    ]) {
      assert.ok(!source.includes(word), `${file} mentions ${word}`);
    }
  }
});
