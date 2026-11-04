import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

// Runs scripts/check_dist.py against small fixture builds, so each rule is
// proven to pass on clean output and to fail on a deliberate violation.

const script = join(import.meta.dirname, "..", "scripts", "check_dist.py");
const python = process.env.PYTHON ?? "python";
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const page = (body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title>` +
  `<link rel="canonical" href="https://example.com/"><link rel="stylesheet" href="/_astro/a.css">` +
  `</head><body><a href="https://elsewhere.example/">out</a>${body}</body></html>`;

const sitemap = (paths) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
  paths.map((path) => `<url><loc>https://example.com${path}</loc></url>`).join("") +
  `</urlset>`;

/** Builds a fixture dist (clean by default), applies overrides, runs the checker. */
function run(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-dist-"));
  roots.push(root);
  const files = {
    "index.html": page(),
    "404.html": page(),
    "about/index.html": page(),
    "_astro/a.css": "body{color:red}",
    "sitemap.xml": sitemap(["/", "/about/"]),
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

test("a clean build passes, and outbound links and canonical links are allowed", () => {
  const { status, output } = run();
  assert.equal(status, 0, output);
  assert.match(output, /0 failure\(s\)/);
});

const violations = [
  ["an inline script", "<script>alert(1)</script>", /inline <script>/],
  ["an inline style block", "<style>a{}</style>", /inline <style>/],
  ["a style attribute", '<p style="color:red">x</p>', /style= attribute/],
  ["an event handler", '<button onclick="go()">x</button>', /onclick= handler/],
  ["an off-site image", '<img src="https://cdn.example/x.png" alt="">', /off-site src/],
  ["an off-site script", '<script src="https://cdn.example/a.js"></script>', /off-site src/],
  [
    "an off-site stylesheet",
    '<link rel="stylesheet" href="https://cdn.example/x.css">',
    /off-site href/,
  ],
  ["a form", "<form></form>", /<form> is not allowed/],
  ["an iframe", '<iframe src="/x"></iframe>', /<iframe> is not allowed/],
  ["a missing local resource", '<img src="/nope.png" alt="">', /missing file/],
];

for (const [name, body, expected] of violations) {
  test(`fails on ${name}`, () => {
    const { status, output } = run({ "index.html": page(body) });
    assert.equal(status, 1, output);
    assert.match(output, expected);
  });
}

test("fails on a data: URL script, stylesheet link or image", () => {
  const script = run({
    "index.html": page('<script src="data:text/javascript,alert(1)"></script>'),
  });
  assert.equal(script.status, 1, script.output);
  assert.match(script.output, /data: URL in src on <script>/);

  const upper = run({
    "index.html": page('<script src=" DATA:text/javascript,alert(1)"></script>'),
  });
  assert.equal(upper.status, 1, upper.output);

  const link = run({ "index.html": page('<link rel="stylesheet" href="data:text/css,a{}">') });
  assert.equal(link.status, 1, link.output);
  assert.match(link.output, /data: URL in href on <link>/);

  const image = run({ "index.html": page('<img src="data:image/gif;base64,R0lGOD" alt="">') });
  assert.equal(image.status, 1, image.output);
  assert.match(image.output, /data: URL in src on <img>/);
});

test("fails on an external stylesheet that is also marked alternate", () => {
  const { status, output } = run({
    "index.html": page('<link rel="alternate stylesheet" href="https://cdn.example/x.css">'),
  });
  assert.equal(status, 1, output);
  assert.match(output, /off-site href/);

  const plain = run({
    "index.html": page('<link rel="alternate" href="https://example.com/feed">'),
  });
  assert.equal(plain.status, 0, plain.output);
});

test("fails on an off-site url() or @import in CSS, and ignores URLs in comments", () => {
  const url = run({ "_astro/a.css": "body{background:url(https://evil.example/x.png)}" });
  assert.equal(url.status, 1, url.output);
  assert.match(url.output, /off-site url/);

  const imported = run({ "_astro/a.css": '@import "https://fonts.example/css";' });
  assert.equal(imported.status, 1, imported.output);

  const comment = run({ "_astro/a.css": "/* https://example.com */ body{color:red}" });
  assert.equal(comment.status, 0, comment.output);
});

test("fails when the home page HTML is over 14 KB", () => {
  const { status, output } = run({ "index.html": page(`<!--${"x".repeat(14_000)}-->`) });
  assert.equal(status, 1, output);
  assert.match(output, /exceeds the 14,000 byte limit/);
});

test("fails when the first load is over 100 KB, counting fonts named in the CSS", () => {
  const { status, output } = run({
    "_astro/a.css": '@font-face{font-family:X;src:url("/fonts/big.woff2")}',
    "fonts/big.woff2": "x".repeat(100_001),
  });
  assert.equal(status, 1, output);
  assert.match(output, /first load .* exceeds the 100,000 byte limit/);
});

test("counts a font reached through nested CSS, once, even with an import cycle", () => {
  const nested = {
    "_astro/a.css": '@import "/_astro/b.css";',
    "_astro/b.css":
      '@import "/_astro/a.css";@font-face{src:url("/fonts/f.woff2")}.x{src:url(/fonts/f.woff2)}',
  };

  const counted = run({ ...nested, "fonts/f.woff2": "x".repeat(1_000) });
  assert.equal(counted.status, 0, counted.output);
  assert.match(counted.output, /4 files/);

  const over = run({ ...nested, "fonts/f.woff2": "x".repeat(100_001) });
  assert.equal(over.status, 1, over.output);
  assert.match(over.output, /first load .* exceeds the 100,000 byte limit/);
});

test("fails when the sitemap lists the 404 page", () => {
  for (const path of ["/404/", "/404.html"]) {
    const { status, output } = run({ "sitemap.xml": sitemap(["/", "/about/", path]) });
    assert.equal(status, 1, output);
    assert.match(output, /lists the 404 page/);
  }
});

test("passes with the 404 page built but absent from the sitemap", () => {
  const { status, output } = run();
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /404/);
});

test("fails when a built page is missing from the sitemap", () => {
  const { status, output } = run({ "sitemap.xml": sitemap(["/"]) });
  assert.equal(status, 1, output);
  assert.match(output, /does not list built page '\/about\/'/);
});

test("fails when the sitemap lists a page that was not built", () => {
  const { status, output } = run({ "sitemap.xml": sitemap(["/", "/about/", "/ghost/"]) });
  assert.equal(status, 1, output);
  assert.match(output, /'\/ghost\/', which was not built/);
});

test("placeholder text is a warning, not a failure", () => {
  const { status, output } = run({ "about/index.html": page("<p>Placeholder resume</p>") });
  assert.equal(status, 0, output);
  assert.match(output, /WARN about\/index\.html: 'placeholder' text appears 1 time/);
  assert.match(output, /1 warning\(s\)/);
});

test("a missing dist directory is an error", () => {
  const result = spawnSync(python, [script, join(tmpdir(), "no-such-dist-dir")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
});
