import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACCENT_VARS, ACCENTS, accentValues, HOME_NAME, nextAccent } from "../src/lib/accents.ts";

// Every colour the footer game hands out must hold the same limits as the purple it replaces:
// the tokens it sets are the ones the stylesheet's own contrast tests are written against.

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const [darkCss, lightCss] = css.split('html[data-theme="light"]');
const token = (block, name) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1];
const THEMES = {
  dark: {
    light: false,
    bg: token(darkCss, "--bg"),
    surface: token(darkCss, "--surface"),
    text: token(darkCss, "--text"),
    onAccent: token(darkCss, "--on-accent"),
    glowStrength: 0.2, // --glow-hover
  },
  light: {
    light: true,
    bg: token(lightCss, "--bg"),
    surface: token(lightCss, "--surface"),
    text: token(lightCss, "--text"),
    onAccent: token(lightCss, "--on-accent"),
    glowStrength: 0.8, // --glow-hover
  },
};

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const lin = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (fg, bg, alpha) =>
  `#${rgb(fg)
    .map((v, i) =>
      Math.round(v * alpha + rgb(bg)[i] * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

test("the page's own tokens were read", () => {
  for (const t of Object.values(THEMES)) {
    for (const k of ["bg", "surface", "text", "onAccent"]) assert.match(t[k], /^#[0-9a-f]{6}$/i, k);
  }
});

test("there are three or four colours, each with a name and a value for every token", () => {
  assert.ok(ACCENTS.length >= 3 && ACCENTS.length <= 4, `${ACCENTS.length} colours`);
  assert.equal(new Set(ACCENTS.map((a) => a.name)).size, ACCENTS.length, "names are distinct");
  assert.ok(!ACCENTS.some((a) => a.name === HOME_NAME), "purple is the home colour, not listed");
  for (const a of ACCENTS) {
    for (const light of [false, true]) {
      const values = accentValues(a, light);
      assert.equal(values.length, ACCENT_VARS.length);
      for (const v of values) assert.match(v, /^#[0-9a-f]{6}$/i, `${a.name} ${v}`);
    }
  }
});

for (const a of ACCENTS) {
  for (const [name, theme] of Object.entries(THEMES)) {
    const [accent, text, glow, ring] = accentValues(a, theme.light);
    test(`${a.name}, ${name}: text and links are 4.5:1 on the page and on a surface`, () => {
      assert.ok(contrast(text, theme.bg) >= 4.5, `${text} on bg ${contrast(text, theme.bg)}`);
      assert.ok(contrast(text, theme.surface) >= 4.5, `${text} on surface`);
    });
    test(`${a.name}, ${name}: a button fill in it holds its label at 4.5:1`, () => {
      assert.ok(contrast(theme.onAccent, text) >= 4.5, `${theme.onAccent} on ${text}`);
    });
    test(`${a.name}, ${name}: the ring and the accent are 3:1 on the page and the surface`, () => {
      for (const c of [ring, theme.light ? ring : accent]) {
        assert.ok(contrast(c, theme.bg) >= 3, `${c} on bg`);
        assert.ok(contrast(c, theme.surface) >= 3, `${c} on surface`);
      }
    });
    test(`${a.name}, ${name}: tile text stays 4.5:1 over the hovered glow`, () => {
      for (const ground of [theme.bg, theme.surface]) {
        const lit = blend(glow, ground, theme.glowStrength);
        assert.ok(contrast(theme.text, lit) >= 4.5, `${theme.text} over ${lit}`);
      }
    });
  }
}

test("the colours go round once and then back to purple", () => {
  const seen = [];
  let at = -1;
  for (let k = 0; k <= ACCENTS.length; k++) {
    seen.push(at);
    at = nextAccent(at);
  }
  assert.deepEqual(seen, [-1, ...ACCENTS.map((_, i) => i)]);
  assert.equal(at, -1, "after the last colour it is home again");
});
