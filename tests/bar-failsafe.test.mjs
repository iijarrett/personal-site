import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The header bar must never be hidden by CSS alone with no working script behind it. If the main
// bundle fails to load or throws before initBar() has decided, a wide screen must still get its bar
// back: hidden on first paint (so it never flashes), then shown again after about 3 seconds.
//
// The two things that can hide the bar are
//   - the marker: bar-off, which src/scripts/bar.ts puts on <html> only once it has decided, and
//   - the pre-script state of a wide screen (no bar-on, no bar-off), which expires: an animation
//     removes the transform after 3s, and the script's class removes the animation. The animation
//     is not inside the media query, so crossing the breakpoint cannot restart its 3s. A header
//     with keyboard focus in it is exempt from this state altogether.
// These tests read the CSS, build a small model of which rules apply to which state, and check
// that nothing else can hide the bar. The browser check (bundle blocked, then delayed) is in the
// commit message.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const raw = read("../src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
const script = read("../src/scripts/bar.ts");

const WIDE = "(min-width: 641px) and (hover: hover)";

// ---------- Read the rules ----------

const keyframes = Object.fromEntries(
  [...raw.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)].map((m) => [m[1], m[2]]),
);
const withoutKeyframes = raw.replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\}\s*\}/g, "");

/** Every rule as { media, selector, body }, for top-level rules and rules directly inside @media. */
function parseRules(text) {
  const out = [];
  let media = null;
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("{", at);
    if (open < 0) break;
    const head = text.slice(at, open).trim();
    if (head.startsWith("@media")) {
      media = head.slice("@media".length).trim();
      at = open + 1;
      continue;
    }
    const close = text.indexOf("}", open);
    out.push({ media, selector: head, body: text.slice(open + 1, close) });
    at = close + 1;
    const closing = text.slice(at).match(/^\s*\}/);
    if (media && closing) {
      media = null;
      at += closing[0].length;
    }
  }
  return out;
}
const rules = parseRules(withoutKeyframes);

const FOCUS_ITEM = ":has(header :focus-visible)";

/**
 * Whether a selector made of html, classes and :not(...), optionally ending in " .bar", applies.
 * A :not() holds a list of classes and, at most, FOCUS_ITEM (keyboard focus in the header, `focus`):
 * it applies only if none of them does.
 */
function selectorApplies(selector, classes, focus = false) {
  const NOT = String.raw`:not\([^()]*(?:\([^()]*(?:\([^()]*\)[^()]*)*\)[^()]*)*\)`;
  const match = selector.match(new RegExp(String.raw`^html((?:\.[\w-]+|${NOT})*)( \.bar)?$`));
  if (!match) return null;
  const onBar = !!match[2];
  for (const part of match[1].match(new RegExp(String.raw`\.[\w-]+|${NOT}`, "g")) ?? []) {
    if (!part.startsWith(":not(")) {
      if (!classes.has(part.slice(1))) return { applies: false, onBar };
      continue;
    }
    const items = part.slice(":not(".length, -1).split(/,\s*/);
    for (const item of items) {
      const holds = item.startsWith(".")
        ? classes.has(item.slice(1))
        : item === FOCUS_ITEM && focus;
      assert.ok(item.startsWith(".") || item === FOCUS_ITEM, `the model does not know ${item}`);
      if (holds) return { applies: false, onBar };
    }
  }
  return { applies: true, onBar };
}

const hidingRules = rules.filter((rule) => /--bar-y:\s*-100%/.test(rule.body));
const failsafeRule = rules.find((rule) => /animation:[^;]*bar-failsafe/.test(rule.body));

// ---------- The inventory ----------

test("only two rules set --bar-y: the marker's bar-off, and the pre-script state of a wide screen", () => {
  assert.deepEqual(
    hidingRules.map((rule) => [rule.media, rule.selector]),
    [
      [null, "html.js.bar-off"],
      [WIDE, `html.js:not(.bar-on, .bar-off, ${FOCUS_ITEM})`],
    ],
  );
  for (const rule of hidingRules)
    assert.match(rule.selector, /^html\.js/, "a hide rule without .js");
});

test("nothing else moves the bar: .js .bar reads --bar-y, and no other rule sets a transform on it", () => {
  const moving = rules.filter(
    (rule) => /transform:/.test(rule.body) && /\.bar\b/.test(rule.selector),
  );
  assert.deepEqual(
    moving.map((rule) => rule.selector),
    [".js .bar"],
  );
  assert.match(moving[0].body, /translateY\(var\(--bar-y, 0\)\)/);
  assert.match(keyframes["bar-failsafe"] ?? "", /to\s*\{\s*transform:\s*none;?\s*\}/);
});

test("the failsafe is a short animation that starts after about 3 seconds and holds its end state", () => {
  assert.ok(failsafeRule, "no rule runs the bar-failsafe animation");
  assert.equal(
    failsafeRule.media,
    null,
    "inside the wide query, leaving and re-entering it would restart the 3s",
  );
  assert.equal(failsafeRule.selector, "html.js:not(.bar-on, .bar-off) .bar");
  const [, duration, delay] =
    failsafeRule.body.match(/animation:\s*bar-failsafe\s+([\d.]+m?s)\s+([\d.]+m?s)\s+forwards/) ??
    [];
  assert.ok(delay, `cannot read the animation: ${failsafeRule.body}`);
  const seconds = (text) =>
    text.endsWith("ms") ? Number.parseFloat(text) / 1000 : Number.parseFloat(text);
  assert.ok(seconds(delay) >= 2 && seconds(delay) <= 5, `the delay is ${delay}`);
  assert.ok(seconds(duration) <= 0.1, `the animation takes ${duration}`);
});

test("a header with keyboard focus is exempt from the pre-script hiding, and the site has one <header>", () => {
  const exempt = hidingRules.filter((rule) => rule.selector.includes(FOCUS_ITEM));
  assert.deepEqual(
    exempt.map((rule) => rule.media),
    [WIDE],
    "the pre-script hide rule does not exempt a header with keyboard focus",
  );
  assert.ok(!hidingRules[0].selector.includes(":has"), "the marker's bar-off must still win");
  // The exemption says `header`, not `.site-header`, to save bytes; that is the same element only
  // while the site header is the only <header> in the source.
  const headers = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(astro|md|mdx|html)$/.test(entry.name))
        headers.push(...(readFileSync(path, "utf8").match(/<header\b/g) ?? []));
    }
  };
  walk(fileURLToPath(new URL("../src", import.meta.url)));
  assert.equal(headers.length, 1, "another <header> would also lift the pre-script hiding");
});

// ---------- A model: which state is the bar hidden in? ----------

const DELAY = Number.parseFloat(
  failsafeRule.body.match(/bar-failsafe\s+[\d.]+m?s\s+([\d.]+)s/)?.[1] ?? "NaN",
);

/**
 * Whether the CSS leaves the bar hidden: `markers` is the set of classes on <html>, `t` is seconds
 * since first paint, `focus` is keyboard focus inside the header. The animation runs from first
 * paint whatever the media query does later, because its rule is outside every media query
 * (checked above), so `t` needs no reset when the viewport crosses the breakpoint.
 */
function hidden({ markers, wide, t, focus = false }) {
  const classes = new Set(markers);
  const inMedia = (rule) => rule.media === null || (rule.media === WIDE && wide);
  const hides = hidingRules.some(
    (rule) => inMedia(rule) && selectorApplies(rule.selector, classes, focus)?.applies,
  );
  if (!hides) return false;
  const rescued =
    failsafeRule &&
    inMedia(failsafeRule) &&
    selectorApplies(failsafeRule.selector, classes)?.applies &&
    t >= DELAY;
  return !rescued;
}

const cases = [
  [
    "no .js: never hidden, whatever else is on <html>",
    { markers: ["bar-off"], wide: true, t: 0 },
    false,
  ],
  ["no .js, wide, no marker", { markers: [], wide: true, t: 0 }, false],
  [
    "the script decided to hide (wide), at once",
    { markers: ["js", "bar-off"], wide: true, t: 0 },
    true,
  ],
  [
    "the script decided to hide (narrow), at once",
    { markers: ["js", "bar-off"], wide: false, t: 0 },
    true,
  ],
  [
    "the script decided to hide, much later",
    { markers: ["js", "bar-off"], wide: true, t: 60 },
    true,
  ],
  ["the script decided to show", { markers: ["js", "bar-on"], wide: true, t: 0 }, false],
  ["the script decided to show, narrow", { markers: ["js", "bar-on"], wide: false, t: 0 }, false],
  [
    "wide, the script has not run: hidden on first paint, so no flash",
    { markers: ["js"], wide: true, t: 0 },
    true,
  ],
  [
    "wide, the script has not run: still hidden just before the failsafe",
    { markers: ["js"], wide: true, t: DELAY - 0.01 },
    true,
  ],
  [
    "wide, the script never ran: the bar is back when the failsafe expires",
    { markers: ["js"], wide: true, t: DELAY },
    false,
  ],
  ["wide, the script never ran: and stays back", { markers: ["js"], wide: true, t: 600 }, false],
  [
    "narrow, the script has not run: the bar is shown",
    { markers: ["js"], wide: false, t: 0 },
    false,
  ],
  ["narrow, the script never ran: still shown", { markers: ["js"], wide: false, t: 600 }, false],
];

for (const [name, state, expected] of cases) {
  test(`model: ${name}`, () => {
    assert.equal(hidden(state), expected);
  });
}

test("the bar can only be hidden with the marker, or in a wide script-less state before the failsafe expires", () => {
  const names = ["js", "bar-on", "bar-off"];
  for (let bits = 0; bits < 8; bits++) {
    const markers = names.filter((_, i) => bits & (1 << i));
    for (const wide of [true, false]) {
      for (const t of [0, 1, DELAY - 0.01, DELAY, DELAY + 1, 100]) {
        for (const focus of [false, true]) {
          if (!hidden({ markers, wide, t, focus })) continue;
          const withMarker = markers.includes("js") && markers.includes("bar-off");
          const waiting =
            markers.includes("js") &&
            !markers.includes("bar-on") &&
            !markers.includes("bar-off") &&
            wide &&
            !focus &&
            t < DELAY;
          assert.ok(
            withMarker || waiting,
            `hidden with ${markers} wide=${wide} t=${t} focus=${focus} and neither the marker nor a live failsafe`,
          );
        }
      }
    }
  }
});

test("model: a focused header is shown in the pre-script state, and the marker still decides once it is there", () => {
  assert.equal(hidden({ markers: ["js"], wide: true, t: 0, focus: true }), false);
  assert.equal(hidden({ markers: ["js"], wide: true, t: 0, focus: false }), true);
  assert.equal(hidden({ markers: ["js", "bar-off"], wide: true, t: 0, focus: true }), true);
});

test("both bar-on and bar-off together would show it (the script never sets both)", () => {
  assert.equal(
    hidden({ markers: ["js", "bar-on", "bar-off"], wide: true, t: 0 }),
    true,
    "bar-off wins",
  );
});

// ---------- The marker is set only when the script has decided ----------

test("the marker classes are set in one place, update(), and that is the last thing initBar does", () => {
  const sets = [...script.matchAll(/classList\.toggle\("(bar-[a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sets, ["bar-on", "bar-off"]);
  const update = script.match(/const update = [\s\S]*?\n {2}\};\n/)?.[0] ?? "";
  assert.match(update, /classList\.toggle\("bar-on"/);
  assert.match(update, /classList\.toggle\("bar-off"/);
  assert.match(
    script,
    /\n {2}live = true;\n {2}update\(\);\n\}\n$/,
    "update() is no longer the last statement of initBar, right after the handlers go live",
  );
  assert.match(update, /if \(!live\) return;/, "update() acts before setup has finished");
});
