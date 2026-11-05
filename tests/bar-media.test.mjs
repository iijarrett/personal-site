import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The header bar has a wide layout (starts hidden, comes back on a wheel-up, the mouse at the top
// edge or keyboard focus) and a narrow one (visible at the top, hides on scroll down, returns on
// scroll up). Which one a device gets is decided by media queries written in two places, the CSS
// and src/scripts/bar.ts, and they must agree exactly.
//
// Wide is ONE definition: a screen over 640px whose primary pointer can hover. Narrow is its exact
// negation in the CSS, so every viewport and every pointer gets exactly one layout, fractional
// widths included (the old pair, min-width: 641px against max-width: 640px, left 640 to 641 with
// no layout at all, which happens under browser zoom).

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
const script = read("../src/scripts/bar.ts");

// ---------- A small media query evaluator, for exactly the features used here ----------

function parse(query) {
  const tokens = query.match(/[(),:]|[^\s(),:]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const take = (expected) => {
    const token = tokens[at++];
    assert.ok(expected === undefined || token === expected, `expected ${expected}, found ${token}`);
    return token;
  };
  function condition() {
    take("(");
    let node;
    if (peek() === "not") {
      take("not");
      node = { not: condition() };
    } else if (peek() === "(") {
      node = list();
    } else {
      const feature = take();
      take(":");
      node = { feature, value: take() };
    }
    take(")");
    return node;
  }
  function and() {
    if (peek() === "not") {
      take("not");
      return { not: condition() };
    }
    const parts = [condition()];
    while (peek() === "and") {
      take("and");
      parts.push(condition());
    }
    return { and: parts };
  }
  function list() {
    const alternatives = [and()];
    while (peek() === ",") {
      take(",");
      alternatives.push(and());
    }
    return { or: alternatives };
  }
  const tree = list();
  assert.equal(at, tokens.length, `unparsed input after ${tokens[at]}`);
  return tree;
}

/** Whether `node` is true for a device: { width, hover: "hover" | "on-demand" | "none", pointer: "fine" | "coarse" | "none" }. */
function matches(node, device) {
  if (node.or) return node.or.some((alternative) => matches(alternative, device));
  if (node.and) return node.and.every((part) => matches(part, device));
  if (node.not) return !matches(node.not, device);
  const px = Number.parseFloat(node.value);
  switch (node.feature) {
    case "min-width":
      return device.width >= px;
    case "max-width":
      return device.width <= px;
    case "hover":
      return device.hover === node.value;
    case "pointer":
      return device.pointer === node.value;
    default:
      throw new Error(`the evaluator does not know ${node.feature}`);
  }
}

// ---------- The queries as written ----------

const preludeBefore = (selector) => {
  const found = [...css.matchAll(/@media\s+([^{]*?)\s*\{\s*([^{}]*)\{/g)].find(
    (match) => match[2].trim() === selector,
  );
  assert.ok(found, `no @media block around ${selector}`);
  return found[1];
};
const WIDE_CSS = preludeBefore("html.js:not(.bar-on):not(.bar-off)");
/** Narrow is whatever wide is not. The CSS no longer writes it out: once the script has run, bar-off hides at any width. */
const NARROW = `not (${WIDE_CSS})`;
const WIDE_JS = script.match(/matchMedia\(\s*"([^"]+)"\s*\)/)?.[1];

test("the script asks exactly the query the CSS uses for the wide layout", () => {
  assert.ok(WIDE_JS, "no matchMedia query in bar.ts");
  assert.equal(WIDE_JS, WIDE_CSS);
});

test("wide is one definition, in one place in the CSS, with no pointer: part and no second width query for the bar", () => {
  assert.equal(WIDE_CSS, "(min-width: 641px) and (hover: hover)");
  assert.ok(!/pointer:/.test(WIDE_CSS), "the pointer: coarse part is gone");
  const barQueries = [...css.matchAll(/@media\s+([^{]*?)\s*\{/g)]
    .map((match) => match[1])
    .filter((query) => /hover/.test(query) && /641px/.test(query));
  assert.deepEqual(barQueries, [WIDE_CSS]);
});

// ---------- What each device gets ----------

const wide = parse(WIDE_CSS);
const narrow = parse(NARROW);
const layoutOf = (device) => (matches(wide, device) ? "wide" : "narrow");

const devices = [
  ["a desktop with a mouse, 1057 px", { width: 1057, hover: "hover", pointer: "fine" }, "wide"],
  ["a big monitor with a mouse, 2560 px", { width: 2560, hover: "hover", pointer: "fine" }, "wide"],
  ["a mouse at exactly 641 px", { width: 641, hover: "hover", pointer: "fine" }, "wide"],
  ["a mouse at 641.5 px (browser zoom)", { width: 641.5, hover: "hover", pointer: "fine" }, "wide"],
  ["a mouse at exactly 640 px", { width: 640, hover: "hover", pointer: "fine" }, "narrow"],
  [
    "a mouse at 640.5 px (browser zoom)",
    { width: 640.5, hover: "hover", pointer: "fine" },
    "narrow",
  ],
  ["a mouse at 640.99 px", { width: 640.99, hover: "hover", pointer: "fine" }, "narrow"],
  ["a mouse in a narrow window, 500 px", { width: 500, hover: "hover", pointer: "fine" }, "narrow"],
  ["a phone, 390 px", { width: 390, hover: "none", pointer: "coarse" }, "narrow"],
  ["a tablet in portrait, 820 px", { width: 820, hover: "none", pointer: "coarse" }, "narrow"],
  ["a tablet in landscape, 1180 px", { width: 1180, hover: "none", pointer: "coarse" }, "narrow"],
  ["a big touch tablet, 1366 px", { width: 1366, hover: "none", pointer: "coarse" }, "narrow"],
  [
    "a touch laptop whose primary pointer is the mouse (touchscreen present), 1280 px",
    { width: 1280, hover: "hover", pointer: "fine" },
    "wide",
  ],
  [
    "a 2-in-1 that can hover but has a coarse primary pointer, 1024 px",
    { width: 1024, hover: "hover", pointer: "coarse" },
    "wide",
  ],
  [
    "a stylus-only wide device (cannot hover, fine pointer), 1024 px: now narrow, so its header is visible and follows scroll",
    { width: 1024, hover: "none", pointer: "fine" },
    "narrow",
  ],
  [
    "a device whose hover is on-demand, 1024 px",
    { width: 1024, hover: "on-demand", pointer: "coarse" },
    "narrow",
  ],
  [
    "a device with no pointer at all, 1024 px",
    { width: 1024, hover: "none", pointer: "none" },
    "narrow",
  ],
];

for (const [name, device, expected] of devices) {
  test(`${name}: ${expected} layout`, () => {
    assert.equal(layoutOf(device), expected);
  });
}

/** Every width worth trying: whole pixels, and fractions around the breakpoint and elsewhere. */
function widths() {
  const out = [];
  for (let width = 200; width <= 2600; width += 1) out.push(width);
  for (const width of [640, 640.4, 640.5, 640.99, 641, 641.5]) out.push(width);
  for (let width = 600; width <= 700; width += 0.25) out.push(width);
  out.push(640.0001, 640.9999, 640.999999, 641.0001);
  return out;
}

test("every width, hover and pointer gets exactly one layout: the two queries are exact opposites", () => {
  let checked = 0;
  for (const width of widths()) {
    for (const hover of ["hover", "on-demand", "none"]) {
      for (const pointer of ["fine", "coarse", "none"]) {
        const device = { width, hover, pointer };
        const rules = [matches(wide, device), matches(narrow, device)];
        assert.equal(rules.filter(Boolean).length, 1, JSON.stringify(device));
        checked++;
      }
    }
  }
  assert.ok(checked > 20000, `only ${checked} combinations were checked`);
});

test("the fractional widths around the breakpoint, with every hover and pointer, each get one layout", () => {
  for (const width of [640, 640.4, 640.5, 640.99, 641, 641.5]) {
    for (const hover of ["hover", "on-demand", "none"]) {
      for (const pointer of ["fine", "coarse", "none"]) {
        const device = { width, hover, pointer };
        assert.notEqual(matches(wide, device), matches(narrow, device), JSON.stringify(device));
      }
    }
  }
});

test("hover decides, not pointer: any pointer type with hover is wide from 641 px, and none without it is", () => {
  for (const width of [641, 641.5, 820, 1366, 1920]) {
    for (const pointer of ["fine", "coarse", "none"]) {
      assert.equal(
        layoutOf({ width, hover: "hover", pointer }),
        "wide",
        `hover ${pointer} ${width}`,
      );
      assert.equal(
        layoutOf({ width, hover: "none", pointer }),
        "narrow",
        `no hover ${pointer} ${width}`,
      );
    }
  }
});

// ---------- The rules those layouts switch on ----------

test("the hide rules still need .js, so with JavaScript off the header is always visible and nothing sticks", () => {
  assert.match(css, /\nhtml\.js\.bar-off\s*\{\s*--bar-y: -100%/);
  assert.match(
    css,
    /@media [^{]*\{\s*html\.js:not\(\.bar-on\):not\(\.bar-off\)\s*\{\s*--bar-y: -100%/,
  );
  assert.match(css, /\.js \.site-header\s*\{\s*position: sticky/);
  assert.ok(!/\n\.site-header\s*\{[^}]*(sticky|--bar-y|pointer-events)/.test(css));
  assert.ok(!/\n\.bar\s*\{[^}]*(transform|--bar-y)/.test(css));
});
