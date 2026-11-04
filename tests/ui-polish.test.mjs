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
const UI_FONT_USERS = [".site-nav a", ".site-footer a", ".btn"];

test("--font-ui is used for the nav, footer links and buttons and nothing else", () => {
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*font-family:\s*var\(--font-ui\)/g)].map(
    (match) =>
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
