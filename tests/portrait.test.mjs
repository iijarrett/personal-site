import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  alphaStep,
  glyphAt,
  hash,
  makeShape,
  RAMP,
  RESOLVED,
  STILL,
  SYMBOLS,
  stepAlpha,
  TONES,
  tones,
} from "../src/lib/portrait.ts";
import { FACE, MARK } from "../src/lib/portrait-art.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const glyph = () => ({ ch: "", alpha: 0, tone: 0 });
const lit = (art) => [...art.cells.join("")].filter((c) => c !== " ").length;

// ---- the art ------------------------------------------------------------------------------

test("each picture is cols by rows, written only in ramp characters", () => {
  for (const art of [FACE, MARK]) {
    assert.equal(art.cells.length, art.rows);
    for (const row of art.cells) {
      assert.equal(row.length, art.cols);
      for (const c of row) assert.ok(RAMP.includes(c), `${JSON.stringify(c)} is not on the ramp`);
    }
  }
});

test("the face and the mark are both really there, with empty margin all round", () => {
  assert.ok(lit(FACE) / (FACE.cols * FACE.rows) > 0.4, "the face fills a good part of its box");
  assert.ok(lit(MARK) / (MARK.cols * MARK.rows) > 0.2, "the mark is a solid shape");
  for (const art of [FACE, MARK]) {
    const first = art.cells[0] ?? "";
    const last = art.cells.at(-1) ?? "";
    assert.equal(first.trim(), "", "the top row is empty");
    assert.equal(last.trim(), "", "the bottom row is empty");
    for (const row of art.cells) {
      assert.equal(row.charAt(0), " ", "the left column is empty");
      assert.equal(row.charAt(art.cols - 1), " ", "the right column is empty");
    }
  }
});

test("the face is a photo and the mark is a mark", () => {
  assert.equal(FACE.tone, "photo");
  assert.equal(MARK.tone, "mark");
  assert.ok(new Set(FACE.cells.join("")).size >= 12, "a photo uses most of the levels");
});

// ---- the rules ----------------------------------------------------------------------------

test("the hash is deterministic and stays in [0, 1)", () => {
  assert.equal(hash(7, 9), hash(7, 9));
  assert.notEqual(hash(7, 9), hash(9, 7));
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    const h = hash(i, 3);
    assert.ok(h >= 0 && h < 1);
    sum += h;
  }
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.01);
});

test("a shape reads the art cell by cell, and unknown characters are empty", () => {
  const s = makeShape(3, 2, "mark", " @?.:Z");
  assert.deepEqual([...s.levels], [0, 15, 0, 1, 3, 0]);
  assert.equal(s.delay.length, 6);
});

test("before it starts every cell is faint field; once resolved every lit cell holds its symbol", () => {
  const s = makeShape(FACE.cols, FACE.rows, FACE.tone, FACE.cells.join(""));
  const g = glyph();
  let drawnAtStart = 0;
  let locked = 0;
  for (let i = 0; i < s.levels.length; i++) {
    if (glyphAt(s, i, 0, false, g)) {
      drawnAtStart++;
      assert.ok(g.alpha <= 0.28 + 1e-9, "the field alone is faint");
      assert.ok(SYMBOLS.includes(g.ch));
    }
    if (s.levels[i]) {
      assert.ok(glyphAt(s, i, RESOLVED + 0.01, false, g) || s.levels[i] === 1);
      if (g.ch === "0" || g.ch === "1" || g.alpha > 0.28) locked++;
    }
  }
  assert.ok(drawnAtStart > 0);
  assert.ok(locked > lit(FACE) * 0.95, `locked ${locked} of ${lit(FACE)}`);
});

test("the field is a halo round the picture, not a box: far cells and the art's edge stay empty", () => {
  for (const art of [FACE, MARK]) {
    const s = makeShape(art.cols, art.rows, art.tone, art.cells.join(""));
    const g = glyph();
    let near = 0;
    let far = 0;
    for (let y = 0; y < art.rows; y++) {
      for (let x = 0; x < art.cols; x++) {
        const i = y * art.cols + x;
        const w = s.halo[i] ?? 0;
        assert.ok(w >= 0 && w <= 1, "a weight");
        if (s.levels[i]) assert.equal(w > 0.99, true, "on the picture it is full");
        const edge = x === 0 || y === 0 || x === art.cols - 1 || y === art.rows - 1;
        if (edge) assert.equal(glyphAt(s, i, 0, false, g), false, "nothing drawn on the very edge");
        if (!s.levels[i] && w === 0) {
          far++;
          assert.equal(glyphAt(s, i, 0, false, g), false, "far from the picture, nothing");
        } else if (!s.levels[i] && w > 0.3) near++;
      }
    }
    assert.ok(far > 0 && near > 0, `${art.tone}: some cells far, some near`);
  }
});

test("a photo cell settles on 0 or 1 and a mark cell on any symbol", () => {
  const f = makeShape(FACE.cols, FACE.rows, "photo", FACE.cells.join(""));
  assert.ok(f.lock.every((c) => c === "0" || c === "1"));
  const m = makeShape(MARK.cols, MARK.rows, "mark", MARK.cells.join(""));
  assert.ok(m.lock.every((c) => SYMBOLS.includes(c)));
  assert.ok(new Set(m.lock).size > 6);
});

test("the picture builds up: lock-in times are spread across the resolve, left to right on average", () => {
  const s = makeShape(FACE.cols, FACE.rows, FACE.tone, FACE.cells.join(""));
  const g = glyph();
  const share = (t) => {
    let done = 0;
    let all = 0;
    for (let i = 0; i < s.levels.length; i++) {
      if (!s.levels[i]) continue;
      all++;
      glyphAt(s, i, t, false, g);
      if (g.ch === s.lock[i]) done++;
    }
    return done / all;
  };
  assert.ok(share(0.2) < 0.1);
  assert.ok(share(1.5) > 0.2 && share(1.5) < 0.9);
  assert.ok(share(RESOLVED + 0.1) > 0.95);
  const left = (i) => i % s.cols < s.cols / 2;
  let leftEarly = 0;
  let rightEarly = 0;
  for (let i = 0; i < s.levels.length; i++) {
    if (!s.levels[i]) continue;
    glyphAt(s, i, 1, false, g);
    if (g.ch === s.lock[i]) left(i) ? leftEarly++ : rightEarly++;
  }
  assert.ok(leftEarly > rightEarly, "the sweep starts at the left");
});

test("still shows the finished picture and never changes; moving drifts", () => {
  const s = makeShape(MARK.cols, MARK.rows, MARK.tone, MARK.cells.join(""));
  const a = glyph();
  const b = glyph();
  let drift = 0;
  for (let i = 0; i < s.levels.length; i++) {
    const x = glyphAt(s, i, STILL, true, a);
    const y = glyphAt(s, i, STILL + 3.7, true, b);
    assert.equal(x, y);
    if (x) assert.deepEqual(a, b, "a still frame is the same whenever it is read");
    if (s.levels[i]) assert.equal(a.ch, s.lock[i], "the still frame is resolved");
  }
  for (let i = 0; i < s.levels.length; i++) {
    if (
      glyphAt(s, i, STILL, false, a) &&
      glyphAt(s, i, STILL + 3.7, false, b) &&
      a.alpha !== b.alpha
    )
      drift++;
  }
  assert.ok(drift > 100, "the field keeps moving while the picture holds");
});

test("a settled photo cell is brighter the higher its level; a mark stays bold", () => {
  const dim = makeShape(1, 1, "photo", ".");
  const bright = makeShape(1, 1, "photo", "@");
  const g1 = glyph();
  const g2 = glyph();
  glyphAt(dim, 0, STILL, true, g1);
  glyphAt(bright, 0, STILL, true, g2);
  assert.ok(g2.alpha > g1.alpha + 0.5);
  assert.ok(g2.tone > g1.tone);
  const mark = makeShape(1, 1, "mark", ".");
  glyphAt(mark, 0, STILL, true, g1);
  assert.ok(g1.alpha >= 0.55);
});

test("opacity steps cover 0 to 1 and tones run from the accent to the highlight", () => {
  assert.equal(alphaStep(0.04), 0);
  assert.equal(alphaStep(1), 11);
  assert.ok(stepAlpha(11) <= 1 && stepAlpha(0) > 0);
  const t = tones("#bb9af7", "#efe6ff");
  assert.equal(t.length, TONES);
  assert.equal(t[0], "rgb(187,154,247)");
  assert.equal(t.at(-1), "rgb(239,230,255)");
  assert.deepEqual(tones("rebeccapurple", "#fff"), Array(TONES).fill("rebeccapurple"));
});

// ---- the page and the script --------------------------------------------------------------

class Ctx {
  constructor() {
    this.texts = [];
    this.fillStyle = "";
    this.globalAlpha = 1;
    this.font = "";
    this.textBaseline = "";
  }
  clearRect() {
    this.texts = [];
  }
  setTransform() {}
  fillText(text) {
    this.texts.push(text);
  }
}

function run({ stored, reduced = false, tag }) {
  const globals = {};
  const set = (name, value) => {
    globals[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const ctx = new Ctx();
  const frames = [];
  const canvas = {
    attrs: new Map(),
    clientWidth: 302,
    clientHeight: 432,
    getContext: () => ctx,
    setAttribute(k, v) {
      this.attrs.set(k, v);
    },
  };
  const host = {
    dataset: {
      cols: String(FACE.cols),
      rows: String(FACE.rows),
      tone: "photo",
      cells: FACE.cells.join(""),
    },
    firstChild: null,
    append(child) {
      this.firstChild = child;
    },
  };
  const root = { dataset: {}, classList: { contains: () => false } };
  // The settings menu's two Motion buttons: the pressed one is the visitor's choice.
  const buttons = ["on", "off"].map((value) => ({ dataset: { value }, pressed: value === "on" }));
  const watchers = [];
  set("HTMLElement", Object);
  set("document", {
    documentElement: root,
    hidden: false,
    createElement: () => canvas,
    querySelectorAll: (selector) => (selector.includes("data-portrait") ? [host] : buttons),
    querySelector: () => buttons.find((b) => b.pressed),
    addEventListener() {},
  });
  set("matchMedia", () => ({ matches: reduced, addEventListener() {} }));
  set("localStorage", { getItem: () => stored });
  set("getComputedStyle", () => ({ getPropertyValue: () => "#bb9af7", fontFamily: "mono" }));
  set(
    "MutationObserver",
    class {
      constructor(fn) {
        this.fn = fn;
      }
      observe(node) {
        if (buttons.includes(node)) watchers.push(this.fn);
      }
    },
  );
  set("IntersectionObserver", undefined);
  set("addEventListener", () => {});
  set("devicePixelRatio", 1);
  set("requestAnimationFrame", (fn) => frames.push(fn) && frames.length);
  set("cancelAnimationFrame", () => {});
  return {
    ctx,
    frames,
    host,
    canvas,
    /** The visitor picks a Motion button in the settings menu. */
    choose(value) {
      for (const b of buttons) b.pressed = b.dataset.value === value;
      for (const fn of watchers) fn();
    },
    start: () => import(new URL(`../src/scripts/portrait.ts?run=${tag}`, import.meta.url).href),
    restore() {
      for (const [name, d] of Object.entries(globals)) {
        if (d) Object.defineProperty(globalThis, name, d);
        else delete globalThis[name];
      }
    },
  };
}

test("with the Motion switch off it draws the finished picture once and never runs", async (t) => {
  const a = run({ stored: "off", tag: "off" });
  t.after(() => a.restore());
  await a.start();
  assert.equal(a.host.firstChild, a.canvas);
  assert.equal(a.canvas.attrs.get("aria-hidden"), "true");
  assert.equal(a.frames.length, 0, "no animation frame was asked for");
  assert.ok(a.ctx.texts.length > lit(FACE) * 0.9, `${a.ctx.texts.length} symbols drawn`);
  assert.ok(a.ctx.texts.filter((c) => c === "0" || c === "1").length > lit(FACE) * 0.9);
});

test("reduced motion does not stop it: only the Motion switch decides, as for the hero", async (t) => {
  const a = run({ stored: "on", reduced: true, tag: "reduced" });
  t.after(() => a.restore());
  await a.start();
  assert.equal(a.frames.length, 1, "it runs");
  const b = run({ stored: "off", reduced: true, tag: "reduced-off" });
  t.after(() => b.restore());
  await b.start();
  assert.equal(b.frames.length, 0, "and the switch off still stops it");
});

test("picking a Motion button in the menu starts and stops it at once", async (t) => {
  const a = run({ stored: "on", tag: "menu" });
  t.after(() => a.restore());
  await a.start();
  assert.equal(a.frames.length, 1);
  a.choose("off");
  assert.ok(a.ctx.texts.length > lit(FACE) * 0.9, "the finished picture is drawn at once");
  a.frames.shift()(34); // the waiting frame finds the switch off and stops
  assert.equal(a.frames.length, 0, "no more frames");
  a.choose("on");
  assert.equal(a.frames.length, 1, "running again");
});

test("with motion on it starts from field alone, resolves, then holds and keeps going", async (t) => {
  const a = run({ stored: "on", tag: "on" });
  t.after(() => a.restore());
  await a.start();
  assert.equal(a.frames.length, 1, "one frame is waiting");
  const solid = () => a.ctx.texts.filter((c) => c === "0" || c === "1").length;
  // The field itself uses 0 and 1 among its symbols, so compare the start with the end.
  const atStart = solid();
  let now = 0;
  const step = () => {
    const fn = a.frames.shift();
    now += 34;
    fn(now);
  };
  for (let k = 0; k < 140; k++) step(); // about 4.7 seconds
  assert.ok(solid() > lit(FACE) * 0.9, `resolved: ${solid()} of ${lit(FACE)}`);
  assert.ok(atStart < solid() * 0.5, `it began as the field: ${atStart} against ${solid()}`);
  assert.equal(a.frames.length, 1, "and it is still running");
});

test("the page wiring: both pages carry a picture, none of it inline, the main script untouched", () => {
  const about = read("../src/pages/about.astro");
  const contact = read("../src/pages/contact.astro");
  assert.match(about, /<Portrait kind="face">/);
  assert.match(contact, /<Portrait kind="mark">/);
  const part = read("../src/components/Portrait.astro");
  assert.match(part, /aria-hidden="true"/);
  assert.doesNotMatch(part, /style=/);
  assert.doesNotMatch(read("../src/scripts/interactive.ts"), /portrait/i);
  assert.doesNotMatch(read("../src/styles/global.css"), /portrait/i);
});
