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
/** A rule's own border-color token, or else the base .btn border it inherits. */
const borderOf = (declarations) =>
  declarations.match(/border-color: var\((--[\w-]+)\)/)?.[1] ??
  rule(".btn").match(/border: 1px solid var\((--[\w-]+)\)/)?.[1];

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
  const card =
    css.match(/:is\(\.card, \.profile-card, \.profile \.item\)::before\s*\{[^}]*\}/)?.[0] ?? "";
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

  for (const [label, declarations, hasGlow] of [
    ["secondary", secondary, false],
    ["primary", primary, true],
  ]) {
    // The glow tints the fill toward the glow colour: that lowers the text's contrast in the dark
    // theme and raises it in the light one. So the worst case is the lower of "glow at its peak"
    // and "no glow at all", and both are checked.
    const glows = hasGlow ? [true, false] : [false];
    const glowName = (withGlow) => (withGlow ? "glow at its peak" : "no glow");

    for (const withGlow of glows) {
      test(`${name}: the ${label} button's text is at least 4.5:1 over the brightest glyph at full opacity, with ${glowName(withGlow)}`, () => {
        const ratio = contrast(c("--text"), worstBehind(declarations, withGlow));
        assert.ok(
          ratio >= 4.5,
          `${name} ${label} text is ${ratio.toFixed(2)}:1 with ${glowName(withGlow)}`,
        );
      });

      test(`${name}: the ${label} button's border is at least 3:1 against what is inside it, over the brightest glyph and over the bare page, with ${glowName(withGlow)}`, () => {
        const token = borderOf(declarations);
        assert.ok(token, `${label} has no border-color token`);
        const worst = contrast(c(token), worstBehind(declarations, withGlow));
        assert.ok(
          worst >= 3,
          `${name} ${label} border ${token} is ${worst.toFixed(2)}:1 over a glyph`,
        );
        const bare = contrast(c(token), bareBehind(declarations, withGlow));
        assert.ok(
          bare >= 3,
          `${name} ${label} border ${token} is ${bare.toFixed(2)}:1 on the page`,
        );
      });

      test(`${name}: the ${label} button's text reads at least as well with no glyph behind it, with ${glowName(withGlow)}`, () => {
        const worst = contrast(c("--text"), worstBehind(declarations, withGlow));
        const bare = contrast(c("--text"), bareBehind(declarations, withGlow));
        assert.ok(bare >= worst - 1e-9, `bare ${bare.toFixed(2)} < worst ${worst.toFixed(2)}`);
      });
    }

    test(`${name}: the ${label} button's border is at least 3:1 against what is just outside it, where the unfaded code can reach its edge`, () => {
      const token = borderOf(declarations);
      const shadow = declarations.replace(/\s+/g, " ").match(/box-shadow: ([^;]*);/)?.[1] ?? "";
      // A keyline: a 1px ring in a flat token, the first (outermost) shadow, directly outside the border.
      const keyline = shadow.match(/^0 0 0 1px var\((--[\w-]+)\)/)?.[1];
      // Without one, the neighbour is the brightest glyph at full opacity, tinted by the halo for the primary.
      let outside = keyline ? c(keyline) : mix(bg, glyph, WORST);
      if (!keyline && hasGlow) outside = mix(outside, c("--ring"), percent(block, "--halo"));
      const ratio = contrast(c(token), outside);
      assert.ok(
        ratio >= 3,
        `${name} ${label} border ${token} is ${ratio.toFixed(2)}:1 against ${keyline ?? "unfaded code"} just outside it`,
      );
      // The keyline must be opaque, or it is not a keyline.
      if (keyline) assert.equal(keyline, "--bg");
    });
  }
}

test("both hero buttons have the keyline that makes the outside neighbour the page, not the code", () => {
  for (const declarations of [secondary, primary]) {
    const shadow = declarations.replace(/\s+/g, " ").match(/box-shadow: ([^;]*);/)?.[1] ?? "";
    assert.match(shadow, /^0 0 0 1px var\(--bg\)(,|$)/, "the first shadow is not the keyline");
  }
  // And it is needed: without it, the border against the brightest code outside is under 3:1 in at least one theme.
  const unprotected = Object.values(themes).map((block) => {
    const code = mix(colour(block, "--bg"), colour(block, "--accent"), WORST);
    return Math.min(
      contrast(colour(block, borderOf(secondary)), code),
      contrast(colour(block, borderOf(primary)), code),
    );
  });
  assert.ok(Math.min(...unprotected) < 3, `the keyline is not needed: ${unprotected}`);
});

test("the hover state is an opaque surface, which hides the code and only raises contrast", () => {
  assert.match(rule(".actions .btn:hover"), /background-color: var\(--surface\)/);
  for (const [name, block] of Object.entries(themes)) {
    const ratio = contrast(colour(block, "--text"), colour(block, "--surface"));
    assert.ok(ratio >= 4.5, `${name} --text on --surface is ${ratio.toFixed(2)}:1`);
  }
});

test("only the hero buttons were restyled: the other .btn on the site keeps its plain, fill-less look", () => {
  assert.ok(!/(^|[\s;])background:/.test(rule(".btn")), "the base .btn grew a background");
  assert.match(
    read("../src/pages/index.astro"),
    /<a class="btn" href="\/projects\/">All projects<\/a>/,
  );
});

// ---------- "All projects": the plain .btn, which has no fill and sits on the page ----------

test("every .btn on the site is one of the three this file measures, so none was missed", () => {
  const pages = ["index"].map((name) => read(`../src/pages/${name}.astro`));
  const found = pages.flatMap((page) => [...page.matchAll(/class="(btn[^"]*)"/g)].map((m) => m[1]));
  assert.deepEqual(found.sort(), ["btn", "btn", "btn btn-primary"]);
  for (const other of [
    "../src/components/Header.astro",
    "../src/components/Footer.astro",
    "../src/components/Card.astro",
    "../src/layouts/Page.astro",
    "../src/layouts/Base.astro",
  ]) {
    // A whole class name: "settings-btn" is a different class.
    assert.ok(!/class="(?:[^"]*\s)?btn(?:\s[^"]*)?"/.test(read(other)), `${other} uses .btn`);
  }
});

test("the base .btn border is --muted, not the old --border", () => {
  assert.equal(rule(".btn").match(/border: 1px solid var\((--[\w-]+)\)/)?.[1], "--muted");
  assert.equal(borderOf(secondary), "--muted", "the hero secondary no longer sets its own");
  assert.equal(borderOf(primary), "--ring");
  assert.ok(!/border[^;]*var\(--border\)/.test(rule(".btn")), "a .btn border still uses --border");
});

for (const [name, block] of Object.entries(themes)) {
  const c = (token) => colour(block, token);
  const token = borderOf(rule(".btn"));

  test(`${name}: the All projects border is at least 3:1 on the page and on a hovered tile's surface`, () => {
    for (const base of ["--bg", "--surface"]) {
      const ratio = contrast(c(token), c(base));
      assert.ok(ratio >= 3, `${name} ${token} on ${base} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${name}: the All projects text is at least 4.5:1 on the page and on the hover surface`, () => {
    for (const base of ["--bg", "--surface"]) {
      const ratio = contrast(c("--text"), c(base));
      assert.ok(ratio >= 4.5, `${name} --text on ${base} is ${ratio.toFixed(2)}:1`);
    }
  });
}
