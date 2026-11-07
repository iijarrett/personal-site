import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The scroll reveal and the closing wordmark are decoration. The page must read the same with JS
// off, in a browser without scroll-driven animations, with reduced motion, and with the Motion
// switch off. These tests read the CSS and the footer markup and hold it to that.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
const footer = read("../src/components/Footer.astro");

const keyframes = css.match(/@keyframes reveal\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? "";
const media = css.match(
  /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*([^{]+)\{([^}]*)\}\s*\}/,
);
const selector = media?.[1].trim() ?? "";
const body = media?.[2] ?? "";

test("the reveal rule lives only inside the no-preference reduced-motion query", () => {
  assert.ok(media, "no (prefers-reduced-motion: no-preference) block found");
  assert.equal(css.split("animation-timeline").length - 1, 1, "animation-timeline used elsewhere");
  assert.equal(
    css.split("animation-name: reveal").length - 1,
    1,
    "reveal applied outside the query",
  );
});

test("it uses animation longhands: the minifier would fold the timeline into a shorthand", () => {
  // Folded into "animation: ... view()", older browsers reject the whole declaration.
  assert.ok(!/animation:/.test(body), "the animation shorthand is used in the reveal rule");
  for (const longhand of ["animation-name", "animation-timing-function", "animation-fill-mode"]) {
    assert.ok(body.includes(`${longhand}:`), `${longhand} missing`);
  }
  assert.ok(!/animation-duration/.test(body), "a set duration would stop the 0s fallback");
});

test("the Motion switch turns it off: the selector excludes .no-fx", () => {
  assert.match(selector, /^html:not\(\.no-fx\) /);
});

test("it reveals the bento tiles and the wordmark, nothing else", () => {
  assert.match(selector, /:is\(\.bento > \*, \.wordmark\)$/);
});

test("it is scroll-driven (view timeline) and runs over the tile's entry", () => {
  assert.match(body, /animation-timeline: view\(\);/);
  assert.match(body, /animation-range: entry 0% entry 30%;/);
});

test("the keyframes only have a from, so the end state is the element's own styles", () => {
  assert.match(keyframes, /\bfrom\s*\{/);
  assert.ok(!/\bto\s*\{|\d+%\s*\{/.test(keyframes), "keyframes set an end state");
});

test("it moves with translate, never transform, so a tile's hover state is not overridden", () => {
  assert.match(keyframes, /translate:/);
  assert.ok(!/transform:/.test(keyframes));
});

test("no rule hides a tile or the wordmark outside the reveal animation (JS-off safe)", () => {
  const hiding = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(
    ([, sel, rules]) =>
      /\.bento|\.wordmark|\.card/.test(sel) &&
      /opacity:\s*0\b|visibility:\s*hidden|display:\s*none/.test(rules),
  );
  // The tile glow layer (.card::before) is the only thing that starts at opacity 0.
  for (const [, sel] of hiding) assert.match(sel, /::before/, `${sel.trim()} hides content`);
});

test("the reveal is pure CSS: no script touches it", () => {
  for (const file of ["bar", "hero", "settings", "motion-state", "interactive"]) {
    assert.ok(!/reveal|wordmark/.test(read(`../src/scripts/${file}.ts`)), `${file}.ts mentions it`);
  }
});

test("the wordmark is decorative text in the footer: hidden from screen readers, mono, muted", () => {
  assert.match(footer, /<p class="wordmark" aria-hidden="true">JD<\/p>/);
  const rule = css.match(/\.wordmark\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /font: 400 clamp\(4rem, 18vw, 8rem\) \/ 1 var\(--font-mono\)/);
  assert.match(rule, /color: var\(--muted\)/);
});
