import assert from "node:assert/strict";
import { test } from "node:test";
import { asciiFrame } from "../src/lib/ascii-frame.ts";

const RAMP = new Set(" .:-=+*#%@");
const ink = (line) => [...line].filter((char) => char !== " ").length;
const sum = (numbers) => numbers.reduce((total, value) => total + value, 0);

test("the same options always produce the same frame", () => {
  assert.deepEqual(asciiFrame(), asciiFrame());
  assert.deepEqual(asciiFrame({ cols: 40, rows: 8 }), asciiFrame({ cols: 40, rows: 8 }));
});

test("the default frame is 20 rows of at most 100 columns", () => {
  const frame = asciiFrame();
  assert.equal(frame.length, 20);
  assert.ok(frame.every((line) => line.length <= 100));
});

test("custom sizes are respected", () => {
  const frame = asciiFrame({ cols: 30, rows: 5 });
  assert.equal(frame.length, 5);
  assert.ok(frame.every((line) => line.length <= 30));
});

test("only ramp characters are used, with no trailing spaces", () => {
  for (const line of asciiFrame()) {
    assert.ok(
      [...line].every((char) => RAMP.has(char)),
      `unexpected character in ${line}`,
    );
    assert.equal(line, line.trimEnd());
  }
});

test("the bottom half is denser than the top half, so the rings radiate upward", () => {
  const frame = asciiFrame();
  const top = sum(frame.slice(0, 10).map(ink));
  const bottom = sum(frame.slice(10).map(ink));
  assert.ok(bottom > top, `bottom ${bottom} should exceed top ${top}`);
});

test("the frame is not blank and uses more than one density", () => {
  const characters = new Set(asciiFrame().join(""));
  characters.delete("\n");
  assert.ok(characters.size > 3);
});

test("different sizes give different frames", () => {
  assert.notDeepEqual(asciiFrame({ cols: 60, rows: 12 }), asciiFrame({ cols: 61, rows: 12 }));
});
