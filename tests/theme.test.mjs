import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const tokens = read("src/styles/tokens.css");
const init = read("public/theme-init.js");
const base = read("src/layouts/Base.astro");

const lightStart = tokens.indexOf('html[data-theme="light"]');
const dark = tokens.slice(0, lightStart);
const light = tokens.slice(lightStart);
const bgOf = (block) => block.match(/--bg:\s*(#[0-9a-fA-F]{6})/)?.[1];

test("dark is the default: the bare :root is dark and says so to the browser", () => {
  assert.ok(lightStart > 0);
  assert.match(dark, /:root\s*\{\s*color-scheme: dark;/);
  assert.equal(bgOf(dark), "#16161e");
});

test("light applies only under html[data-theme=light], and sets color-scheme: light", () => {
  assert.match(light, /^html\[data-theme="light"\]\s*\{\s*color-scheme: light;/);
  assert.equal(bgOf(light), "#e1e2e7");
  // Exactly the two blocks, nothing else in the file switches colours.
  assert.equal([...tokens.matchAll(/^\s*--bg:/gm)].length, 2);
});

test("the OS colour scheme is never consulted: no prefers-color-scheme in the source", () => {
  const found = [];
  const scan = (dir, extensions) => {
    for (const file of readdirSync(new URL(dir, root), { recursive: true })) {
      const path = `${dir}${file}`.replaceAll("\\", "/");
      if (!extensions.some((ext) => path.endsWith(ext))) continue;
      if (/prefers-color-scheme/.test(read(path))) found.push(path);
    }
  };
  scan("src/", [".css", ".ts", ".astro", ".md"]);
  scan("public/", [".js", ".css", ".svg"]);
  assert.deepEqual(found, []);
});

test("one theme-color meta, dark at first, and a dark-only color-scheme meta", () => {
  const metas = [...base.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0]);
  assert.equal(metas.length, 1, "expected exactly one theme-color meta");
  assert.ok(!/media=/.test(metas[0]), "theme-color must not depend on the OS setting");
  assert.ok(metas[0].includes(`content="${bgOf(dark)}"`), metas[0]);
  assert.match(base, /<meta name="color-scheme" content="dark" \/>/);
});

test("the head script is a plain blocking script from the same origin, after the meta it edits", () => {
  const tag = base.match(/<script[^>]*theme-init\.js[^>]*><\/script>/)?.[0];
  assert.ok(tag, "Base.astro does not load /theme-init.js");
  assert.match(tag, /^<script is:inline src="\/theme-init\.js"><\/script>$/);
  assert.ok(!/type=|defer|async/.test(tag), "it must block, so it runs before first paint");
  assert.ok(base.indexOf(tag) > base.indexOf('<meta name="theme-color"'));
  assert.ok(base.indexOf(tag) < base.indexOf('rel="canonical"'), "it belongs in the head");
  assert.ok(base.indexOf(tag) < base.indexOf("</head>"));
});

/** Runs public/theme-init.js against a fake page and storage. */
function runInit({ stored, blocked = false, hasMeta = true }) {
  const root = { dataset: {} };
  const meta = { attributes: {}, setAttribute: (name, value) => (meta.attributes[name] = value) };
  const context = {
    localStorage: {
      getItem(key) {
        if (blocked) throw new Error("storage is blocked");
        return key === "theme" ? stored : null;
      },
    },
    document: {
      documentElement: root,
      querySelector: (selector) =>
        hasMeta && selector === 'meta[name="theme-color"]' ? meta : null,
    },
  };
  vm.runInNewContext(init, context);
  return { theme: root.dataset.theme, color: meta.attributes.content };
}

test("a stored light theme is applied before paint, with the matching theme-color", () => {
  const result = runInit({ stored: "light" });
  assert.equal(result.theme, "light");
  assert.equal(result.color, bgOf(light));
});

test("anything but a stored light stays dark and touches nothing", () => {
  for (const stored of [null, undefined, "", "dark", "Light", "LIGHT", "1", "garbage"]) {
    assert.deepEqual(runInit({ stored }), { theme: undefined, color: undefined }, String(stored));
  }
});

test("blocked storage keeps the site dark and does not throw", () => {
  assert.deepEqual(runInit({ stored: "light", blocked: true }), {
    theme: undefined,
    color: undefined,
  });
});

test("a page without the meta still gets its theme", () => {
  assert.equal(runInit({ stored: "light", hasMeta: false }).theme, "light");
});

test("the head script keeps to the rules every built script follows", () => {
  for (const banned of [/\beval\b/, /\bFunction\b/, /\bfetch\b/, /\bimport\b/, /\bexport\b/]) {
    assert.ok(!banned.test(init), `theme-init.js matches ${banned}`);
  }
  assert.ok(!/https?:\/\//.test(init));
  assert.ok(init.length < 400, `theme-init.js is ${init.length} bytes`);
});

import { parseTheme, THEME_COLOR, THEME_KEY } from "../src/lib/theme.ts";

test("parseTheme is light only for exactly light, and dark for anything else", () => {
  for (const raw of [null, undefined, "", "dark", "Light", "LIGHT", "1", "garbage"]) {
    assert.equal(parseTheme(raw), "dark", String(raw));
  }
  assert.equal(parseTheme("light"), "light");
});

test("the TypeScript side agrees with the head script on the key and with the tokens on the colours", () => {
  assert.equal(THEME_KEY, "theme");
  assert.ok(init.includes(`getItem("${THEME_KEY}")`));
  assert.equal(THEME_COLOR.dark, bgOf(dark));
  assert.equal(THEME_COLOR.light, bgOf(light));
  assert.ok(init.includes(`"${THEME_COLOR.light}"`), "theme-init.js has a different light colour");
});
