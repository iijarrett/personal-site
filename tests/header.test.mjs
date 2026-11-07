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
      // The Security page's pinned intro is sticky in plain CSS on purpose (no script, see
      // tests/showcase.test.mjs); this test is about the header.
      if (selector === "html:not(.no-fx) .showcase-pin") continue;
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

test("the bar's hide rules: bar-off hides at any width, and before the script a wide screen starts hidden", () => {
  assert.match(css, /\nhtml\.js\.bar-off\s*\{\s*--bar-y: -100%;\s*--float: var\(--muted\);\s*\}/);
  assert.match(
    css,
    /@media \(min-width: 641px\) and \(hover: hover\)\s*\{\s*html\.js:not\(\.bar-on, \.bar-off, :has\(header :focus-visible\)\)\s*\{\s*--bar-y: -100%;\s*--float: var\(--muted\);\s*\}/,
  );
  assert.ok(!/@media not /.test(css), "a separate narrow media query is back");
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

// The header's real heights, measured in a browser (see the fixture's own note): each row is a
// viewport width at a text size, with the bar shown. rootPx is the browser's default font size,
// which is also what rem means inside a media query, so a phone layout (max-width: 36rem) applies
// when the width is at most 36 * rootPx.
const measured = JSON.parse(
  readFileSync(new URL("./fixtures/header-heights.json", import.meta.url), "utf8"),
);
const remOf = (pattern, what) => {
  const value = Number.parseFloat(css.match(pattern)?.[1] ?? "NaN");
  assert.ok(Number.isFinite(value), `no ${what}`);
  return value;
};
const paddings = {
  wide: remOf(/\n\.js\s*\{\s*scroll-padding-top: ([\d.]+)rem;/, "base scroll-padding-top"),
  phone: remOf(
    /@media \(max-width: 36rem\)\s*\{[\s\S]*?\.js\s*\{\s*scroll-padding-top: ([\d.]+)rem;/,
    "phone scroll-padding-top",
  ),
};
const layoutOf = (row) => (row.width <= 36 * row.rootPx ? "phone" : "wide");

// Header height depends on the system UI font, and only headless Chrome on Windows was measured,
// so the padding must clear every measured header by this much.
const MARGIN_REM = 0.5;

test("scroll-padding-top clears the measured header height by the safety margin at every measured width and text size", () => {
  assert.ok(measured.rows.length >= 20);
  for (const row of measured.rows) {
    const padding = paddings[layoutOf(row)] * row.rootPx;
    const needed = row.headerPx + MARGIN_REM * row.rootPx;
    assert.ok(
      padding >= needed,
      `${row.text} text, ${row.width}px: the header is ${row.headerPx}px, so scroll-padding-top must be at least ${needed}px, and it is ${padding}px`,
    );
  }
});

test("the measurements cover the widths and text sizes that were asked for, in both themes", () => {
  assert.equal(measured.themesAgree, true, "dark and light headers differ in height");
  for (const text of ["100%", "200%"]) {
    const widths = measured.rows.filter((row) => row.text === text).map((row) => row.width);
    for (const width of [320, 360, 390, 640, 641, 820]) {
      assert.ok(widths.includes(width), `${text} ${width}px was not measured`);
    }
  }
  // Widths either side of the phone layout's edge (36rem is 576px at 100%), and the edge at 200%.
  for (const [text, width] of [
    ["100%", 577],
    ["100%", 607],
    ["200%", 1154],
  ]) {
    assert.ok(
      measured.rows.some((row) => row.text === text && row.width === width),
      `${text} ${width}px`,
    );
  }
  for (const row of measured.rows) {
    assert.ok(Math.abs(row.headerPx / row.rootPx - row.headerRem) < 0.01, JSON.stringify(row));
  }
});

test("the padding is only as high as it needs to be: the safety margin plus at most half a rem of rounding over the tallest header in its layout", () => {
  for (const layout of ["wide", "phone"]) {
    const tallest = Math.max(
      ...measured.rows.filter((row) => layoutOf(row) === layout).map((row) => row.headerRem),
    );
    assert.ok(
      paddings[layout] >= tallest + MARGIN_REM,
      `${layout}: ${paddings[layout]}rem is under ${tallest}rem plus the ${MARGIN_REM}rem margin`,
    );
    assert.ok(
      paddings[layout] - tallest <= MARGIN_REM + 0.5,
      `${layout}: ${paddings[layout]}rem is far over ${tallest}rem plus the margin`,
    );
  }
});

test("the skip link and the settings panel stay on top of the page, inside the header's stacking context", () => {
  assert.match(css, /\.site-header\s*\{\s*position: relative;\s*z-index: 5;/);
  assert.match(css, /\.skip-link\s*\{[^}]*z-index: 10/);
});
