import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

// The Security page's hardening showcase. Two jobs: keep every claim on the page tied to something
// the repository really does (the page may only promise what is enforced), and keep the CSS
// pinned, accessible and safe with JS off, with reduced motion and with the Motion switch off.
//
// The claims about the build are proven by running scripts/check_dist.py on a fixture build with
// one deliberate violation each, not by reading its documentation.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/pages/security.astro");
const css = read("../src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
const contributing = read("../CONTRIBUTING.md");
const pkg = JSON.parse(read("../package.json"));

const layers = [
  ...page.matchAll(
    /\{\s*name: "([^"]+)",\s*title: "([^"]+)",\s*text: "([^"]+)",\s*command: "([^"]+)",\s*\}/g,
  ),
].map((m) => ({ name: m[1], title: m[2], text: m[3], command: m[4] }));

// ---------- The claims ----------

test("the page has four rules, each with a name, a title, a sentence and a command", () => {
  assert.equal(layers.length, 4);
  for (const l of layers) {
    assert.ok(l.name && l.title && l.text.length > 40 && l.command, JSON.stringify(l));
  }
  assert.match(page, /Four rules, and how to check them/);
});

test("every command on the page runs something the repository has", () => {
  const known = [
    [
      "python scripts/check_dist.py",
      () => existsSync(new URL("../scripts/check_dist.py", import.meta.url)),
    ],
    ["npm ci --ignore-scripts", () => /npm ci --ignore-scripts/.test(contributing)],
    ["npm run verify", () => typeof pkg.scripts.verify === "string"],
    ["npm run build", () => typeof pkg.scripts.build === "string"],
  ];
  const commands = [
    ...layers.map((l) => l.command),
    // The commands written straight into the markup (the layers' own are in the array above).
    ...[...page.matchAll(/<code>([^<{]+)<\/code>/g)].map((m) => m[1]),
  ];
  for (const command of commands) {
    for (const part of command.split("&&").map((p) => p.trim())) {
      const hit = known.find(([prefix]) => part === prefix);
      assert.ok(hit, `unknown command on the Security page: ${part}`);
      assert.ok(hit[1](), `${part} is not backed by the repository`);
    }
  }
});

// A small build for check_dist.py to look at, as in tests/check-dist.test.mjs.
const script = join(import.meta.dirname, "..", "scripts", "check_dist.py");
const python = process.env.PYTHON ?? "python";
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const html = (body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title>` +
  `<link rel="canonical" href="https://example.com/"><link rel="stylesheet" href="/_astro/a.css">` +
  `</head><body><a href="https://elsewhere.example/">out</a>${body}</body></html>`;

const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
  `<url><loc>https://example.com/</loc></url></urlset>`;

function check(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "showcase-"));
  roots.push(root);
  const files = {
    "index.html": html(),
    "404.html": html(),
    "_astro/a.css": "body{color:red}",
    "sitemap.xml": sitemap,
    ...overrides,
  };
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const result = spawnSync(python, [script, root], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("control: a clean fixture build passes the check", () => {
  const { status, output } = check();
  assert.equal(status, 0, output);
});

// [what the page says, a deliberate violation, what the check must report]
const claims = [
  [
    "Forms, iframes, embeds and objects",
    { "index.html": html("<form></form>") },
    /<form> is not allowed/,
  ],
  [
    "Forms, iframes, embeds and objects",
    { "index.html": html('<iframe src="/"></iframe>') },
    /<iframe> is not allowed/,
  ],
  [
    "Forms, iframes, embeds and objects",
    { "index.html": html('<embed src="/">') },
    /<embed> is not allowed/,
  ],
  [
    "Forms, iframes, embeds and objects",
    { "index.html": html('<object data="/"></object>') },
    /<object> is not allowed/,
  ],
  ["No inline scripts or styles", { "index.html": html("<script>1</script>") }, /inline <script>/],
  ["No inline scripts or styles", { "index.html": html("<style>a{}</style>") }, /inline <style>/],
  ["no style attributes", { "index.html": html('<p style="color:red">x</p>') }, /style= attribute/],
  ["mentions eval, fetch or innerHTML", { "_astro/a.js": 'eval("1")' }, /eval/],
  ["mentions eval, fetch or innerHTML", { "_astro/a.js": 'fetch("/x")' }, /fetch/],
  ["mentions eval, fetch or innerHTML", { "_astro/a.js": 'el.innerHTML="x"' }, /innerHTML/],
  [
    "points off-site",
    { "index.html": html('<img src="https://cdn.example/x.png" alt="">') },
    /off-site src/,
  ],
  [
    "a data: URL as an image, script or stylesheet",
    { "index.html": html('<img src="data:image/gif;base64,R0lGOD" alt="">') },
    /data: URL in src on <img>/,
  ],
  [
    "a data: URL as an image, script or stylesheet",
    { "index.html": html('<script src="data:text/javascript,1"></script>') },
    /data: URL in src on <script>/,
  ],
  [
    "a data: URL as an image, script or stylesheet",
    { "index.html": html('<link rel="stylesheet" href="data:text/css,a{}">') },
    /data: URL in href on <link>/,
  ],
];

for (const [said, overrides, expected] of claims) {
  test(`the page says "${said}" and the check really fails on it (${expected})`, () => {
    assert.ok(page.toLowerCase().includes(said.toLowerCase()), `the page no longer says: ${said}`);
    const { status, output } = check(overrides);
    assert.equal(status, 1, output);
    assert.match(output, expected);
  });
}

test("the review claims match CONTRIBUTING.md and the repository", () => {
  assert.match(contributing, /`main` is protected/);
  assert.match(contributing, /npm ci --ignore-scripts/);
  assert.match(contributing, /Pin exact versions/);
  assert.ok(
    existsSync(new URL("../public/fonts/SHA256SUMS", import.meta.url)),
    "no font checksums",
  );
});

test("the page does not promise what is not built yet, nor an automatic gate", () => {
  assert.match(page, /<h2>Not here yet<\/h2>/);
  assert.match(page, /arrive with hosting/);
  const claimed = [
    page.match(/<p>\s*This site is[\s\S]*?<\/p>/)?.[0],
    ...layers.map((l) => `${l.title} ${l.text}`),
  ].join(" ");
  for (const word of [
    "HSTS",
    "DNSSEC",
    "Cloudflare",
    "scan",
    "Lighthouse",
    "passed",
    "automatic",
    "CI",
  ]) {
    assert.ok(
      !new RegExp(`\\b${word}\\b`).test(claimed),
      `a rule claims something not built: ${word}`,
    );
  }
  // The build only compiles; the checks are check_dist.py and the author's own run of them.
  assert.ok(!/the build (checks|enforces)|before every merge/i.test(page));
});

test("the only link the page adds goes to the public repository", () => {
  const hrefs = [...page.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["https://github.com/iijarrett/personal-site"]);
});

test("the page word 'placeholder' is gone (it is a build warning)", () => {
  assert.ok(!/placeholder/i.test(page));
});

test("the list keeps its semantics where list-style: none removes them (Safari with VoiceOver)", () => {
  assert.match(page, /<ol class="layers" role="list">/);
  assert.match(css, /\.layers\s*\{[^}]*list-style: none/);
});

// ---------- The CSS ----------

const rule = (selector) =>
  css.match(new RegExp(`(?:^|\\n)${selector.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

const WIDE = "@media (min-width: 48.0625rem)";
const WIDE_MOTION = "@media (min-width: 48.0625rem) and (prefers-reduced-motion: no-preference)";

test("the base layout is one column and unpinned: a narrow screen, and the fallback for everything", () => {
  assert.ok(!/grid-template-columns|position/.test(rule(".showcase")));
  assert.match(rule(".showcase"), /display: grid/);
  assert.match(rule(".showcase-pin"), /align-self: start/);
  assert.ok(!/position/.test(rule(".showcase-pin")));
  assert.ok(!/min-height/.test(rule(".layer")));
});

test("two columns, and a tall rule, only from 48.0625rem up", () => {
  const block =
    css.match(
      new RegExp(`${WIDE.replace(/[()]/g, "\\$&")}\\s*\\{([\\s\\S]*?\\n\\})\\s*\\n`),
    )?.[1] ?? "";
  assert.match(
    block,
    /\.showcase\s*\{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.5fr\)/,
  );
  assert.match(block, /\.layer\s*\{\s*min-height: 55vh/);
});

test("the pin is sticky only on a wide screen, with motion allowed and the Motion switch on", () => {
  const block = css.match(
    new RegExp(
      `${WIDE_MOTION.replace(/[()]/g, "\\$&")}\\s*\\{\\s*html:not\\(\\.no-fx\\) \\.showcase-pin\\s*\\{([^}]*)\\}`,
    ),
  )?.[1];
  assert.ok(block, "the pin is not gated by the wide + no-preference query and .no-fx");
  assert.match(block, /position: sticky/);
  assert.match(block, /top: 6rem/);
  assert.equal(css.split("position: sticky").length - 1 >= 1, true);
  // No other rule pins the showcase.
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/position: sticky/.test(body) && /showcase/.test(sel)) {
      assert.match(sel, /html:not\(\.no-fx\) \.showcase-pin/);
    }
  }
});

test("no ancestor clips the sticky column (overflow would break the pin)", () => {
  for (const selector of [".showcase", ".page"]) {
    assert.ok(!/overflow\s*:\s*(hidden|auto|scroll|clip)/.test(rule(selector)), selector);
  }
});

test("the lit rule changes only a border colour, never opacity or visibility, so text keeps its contrast", () => {
  const keyframes = css.match(/@keyframes layer-lit\s*\{([\s\S]*?\n\})\s*\n/)?.[1] ?? "";
  assert.match(keyframes, /border-left-color/);
  const rest = keyframes.replace(/border-left-color: var\(--(border|ring)\);/g, "");
  assert.ok(!/opacity|visibility|display|transform|translate|color/.test(rest), rest);
});

test("the animation sits inside no-preference, excludes .no-fx, and uses longhands", () => {
  const block = css.match(
    /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*html:not\(\.no-fx\) \.layer\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(block, "the .layer animation is not in a no-preference block that excludes .no-fx");
  assert.ok(!/animation:/.test(block), "the animation shorthand would fold the timeline in");
  assert.match(block, /animation-timeline: view\(\);/);
  assert.match(block, /animation-range: cover;/);
  assert.ok(!/animation-duration/.test(block));
  assert.ok(!/animation-fill-mode/.test(block), "a fill mode would hold the lit state");
});

test("no rule hides a rule block, so every one stays readable without the animation", () => {
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/\.layer|\.layers|\.showcase/.test(sel)) {
      assert.ok(!/opacity:\s*0|visibility:\s*hidden|display:\s*none/.test(body), sel.trim());
    }
  }
});

test("it is pure CSS: no script touches the showcase", () => {
  for (const file of ["bar", "hero", "settings", "motion-state", "interactive"]) {
    assert.ok(!/showcase|layers|layer-lit/.test(read(`../src/scripts/${file}.ts`)), `${file}.ts`);
  }
});
