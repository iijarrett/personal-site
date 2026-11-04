import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ALPHA, HEX_ALPHA } from "../src/lib/ascii-field.ts";
import { colour, contrast, mix, percent, themes } from "./helpers/contrast.mjs";

// The hero buttons are see-through, so the code field shows through them. Their text must
// stay at 4.5:1 and their border at 3:1 (WCAG 1.4.3 and 1.4.11) over the worst thing that can
// be behind them: the brightest glyph the field ever draws, at its highest opacity, in both
// themes. Everything is read from the CSS and from src/lib/ascii-field.ts, so changing a fill,
// a token or the field's alpha re-runs the measurement.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
const hero = read("../src/scripts/hero.ts");

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The declarations of a top-level rule, found by its exact selector. */
function rule(selector) {
  const match = css.match(new RegExp(`(?:^|\\n)${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `global.css has no top-level ${selector} rule`);
  return match[1];
}

const fillOf = (declarations) => {
  const match = declarations.match(/color-mix\(in srgb, var\(--bg\) (\d+)%, transparent\)/);
  assert.ok(match, "no fill made from the page colour");
  return Number.parseInt(match[1], 10) / 100;
};
const borderOf = (declarations) => declarations.match(/border-color: var\((--[\w-]+)\)/)?.[1];

const secondary = rule(".actions .btn");
const primary = rule(".actions .btn-primary");
const GLOW =
  /linear-gradient\(\s*to top,\s*color-mix\(in srgb, var\((--[\w-]+)\) var\((--[\w-]+)\), transparent\),\s*transparent 65%\s*\)/;

// ---------- The worst thing behind a button ----------

const number = (declarations, property) =>
  Number.parseFloat(declarations.match(new RegExp(`${property}: ([\\d.]+)`))?.[1] ?? "NaN");
const fieldOpacity = number(rule(".field"), "opacity");
const staticFrame = number(rule(".ascii"), "opacity") * number(rule(".ascii .t2"), "opacity");
/** The canvas draws ramp glyphs at ALPHA and the hex digits near the cursor at HEX_ALPHA. */
const brightest = Math.max(HEX_ALPHA, ...ALPHA);
/** The highest opacity any glyph reaches on the page, where the field's own mask is fully open. */
const WORST = Math.max(fieldOpacity * brightest, staticFrame);

test("the worst case is read from the field: the hex digit at full strength under the canvas's opacity", () => {
  assert.ok(Number.isFinite(WORST) && WORST > 0.4 && WORST < 1, String(WORST));
  assert.equal(WORST, fieldOpacity * HEX_ALPHA);
  // Both the static frame and the canvas draw in --accent.
  assert.match(rule(".ascii"), /color: var\(--accent\)/);
  assert.match(hero, /getPropertyValue\("--accent"\)/);
});

// ---------- What the buttons are made of ----------

test("both buttons are see-through, and the secondary is the more transparent", () => {
  const quiet = fillOf(secondary);
  const strong = fillOf(primary);
  assert.ok(quiet > 0 && strong < 1, "a button is fully clear or fully solid");
  assert.ok(
    quiet < strong,
    `the secondary (${quiet}) must be more transparent than the primary (${strong})`,
  );
  assert.ok(!/background:\s*var\(--accent/.test(primary), "the primary is solid again");
});

test("the primary carries the tile's hover glow, always on, static and independent of motion", () => {
  assert.match(primary, GLOW, "no bottom-up glow gradient");
  const [, colourToken, strengthToken] = primary.match(GLOW);
  const card = css.match(/\.card::before\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(
    card.includes(`color-mix(in srgb, var(${colourToken}) var(${strengthToken}), transparent)`),
  );
  assert.equal(strengthToken, "--glow-hover", "the glow is not the hovered tile's strength");
  const ring =
    "inset 0 0 0 1px var(--ring), 0 0 1rem color-mix(in srgb, var(--ring) var(--halo), transparent)";
  const flat = (text) => text.replace(/\s+/g, " ");
  assert.ok(flat(primary).includes(ring), "the ring and halo differ from the hovered tile's");
  assert.ok(flat(css).includes(`box-shadow: ${ring}`));
  for (const motion of [/animation/, /transition/, /@keyframes/]) {
    assert.ok(!motion.test(primary), `the primary uses ${motion}`);
  }
  assert.ok(
    !/\.no-fx[^{]*\.actions|\.actions[^{]*\.no-fx/.test(css),
    "the glow depends on the motion switch",
  );
});

test("the hero buttons' text is the page text colour, not a colour made for the old solid fill", () => {
  assert.match(rule(".btn"), /color: var\(--text\)/);
  assert.ok(!/(^|\s)color:/.test(primary) && !/(^|\s)color:/.test(secondary));
});

// ---------- Contrast, both themes ----------

for (const [name, block] of Object.entries(themes)) {
  const c = (token) => colour(block, token);
  const bg = c("--bg");
  const glyph = c("--accent");

  /** What is behind a button: `base` (the page, or the brightest glyph on it), the fill, then the glow's peak. */
  function over(base, declarations, withGlow) {
    let at = mix(base, bg, fillOf(declarations));
    if (withGlow) {
      const [, glowToken, strengthToken] = declarations.match(GLOW);
      at = mix(at, c(glowToken), percent(block, strengthToken));
    }
    return at;
  }
  const worstBehind = (declarations, withGlow) =>
    over(mix(bg, glyph, WORST), declarations, withGlow);
  const bareBehind = (declarations, withGlow) => over(bg, declarations, withGlow);

  for (const [label, declarations, withGlow] of [
    ["secondary", secondary, false],
    ["primary", primary, true],
  ]) {
    test(`${name}: the ${label} button's text is at least 4.5:1 over the brightest glyph at full opacity`, () => {
      const ratio = contrast(c("--text"), worstBehind(declarations, withGlow));
      assert.ok(ratio >= 4.5, `${name} ${label} text is ${ratio.toFixed(2)}:1`);
    });

    test(`${name}: the ${label} button's border is at least 3:1 over the brightest glyph and over the bare page`, () => {
      const token = borderOf(declarations);
      assert.ok(token, `${label} has no border-color token`);
      const worst = contrast(c(token), worstBehind(declarations, withGlow));
      assert.ok(
        worst >= 3,
        `${name} ${label} border ${token} is ${worst.toFixed(2)}:1 over a glyph`,
      );
      const bare = contrast(c(token), bareBehind(declarations, withGlow));
      assert.ok(bare >= 3, `${name} ${label} border ${token} is ${bare.toFixed(2)}:1 on the page`);
    });

    test(`${name}: the ${label} button's text reads at least as well with no glyph behind it`, () => {
      const worst = contrast(c("--text"), worstBehind(declarations, withGlow));
      const bare = contrast(c("--text"), bareBehind(declarations, withGlow));
      assert.ok(bare >= worst - 1e-9, `bare ${bare.toFixed(2)} < worst ${worst.toFixed(2)}`);
    });
  }
}

test("the hover state is an opaque surface, which hides the code and only raises contrast", () => {
  assert.match(rule(".actions .btn:hover"), /background-color: var\(--surface\)/);
  for (const [name, block] of Object.entries(themes)) {
    const ratio = contrast(colour(block, "--text"), colour(block, "--surface"));
    assert.ok(ratio >= 4.5, `${name} --text on --surface is ${ratio.toFixed(2)}:1`);
  }
});

test("only the hero buttons were restyled: the other .btn on the site keeps its plain look", () => {
  assert.ok(!/(^|[\s;])background:/.test(rule(".btn")), "the base .btn grew a background");
  assert.match(
    read("../src/pages/index.astro"),
    /<a class="btn" href="\/projects\/">All projects<\/a>/,
  );
});
