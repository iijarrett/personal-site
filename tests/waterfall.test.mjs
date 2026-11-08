import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RAMP as HERO_RAMP } from "../src/lib/ascii-field.ts";
import { ALPHA, hash, levelAt, PITCH, RAMP, streaks, TOP } from "../src/lib/waterfall.ts";
import { initWaterfall } from "../src/scripts/waterfall.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---- the rules ---------------------------------------------------------------------------

test("the ramp is the hero's, symbol for symbol (the chunk cannot import it, so it is copied)", () => {
  assert.equal(RAMP, HERO_RAMP);
  assert.equal(TOP, RAMP.length - 1);
  assert.equal(RAMP.charAt(0), " ");
});

test("the hash is deterministic, stays in [0, 1) and is spread out", () => {
  assert.equal(hash(42), hash(42));
  let sum = 0;
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const h = hash(i);
    assert.ok(h >= 0 && h < 1, `hash(${i}) = ${h}`);
    sum += h;
    seen.add(h);
  }
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.01, `mean ${sum / 20000}`);
  assert.ok(seen.size > 19990, "almost no collisions");
});

test("each column has two streaks with speed, tail, gap and phase in range, the same every time", () => {
  for (let col = 0; col < 200; col++) {
    const a = streaks(col, 9);
    assert.deepEqual(a, streaks(col, 9));
    assert.equal(a.length, 2);
    for (const s of a) {
      assert.ok(s.speed >= 3 && s.speed < 8, `speed ${s.speed}`);
      assert.ok(Number.isInteger(s.tail) && s.tail >= 3 && s.tail <= 6, `tail ${s.tail}`);
      const gap = s.period - 9 - s.tail;
      assert.ok(Number.isInteger(gap) && gap >= 10 && gap <= 33, `gap ${gap}`);
      assert.ok(s.phase >= 0 && s.phase < s.period);
    }
  }
  const speeds = new Set(Array.from({ length: 50 }, (_, c) => streaks(c, 9)[0].speed));
  assert.ok(speeds.size > 40, "columns do not move in step");
});

test("a streak is densest at its head and thins out behind it; nothing is ahead of it", () => {
  const one = [{ speed: 1, tail: 4, period: 20, phase: 0 }];
  const at = (row, t) => levelAt(one, row, t);
  // at t = 5 the head is row 5
  assert.deepEqual(
    [5, 4, 3, 2, 1, 0].map((r) => at(r, 5)),
    [10, 6, 3, 1, 0, 0],
  );
  assert.equal(at(6, 5), 0);
  assert.equal(at(9, 5), 0);
  for (let tail = 3; tail <= 6; tail++) {
    const s = [{ speed: 1, tail, period: 40, phase: 0 }];
    const levels = Array.from({ length: tail }, (_, d) => levelAt(s, 20 - d, 20));
    assert.equal(levels[0], TOP);
    for (let i = 1; i < levels.length; i++)
      assert.ok(levels[i] <= levels[i - 1], `tail ${tail}: ${levels}`);
    assert.ok(levels.at(-1) >= 1, "the last cell of a tail is still drawn");
    assert.equal(levelAt(s, 20 - tail, 20), 0);
  }
});

test("a streak moves a whole row at a time and starts again after its gap", () => {
  const one = [{ speed: 2, tail: 3, period: 12, phase: 0 }];
  const head = (t) => {
    for (let r = 0; r < 12; r++) if (levelAt(one, r, t) === TOP) return r;
    return -1;
  };
  assert.equal(head(0), 0);
  assert.equal(head(0.49), 0);
  assert.equal(head(0.5), 1);
  assert.equal(head(0.99), 1);
  assert.equal(head(1), 2);
  assert.equal(head(5.5), 11);
  assert.equal(head(6), 0, "period 12 rows at 2 rows a second: back at the top after 6 s");
  assert.equal(head(12.25), 0);
});

test("a whole strip stays in range and is never empty or crowded, wide or narrow, at every time", () => {
  // The narrow grid is a 320 px phone: few columns, so the share swings more.
  for (const [cols, rows, floor, ceiling] of [
    [92, 9, 0.04, 0.4],
    [23, 9, 0.03, 0.5],
  ]) {
    const grid = Array.from({ length: cols }, (_, c) => streaks(c, rows));
    for (let t = 0; t < 600; t += 0.53) {
      let lit = 0;
      for (const column of grid) {
        for (let r = 0; r < rows; r++) {
          const level = levelAt(column, r, t);
          assert.ok(Number.isInteger(level) && level >= 0 && level <= TOP, `level ${level}`);
          if (level) lit++;
        }
      }
      const share = lit / (cols * rows);
      assert.ok(
        share > floor && share < ceiling,
        `${cols} columns, t=${t.toFixed(2)}: ${(share * 100).toFixed(1)}% lit`,
      );
    }
  }
});

test("opacity rises with density, level 0 is invisible, and the densest stays under full", () => {
  assert.equal(ALPHA.length, RAMP.length);
  assert.equal(ALPHA[0], 0);
  for (let i = 2; i < ALPHA.length; i++) assert.ok(ALPHA[i] > ALPHA[i - 1], `level ${i}`);
  assert.ok(ALPHA[1] >= 0.1 && ALPHA[1] < 0.2);
  assert.ok(ALPHA.at(-1) <= 0.95);
});

// ---- a fake browser: just what the strip touches ----------------------------------------

class Ctx {
  constructor() {
    this.calls = [];
    this.fillStyle = "";
    this.globalAlpha = 1;
    this.font = "";
  }
  clearRect() {
    this.calls.push(["clear"]);
  }
  fillText(text, x, y) {
    this.calls.push(["text", text, x, y, this.fillStyle, this.globalAlpha]);
  }
  setTransform(...m) {
    this.calls.push(["transform", ...m]);
  }
  /** What the last draw put on the canvas. */
  last() {
    return this.calls.slice(this.calls.findLastIndex((c) => c[0] === "clear") + 1);
  }
  draws() {
    return this.calls.filter((c) => c[0] === "clear").length;
  }
}

class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.clientWidth = 480;
    this.clientHeight = 120;
    this.width = 0;
    this.height = 0;
    this.ctx = new Ctx();
    this.noContext = false;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(k, v) {
    this.attrs.set(k, v);
  }
  addEventListener(name) {
    this.listeners.set(name, (this.listeners.get(name) ?? 0) + 1);
  }
  getContext() {
    return this.noContext ? null : this.ctx;
  }
  querySelector(selector) {
    return selector === ".waterfall" ? (this.mount ?? null) : null;
  }
}

function install(
  t,
  { mountFull = false, noContext = false, ambient = true, dpr = 1, hidden = false } = {},
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
    hidden,
    vars: { "--accent": "#aa00ff", "--accent-text": "", "--muted": "#888888" },
  };
  const win = new Map();
  const doc = new Map();
  const frames = new Map();
  let nextFrame = 1;
  const observers = { io: null, mo: null };
  const root = new El("html");
  const created = [];
  const bump = (map, name) => map.set(name, (map.get(name) ?? 0) + 1);
  // `fn:<name>` runs every handler added for that name, so a second registration cannot hide.
  const hooks = new Map();
  const register = (map, label, name, fn) => {
    bump(map, name);
    const list = hooks.get(`${label}:${name}`) ?? [];
    list.push(fn);
    hooks.set(`${label}:${name}`, list);
    map.set(`fn:${name}`, (...args) => {
      for (const f of list) f(...args);
    });
  };

  set("document", {
    documentElement: root,
    get hidden() {
      return state.hidden;
    },
    createElement: (tag) => {
      const el = new El(tag);
      el.noContext = noContext;
      created.push(el);
      return el;
    },
    addEventListener: (name, fn) => {
      register(doc, "doc", name, fn);
    },
  });
  set("getComputedStyle", () => ({
    fontFamily: "JetBrains Mono, monospace",
    getPropertyValue: (name) => ` ${state.vars[name] ?? ""} `,
  }));
  set("addEventListener", (name, fn) => {
    register(win, "win", name, fn);
  });
  set("devicePixelRatio", dpr);
  set("performance", { now: () => state.clock });
  set("requestAnimationFrame", (fn) => {
    frames.set(nextFrame, fn);
    return nextFrame++;
  });
  set("cancelAnimationFrame", (id) => frames.delete(id));
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
  let motion = null;
  initWaterfall({
    footer,
    isOn: () => ambient,
    subscribe(listener) {
      motion = listener;
      listener({ ambient, fades: ambient });
    },
  });
  const canvas = mount.children.find((c) => c.tag === "canvas") ?? null;

  const api = {
    state,
    win,
    doc,
    mount,
    canvas,
    created,
    observers,
    pending: () => frames.size,
    see: (on) => observers.io.cb([{ isIntersecting: on }]),
    setMotion: (on) => motion({ ambient: on, fades: on }),
    mode: (m) => motion(m),
    tick(ms = 1000 / 60) {
      state.clock += ms;
      const due = [...frames.values()];
      frames.clear();
      for (const fn of due) fn(state.clock);
    },
    run(seconds, ms = 1000 / 60) {
      for (let i = 0, n = Math.round((seconds * 1000) / ms); i < n; i++) api.tick(ms);
    },
    hide(on) {
      state.hidden = on;
      api.doc.get("fn:visibilitychange")();
    },
    draws: () => canvas.ctx.draws(),
    text: () => canvas.ctx.last().filter((c) => c[0] === "text"),
  };
  return api;
}

// ---- the strip ---------------------------------------------------------------------------

test("it builds one hidden canvas in the footer's waterfall box, and nothing else", (t) => {
  const a = install(t);
  assert.equal(a.canvas.attrs.get("aria-hidden"), "true");
  assert.equal(a.mount.children.length, 1);
  assert.deepEqual(
    a.created.map((c) => c.tag),
    ["canvas"],
  );
  assert.equal(a.canvas.attrs.has("tabindex"), false);
  assert.equal(a.canvas.attrs.has("role"), false);
});

test("it does nothing when the box is missing or taken, or there is no canvas context", (t) => {
  for (const options of [{ mountFull: true }, { noContext: true }]) {
    const a = install(t, options);
    assert.equal(a.win.size, 0, JSON.stringify(options));
    assert.equal(a.observers.io, null);
    assert.equal(a.mount.children.length, options.mountFull ? 1 : 0);
  }
});

test("it takes no input: no key, pointer, touch or click handler anywhere", (t) => {
  const a = install(t);
  const names = [...a.win.keys(), ...a.doc.keys(), ...a.canvas.listeners.keys()].filter(
    (k) => !k.startsWith("fn:"),
  );
  assert.deepEqual(names.sort(), ["resize", "visibilitychange"]);
  assert.equal(a.canvas.listeners.size, 0);
});

test("the grid follows the box: one cell per 14 px, at most 2x the pixels, redone on resize", (t) => {
  const a = install(t, { dpr: 3 });
  assert.equal(PITCH, 14);
  assert.equal(a.canvas.width, 960);
  assert.equal(a.canvas.height, 240);
  assert.ok(a.canvas.ctx.calls.some((c) => c[0] === "transform" && c[1] === 2 && c[4] === 2));
  a.canvas.clientWidth = 140;
  a.canvas.clientHeight = 28;
  a.win.get("fn:resize")();
  assert.equal(a.canvas.width, 280);
  const cells = new Set(a.text().map((c) => `${c[2]},${c[3]}`));
  for (const c of a.text()) assert.ok(c[2] < 140 && c[3] < 28, `${c[2]},${c[3]} is inside the box`);
  assert.ok(cells.size > 0);
});

test("on screen with motion allowed it runs near 30 frames a second, not at the display's rate", (t) => {
  const a = install(t);
  a.see(true);
  assert.equal(a.pending(), 1);
  const before = a.draws();
  a.run(2); // a 60 Hz display for two seconds
  const drawn = a.draws() - before;
  assert.ok(drawn >= 58 && drawn <= 62, `${drawn} frames in 2 s`);
  const odd = a.draws();
  a.run(1, 1000 / 144); // and a 144 Hz display
  assert.ok(
    a.draws() - odd >= 28 && a.draws() - odd <= 32,
    `${a.draws() - odd} frames in 1 s at 144 Hz`,
  );
});

test("the picture really moves: the same cells are not drawn twice in a row", (t) => {
  const a = install(t);
  a.see(true);
  a.run(0.2);
  const first = JSON.stringify(a.text());
  a.run(1);
  assert.notEqual(JSON.stringify(a.text()), first);
});

test("off screen, in a hidden tab, or with motion off, the loop is stopped and nothing is scheduled", (t) => {
  const a = install(t);
  a.see(true);
  a.run(0.3);
  a.see(false);
  assert.equal(a.pending(), 0, "scrolled away");
  const idle = a.draws();
  a.run(1);
  assert.equal(a.draws(), idle, "and nothing is drawn");
  a.see(true);
  assert.equal(a.pending(), 1, "back on screen");
  a.hide(true);
  assert.equal(a.pending(), 0, "hidden tab");
  a.hide(false);
  assert.equal(a.pending(), 1, "tab visible again");
  a.setMotion(false);
  assert.equal(a.pending(), 0, "Motion switched off");
  a.setMotion(true);
  assert.equal(a.pending(), 1, "Motion switched back on");
});

test("the loop is never doubled, however often the conditions are re-evaluated", (t) => {
  const a = install(t);
  a.see(true);
  for (let i = 0; i < 5; i++) {
    a.hide(false);
    a.see(true);
    a.setMotion(true);
  }
  assert.equal(a.pending(), 1);
  a.run(1);
  assert.equal(a.pending(), 1);
});

test("Motion off from the start: one still frame, and it never runs", (t) => {
  const a = install(t, { ambient: false });
  assert.equal(a.draws() >= 1, true, "the still frame is drawn");
  a.see(true);
  assert.equal(a.pending(), 0);
  const drawn = a.draws();
  a.run(3);
  assert.equal(a.draws(), drawn);
  assert.ok(a.text().length > 0, "and it is not blank");
});

test("the device's reduced-motion setting does not stop it, like the hero: only the Motion switch does", (t) => {
  const a = install(t);
  a.see(true);
  a.mode({ ambient: true, fades: false });
  assert.equal(a.pending(), 1);
  const drawn = a.draws();
  a.run(1);
  assert.ok(a.draws() - drawn > 20, "still running under reduced motion");
  a.mode({ ambient: false, fades: false });
  assert.equal(a.pending(), 0);
});

test("the still frame is always the same one, whenever motion is switched off", (t) => {
  const quiet = install(t, { ambient: false });
  const still = JSON.stringify(quiet.text());
  const a = install(t);
  a.see(true);
  a.run(3.7);
  assert.notEqual(JSON.stringify(a.text()), still);
  a.setMotion(false);
  assert.equal(JSON.stringify(a.text()), still);
});

test("a long stall does not make it jump: one step is at most a tenth of a second", (t) => {
  // Two separate pages (only one set of fakes can be live at a time), the same clock for both.
  const stall = (ms) => {
    const a = install(t);
    a.see(true);
    a.run(0.2);
    const before = a.draws();
    a.tick(ms);
    return { frames: a.draws() - before, picture: JSON.stringify(a.text()), a, before };
  };
  const long = stall(60_000);
  assert.equal(long.frames, 1, "one frame, not a burst of catching up");
  const clamp = stall(100);
  assert.equal(long.picture, clamp.picture, "and it moved no further than a 100 ms step");
  long.a.run(0.1);
  assert.ok(long.a.draws() - long.before < 6);
});

test("symbols come only from the ramp, at its opacities, in the theme's accent", (t) => {
  const a = install(t);
  a.see(true);
  a.run(1);
  const drawn = a.text();
  assert.ok(drawn.length > 10);
  const alphas = new Set(ALPHA);
  for (const [, ch, , , colour, alpha] of drawn) {
    assert.ok(RAMP.includes(ch) && ch !== " ", `symbol ${JSON.stringify(ch)}`);
    assert.equal(colour, "#aa00ff");
    assert.ok(alphas.has(alpha), `alpha ${alpha}`);
  }
  assert.equal(a.canvas.ctx.globalAlpha, 1, "left at full opacity");
});

test("a theme change redraws in the text accent where the theme has one", (t) => {
  const a = install(t);
  a.state.vars["--accent-text"] = "#7433d0";
  a.observers.mo.cb();
  assert.ok(a.text().length > 0);
  assert.ok(a.text().every((c) => c[4] === "#7433d0"));
});

test("each page-level listener is added once", (t) => {
  const a = install(t);
  assert.equal(a.win.get("resize"), 1);
  assert.equal(a.doc.get("visibilitychange"), 1);
  assert.equal(a.win.size, 2, "the count and the handler for resize");
});

test("a tab that starts hidden stays still until it is shown", (t) => {
  const a = install(t, { hidden: true });
  a.see(true);
  assert.equal(a.pending(), 0);
  a.run(1);
  const drawn = a.draws();
  a.hide(false);
  assert.equal(a.pending(), 1);
  a.run(0.5);
  assert.ok(a.draws() > drawn);
});

test("with no sign that it is on screen it never starts a loop", (t) => {
  const a = install(t);
  const drawn = a.draws();
  a.run(2);
  assert.equal(a.pending(), 0);
  assert.equal(a.draws(), drawn);
});

test("a box with no size throws nothing, then draws once it has one", (t) => {
  const a = install(t);
  a.canvas.clientWidth = 0;
  a.canvas.clientHeight = 0;
  a.win.get("fn:resize")();
  a.canvas.clientWidth = 280;
  a.canvas.clientHeight = 56;
  a.win.get("fn:resize")();
  assert.equal(a.canvas.width, 280);
  assert.ok(a.text().length > 0);
});

test("a change of pixel density alone redoes the backing size", (t) => {
  const a = install(t, { dpr: 1 });
  assert.equal(a.canvas.width, 480);
  globalThis.devicePixelRatio = 2;
  a.win.get("fn:resize")();
  assert.equal(a.canvas.width, 960);
});

// ---- the source --------------------------------------------------------------------------

test("the strip and its rules stay plain: no network, timers, eval, markup strings, storage or randomness", () => {
  for (const file of ["../src/scripts/waterfall.ts", "../src/lib/waterfall.ts"]) {
    const source = read(file);
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
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "Date",
      "http://",
      "https://",
    ]) {
      assert.ok(!source.includes(word), `${file} mentions ${word}`);
    }
    // Spelled with spaces, line breaks or brackets, these still count.
    for (const pattern of [
      /document\s*\.\s*write/,
      /document\s*(\.\s*cookie|\[\s*["'`]cookie)/,
      /Math\s*\.\s*random/,
      /\bimport\s*\(/,
      /\bimport\s*\./,
    ]) {
      assert.doesNotMatch(source, pattern, file);
    }
  }
  const rules = read("../src/lib/waterfall.ts");
  for (const word of [
    "document",
    "window",
    "performance",
    "requestAnimationFrame",
    "addEventListener",
  ]) {
    assert.ok(!rules.includes(word), `the rules file mentions ${word}`);
  }
  const script = read("../src/scripts/waterfall.ts");
  assert.deepEqual(
    [...script.matchAll(/createElement\("(\w+)"\)/g)].map((m) => m[1]),
    ["canvas"],
  );
  for (const handler of ["keydown", "keyup", "pointer", "touch", "click", "mouse", "wheel"]) {
    assert.ok(!script.includes(handler), `the strip mentions ${handler}`);
  }
});
