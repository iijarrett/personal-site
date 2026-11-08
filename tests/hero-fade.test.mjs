import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The code field (the static frame and the live canvas) is 30rem tall (30 rows of 1rem) and
// bottom-anchored, and --fade says how visible it is at each height above its bottom edge. The
// buttons sit a fixed distance above the hero's bottom (the hero body's bottom padding), and the
// paragraph sits a fixed gap above the buttons, so the band the buttons occupy and the line the
// paragraph ends on can both be worked out from the CSS. These tests check that --fade is fully
// on across the band, thins out steadily above it (a little less visible behind the paragraph,
// very faint where the headline ends, nothing at the top), and is the old curve below it.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = read("../src/styles/tokens.css");

const FIELD_REM = 30;
// The headline's lower edge is this far above the band's bottom edge (the paragraph is two lines).
const HEADLINE_ABOVE_BAND = 9.8;

/** The stops of a `linear-gradient(to top, ...)` as [rem, alpha], from "#000 9rem" style stops. */
function stopsOf(text) {
  const inside = text.match(/linear-gradient\(\s*to top,([\s\S]*?)\)\s*;/)?.[1];
  assert.ok(inside, "no linear-gradient(to top, ...) in --fade");
  return inside
    .replace(/rgb\(([^)]*)\)/g, (_, parts) => `rgb:${parts.replace(/\s+/g, "_")}`)
    .split(",")
    .map((stop) => {
      const [colour, position] = stop.trim().split(/\s+/);
      assert.match(position, /^[\d.]+rem$/, `a stop without a rem position: ${stop}`);
      const alpha =
        colour === "#000"
          ? 1
          : colour === "transparent"
            ? 0
            : Number.parseFloat(colour.match(/\/_([\d.]+)$/)?.[1] ?? "NaN");
      assert.ok(Number.isFinite(alpha), `cannot read the opacity of ${colour}`);
      return [Number.parseFloat(position), alpha];
    });
}

/** The field's opacity at `d` rem above its bottom edge, interpolating linearly between stops. */
function alphaAt(stops, d) {
  if (d <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [d1, a1] = stops[i];
    const [d0, a0] = stops[i - 1];
    if (d <= d1) return a0 + ((a1 - a0) * (d - d0)) / (d1 - d0);
  }
  return stops.at(-1)[1];
}

/** The curve it replaced: opaque to 9rem, then a straight fade to nothing at the top (55% from the top). */
const oldAlpha = (d) => Math.max(0, Math.min(1, 1 - (d - 9) / (20 - 9)));

// ---------- The layout the band comes from ----------

const rem = (text, pattern) => {
  const value = Number.parseFloat(text.match(pattern)?.[1] ?? "NaN");
  assert.ok(Number.isFinite(value), `no match for ${pattern}`);
  return value;
};
const space = (name) => rem(tokens, new RegExp(`${name}:\\s*([\\d.]+)rem`));

// A button is its padding twice, one line of text and its 1px borders.
const btn = css.match(/\n\.btn\s*\{[^}]*\}/)?.[0] ?? "";
const lineHeight = rem(css, /\nbody\s*\{[^}]*line-height: ([\d.]+)/);
const BUTTON =
  2 * rem(btn, /padding: ([\d.]+)rem/) + rem(btn, /font-size: ([\d.]+)rem/) * lineHeight + 2 / 16;
// The paragraph's bottom edge is its bottom margin above the buttons.
const pitch = css.match(/\n\.pitch\s*\{[^}]*\}/)?.[0] ?? "";
assert.match(pitch, /margin-block: 0 var\(--space-4\)/);
const GAP = space("--space-4");

const phoneBlock = css.match(/@media \(max-width: 40rem\)\s*\{[\s\S]*?\n\}\n/)?.[0] ?? "";
const heroBody = (text) =>
  rem(text, /\.hero-body\s*\{[^}]*padding-block: var\(--space-\d\) ([\d.]+)rem/);

const variants = {
  desktop: {
    from: heroBody(css.replace(phoneBlock, "")),
    stops: stopsOf(css.match(/\n\.hero\s*\{[^}]*--fade:([\s\S]*?;)/)?.[1] ?? ""),
  },
  phone: {
    from: heroBody(phoneBlock),
    stops: stopsOf(phoneBlock.match(/\.hero\s*\{[^}]*--fade:([\s\S]*?;)/)?.[1] ?? ""),
  },
};

test("the layout numbers are what the fade is built for", () => {
  assert.equal(variants.desktop.from, 15);
  assert.equal(variants.phone.from, 12);
  assert.ok(BUTTON > 3 && BUTTON < 3.2, `a button is ${BUTTON.toFixed(2)}rem tall`);
  assert.equal(GAP, 1.5);
  assert.match(css, /\.field\s*\{[^}]*height: 30rem/);
  // One row is 1rem (0.8rem at a line height of 1.25 = 1rem), so the frame's rows are the field's rem.
  const rows = Number(read("../src/lib/ascii-field.ts").match(/rows: (\d+) \}/)?.[1]);
  assert.equal(rows, FIELD_REM);
});

for (const [name, { from, stops }] of Object.entries(variants)) {
  const top = from + BUTTON;

  test(`${name}: the code is fully visible across the buttons' band (${from}rem to ${top.toFixed(2)}rem)`, () => {
    for (let d = from; d <= top; d += 0.05) {
      assert.ok(
        alphaAt(stops, d) >= 0.99,
        `at ${d.toFixed(2)}rem it is ${alphaAt(stops, d).toFixed(2)}`,
      );
    }
  });

  test(`${name}: it is raised there: at least 0.25 above the old curve everywhere, 0.35 on average`, () => {
    // The phone's band is lower down the old curve, where it was already stronger, so it gains less.
    let total = 0;
    let count = 0;
    for (let d = from; d <= top; d += 0.05) {
      const gain = alphaAt(stops, d) - oldAlpha(d);
      assert.ok(gain >= 0.25, `at ${d.toFixed(2)}rem: ${alphaAt(stops, d)} vs old ${oldAlpha(d)}`);
      total += gain;
      count++;
    }
    assert.ok(total / count >= 0.35, `the mean gain is ${(total / count).toFixed(2)}`);
  });

  test(`${name}: above the band it thins out steadily: less behind the paragraph, very faint where the headline ends, nothing at the top`, () => {
    let last = 1;
    for (let d = top; d <= FIELD_REM; d += 0.05) {
      const a = alphaAt(stops, d);
      assert.ok(a <= last + 1e-9, `at ${d.toFixed(2)}rem it rises to ${a.toFixed(3)}`);
      last = a;
    }
    const paragraph = alphaAt(stops, top + GAP);
    assert.ok(
      paragraph > 0.5 && paragraph < 0.9,
      `a little less visible at the paragraph: ${paragraph}`,
    );
    const headline = alphaAt(stops, from + HEADLINE_ABOVE_BAND);
    assert.ok(
      headline >= 0.05 && headline <= 0.12,
      `very faint, not gone, under the headline: ${headline}`,
    );
    assert.equal(alphaAt(stops, FIELD_REM), 0);
  });

  test(`${name}: no step is abrupt: it never drops more than 0.15 in half a rem`, () => {
    for (let d = top; d + 0.5 <= FIELD_REM; d += 0.05) {
      const drop = alphaAt(stops, d) - alphaAt(stops, d + 0.5);
      assert.ok(drop <= 0.15, `at ${d.toFixed(2)}rem it falls ${drop.toFixed(2)}`);
    }
  });

  test(`${name}: below the band it is the old curve, so only the band changed`, () => {
    for (let d = 0; d <= from - 2; d += 0.25) {
      assert.ok(
        Math.abs(alphaAt(stops, d) - oldAlpha(d)) < 0.02,
        `at ${d}rem: ${alphaAt(stops, d)} vs old ${oldAlpha(d)}`,
      );
    }
  });

  test(`${name}: the stops are in order and the opacity rises into the band, then falls away above it`, () => {
    const positions = stops.map(([d]) => d);
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b),
    );
    assert.ok(alphaAt(stops, from - 2) < alphaAt(stops, from));
    assert.ok(alphaAt(stops, top) > alphaAt(stops, top + 1));
    assert.equal(alphaAt(stops, 0), 1, "the bottom of the field is fully visible, as before");
  });
}

test("the phone's band sits 3rem lower than the desktop's, as the hero body's padding does", () => {
  assert.equal(variants.desktop.from - variants.phone.from, 3);
  const shift = variants.desktop.stops.map(([d]) => d);
  const phone = variants.phone.stops.map(([d]) => d);
  assert.equal(shift.at(-1) - phone.at(-1), 3);
});

test("the static frame and the live canvas use the same fade, and the old fixed 55% curve is gone", () => {
  assert.match(css, /\.ascii\s*\{[^}]*mask-image:\s*var\(--fade\),/);
  assert.match(css, /\.field\s*\{[^}]*mask-image: var\(--fade\);/);
  assert.ok(
    !/linear-gradient\(to bottom, transparent, #000 55%\)/.test(css),
    "the old fade is still there",
  );
});
