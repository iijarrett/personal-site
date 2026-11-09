import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Only the home page hides its header bar when it opens (it slides in on scroll-up, at the top
// edge or with keyboard focus). Every other page keeps the bar showing, always.
//
// Base.astro builds every page except home with bar-on already on <html>. bar-on is what the bar
// script sets when it shows the bar, so the CSS never starts it hidden there, and the main script
// does not start the bar logic on such a page, so nothing ever adds bar-off.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("the layout puts bar-on on every page except home", () => {
  const base = read("../src/layouts/Base.astro");
  assert.match(base, /const home = Astro\.url\.pathname === "\/"/);
  assert.match(base, /<html lang="en" class=\{home \? undefined : "bar-on"\}>/);
});

test("the main script starts the bar logic only on a page that is not already showing the bar", () => {
  const main = read("../src/scripts/interactive.ts");
  assert.match(
    main,
    /if \(!document\.documentElement\.classList\.contains\("bar-on"\)\) initBar\(\);/,
  );
  assert.doesNotMatch(main, /bar-off/);
  // The bar script itself is unchanged: its logic is the home page's behaviour.
  assert.match(read("../src/scripts/bar.ts"), /export function initBar\(\): void/);
});

test("with bar-on on <html> the CSS never hides the bar", () => {
  // Hiding comes from the bar-off marker, or from the pre-script state of a wide screen, which
  // is `:not(.bar-on, .bar-off, ...)`. A page built with bar-on is in neither.
  assert.match(css, /html\.js\.bar-off\s*\{/);
  assert.match(css, /html\.js:not\(\.bar-on, \.bar-off/);
  assert.match(css, /html\.js:not\(\.bar-on, \.bar-off\) \.bar\s*\{/);
});

test("the head script does not need to know about it", () => {
  assert.doesNotMatch(read("../public/theme-init.js"), /bar-on/);
});
