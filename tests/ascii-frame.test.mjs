import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EDGE_COLS,
  RAMP as FIELD_RAMP,
  FRAME,
  symbolAt,
  TIER_ALPHA,
  tierOf,
} from "../src/lib/ascii-field.ts";
import { asciiFrame, asciiTiers } from "../src/lib/ascii-frame.ts";

const RAMP = new Set(FIELD_RAMP);
const ink = (line) => [...line].filter((char) => char !== " ").length;
const sum = (numbers) => numbers.reduce((total, value) => total + value, 0);

test("the same options always produce the same frame", () => {
  assert.deepEqual(asciiFrame(), asciiFrame());
  assert.deepEqual(asciiFrame({ cols: 40, rows: 8 }), asciiFrame({ cols: 40, rows: 8 }));
});

test("the static frame is exactly the shared field at t = 0, so the canvas can match it", () => {
  const frame = asciiFrame();
  for (let row = 0; row < FRAME.rows; row++) {
    let expected = "";
    for (let col = 0; col < FRAME.cols; col++) expected += symbolAt(col, row, 0);
    assert.equal(frame[row], expected.trimEnd(), `row ${row}`);
  }
});

test("the tier layers stack back into exactly the frame, each cell in one layer", () => {
  const tiers = asciiTiers().map((block) => block.split("\n"));
  assert.equal(tiers.length, TIER_ALPHA.length);
  const frame = asciiFrame();
  for (let row = 0; row < FRAME.rows; row++) {
    for (let col = 0; col < FRAME.cols; col++) {
      const symbol = symbolAt(col, row, 0);
      const layers = tiers
        .map((lines, tier) => ({ tier, char: lines[row]?.charAt(col) || " " }))
        .filter(({ char }) => char !== " ");
      if (symbol === " ") assert.equal(layers.length, 0, `${col},${row}`);
      else {
        assert.equal(layers.length, 1, `${col},${row}`);
        assert.equal(layers[0].char, symbol);
        assert.equal(layers[0].tier, tierOf(FIELD_RAMP.indexOf(symbol)));
      }
    }
    assert.equal(frame[row]?.trimEnd(), frame[row]);
  }
});

test("every tier layer is as tall as the frame, even where it is empty", () => {
  for (const block of asciiTiers()) {
    const lines = block.split("\n");
    assert.equal(lines.length, FRAME.rows);
    assert.ok(lines.every((line) => line.length >= 1 && line.length <= FRAME.cols));
  }
});

test("the CSS opacity of each tier layer matches TIER_ALPHA", () => {
  const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
  for (const [tier, alpha] of TIER_ALPHA.entries()) {
    const match = css.match(new RegExp(`\\.ascii \\.t${tier}\\s*\\{[^}]*opacity:\\s*([0-9.]+)`));
    assert.ok(match, `no .ascii .t${tier} rule with an opacity`);
    assert.equal(Number(match[1]), alpha);
  }
});

test("the static frame is masked at its left and right edges over exactly EDGE_COLS columns", () => {
  const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
  const rule = css.match(/\.ascii \{[^}]*\}/);
  assert.ok(rule, "no .ascii rule");
  const horizontal = rule[0].match(
    /linear-gradient\(\s*to right,\s*transparent,\s*#000 (\d+)ch,\s*#000 calc\(100% - (\d+)ch\),\s*transparent\s*\)/,
  );
  assert.ok(horizontal, "no horizontal edge mask on .ascii");
  assert.equal(Number(horizontal[1]), EDGE_COLS);
  assert.equal(Number(horizontal[2]), EDGE_COLS);
  assert.match(
    rule[0],
    /linear-gradient\(to bottom, transparent, #000 55%\)/,
    "the bottom fade is still there",
  );
  assert.match(rule[0], /mask-composite:\s*intersect/, "the two masks must multiply, not add");
  assert.match(
    rule[0],
    /width:\s*100ch/,
    "the mask ramps are measured against a frame exactly 100ch wide",
  );
  assert.equal(FRAME.cols, 100);
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
