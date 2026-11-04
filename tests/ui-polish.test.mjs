import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokens = read("../src/styles/tokens.css");
const css = read("../src/styles/global.css");

test("the page is named Me, but its URL is still /about/", () => {
  const header = read("../src/components/Header.astro");
  assert.match(header, /\{ href: "\/about\/", label: "Me" \}/);
  assert.ok(!/label: "About"/.test(header), "the nav still says About");

  const page = read("../src/pages/about.astro");
  assert.match(page, /<Page title="Me" /);
  assert.match(page, /<h1>Me<\/h1>/);
  assert.ok(!/<h1>About<\/h1>/.test(page));

  assert.match(read("../src/pages/sitemap.xml.ts"), /"\/about\/"/);
});

test("--font-ui is the system UI stack, with no font file behind it", () => {
  const declared = tokens.match(/--font-ui:\s*([^;]+);/);
  assert.ok(declared, "--font-ui is missing from tokens.css");
  assert.equal(declared[1], 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif');
  assert.ok(!read("../src/styles/fonts.css").includes("--font-ui"));
});

// The interface font is for controls only. Headings and body stay IBM Plex Sans, and
// labels stay JetBrains Mono, so every rule that uses --font-ui is named here.
const UI_FONT_USERS = [".site-nav a", ".site-footer a", ".btn", ".settings-panel"];

test("--font-ui is used for the nav, footer links and buttons and nothing else", () => {
  const selectors = [
    ...css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/([^{}]+)\{[^{}]*font-family:\s*var\(--font-ui\)/g),
  ].map((match) =>
    match[1]
      .split(",")
      .map((part) => part.trim())
      .join(", "),
  );
  assert.deepEqual(
    selectors.sort(),
    [...UI_FONT_USERS].sort(),
    "a rule outside the allowed list uses --font-ui",
  );
  for (const keep of ["body", "code,\n.mono", ".label"]) {
    assert.ok(css.includes(keep), `${keep} rule is missing`);
  }
  assert.match(css, /body\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  assert.match(css, /\.label\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
});

// ---------- The skip link ----------

test("the skip link is the first focusable element: first in the header, and the header is first in the body", () => {
  const base = read("../src/layouts/Base.astro");
  const header = read("../src/components/Header.astro");
  assert.ok(!/skip-link/.test(base), "Base.astro still has its own skip link");
  assert.match(base, /<body>\s*<Header /);
  const skip = header.indexOf('class="skip-link"');
  assert.ok(skip > 0, "Header.astro has no skip link");
  assert.match(header, /<header class="site-header">\s*<a class="skip-link" href="#main">/);
  for (const later of ['class="brand"', 'class="site-nav"', 'class="settings"']) {
    assert.ok(skip < header.indexOf(later), `the skip link must come before ${later}`);
  }
});

test("a focused skip link sits under the header bar at the page's left edge, so it covers none of it", () => {
  const rule = css.match(/\n\.skip-link\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /position: absolute/);
  assert.match(rule, /top: calc\(100% \+ var\(--space-2\)\)/, "it must start below the header");
  assert.match(rule, /left: calc\(var\(--space-3\) \+ max\(0px, \(100% - var\(--page\)\) \/ 2\)\)/);
  assert.ok(!/translateY|transform/.test(rule), "the old slide-down-over-the-brand is back");
  assert.ok(!/\btop: var\(--space-2\)/.test(rule));
});

test("until it is focused the skip link is visually hidden, but never display:none or visibility:hidden", () => {
  const rule = css.match(/\.skip-link:not\(:focus\)\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /clip-path: inset\(50%\)/);
  assert.match(rule, /overflow: hidden/);
  assert.ok(
    !/display:\s*none|visibility:\s*hidden/.test(rule),
    "that would take it out of the tab order",
  );
});
