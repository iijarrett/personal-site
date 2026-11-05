import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const header = read("../src/components/Header.astro");
const css = read("../src/styles/global.css");

// ---------- Markup: what slides, and what does not ----------

test("the brand and nav are inside .bar, which slides; the settings button is outside it, so it never moves", () => {
  const bar = header.indexOf('<div class="bar">');
  const settings = header.indexOf('<div class="settings">');
  assert.ok(bar > 0 && settings > bar, "the markup is not .bar then .settings");
  const barEnd = header.indexOf("</header>");
  const insideBar = header.slice(bar, settings);
  assert.match(insideBar, /class="brand"/);
  assert.match(insideBar, /class="site-nav"/);
  assert.ok(!/class="settings/.test(insideBar), "the settings button is inside the sliding bar");
  assert.ok(barEnd > settings);
});

test("only .bar is moved by the scroll rules", () => {
  const moved = [...css.matchAll(/([^{}]+)\{[^{}]*translateY\(var\(--bar-y/g)].map((m) =>
    m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim(),
  );
  assert.deepEqual(moved, [".js .bar"]);
  assert.ok(!/\.settings[^{]*\{[^}]*transform/.test(css));
});

// ---------- CSS: everything that hides the bar needs .js ----------

test("with JavaScript off nothing hides or sticks the header: every such rule is under .js", () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(plain, /\n\.site-header\s*\{\s*position: relative;\s*z-index: 5;\s*\}/);
  for (const needle of [/position: sticky/, /--bar-y/]) {
    for (const match of plain.matchAll(new RegExp(`([^{}]+)\\{[^{}]*${needle.source}`, "g"))) {
      const selector = match[1]
        .trim()
        .replace(/^@media[^{]*\{/, "")
        .trim();
      assert.match(
        selector,
        /\.js\b|html\.js/,
        `${needle} is applied by "${selector}", which does not need .js`,
      );
    }
  }
});

test("the plain header rule does not swallow clicks: that is only done under .js", () => {
  const plain = css.match(/\n\.site-header\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(plain.length > 0 && !/pointer-events/.test(plain), plain);
});

test("the bar starts hidden on wide screens and shown on narrow ones, before the script runs", () => {
  assert.match(
    css,
    /@media [^{]*\(min-width: 641px\)[^{]*\{\s*html\.js:not\(\.bar-on\)\s*\{\s*--bar-y: -100%;\s*--float: var\(--muted\);\s*\}\s*\}/,
  );
  assert.match(
    css,
    /@media [^{]*\(max-width: 640px\)[^{]*\{\s*html\.js\.bar-off\s*\{\s*--bar-y: -100%;\s*--float: var\(--muted\);\s*\}\s*\}/,
  );
});

test("the header sticks but lets clicks through, and only the bar, the button and the skip link take them", () => {
  assert.match(
    css,
    /\.js \.site-header\s*\{\s*position: sticky;\s*top: 0;\s*pointer-events: none;\s*\}/,
  );
  assert.match(
    css,
    /\.js \.bar,\s*\.js \.settings,\s*\.js \.skip-link\s*\{\s*pointer-events: auto;\s*\}/,
  );
});

test("the bar slides for 0.25 s, and with Motion off or reduced motion it does not", () => {
  assert.match(css, /\.js \.bar\s*\{[^}]*transition: transform 0\.25s ease/);
  assert.match(css, /\.no-fx \.bar\s*\{\s*transition: none;\s*\}/);
  // The global reduced-motion rule makes every transition instant.
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*transition-duration: 0\.01ms !important/,
  );
});

test("with the bar away, the settings button gets its own outline and a solid background", () => {
  const button = css.match(/\.settings-btn\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(button, /background: var\(--bg\)/);
  assert.match(button, /border: 1px solid var\(--float, transparent\)/);
});

// ---------- Focus is never left under the header (WCAG 2.4.11) ----------

test("scroll-padding-top covers the sticky header at both widths, so a focused element is not hidden under it", () => {
  const rem = (pattern) => Number.parseFloat(css.match(pattern)?.[1] ?? "NaN");
  const wide = rem(/\n\.js\s*\{\s*scroll-padding-top: ([\d.]+)rem;/);
  const phone = rem(/\.js\s*\{\s*scroll-padding-top: ([\d.]+)rem;\s*\}\s*\}\s*\n/);
  // Measured header heights: 61 px on a wide screen, 129 px with the nav on two rows on a phone.
  assert.ok(wide >= 61 / 16, `wide scroll-padding-top ${wide}rem`);
  assert.ok(phone >= 129 / 16, `phone scroll-padding-top ${phone}rem`);
  assert.ok(phone > wide);
});

test("the skip link and the settings panel stay on top of the page, inside the header's stacking context", () => {
  assert.match(css, /\.site-header\s*\{\s*position: relative;\s*z-index: 5;/);
  assert.match(css, /\.skip-link\s*\{[^}]*z-index: 10/);
});
