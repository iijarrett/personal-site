import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ACCENT_VARS, ACCENTS, accentRecord, accentValues } from "../src/lib/accents.ts";
import { initArcade } from "../src/scripts/arcade.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---- a small fake browser: just what the arcade script touches ----------------------

class Ctx {
  constructor() {
    this.calls = [];
    this.fillStyle = "";
    this.font = "";
  }
  clearRect() {
    this.calls.push(["clear"]);
  }
  fillRect(x, y, w, h) {
    this.calls.push(["rect", x, y, w, h, this.fillStyle]);
  }
  fillText(text, x, y) {
    this.calls.push(["text", text, x, y, this.fillStyle, this.font, this.textAlign]);
  }
  setTransform(...m) {
    this.calls.push(["transform", ...m]);
  }
  /** What the last draw put on the canvas. */
  last() {
    const at = this.calls.findLastIndex((c) => c[0] === "clear");
    return this.calls.slice(at + 1);
  }
}

/** Event listeners as a browser keeps them: every handler added is kept, and all of them run. */
class Bus {
  constructor() {
    this.all = new Map();
  }
  add(name, fn) {
    this.all.set(name, [...(this.all.get(name) ?? []), fn]);
  }
  /** One function that runs every handler for the event, or undefined when there are none. */
  get(name) {
    const fns = this.all.get(name);
    return fns && ((event) => fns.map((fn) => fn(event)).at(-1));
  }
  delete(name) {
    this.all.delete(name);
  }
  count(name) {
    return this.all.get(name)?.length ?? 0;
  }
  get size() {
    return [...this.all.values()].reduce((n, fns) => n + fns.length, 0);
  }
}

class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Bus();
    this.classes = new Set();
    this.className = "";
    this.textContent = "";
    this.tabIndex = -1;
    this.clientWidth = 480;
    this.width = 0;
    this.height = 0;
    this.captured = [];
    this.ctx = new Ctx();
    this.noContext = false;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get classList() {
    return {
      add: (n) => this.classes.add(n),
      remove: (n) => this.classes.delete(n),
      contains: (n) => this.classes.has(n),
    };
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(k, v) {
    this.attrs.set(k, v);
  }
  addEventListener(name, fn) {
    this.listeners.add(name, fn);
  }
  getBoundingClientRect() {
    return { left: 100, width: 480, top: 0, height: 300 };
  }
  setPointerCapture(id) {
    this.captured.push(id);
  }
  getContext() {
    return this.noContext ? null : this.ctx;
  }
  /** Just enough of closest() for a comma list of tag names and [contenteditable]. */
  closest(selector) {
    const hit = selector
      .split(",")
      .some((s) => s === this.tag || (s === "[contenteditable]" && this.editable));
    return hit ? this : null;
  }
  querySelector(selector) {
    return selector === ".arcade" ? (this.mount ?? null) : null;
  }
}

function install(
  t,
  {
    storage = new Map(),
    throwingStorage = false,
    session = new Map(),
    throwingSession = false,
    noContext = false,
    mountFull = false,
    touch = false,
  } = {},
) {
  const saved = new Map();
  const set = (name, value) => {
    if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  const state = {
    clock: 1000,
    hidden: false,
    vars: { "--accent": "#aa00ff", "--text": "#eeeeee", "--muted": "#888888" },
  };
  const win = new Bus();
  const doc = new Bus();
  const frames = new Map();
  let nextFrame = 1;
  const observers = { io: null, mo: null };
  const root = new El("html");
  // The page's accent: inline values the game puts on <html>, which win over the stylesheet's.
  const inline = new Map();
  root.dataset = {};
  root.style = {
    setProperty: (name, value) => inline.set(name, value),
    removeProperty: (name) => inline.delete(name),
  };
  const created = [];

  // What global.css makes of the colour on <html>: four values feed the tokens, by theme.
  const cssValue = (name) => {
    if (root.dataset.accent === undefined) return undefined;
    const light = root.dataset.theme === "light";
    const from = {
      "--accent": light ? "--x1" : "--x0",
      "--accent-text": light ? "--x2" : "--x0",
      "--glow": light ? "--x3" : "--x0",
      "--ring": light ? "--x2" : "--x0",
    }[name];
    return from && inline.get(from);
  };

  set("document", {
    documentElement: root,
    get hidden() {
      return state.hidden;
    },
    createElement: (tag) => {
      const el = new El(tag);
      el.noContext = noContext;
      created.push(tag);
      return el;
    },
    addEventListener: (name, fn) => doc.add(name, fn),
  });
  set("getComputedStyle", () => ({
    fontFamily: "JetBrains Mono, monospace",
    getPropertyValue: (name) => ` ${cssValue(name) ?? state.vars[name] ?? ""} `,
  }));
  set("addEventListener", (name, fn) => win.add(name, fn));
  set("removeEventListener", (name) => win.delete(name));
  set("devicePixelRatio", 1);
  set("matchMedia", (query) => ({ matches: touch && query === "(pointer: coarse)" }));
  set("performance", { now: () => state.clock });
  set("requestAnimationFrame", (fn) => {
    frames.set(nextFrame, fn);
    return nextFrame++;
  });
  set("cancelAnimationFrame", (id) => frames.delete(id));
  set("localStorage", {
    getItem(key) {
      if (throwingStorage) throw new Error("blocked");
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (throwingStorage) throw new Error("blocked");
      storage.set(key, String(value));
    },
  });
  set("sessionStorage", {
    getItem(key) {
      if (throwingSession) throw new Error("blocked");
      return session.get(key) ?? null;
    },
    setItem(key, value) {
      if (throwingSession) throw new Error("blocked");
      session.set(key, String(value));
    },
    removeItem(key) {
      if (throwingSession) throw new Error("blocked");
      session.delete(key);
    },
  });
  set(
    "IntersectionObserver",
    class {
      constructor(cb) {
        this.cb = cb;
        observers.io = this;
      }
      observe() {}
    },
  );
  set(
    "MutationObserver",
    class {
      constructor(cb) {
        this.cb = cb;
        observers.mo = this;
      }
      observe() {}
    },
  );

  const footer = new El("footer");
  const mount = new El("div");
  if (mountFull) mount.append(new El("canvas"));
  footer.mount = mount;
  initArcade({ footer, isOn: () => true, subscribe() {} });
  const canvas = mount.children.find((c) => c.tag === "canvas") ?? null;
  const help = mount.children.find((c) => c.tag === "p") ?? null;

  const other = new El("body"); // something that is not the canvas
  const api = {
    state,
    storage,
    session,
    win,
    doc,
    mount,
    canvas,
    help,
    created,
    observers,
    root,
    inline,
    other,
    pending: () => frames.size,
    see: (on) => observers.io.cb([{ isIntersecting: on }]),
    tick(ms = 1000 / 60) {
      state.clock += ms;
      const due = [...frames.values()];
      frames.clear();
      for (const fn of due) fn(state.clock);
    },
    run(seconds) {
      for (let i = 0, n = Math.round(seconds * 60); i < n && frames.size; i++) api.tick();
    },
    key(key, extra = {}) {
      const event = {
        key,
        target: other,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
        ...extra,
      };
      win.get("keydown")?.(event);
      return event;
    },
    keyUp: (key) => win.get("keyup")?.({ key }),
    /** The paddle and ball as last drawn. */
    shapes() {
      const rects = canvas.ctx.last().filter((c) => c[0] === "rect");
      return {
        paddle: rects.find((c) => c[3] === 36),
        ball: rects.find((c) => c[3] === 5),
        lives: rects.filter((c) => c[3] === 4 && c[4] === 4).length,
      };
    },
    texts: () =>
      canvas.ctx
        .last()
        .filter((c) => c[0] === "text")
        .map((c) => c[1]),
    pointer(name, extra = {}) {
      const event = { clientX: 340, button: 0, pointerId: 7, ...extra };
      canvas.listeners.get(name)?.(event);
      return event;
    },
  };
  return api;
}

/** Open the game the way a keyboard visitor does: on screen, canvas focused, space pressed. */
function started(t, options) {
  const a = install(t, options);
  a.see(true);
  a.key(" ", { target: a.canvas });
  return a;
}

// ---- building it ------------------------------------------------------------------------

test("it builds a focusable canvas and a status line inside the footer's arcade box, and nothing else", () => {
  const t = { after() {} };
  const a = install(t);
  assert.equal(a.canvas.tabIndex, 0);
  assert.equal(a.canvas.attrs.get("role"), "img");
  assert.match(a.canvas.attrs.get("aria-label"), /Brick breaker/);
  assert.equal(a.help.attrs.get("role"), "status");
  assert.match(a.help.textContent, /esc to stop/);
  assert.deepEqual([...a.created].sort(), ["canvas", "p"]);
});

test("the status line is read aloud only: the controls are drawn inside the box, and only until it starts", (t) => {
  const idle = install(t);
  idle.see(true);
  assert.equal(idle.help.className, "sr-only", "no visible line under the box");
  const hint = (a) => a.texts().filter((s) => /A D|esc to stop/.test(s));
  assert.equal(hint(idle).length, 2, "idle: the controls are in the box, one short line each");
  assert.match(hint(idle).join(" "), /A D.*esc to stop/);
  // Where they are really drawn: centred, in their own font (mono glyphs are 0.6em wide), well
  // inside the 240 x 150 box, under the play line with room to breathe, above
  // the paddle, and not on top of one another.
  const calls = idle.canvas.ctx.last().filter((c) => c[0] === "text");
  const specs = calls.filter((c) => /A D|esc to stop/.test(c[1]));
  const note = calls.find((c) => /to play/.test(c[1]));
  let above = note;
  for (const spec of specs) {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(spec[5])?.[1]);
    const half = (spec[1].length * px * 0.6) / 2;
    assert.equal(spec[6], "center");
    assert.ok(spec[2] - half >= 30 && spec[2] + half <= 240 - 30, "a wide margin either side");
    assert.ok(spec[3] - above[3] >= 10, "clear of the line above it");
    above = spec;
  }
  assert.ok(138 - above[3] >= 14, "well above the paddle");
  const a = started(t);
  assert.equal(hint(a).length, 0, "once it has started they are gone");
  a.key("Escape");
  assert.equal(hint(a).length, 2, "back to idle they are shown again");
});

test("on a touch device the box says tap and drag and lists no keys", (t) => {
  const a = install(t, { touch: true });
  a.see(true);
  const texts = a.texts();
  assert.ok(texts.includes("tap to play"), texts.join(" | "));
  assert.ok(texts.includes("slide to move"), texts.join(" | "));
  assert.ok(!texts.some((s) => /esc|space|A D|click|mouse/.test(s)), texts.join(" | "));
  const calls = a.canvas.ctx.last().filter((c) => c[0] === "text");
  const note = calls.find((c) => /to play/.test(c[1]));
  const line = calls.find((c) => /slide to move/.test(c[1]));
  assert.ok(line[3] - note[3] >= 10, "clear of the play line");
  assert.ok(138 - line[3] >= 14, "well above the paddle");
  const b = started(t, { touch: true });
  assert.ok(!b.texts().some((s) => /slide to move/.test(s)), "gone once it has started");
});

test("with a keyboard and mouse the box says click or space and lists the keys, never tap or drag", (t) => {
  const a = install(t);
  a.see(true);
  const texts = a.texts();
  assert.ok(texts.includes("click or press space to play"), texts.join(" | "));
  assert.ok(texts.some((s) => /A D, or click and drag, to move/.test(s)));
  assert.ok(!texts.some((s) => /\btap\b|slide/.test(s)), texts.join(" | "));
});

test("it does nothing when there is no arcade box, the box is not empty, or there is no canvas context", (t) => {
  for (const options of [{ mountFull: true }, { noContext: true }]) {
    const a = install(t, options);
    assert.equal(a.win.size, 0, JSON.stringify(options));
    assert.equal(a.observers.io, null);
    assert.equal(a.mount.children.length, options.mountFull ? 1 : 0);
  }
});

test("idle, it draws once and runs nothing: no frame loop, and the page keeps its keys", (t) => {
  const a = install(t);
  a.see(true);
  assert.equal(a.pending(), 0);
  assert.ok(a.texts().some((s) => /click or press space to play/.test(s)));
  for (const k of [" ", "Enter", "ArrowUp", "ArrowLeft", "a", "d", "w"]) {
    assert.equal(a.key(k).prevented, false, `${k} on the page, not the canvas`);
  }
  a.pointer("pointermove");
  assert.equal(a.pending(), 0);
  assert.equal(a.mount.classes.has("live"), false);
});

test("the canvas is scaled to the screen: one backing pixel per logical pixel times the size ratio", (t) => {
  const a = install(t);
  assert.equal(a.canvas.width, 480);
  assert.equal(a.canvas.height, 300);
  assert.ok(a.canvas.ctx.calls.some((c) => c[0] === "transform" && c[1] === 2));
  a.canvas.clientWidth = 240;
  a.win.get("resize")();
  assert.equal(a.canvas.width, 240);
});

// ---- starting ----------------------------------------------------------------------------

test("space, Enter, up, W on the focused canvas start it; the key is taken so the page does not scroll", (t) => {
  for (const k of [" ", "Enter", "ArrowUp", "w", "W"]) {
    const a = install(t);
    a.see(true);
    const e = a.key(k, { target: a.canvas });
    assert.equal(e.prevented, true, k);
    assert.equal(a.mount.classes.has("live"), true, k);
    assert.equal(a.pending(), 1, k);
    const before = a.shapes().ball;
    a.run(0.5);
    assert.ok(a.shapes().ball[2] < before[2], `${k}: the ball is on its way up`);
  }
});

test("a click starts it, steering to where it landed, and a second click does not restart", (t) => {
  const a = install(t);
  a.see(true);
  a.pointer("click", { clientX: 340 });
  assert.equal(a.mount.classes.has("live"), true);
  assert.equal(a.pending(), 1);
  // x = (340 - 100) / 480 of the 240 wide field = 120, the middle
  assert.ok(Math.abs(a.shapes().paddle[1] + 18 - 120) < 1e-9);
  a.run(0.3);
  const ball = a.shapes().ball;
  a.pointer("click", { clientX: 340 });
  a.run(0.1);
  assert.ok(a.shapes().ball[2] < ball[2], "still the same game");
});

test("while idle a press or a drag does nothing, so a scroll that starts on the canvas is not a start", (t) => {
  const a = install(t);
  a.see(true);
  a.pointer("pointerdown");
  a.pointer("pointermove", { clientX: 200 });
  assert.equal(a.mount.classes.has("live"), false);
  assert.equal(a.pending(), 0);
  assert.deepEqual(a.canvas.captured, []);
});

test("keys that are not play keys, or come with Ctrl, Meta or Alt, are left alone", (t) => {
  const a = started(t);
  for (const k of ["x", "Shift", "F5", "PageDown", "Home"])
    assert.equal(a.key(k).prevented, false, k);
  for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
    assert.equal(a.key("ArrowLeft", { [mod]: true }).prevented, false, mod);
    assert.equal(a.key("r", { [mod]: true }).prevented, false, mod);
  }
});

// ---- playing -----------------------------------------------------------------------------

test("arrows and A and D steer once started, from anywhere on the page, and stop on key up", (t) => {
  for (const [left, right] of [
    ["ArrowLeft", "ArrowRight"],
    ["a", "d"],
    ["A", "D"],
  ]) {
    const a = started(t);
    const x0 = a.shapes().paddle[1];
    assert.equal(a.key(left).prevented, true);
    a.run(0.2);
    const x1 = a.shapes().paddle[1];
    assert.ok(x1 < x0 - 30, `${left}: ${x0} -> ${x1}`);
    a.keyUp(left);
    a.key(right);
    a.run(0.2);
    assert.ok(a.shapes().paddle[1] > x1 + 30, right);
    a.keyUp(right);
    const parked = a.shapes().paddle[1];
    a.run(0.2);
    assert.equal(a.shapes().paddle[1], parked, "no key held, so it stays put");
  }
});

test("a held launch key does not relaunch or scroll, and a finger or mouse steers and launches", (t) => {
  const a = started(t);
  const e = a.key(" ", { repeat: true });
  assert.equal(e.prevented, true);
  a.pointer("pointermove", { clientX: 220, pointerType: "touch" });
  a.run(0.05);
  assert.ok(Math.abs(a.shapes().paddle[1] + 18 - 60) < 1e-9, "steered to x=60");
  const down = a.pointer("pointerdown", { clientX: 220 });
  assert.deepEqual(a.canvas.captured, [down.pointerId]);
  a.pointer("pointerdown", { button: 2 });
  assert.deepEqual(a.canvas.captured, [7], "a right button is ignored");
});

test("a mouse only steers while its button is down, so passing over the box never grabs the paddle", (t) => {
  const a = started(t);
  a.run(0.05);
  const before = a.shapes().paddle[1];
  a.pointer("pointermove", { clientX: 220, pointerType: "mouse" }); // hovering
  a.run(0.05);
  assert.equal(a.shapes().paddle[1], before, "a hovering mouse did not move the paddle");
  a.pointer("pointerdown", { clientX: 220, pointerType: "mouse" });
  a.pointer("pointermove", { clientX: 220, pointerType: "mouse" });
  a.run(0.05);
  assert.ok(Math.abs(a.shapes().paddle[1] + 18 - 60) < 1e-9, "a dragging mouse steers to x=60");
  a.pointer("pointerup", { pointerType: "mouse" });
  a.pointer("pointermove", { clientX: 340, pointerType: "mouse" });
  a.run(0.05);
  assert.ok(
    Math.abs(a.shapes().paddle[1] + 18 - 60) < 1e-9,
    "released: hovering leaves it where it was",
  );
});

test("the lives are drawn, and the best score only when there is one", (t) => {
  const a = started(t);
  assert.equal(a.shapes().lives, 3);
  assert.ok(!a.texts().some((s) => /HI/.test(s)));
  const b = started(t, { storage: new Map([["jd-brick-best", "500"]]) });
  assert.ok(b.texts().some((s) => s === "HI 500  0"));
});

test("a game runs to its end: game over is announced, the best is kept, and a restart waits a moment", (t) => {
  const a = started(t);
  a.key(" "); // launch
  for (let miss = 0; miss < 4; miss++) {
    a.run(30);
    if (/game over/.test(a.help.textContent)) break;
    a.key(" ");
  }
  assert.match(a.help.textContent, /game over · score (\d+) · best \1/);
  const score = Number(/score (\d+)/.exec(a.help.textContent)[1]);
  assert.ok(score > 0);
  assert.equal(a.storage.get("jd-brick-best"), String(score));
  assert.equal(a.pending(), 0);
  assert.ok(a.texts().includes("game over"));

  a.key(" ");
  assert.match(a.help.textContent, /game over/, "a mashed key right after the end is ignored");
  a.state.clock += 700;
  a.key(" ");
  assert.match(a.help.textContent, /esc to stop/);
  assert.equal(a.shapes().lives, 3);
  assert.ok(
    a.texts().some((s) => s === `HI ${score}  0`),
    "the best stays on screen",
  );
});

/** Plays like someone who never misses, varying where the paddle meets the ball, until `done`. */
function autoplay(a, done, seconds = 1500) {
  for (let i = 0; i < seconds * 60 && !done(); i++) {
    const { ball } = a.shapes();
    if (ball) {
      const aim = ball[1] + 2.5 + Math.sin(i / 9) * 12; // the ball's centre, nudged off the middle
      a.pointer("pointermove", { clientX: 100 + aim * 2, pointerType: "touch" });
    }
    if (!a.pending()) a.key(" "); // the next serve
    a.tick();
  }
}

test("clearing the bricks moves the whole page to the next colour and says so in the box", (t) => {
  const a = started(t);
  assert.equal(a.inline.size, 0, "purple is the stylesheet's own, nothing inline");
  assert.equal(a.root.dataset.accent, undefined);
  a.key(" ");
  autoplay(a, () => a.root.dataset.accent !== undefined);
  assert.equal(a.root.dataset.accent, "cyan", "the first colour is the first in the list");
  for (const [k, name] of ACCENT_VARS.entries()) {
    assert.equal(a.inline.get(name), accentValues(ACCENTS[0])[k], name);
  }
  assert.match(a.help.textContent, /color unlocked: Cyan/);
  assert.ok(a.texts().includes("color unlocked: Cyan"), "the line is in the box");
  // The bricks come back in the new colour.
  const bricks = a.canvas.ctx.last().filter((c) => c[0] === "text" && /^[@#X+]{4}$/.test(c[1]));
  assert.equal(bricks.length, 32);
  assert.ok(bricks.every((c) => c[4] === ACCENTS[0].dark));
  // The line goes at the next launch.
  a.key(" ");
  assert.ok(!a.texts().some((s) => /color unlocked/.test(s)));
  // The other theme needs nothing from the game: the stylesheet picks the other values of the
  // same colour, and the box redraws in them.
  const before = a.inline.size;
  a.root.dataset.theme = "light";
  a.observers.mo.cb();
  assert.equal(a.inline.size, before, "the game puts nothing more on the page");
  assert.ok(a.canvas.ctx.last().some((c) => c[0] === "text" && c[4] === ACCENTS[0].light.text));
});

test("going to a fresh game keeps the colour, and Escape does not give it back", (t) => {
  const a = started(t);
  a.key(" ");
  autoplay(a, () => a.root.dataset.accent !== undefined);
  a.key("Escape");
  assert.equal(a.inline.get("--x0"), ACCENTS[0].dark);
});

test("a colour won is kept for the tab, in the form the head script reads", (t) => {
  const a = started(t);
  assert.equal(a.session.has("accent"), false);
  a.key(" ");
  autoplay(a, () => a.root.dataset.accent !== undefined);
  assert.equal(a.session.get("accent"), accentRecord(ACCENTS[0]));
  assert.equal(a.storage.has("accent"), false, "the high score's storage is left alone");
});

test("a colour kept from another page carries on: the next wave is the next colour", (t) => {
  const a = started(t, { session: new Map([["accent", accentRecord(ACCENTS[1])]]) });
  a.key(" ");
  autoplay(a, () => /color unlocked/.test(a.help.textContent));
  assert.equal(a.root.dataset.accent, ACCENTS[2].name.toLowerCase());
  assert.equal(a.session.get("accent"), accentRecord(ACCENTS[2]));
  assert.match(a.help.textContent, new RegExp(`color unlocked: ${ACCENTS[2].name}`));
});

test("after the last colour the page goes home to purple and forgets the colour", (t) => {
  const last = ACCENTS.length - 1;
  const a = started(t, { session: new Map([["accent", accentRecord(ACCENTS[last])]]) });
  // What the head script put on the page before the game loaded.
  a.root.dataset.accent = ACCENTS[last].name.toLowerCase();
  for (const [k, v] of accentValues(ACCENTS[last]).entries()) a.inline.set(ACCENT_VARS[k], v);
  a.key(" ");
  autoplay(a, () => /color unlocked/.test(a.help.textContent));
  assert.match(a.help.textContent, /color unlocked: Purple/);
  assert.equal(a.root.dataset.accent, undefined);
  assert.equal(a.inline.size, 0);
  assert.equal(a.session.has("accent"), false);
});

test("a stored colour that is not one of ours is ignored", (t) => {
  for (const bad of ["", "orange,#ff8800,#ff8800,#ff8800,#ff8800", "garbage", "7"]) {
    const a = started(t, { session: new Map([["accent", bad]]) });
    a.key(" ");
    autoplay(a, () => /color unlocked/.test(a.help.textContent));
    assert.equal(a.root.dataset.accent, ACCENTS[0].name.toLowerCase(), JSON.stringify(bad));
  }
});

test("blocked tab storage is tolerated: the colour still changes for this page", (t) => {
  const a = started(t, { throwingSession: true });
  a.key(" ");
  autoplay(a, () => a.root.dataset.accent !== undefined);
  assert.equal(a.root.dataset.accent, ACCENTS[0].name.toLowerCase());
  assert.equal(a.inline.get("--x0"), ACCENTS[0].dark);
});

test("storage that throws is tolerated: the game still plays and ends", (t) => {
  const a = started(t, { throwingStorage: true });
  a.key(" ");
  for (let miss = 0; miss < 4 && !/game over/.test(a.help.textContent); miss++) {
    a.run(30);
    a.key(" ");
  }
  assert.match(a.help.textContent, /game over/);
});

test("a theme change redraws in the new colours", (t) => {
  const a = install(t);
  a.see(true);
  a.state.vars["--accent"] = "#00ff00";
  a.observers.mo.cb();
  assert.ok(a.canvas.ctx.last().some((c) => c[0] === "text" && c[4] === "#00ff00"));
});

// ---- stopping ----------------------------------------------------------------------------

test("Escape and Tab put it back to idle, Tab without being taken, and the page gets its keys back", (t) => {
  for (const k of ["Escape", "Tab"]) {
    const a = started(t);
    a.key("ArrowRight");
    assert.equal(a.pending(), 1);
    const e = a.key(k);
    assert.equal(e.prevented, false, k);
    assert.equal(a.mount.classes.has("live"), false, k);
    a.tick();
    assert.equal(a.pending(), 0, `${k}: nothing runs`);
    assert.equal(a.key("ArrowRight").prevented, false, `${k}: arrows scroll again`);
    assert.ok(a.texts().some((s) => /click or press space to play/.test(s)));
    assert.equal(a.shapes().lives, 3);
  }
});

test("scrolling the canvas out of view pauses it as it is, and a press carries on", (t) => {
  const a = started(t);
  a.key("ArrowLeft");
  a.run(0.3);
  const frozen = a.shapes();
  a.see(false);
  assert.equal(a.mount.classes.has("live"), true, "still the same game, not a fresh one");
  assert.equal(a.pending(), 0, "nothing runs while it is out of view");
  a.see(true);
  assert.equal(a.pending(), 0, "back in view it waits for a press");
  assert.ok(
    a.texts().some((s) => /paused/.test(s)),
    "and says so in the box",
  );
  assert.deepEqual(a.shapes().ball, frozen.ball);
  assert.deepEqual(a.shapes().paddle, frozen.paddle);
  a.key(" ");
  assert.equal(a.pending(), 1, "the press carries on");
  assert.ok(!a.texts().some((s) => /paused/.test(s)));
  assert.equal(a.shapes().lives, frozen.lives, "and does not also launch a new ball");
  a.run(0.2);
  assert.notDeepEqual(a.shapes().ball, frozen.ball, "the ball is moving again");
});

test("a paused game ignores the pointer and the arrows until the press that carries on", (t) => {
  const a = started(t, { touch: true });
  a.run(0.2);
  a.see(false);
  a.see(true);
  const frozen = a.shapes();
  a.pointer("pointermove", { clientX: 300, pointerType: "touch" });
  a.key("ArrowRight");
  assert.equal(a.pending(), 0, "nothing restarts by itself");
  assert.deepEqual(a.shapes().paddle, frozen.paddle, "the paddle stays where it was");
  a.key("Escape");
  assert.equal(a.mount.classes.has("live"), false, "Escape still ends it");
  assert.ok(!a.texts().some((s) => /paused/.test(s)));
});

test("a game that is over goes back to idle when scrolled away, its score kept", (t) => {
  const a = started(t);
  a.key(" ");
  for (let miss = 0; miss < 4 && !/game over/.test(a.help.textContent); miss++) {
    a.run(30);
    a.key(" ");
  }
  assert.match(a.help.textContent, /game over/);
  const score = Number(/score (\d+)/.exec(a.help.textContent)[1]);
  a.see(false);
  assert.equal(a.mount.classes.has("live"), false);
  assert.equal(a.storage.get("jd-brick-best"), String(score));
  a.see(true);
  assert.equal(a.pending(), 0);
  assert.ok(a.texts().some((s) => /click or press space to play/.test(s)));
});

test("the best is banked the moment it is passed, so a run left half way still counts", (t) => {
  const a = started(t, { storage: new Map([["jd-brick-best", "10"]]) });
  autoplay(a, () => a.storage.get("jd-brick-best") !== "10", 60);
  const banked = Number(a.storage.get("jd-brick-best"));
  assert.ok(banked > 10, "the stored best moved up while the game was still going");
  assert.ok(!/game over/.test(a.help.textContent));
  assert.ok(
    a.texts().some((s) => s === `HI ${banked}  ${banked}`),
    "and the box shows it",
  );
  a.see(false);
  assert.equal(a.storage.get("jd-brick-best"), String(banked), "leaving loses nothing");
});

test("a score that does not beat the best leaves the stored best alone", (t) => {
  const a = started(t, { storage: new Map([["jd-brick-best", "99999"]]) });
  a.run(5);
  assert.equal(a.storage.get("jd-brick-best"), "99999");
});

test("off screen it takes no keys, and a hidden tab pauses it until the tab is back", (t) => {
  const a = started(t);
  a.key("ArrowLeft");
  a.state.hidden = true;
  a.doc.get("visibilitychange")();
  assert.equal(a.pending(), 0, "hidden: the loop stops");
  a.state.hidden = false;
  a.doc.get("visibilitychange")();
  assert.equal(a.pending(), 1, "visible again: it carries on");
  a.run(0.1);
  a.see(false);
  assert.equal(a.key("ArrowLeft").prevented, false, "off screen, the keys are the page's");
});

// ---- the source --------------------------------------------------------------------------

test("the lazy file stays small, local and plain: no network, timers, eval, markup strings or other storage", () => {
  const source = read("../src/scripts/arcade.ts");
  for (const word of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "sendBeacon",
    "eval",
    "Function",
    "setTimeout",
    "setInterval",
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
    "document.write",
    "document.cookie",
    "indexedDB",
    "Math.random",
    "http://",
    "https://",
  ]) {
    assert.ok(!source.includes(word), `arcade.ts mentions ${word}`);
  }
  assert.deepEqual([...source.matchAll(/createElement\("(\w+)"\)/g)].map((m) => m[1]).sort(), [
    "canvas",
    "p",
  ]);
  assert.deepEqual([...source.matchAll(/localStorage\.(\w+)\(/g)].map((m) => m[1]).sort(), [
    "getItem",
    "setItem",
  ]);
  assert.equal(source.match(/"jd-brick-best"/g)?.length, 1, "one key, one place");
  // The tab's colour is the only other thing kept, and only through the shared key.
  assert.deepEqual([...source.matchAll(/sessionStorage\.(\w+)\(/g)].map((m) => m[1]).sort(), [
    "getItem",
    "removeItem",
    "setItem",
  ]);
  assert.ok(!/"accent"/.test(source), "the key comes from accents.ts, not a second copy");
});

test("the rules file has no DOM, clock or randomness, so the game can be replayed", () => {
  const source = read("../src/lib/brick.ts");
  for (const word of [
    "document",
    "window",
    "performance",
    "Date",
    "Math.random",
    "localStorage",
    "requestAnimationFrame",
    // and what no code in the lazy chunk may use, brick.ts being bundled into it
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "sendBeacon",
    "eval",
    "Function",
    "setTimeout",
    "setInterval",
    "innerHTML",
    "document.cookie",
    "sessionStorage",
    "indexedDB",
    "addEventListener",
    "http://",
    "https://",
    "import(",
  ]) {
    assert.ok(!source.includes(word), `brick.ts mentions ${word}`);
  }
});

// ---- what the review found ---------------------------------------------------------------

test("it adds each page-level listener once: keydown, keyup, resize, blur, visibilitychange", (t) => {
  const a = install(t);
  for (const name of ["keydown", "keyup", "resize", "blur"])
    assert.equal(a.win.count(name), 1, name);
  assert.equal(a.win.size, 4);
  assert.equal(a.doc.count("visibilitychange"), 1);
  assert.equal(a.doc.size, 1);
});

test("playing, a key on another control stays with that control; the canvas and the page still play", (t) => {
  const a = started(t);
  for (const tag of ["input", "textarea", "button", "a", "select", "summary"]) {
    const control = new El(tag);
    assert.equal(a.key(" ", { target: control }).prevented, false, `space on ${tag}`);
    assert.equal(a.key("a", { target: control }).prevented, false, `a typed in ${tag}`);
  }
  const editable = new El("div");
  editable.editable = true;
  assert.equal(a.key("d", { target: editable }).prevented, false, "contenteditable");
  assert.equal(a.key("d", { target: a.other }).prevented, true, "the page itself");
  assert.equal(a.key("d", { target: a.canvas }).prevented, true, "the canvas");
});

test("a key let go while the window was elsewhere does not leave the paddle running", (t) => {
  for (const lose of [
    (a) => a.win.get("blur")(),
    (a) => {
      a.state.hidden = true;
      a.doc.get("visibilitychange")();
      a.state.hidden = false;
      a.doc.get("visibilitychange")();
    },
  ]) {
    const a = started(t);
    a.key("ArrowLeft");
    a.run(0.1);
    lose(a); // the keyup never arrives
    a.run(0.05);
    const parked = a.shapes().paddle[1];
    a.run(0.3);
    assert.equal(a.shapes().paddle[1], parked);
  }
});

test("Escape in the middle of a press does not let that press's click restart the game", (t) => {
  const a = started(t);
  a.pointer("pointerdown"); // finger or mouse down while playing
  a.key("Escape");
  assert.equal(a.mount.classes.has("live"), false);
  a.pointer("pointerup");
  a.pointer("click");
  assert.equal(a.mount.classes.has("live"), false, "that click is ignored");
  // the next full press is an ordinary tap and does start it
  a.pointer("pointerdown");
  a.pointer("pointerup");
  a.pointer("click");
  assert.equal(a.mount.classes.has("live"), true);
});

test("a cancelled press after a reset does not swallow the next tap either", (t) => {
  const a = started(t);
  a.pointer("pointerdown");
  a.key("Escape");
  a.pointer("pointercancel"); // no click follows a cancelled press
  a.pointer("pointerdown");
  a.pointer("pointerup");
  a.pointer("click");
  assert.equal(a.mount.classes.has("live"), true);
});

test("a stored best that is not a plain whole number is ignored, and a good one is shown", (t) => {
  for (const bad of [
    "-5",
    "12abc",
    "1e3",
    "1e999",
    "Infinity",
    "NaN",
    "0x10",
    "99999999999",
    " 7",
    "",
  ]) {
    const a = install(t, { storage: new Map([["jd-brick-best", bad]]) });
    a.see(true);
    assert.ok(!a.texts().some((s) => /HI/.test(s)), `"${bad}" must not show`);
  }
  const good = install(t, { storage: new Map([["jd-brick-best", "250"]]) });
  assert.ok(good.texts().includes("HI 250  0"));
});

test("the bricks are drawn in the text accent, never faded, so they keep their contrast", (t) => {
  const a = install(t);
  a.state.vars["--accent-text"] = "#7433d0";
  a.observers.mo.cb();
  const bricks = a.canvas.ctx.last().filter((c) => c[0] === "text" && /^[@#X+]{4}$/.test(c[1]));
  assert.equal(bricks.length, 32);
  assert.ok(bricks.every((c) => c[4] === "#7433d0"));
  assert.ok(!a.canvas.ctx.calls.some((c) => c[0] === "alpha"));
  assert.ok(!read("../src/scripts/arcade.ts").includes("globalAlpha"));
});
