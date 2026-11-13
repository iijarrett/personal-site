import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The tile glow sits behind text, so at its strongest it must still leave every
// text colour at WCAG AA (4.5:1). Three cases, in both themes, straight from the
// numbers in src/styles/tokens.css:
//   rest   the always-on gradient where there is no hover. Text near the bottom edge
//          of a tile is under almost the full strength, so the peak is the worst case.
//   hover  the brighter gradient on the hovered or focused tile, over its hover surface.
//   halo   the lit tile's outer glow, spilling onto a neighbouring tile at rest.
// The ring and the focus outlines are not text, so they need 3:1 (WCAG 1.4.11) against
// what they sit on instead: the hover surface, and the page behind a neighbouring tile.
// They are measured with whichever token global.css actually uses for them.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokens = read("../src/styles/tokens.css");
const css = read("../src/styles/global.css");
const split = tokens.indexOf('html[data-theme="light"]');
assert.ok(split > 0, "tokens.css has no html[data-theme=light] block");
const themes = { dark: tokens.slice(0, split), light: tokens.slice(split) };

/** The token a CSS declaration uses, found by pattern so renaming it in the CSS cannot dodge a test. */
const tokenUsedBy = (pattern, what) => {
  const match = css.match(pattern);
  assert.ok(match, `global.css has no ${what}`);
  return match[1];
};
const ringToken = tokenUsedBy(/inset 0 0 0 1px var\((--[\w-]+)\)/, "1px inset hover ring");
const haloToken = tokenUsedBy(
  /color-mix\(in srgb, var\((--[\w-]+)\) var\(--halo\), transparent\)/,
  "halo",
);
const outlineTokens = [...css.matchAll(/outline: 2px solid var\((--[\w-]+)\)/g)].map((m) => m[1]);

const token = (block, name) => {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6}|\\d+%)`));
  assert.ok(match, `${name} missing`);
  return match[1];
};
const percent = (block, name) => Number.parseInt(token(block, name), 10) / 100;
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const linear = (channel) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (base, tint, amount) => base.map((v, i) => v * (1 - amount) + tint[i] * amount);

const TEXTS = ["--text", "--muted", "--accent-text"];

/** Fails if any text colour drops under 4.5:1 on `base` tinted by `tint` at `amount`. */
function assertReadable(name, block, label, base, tint, amount) {
  const background = mix(rgb(token(block, base)), rgb(token(block, tint)), amount);
  for (const text of TEXTS) {
    const ratio = contrast(rgb(token(block, text)), background);
    assert.ok(
      ratio >= 4.5,
      `${name} ${text} on ${base} under the ${label} is ${ratio.toFixed(2)}:1`,
    );
  }
}

for (const [name, block] of Object.entries(themes)) {
  test(`${name}: text is readable over the always-on gradient at its bottom edge`, () => {
    // Only where there is no hover, and the hover background (--surface) is gated to
    // (hover: hover) in global.css, so these tiles always sit on the page background.
    assertReadable(name, block, "rest gradient", "--bg", "--glow", percent(block, "--glow-rest"));
  });

  test(`${name}: text is readable over the brighter hovered gradient`, () => {
    const hover = percent(block, "--glow-hover");
    for (const base of ["--surface", "--bg"]) {
      assertReadable(name, block, "hovered gradient", base, "--glow", hover);
    }
  });

  test(`${name}: a neighbouring tile's text is readable under the outer glow`, () => {
    assertReadable(name, block, "outer glow", "--bg", haloToken, percent(block, "--halo"));
  });

  test(`${name}: the 1px hover ring is at least 3:1 against the hover surface and a neighbouring tile`, () => {
    const ring = rgb(token(block, ringToken));
    for (const base of ["--surface", "--bg"]) {
      const ratio = contrast(ring, rgb(token(block, base)));
      assert.ok(ratio >= 3, `${name} ring ${ringToken} on ${base} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${name}: every 2px focus outline is at least 3:1 against both backgrounds`, () => {
    assert.ok(outlineTokens.length >= 2, "expected the global and the tile focus outlines");
    for (const outline of outlineTokens) {
      for (const base of ["--bg", "--surface"]) {
        const ratio = contrast(rgb(token(block, outline)), rgb(token(block, base)));
        assert.ok(ratio >= 3, `${name} outline ${outline} on ${base} is ${ratio.toFixed(2)}:1`);
      }
    }
  });

  test(`${name}: the hovered edge is brighter than the resting one`, () => {
    assert.ok(percent(block, "--glow-hover") > percent(block, "--glow-rest"));
  });
}

test("the light glow is lighter than the surface it sits on, so it cannot lower contrast", () => {
  const light = themes.light;
  const surface = luminance(rgb(token(light, "--surface")));
  assert.ok(luminance(rgb(token(light, "--glow"))) > surface);
});

test("global.css draws exactly what is measured here", () => {
  for (const name of ["--glow", "--glow-rest", "--glow-hover", "--halo", "--ring"]) {
    assert.ok(css.includes(`var(${name})`), `${name} is not used by global.css`);
  }
  // One edge colour for the ring, its halo and the focus outlines, so one test covers all.
  assert.equal(ringToken, "--ring");
  assert.equal(haloToken, "--ring");
  assert.ok(
    outlineTokens.every((outline) => outline === "--ring"),
    outlineTokens.join(),
  );
  // The home page's tiles and the Me page's tiles share one set of glow rules.
  assert.match(
    css,
    new RegExp(
      String.raw`:is\(\.card, \.profile-card, \.profile \.item\)::before\s*\{[^}]*linear-gradient\(\s*to top,[^}]*transparent 65%`,
    ),
  );
  assert.match(css, /@media \(hover: hover\)\s*\{[^@]*\.card:hover/);
  assert.match(
    css,
    new RegExp(
      String.raw`@media \(hover: none\)\s*\{\s*:is\(\.card, \.profile-card, \.profile \.item\)::before\s*\{[^}]*opacity: 1`,
    ),
  );
});

test("the hover background exists only where there is hover, so a tap cannot leave it stuck", () => {
  assert.ok(!/\n\.card:hover\s*\{/.test(css), "a top-level .card:hover rule is back");
  assert.match(
    css,
    /@media \(hover: hover\)\s*\{\s*\.card:hover\s*\{\s*background: var\(--surface\)/,
  );
});

test("the card glow is plain CSS: nothing from the old cursor spotlight is left", () => {
  for (const gone of ["--mx", "--my", "--glow-strength", "is-lit", ".fx "]) {
    assert.ok(!css.includes(gone), `global.css still mentions ${gone}`);
  }
  assert.match(
    css,
    new RegExp(
      String.raw`\.no-fx :is\(\.card, \.profile-card, \.profile \.item\),\s*\.no-fx :is\(\.card, \.profile-card, \.profile \.item\)::before\s*\{\s*transition: none`,
    ),
  );
});
