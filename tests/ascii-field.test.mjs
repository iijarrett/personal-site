import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALPHA,
  ambient,
  bandMask,
  columnAlpha,
  columnRange,
  EDGE_COLS,
  FRAME,
  grain,
  HEX,
  hexChar,
  inHexCore,
  levelOf,
  POINTER_RADIUS,
  pointerBoost,
  pointerDistance,
  RAMP,
  symbolAt,
  TIER_ALPHA,
  textBaseline,
  tierOf,
} from "../src/lib/ascii-field.ts";

const cells = (cols, rows) =>
  Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => [col, row]),
  ).flat();
const mean = (numbers) => numbers.reduce((total, value) => total + value, 0) / numbers.length;

test("grain is deterministic, in [0, 1) and varies by cell, including negative columns", () => {
  assert.equal(grain(3, 4), grain(3, 4));
  assert.notEqual(grain(3, 4), grain(4, 3));
  for (const [col, row] of [...cells(20, 5), [-7, 2], [-100, 0], [250, 19]]) {
    const value = grain(col, row);
    assert.ok(value >= 0 && value < 1, `${col},${row} -> ${value}`);
  }
});

// A determinism check, nothing more: calling a pure function twice with the same
// arguments gives the same answer. That a build-time frame and the canvas agree is
// proved elsewhere, by asciiFrame() being compared with symbolAt() at t = 0 in
// ascii-frame.test.mjs and by the first-frame comparison in hero.test.mjs.
test("symbolAt and ambient are deterministic: the same arguments always give the same result", () => {
  for (const [col, row] of [...cells(30, 6), [-12, 4], [140, 10]]) {
    for (const t of [0, 0.37, 12.5]) {
      assert.equal(symbolAt(col, row, t), symbolAt(col, row, t));
      assert.equal(ambient(col, row, t), ambient(col, row, t));
    }
  }
});

test("levelOf clamps to the ramp and never decreases", () => {
  assert.equal(levelOf(-5), 0);
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(50), RAMP.length - 1);
  let last = 0;
  for (let b = 0; b <= 1.3; b += 0.01) {
    const level = levelOf(b);
    assert.ok(level >= last);
    last = level;
  }
});

test("levels fall into three tiers, brighter tiers for higher levels", () => {
  assert.deepEqual(
    Array.from({ length: RAMP.length }, (_, level) => tierOf(level)),
    [-1, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2],
  );
  assert.equal(TIER_ALPHA.length, 3);
  assert.ok(TIER_ALPHA[0] < TIER_ALPHA[1] && TIER_ALPHA[1] < TIER_ALPHA[2]);
  assert.ok(TIER_ALPHA.every((alpha) => alpha > 0 && alpha <= 1));
});

test("alpha per level follows its tier, and a space has none", () => {
  assert.equal(ALPHA.length, RAMP.length);
  assert.equal(ALPHA[0], 0);
  for (let level = 1; level < RAMP.length; level++) {
    assert.equal(ALPHA[level], TIER_ALPHA[tierOf(level)]);
  }
  for (let level = 2; level < RAMP.length; level++) assert.ok(ALPHA[level] >= ALPHA[level - 1]);
});

test("the field is brightest near the origin and fades far away", () => {
  const near = [];
  const far = [];
  for (const [col, row] of cells(FRAME.cols, FRAME.rows)) {
    const level = levelOf(ambient(col, row, 0));
    if (Math.abs(col - FRAME.cols / 2) <= 10 && row >= 12) near.push(level);
    if (Math.abs(col - FRAME.cols / 2) >= 45 && row <= 6) far.push(level);
  }
  assert.ok(mean(near) > mean(far) + 1, `near ${mean(near)} vs far ${mean(far)}`);
});

test("far past the frame the field is blank, in both directions", () => {
  for (const col of [-400, -300, 500, 600]) {
    for (let row = 0; row < FRAME.rows; row++) assert.equal(symbolAt(col, row, 3), " ");
  }
});

test("symbols keep changing over time", () => {
  let inked = 0;
  let changed = 0;
  for (const [col, row] of cells(FRAME.cols, FRAME.rows)) {
    const before = symbolAt(col, row, 0);
    const after = symbolAt(col, row, 1.5);
    if (before !== " " || after !== " ") inked++;
    if (before !== after) changed++;
  }
  assert.ok(inked > 200);
  assert.ok(changed / inked > 0.2, `only ${changed} of ${inked} cells changed`);
});

test("pointer boost is largest at the pointer, falls off, and is zero at the radius", () => {
  assert.ok(Math.abs(pointerBoost(0, 1) - 0.85) < 1e-9);
  assert.equal(pointerBoost(POINTER_RADIUS, 1), 0);
  assert.equal(pointerBoost(POINTER_RADIUS + 50, 1), 0);
  let last = Number.POSITIVE_INFINITY;
  for (let d = 0; d <= POINTER_RADIUS; d += 5) {
    const boost = pointerBoost(d, 1);
    assert.ok(boost <= last);
    last = boost;
  }
});

test("pointer boost scales with strength and is off at strength 0", () => {
  assert.equal(pointerBoost(10, 0), 0);
  assert.ok(pointerBoost(10, 0.5) < pointerBoost(10, 1));
  assert.ok(Math.abs(pointerBoost(10, 0.5) - pointerBoost(10, 1) / 2) < 1e-9);
});

test("the hex core is the inner half of the radius and grows with strength", () => {
  assert.equal(inHexCore(0, 1), true);
  assert.equal(inHexCore(POINTER_RADIUS * 0.49, 1), true);
  assert.equal(inHexCore(POINTER_RADIUS * 0.51, 1), false);
  assert.equal(inHexCore(POINTER_RADIUS * 0.3, 0.5), false);
  assert.equal(inHexCore(POINTER_RADIUS * 0.2, 0.5), true);
  assert.equal(inHexCore(0, 0), false);
});

test("columnRange covers the canvas edge to edge, whatever the offset", () => {
  for (const [width, left, cell] of [
    [1024, 128, 7.68],
    [1024, -300.5, 7.68],
    [390, -189, 7.68],
    [2560, 896, 7.68],
    [800, 0, 8],
    [800, 800, 8],
  ]) {
    const { first, last } = columnRange(width, left, cell);
    assert.ok(left + first * cell <= 0, `left edge ${width},${left}`);
    assert.ok(left + (last + 1) * cell >= width, `right edge ${width},${left}`);
    assert.ok(left + (first + 1) * cell > 0, `no spare column on the left ${width},${left}`);
    assert.ok(left + last * cell < width, `no spare column on the right ${width},${left}`);
  }
  assert.equal(columnRange(800, 0, 8).first, 0);
});

test("textBaseline centres the font's box in the line, with a fallback", () => {
  assert.equal(textBaseline(16, 12, 4), 12);
  assert.equal(textBaseline(20, 12, 4), 14);
  assert.ok(Math.abs(textBaseline(16, 12.5, 3.5) - 12.5) < 1e-9);
  // Blink floors the half-leading: 15.984px around a 17px font is -0.51, which becomes -1.
  assert.equal(textBaseline(15.984375, 13, 4), 12);
  assert.equal(textBaseline(21, 13, 4), 15);
  assert.equal(textBaseline(16, Number.NaN, Number.NaN), 16 * 0.78);
  assert.equal(textBaseline(16, undefined, undefined), 16 * 0.78);
});

test("the static frame's mask is 0 outside the frame, ramps over EDGE_COLS, and is 1 in the middle", () => {
  for (const col of [-50, -1, 100, 101, 400]) assert.equal(bandMask(col), 0, `col ${col}`);
  assert.ok(Math.abs(bandMask(0) - 0.5 / EDGE_COLS) < 1e-12);
  assert.ok(Math.abs(bandMask(99) - 0.5 / EDGE_COLS) < 1e-12);
  assert.equal(bandMask(EDGE_COLS), 1);
  assert.equal(bandMask(FRAME.cols - 1 - EDGE_COLS), 1);
  assert.equal(bandMask(50), 1);
  for (let col = 0; col < EDGE_COLS; col++) assert.ok(bandMask(col) < bandMask(col + 1) + 1e-12);
  for (let col = 0; col < FRAME.cols; col++) {
    assert.equal(bandMask(col), bandMask(FRAME.cols - 1 - col), `mirror ${col}`);
  }
});

test("columnAlpha is exactly the static mask at 0, fully visible at 1, and never decreases in between", () => {
  for (const col of [-30, -1, 0, 5, 11, 40, 99, 100, 130]) {
    assert.equal(columnAlpha(col, 0), bandMask(col), `col ${col} at 0`);
    assert.equal(columnAlpha(col, 1), 1, `col ${col} at 1`);
    let last = -1;
    for (let edge = 0; edge <= 1.0001; edge += 0.05) {
      const alpha = columnAlpha(col, edge);
      assert.ok(alpha >= last - 1e-12 && alpha >= 0 && alpha <= 1);
      last = alpha;
    }
  }
  assert.equal(columnAlpha(-5, 0.4), 0.4, "outside the frame it is just the fade");
  assert.equal(columnAlpha(50, 0.4), 1, "the middle is always fully visible");
  assert.equal(columnAlpha(7, -3), bandMask(7), "clamped below");
  assert.equal(columnAlpha(7, 9), 1, "clamped above");
});

test("pointerDistance measures from the cell centre", () => {
  assert.ok(Math.abs(pointerDistance(0, 0, 3.84, 8)) < 1e-9);
  assert.ok(Math.abs(pointerDistance(2, 1, 3.84, 8) - Math.hypot(2 * 7.68, 16)) < 1e-9);
});

test("hex digits are hex, stable within a tick, and cycle between ticks", () => {
  for (const [col, row] of [...cells(40, 4), [-9, 3]]) {
    for (const t of [0, 0.3, 5.1]) assert.ok(HEX.includes(hexChar(col, row, t)));
    assert.equal(hexChar(col, row, 0.01), hexChar(col, row, 0.1));
  }
  let differs = 0;
  for (const [col, row] of cells(40, 4))
    if (hexChar(col, row, 0) !== hexChar(col, row, 0.5)) differs++;
  assert.ok(differs > 100, `${differs} of 160 changed`);
});
