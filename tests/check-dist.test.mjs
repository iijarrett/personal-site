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

// How the checker names the import and export rules in its messages.
const IMPORT_WORD = 'the word "import"';
const EXPORT_WORD = 'the word "export"';

// One fixture per forbidden form. The guard is a tripwire of regular expressions, not
// a parser: it bans the bare words eval, fetch and Function (so aliases, indirect and
// optional calls trip), but computed names built at run time are out of scope.
const forbiddenScripts = [
  // the bare identifier Function: called, constructed, aliased, optionally called
  ["Function", 'Function("return 1")()'],
  ["Function", 'globalThis.Function ("return 1")()'],
  ["Function", 'new Function("return 1")'],
  ["Function", 'const F=Function;F("return 1")'],
  ["Function", 'Function?.("return 1")'],
  // eval, direct, indirect and aliased
  ["eval", 'eval("1")'],
  ["eval", '(0,eval)("1")'],
  ["eval", 'const e=eval;e("1")'],
  ["eval", 'globalThis.eval("1")'],
  ["eval", 'window["eval"]("1")'],
  // fetch, called, optionally called and aliased
  ["fetch", 'fetch("/x")'],
  ["fetch", 'fetch?.("/x")'],
  ["fetch", 'const f=fetch;f("/x")'],
  ["fetch", 'window.fetch.call(window,"/x")'],
  ["XMLHttpRequest", "new XMLHttpRequest()"],
  ["WebSocket", 'new WebSocket("wss://x")'],
  ["sendBeacon", 'navigator.sendBeacon("/x")'],
  // cookies, dotted, optional and bracketed
  ["document.cookie", 'document.cookie="a=1"'],
  ["document.cookie", 'document["cookie"]="a=1"'],
  ["document.cookie", "document['cookie']"],
  ["document.cookie", "document?.cookie"],
  // creating a script element
  ['createElement("script")', 'document.createElement("script")'],
  ['createElement("script")', "document.createElement('script')"],
  ['createElement("script")', 'document.createElement( "SCRIPT" )'],
  // absolute and protocol-relative URLs
  ["an absolute http(s):// URL", 'const u="https://example.com/x"'],
  ["an absolute http(s):// URL", 'const u="http://example.com/x"'],
  ["a protocol-relative //host URL", 'const u="//cdn.example/x.js"'],
  ["a protocol-relative //host URL", "const u='//evil.example'"],
  ["a protocol-relative //host URL", "const u=`//cdn.example:8080/x`"],
  ["a protocol-relative //host URL", 'const u=" //cdn.example/x.js"'],
  ["innerHTML", 'el.innerHTML="x"'],
  ["outerHTML", 'el.outerHTML="x"'],
  ["insertAdjacentHTML", 'el.insertAdjacentHTML("beforeend","x")'],
  ["document.write", 'document.write("x")'],
  ["document.write", 'document["write"]("x")'],
  ["document.write", 'document?.write("x")'],
  // dynamic import, with whitespace or comments before the paren
  [IMPORT_WORD, 'import("./x.js")'],
  [IMPORT_WORD, 'import ("./x.js")'],
  [IMPORT_WORD, 'import\n("./x.js")'],
  [IMPORT_WORD, 'import/* c */("./x.js")'],
  [IMPORT_WORD, 'import /* c */ ("./x.js")'],
  [IMPORT_WORD, 'import // c\n("./x.js")'],
];

for (const [label, source] of forbiddenScripts) {
  test(`fails on a script containing ${JSON.stringify(source)}`, () => {
    const { status, output } = run({ "_astro/a.js": `const a=1;${source};` });
    assert.equal(status, 1, output);
    assert.ok(output.includes(`FAIL _astro/a.js: ${label} in script`), output);
  });
}

test("a realistic harmless script passes: lower-case function, import.meta, split('//'), other elements", () => {
  // "Function" with a capital F is banned everywhere, even in instanceof, so a script
  // that needs to test for a function uses typeof.
  const clean = [
    "// a plain comment is fine, and so is a // inside it",
    'const a=1,s="function",isFn=(typeof a==="function");',
    'const t=typeof s==="function"&&import.meta.url;',
    'const c=document.createElement("canvas"),d=document.createElement("div");',
    'const p="a//b".split("//"),q="evaluate prefetch fetching";',
    'document.addEventListener("click",()=>a);',
  ].join("\n");
  const { status, output } = run({ "_astro/a.js": clean });
  assert.equal(status, 0, output);
});

test("a harmless script passes, and the script guard has no allowlist", () => {
  const clean = run({ "_astro/a.js": 'const a=1;document.addEventListener("click",()=>a);' });
  assert.equal(clean.status, 0, clean.output);

  const module = run({ "_astro/a.mjs": 'eval("1")' });
  assert.equal(module.status, 1, module.output);

  const comment = run({ "_astro/a.js": "// see https://example.com\nconst a=1;" });
  assert.equal(comment.status, 1, comment.output);
});

// ---- imports are banned outright, so every built script is one self-contained file ----
//
// The rule is about the word, not the syntax. Any whole-word "import" fails, except
// import.meta. It does not try to read binding names or tell a static import from a
// dynamic one, so Unicode names, comments, line breaks and odd spacing cannot slip
// past it; and it cannot tell a statement from a string or a comment either, so those
// fail too. The one exception is the narrow lazy-load form tested further down. Anything
// wider needs a real tokenizer first.

const importForms = [
  // the re-check findings
  [IMPORT_WORD, 'import π from "./m.js"'],
  [IMPORT_WORD, 'import {x} from "./m.js"'],
  [IMPORT_WORD, 'import "./m.js"'],
  [IMPORT_WORD, 'import/*c*/("./m.js")'],
  [IMPORT_WORD, '// a comment, then a line break\nimport("./m.js")'],
  [IMPORT_WORD, 'const s="please import it"'],
  // other binding names, none of which the rule has to understand
  [IMPORT_WORD, 'import ü from"./m.js"'],
  [IMPORT_WORD, 'import 名前 from "./m.js"'],
  [IMPORT_WORD, 'import $x,{_y as π}from"./m.js"'],
  [IMPORT_WORD, 'import*as ns from"./m.js"'],
  // plain forms
  [IMPORT_WORD, 'import"./b.js"'],
  [IMPORT_WORD, 'import x from"./d.js"'],
  [IMPORT_WORD, 'import x,{y}from"./d.js"'],
  [IMPORT_WORD, 'import{a as b}from"/_astro/b.js"'],
  [IMPORT_WORD, 'import x from"react"'],
  [IMPORT_WORD, 'import"data:text/javascript,1"'],
  [IMPORT_WORD, 'import"https://cdn.example/x.js"'],
  // comments and whitespace between the tokens
  [IMPORT_WORD, 'import /* c */ "./b.js"'],
  [IMPORT_WORD, 'import/* c */"./b.js"'],
  [IMPORT_WORD, 'import // c\n"./b.js"'],
  [IMPORT_WORD, 'import\n"./b.js"'],
  [IMPORT_WORD, 'import /* c */ x /* d */ from /* e */ "./b.js"'],
  [IMPORT_WORD, 'import /* c */ {a} /* d */ from "./b.js"'],
  [IMPORT_WORD, 'import * /* c */ as g from "./g.js"'],
  [IMPORT_WORD, "import\t\r\n  x from './b.js'"],
  // not import.meta: a longer name, or something in the way
  [IMPORT_WORD, "const m=import.metadata;"],
  [IMPORT_WORD, "const m=import /* c */ .meta;"],
];

// The same rule for the word "export", with no exception. A re-export (export * from)
// used to have a rule of its own that read the syntax; the word rule makes it
// unnecessary, because a re-export has to say "export".
const exportForms = [
  [EXPORT_WORD, "export const a=1"],
  [EXPORT_WORD, "export {x}"],
  [EXPORT_WORD, 'export * from "./m.js"'],
  [EXPORT_WORD, "export default 1"],
  [EXPORT_WORD, 'const s="please export it"'],
  // other shapes, none of which the rule has to understand
  [EXPORT_WORD, 'export*from"./e.js"'],
  [EXPORT_WORD, 'export{y}from"./f.js"'],
  [EXPORT_WORD, 'export*as ns from"./e.js"'],
  [EXPORT_WORD, 'export * as π from "./e.js"'],
  [EXPORT_WORD, 'export {π as ρ} from "./e.js"'],
  [EXPORT_WORD, 'export /* c */ * /* d */ from "./e.js"'],
  [EXPORT_WORD, 'export {a as b} // c\n from "./e.js"'],
  [EXPORT_WORD, "export\nfunction f(){}"],
  [EXPORT_WORD, "// a comment, then a line break\nexport class C{}"],
];

for (const [label, source] of [...importForms, ...exportForms]) {
  test(`fails on ${label === IMPORT_WORD ? "an import" : "an export"}: ${JSON.stringify(source)}`, () => {
    const { status, output } = run({ "_astro/a.js": `const a=1;${source};` });
    assert.equal(status, 1, output);
    assert.ok(output.includes(`FAIL _astro/a.js: ${label} in script`), output);
    assert.match(
      output,
      /Built scripts have no imports or exports\. The one exception/,
      "the message should say what to do",
    );
  });
}

test("an entry script that imports another file fails, whether or not that file exists", () => {
  const entry = page('<script type="module" src="/_astro/entry.js"></script>');
  const present = run({
    "index.html": entry,
    "_astro/entry.js": 'import"./b.js";const a=1;',
    "_astro/b.js": "const b=1;",
  });
  assert.equal(present.status, 1, present.output);
  assert.match(present.output, /FAIL _astro\/entry\.js: the word "import" in script/);

  const missing = run({
    "index.html": entry,
    "_astro/entry.js": 'import /* c */ x from "./nope.js";',
  });
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /FAIL _astro\/entry\.js: the word "import" in script/);
});

// ---- lazy loading: one narrow, exact import() of a built file --------------------------
//
// A page script may say import("./name.js") for a built .js file in its own folder. That
// file is a lazy script: it may export but never import. Everything else about imports
// and exports is unchanged, and the lazy file is scanned like any other script.

const entryPage = page('<script type="module" src="/_astro/entry.js"></script>');
const lazyFile = "function go(){}export{go as initArcade};";
const lazyBuild = (entry, lazy = lazyFile, extra = {}) =>
  run({
    "index.html": entryPage,
    "_astro/entry.js": entry,
    ...(lazy === null ? {} : { "_astro/arcade.abc.js": lazy }),
    ...extra,
  });

test("a page script may import() one built same-folder file, and that file may export", () => {
  for (const quote of ['"', "'", "`"]) {
    const entry = `const a=1;a&&import(${quote}./arcade.abc.js${quote}).then(m=>m.initArcade());`;
    const { status, output } = lazyBuild(entry);
    assert.equal(status, 0, `${quote}\n${output}`);
  }
});

test("the lazy file counts toward the JS total but not toward the first load", () => {
  const { status, output } = lazyBuild(
    'import("./arcade.abc.js");',
    `export const a="${"x".repeat(9_000)}";`,
  );
  assert.equal(status, 0, output);
  assert.match(output, /JS total: +9,\d{3} bytes/);
  assert.match(output, / 3 files/); // index.html, the stylesheet, entry.js
});

test("a lazy file may not import, statically or dynamically, so the graph stays one level deep", () => {
  for (const lazy of [
    'import"./x.js";export const a=1;',
    'import{a}from"./entry.js";export{a};',
    'export const a=1;const f=()=>import("./entry.js");',
    'export const a=1;const f=()=>import("./arcade.abc.js");',
  ]) {
    const { status, output } = lazyBuild('import("./arcade.abc.js");', lazy);
    assert.equal(status, 1, `${lazy}\n${output}`);
    assert.ok(
      output.includes(`FAIL _astro/arcade.abc.js: ${IMPORT_WORD} in script`),
      `${lazy}\n${output}`,
    );
  }
});

test("a page script that is not lazy still may not export, even when it imports a lazy file", () => {
  const { status, output } = lazyBuild('export const a=1;import("./arcade.abc.js");');
  assert.equal(status, 1, output);
  assert.ok(output.includes(`FAIL _astro/entry.js: ${EXPORT_WORD} in script`), output);
  assert.doesNotMatch(output, /FAIL _astro\/entry\.js: the word "import"/);
});

test("export is only allowed in a file a page script names: an unreferenced file still fails", () => {
  const { status, output } = lazyBuild("const a=1;", lazyFile);
  assert.equal(status, 1, output);
  assert.ok(output.includes(`FAIL _astro/arcade.abc.js: ${EXPORT_WORD} in script`), output);
});

test("the target must be a built .js file, or the import() fails like any import", () => {
  for (const entry of [
    'import("./gone.js");',
    'import("./arcade.abc.mjs");', // only .js targets qualify
    'import("./sub/arcade.abc.js");', // another folder
  ]) {
    // The .mjs and subfolder targets are built too, so only the shape of the import is at fault.
    const built = { "_astro/arcade.abc.mjs": lazyFile, "_astro/sub/arcade.abc.js": lazyFile };
    const { status, output } = lazyBuild(entry, lazyFile, built);
    assert.equal(status, 1, `${entry}\n${output}`);
    assert.ok(
      output.includes(`FAIL _astro/entry.js: ${IMPORT_WORD} in script`),
      `${entry}\n${output}`,
    );
  }
});

test("only the exact form qualifies: spacing, comments, other paths, URLs and computed names all fail", () => {
  const notExact = [
    "import ('./arcade.abc.js')",
    'import("./arcade.abc.js" )',
    'import( "./arcade.abc.js")',
    'import/* c */("./arcade.abc.js")',
    'import("/_astro/arcade.abc.js")',
    'import("../_astro/arcade.abc.js")',
    'import("arcade.abc.js")',
    'import("./arcade.abc.js?v=1")',
    'import("./arcade.abc.js#x")',
    'import("./arcade.abc.js",{})',
    'import("./arcade.abc.js"+x)',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is script source text, not a template
    "import(`./arcade.abc.js${x}`)",
    'import("./arcade.abc.js\\u0000")',
    "import(u)",
    'import("data:text/javascript,1")',
    'import("https://cdn.example/x.js")',
    'import"./arcade.abc.js"',
    'import{initArcade}from"./arcade.abc.js"',
    'import("./arcade.abc.js").then(()=>import("./other.js"))', // a second, missing target
  ];
  for (const entry of notExact) {
    const { status, output } = lazyBuild(`const a=1;${entry};`, `${lazyFile}`);
    assert.equal(status, 1, `${entry}\n${output}`);
    assert.ok(
      output.includes(`FAIL _astro/entry.js: ${IMPORT_WORD} in script`),
      `${entry}\n${output}`,
    );
  }
});

test("a lazy file is scanned like any other script: eval, fetch, URLs and the rest still fail in it", () => {
  for (const [label, body] of [
    ["eval", 'eval("1")'],
    ["fetch", "fetch(u)"],
    ["innerHTML", "el.innerHTML=1"],
    ["an absolute http(s):// URL", 'const u="https://example.com/x"'],
    ['createElement("script")', 'document.createElement("script")'],
  ]) {
    const { status, output } = lazyBuild('import("./arcade.abc.js");', `export const a=1;${body};`);
    assert.equal(status, 1, `${body}\n${output}`);
    assert.ok(
      output.includes(`FAIL _astro/arcade.abc.js: ${label} in script`),
      `${body}\n${output}`,
    );
  }
});

test("a chain fails: the lazy file may not import() another, so there is no second level", () => {
  const { status, output } = lazyBuild(
    'import("./arcade.abc.js");',
    'export const a=1;import("./deeper.abc.js");',
    { "_astro/deeper.abc.js": "export const b=2;" },
  );
  assert.equal(status, 1, output);
  assert.ok(output.includes(`FAIL _astro/arcade.abc.js: ${IMPORT_WORD} in script`), output);
});

test("the hint names the one exception", () => {
  const { output } = lazyBuild('import"./x.js";');
  assert.match(output, /may say import\("\.\/file\.js"\) for a built \.js file in its own folder/);
});

const REEXPORT = "a re-export (export ... from)";

test("a lazy file may not re-export: export ... from is refused in every spelling", () => {
  for (const body of [
    'export * from "../missing.mjs";',
    'export{x}from"./other.js";',
    'export * as ns from "data:text/javascript,export const a=1";',
    'export*from/* c */"./m.js";',
    'export {x} from // c\n "./m.js";',
    "export * from`./m.js`;",
    'export {y} from\n"./m.js";',
  ]) {
    const { status, output } = lazyBuild('import("./arcade.abc.js");', `export const a=1;${body}`);
    assert.equal(status, 1, `${body}\n${output}`);
    assert.ok(
      output.includes(`FAIL _astro/arcade.abc.js: ${REEXPORT} in script`),
      `${body}\n${output}`,
    );
    assert.match(output, /may export its own names only/);
  }
});

test("things that only look like a re-export pass: Array.from, a variable or key called from, export of a local", () => {
  const lazy =
    'const from=1,o={from:2};export const a=Array.from("ab").length+from+o.from;export{from as b};';
  const { status, output } = lazyBuild('import("./arcade.abc.js");', lazy);
  assert.equal(status, 0, output);
});

test("only a script a page loads can make a file lazy: a string, comment or property call elsewhere grants nothing", () => {
  for (const other of [
    "const s='import(\"./entry.js\")';",
    '/*import("./entry.js")*/',
    'x.import("./entry.js");',
  ]) {
    const { status, output } = run({
      "index.html": entryPage,
      "_astro/entry.js": "export const a=1;",
      "_astro/other.js": other,
    });
    assert.equal(status, 1, `${other}\n${output}`);
    assert.ok(
      output.includes(`FAIL _astro/entry.js: ${EXPORT_WORD} in script`),
      `${other}\n${output}`,
    );
  }
});

test("a script a page loads cannot also be a lazy script", () => {
  const both = page(
    '<script type="module" src="/_astro/entry.js"></script><script type="module" src="/_astro/second.js"></script>',
  );
  const { status, output } = run({
    "index.html": both,
    "_astro/entry.js": 'import("./second.js");',
    "_astro/second.js": "export const a=1;",
  });
  assert.equal(status, 1, output);
  assert.match(output, /FAIL _astro\/second\.js: is loaded by a page and also named by import\(\)/);
});

test("the name must match the built file's letter case exactly", () => {
  const { status, output } = lazyBuild('import("./ARCADE.abc.js");');
  assert.equal(status, 1, output);
  assert.ok(output.includes(`FAIL _astro/entry.js: ${IMPORT_WORD} in script`), output);
});

test("a nested import() cannot hide behind a permitted one", () => {
  for (const entry of ['import(import("./arcade.abc.js"));', 'import(("./arcade.abc.js"));']) {
    const { status, output } = lazyBuild(entry);
    assert.equal(status, 1, `${entry}\n${output}`);
    assert.ok(
      output.includes(`FAIL _astro/entry.js: ${IMPORT_WORD} in script`),
      `${entry}\n${output}`,
    );
  }
});

test("a script that any page loads counts as a page script, whichever page it is", () => {
  const { status, output } = run({
    "about/index.html": page('<script type="module" src="/_astro/entry.js"></script>'),
    "_astro/entry.js": 'import("./arcade.abc.js");',
    "_astro/arcade.abc.js": lazyFile,
  });
  assert.equal(status, 0, output);
});

test("the old import-following is gone: the first load counts only what the page and its CSS reach", () => {
  const entry = page('<script type="module" src="/_astro/entry.js"></script>');
  const { output } = run({
    "index.html": entry,
    "_astro/entry.js": "const a=1;",
    "_astro/big.js": `const a="${"x".repeat(106_000)}";`, // not referenced by anything
  });
  assert.doesNotMatch(output, /first load .* exceeds/);
  assert.match(output, / 3 files/); // index.html, the stylesheet, entry.js
});

test("documented: the rules are about the words, so a string, comment, key or property that only says import or export fails too", () => {
  // Nothing here is a module statement. The rules do not read syntax, so they cannot know
  // that, and they err on the side of failing. Reword the string, rename the key or move
  // to a real tokenizer when the game needs modules.
  const justTheWord = [
    [IMPORT_WORD, `const help='Use import "./example.js";'`],
    [IMPORT_WORD, 'const s="import the data";'],
    [IMPORT_WORD, "// import './x.js'"],
    [IMPORT_WORD, "/* the import step */"],
    [IMPORT_WORD, "const o={import:1};"],
    [IMPORT_WORD, "const x=o.import;"],
    [IMPORT_WORD, "const $import=1;"],
    [EXPORT_WORD, 'const help="Use export to share it";'],
    [EXPORT_WORD, "// export the data"],
    [EXPORT_WORD, "/* the export step */"],
    [EXPORT_WORD, "const o={export:1};"],
    [EXPORT_WORD, "const x=o.export;"],
    [EXPORT_WORD, "const $export=1;"],
  ];
  for (const [label, source] of justTheWord) {
    const { status, output } = run({ "_astro/a.js": `${source}\nconst a=1;` });
    assert.equal(status, 1, `${source}\n${output}`);
    assert.ok(output.includes(`FAIL _astro/a.js: ${label} in script`), `${source}\n${output}`);
  }
});

test("import.meta passes, and so do other words that merely contain the letters", () => {
  const harmless = [
    "const t=import.meta.url,u=import.meta,v=import .meta,w=import  .  meta.env;",
    "const important=1,imports=[],reimport=2,importer=3,_import=4,importπ=5;",
    "const exports=1,reexport=2,_export=3,exported=4,exporter=5,exportπ=6,πexport=7,export_x=8;",
    'const s="important data, imports and reimporting, exports and reexport";',
  ].join("\n");
  const { status, output } = run({ "_astro/a.js": harmless });
  assert.equal(status, 0, output);
});

test("outside a lazy file there is no separate re-export rule: only the two word rules are reported", () => {
  const { output } = run({ "_astro/a.js": 'export * from "./m.js";' });
  assert.ok(output.includes(`FAIL _astro/a.js: ${EXPORT_WORD} in script`), output);
  assert.doesNotMatch(output, /re-export/);
});

// ---- size caps ------------------------------------------------------------------

// Padding that no rule objects to: a string of x's, and a CSS comment.
const jsOf = (bytes) => `const a="${"x".repeat(bytes - 11)}";`; // `const a="` and `";` are 11
const cssOf = (bytes) => `/*${"x".repeat(bytes - 4)}*/`;

test("all JavaScript together is capped at 26,000 bytes", () => {
  const atLimit = run({ "_astro/a.js": jsOf(26_000) });
  assert.equal(atLimit.status, 0, atLimit.output);
  assert.match(atLimit.output, /JS total: +26,000 bytes \(limit 26,000\)/);

  const over = run({ "_astro/a.js": jsOf(26_001) });
  assert.equal(over.status, 1, over.output);
  assert.match(over.output, /JavaScript totals 26,001 bytes, over the 26,000 byte limit/);

  // It is a total, not a per-file limit, and .mjs counts.
  const split = run({ "_astro/a.js": jsOf(14_000), "_astro/b.mjs": jsOf(14_000) });
  assert.equal(split.status, 1, split.output);
  assert.match(split.output, /JavaScript totals 28,000 bytes/);
});

test("all CSS together is capped at 18,000 bytes", () => {
  const atLimit = run({ "_astro/a.css": cssOf(18_000) });
  assert.equal(atLimit.status, 0, atLimit.output);
  assert.match(atLimit.output, /CSS total: +18,000 bytes \(limit 18,000\)/);

  const over = run({ "_astro/a.css": cssOf(18_001) });
  assert.equal(over.status, 1, over.output);
  assert.match(over.output, /CSS totals 18,001 bytes, over the 18,000 byte limit/);

  const split = run({ "_astro/a.css": cssOf(9_500), "_astro/b.css": cssOf(9_500) });
  assert.equal(split.status, 1, split.output);
  assert.match(split.output, /CSS totals 19,000 bytes/);
});

test("a clean build reports both totals", () => {
  const { output } = run();
  assert.match(output, /JS total: .*limit 26,000/);
  assert.match(output, /CSS total: .*limit 18,000/);
});

test("fails when the home page HTML is over 14 KB", () => {
  const { status, output } = run({ "index.html": page(`<!--${"x".repeat(14_000)}-->`) });
  assert.equal(status, 1, output);
  assert.match(output, /exceeds the 14,000 byte limit/);
});

test("fails when the first load is over 106 KB, counting fonts named in the CSS", () => {
  const { status, output } = run({
    "_astro/a.css": '@font-face{font-family:X;src:url("/fonts/big.woff2")}',
    "fonts/big.woff2": "x".repeat(106_001),
  });
  assert.equal(status, 1, output);
  assert.match(output, /first load .* exceeds the 106,000 byte limit/);
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

  const over = run({ ...nested, "fonts/f.woff2": "x".repeat(106_001) });
  assert.equal(over.status, 1, over.output);
  assert.match(over.output, /first load .* exceeds the 106,000 byte limit/);
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
