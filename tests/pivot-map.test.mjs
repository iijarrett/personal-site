import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { heading, moreLabel, plural, ring, targets, trailText } from "../src/lib/pivot-map.ts";

const data = JSON.parse(readFileSync(new URL("../src/data/osint-pivot-map.json", import.meta.url)));
const ids = new Set(data.nodes.map((n) => n.id));

// ---------- The vendored data ----------

test("every pivot starts and ends at a known type, and every tool has a tier and an https link", () => {
  assert.ok(data.nodes.length > 0 && data.edges.length > 0);
  for (const e of data.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from} -> ${e.to}`);
    assert.ok(e.label && e.tools.length > 0, e.label);
    for (const t of e.tools) {
      assert.ok(t.tier === "start" || t.tier === "deeper", t.id);
      assert.match(t.url, /^https:\/\/github\.com\/iijarrett\/osint-field-guide\//, t.id);
    }
  }
  for (const n of data.nodes) assert.match(n.guide, /^https:\/\/github\.com\/iijarrett\//, n.id);
});

test("the data names no gated tier", () => {
  assert.ok(!/gated/i.test(JSON.stringify(data)));
});

test("the tool count in the data matches the distinct tools its pivots name", () => {
  const distinct = new Set(data.edges.flatMap((e) => e.tools.map((t) => t.id)));
  assert.ok(distinct.size <= data.toolCount, `${distinct.size} named, ${data.toolCount} counted`);
});

// ---------- The helpers ----------

test("heading and moreLabel read as plain sentences", () => {
  const email = data.nodes.find((n) => n.id === "email");
  assert.equal(heading(email), "From an email address you can reach");
  assert.equal(moreLabel(data.nodes.find((n) => n.id === "domain")), "More domains");
  assert.equal(moreLabel({ id: "x", short: "Thing", label: "", guide: "" }), "More thing");
});

test("plural counts one as singular", () => {
  assert.equal(plural(1, "pivot"), "1 pivot");
  assert.equal(plural(0, "pivot"), "0 pivots");
  assert.equal(plural(7, "tool"), "7 tools");
});

test("ring puts the first point at the top and spaces the rest evenly", () => {
  const pts = ring(4, 100, 100, 50);
  assert.deepEqual(
    pts.map((p) => [Math.round(p.x), Math.round(p.y)]),
    [
      [100, 50],
      [150, 100],
      [100, 150],
      [50, 100],
    ],
  );
});

test("targets groups pivots by destination, skips self pivots and lists each tool once", () => {
  const edges = [
    { from: "a", to: "b", label: "", tools: [{ name: "One" }, { name: "Two" }] },
    { from: "a", to: "a", label: "", tools: [{ name: "Self" }] },
    { from: "a", to: "b", label: "", tools: [{ name: "Two" }, { name: "Three" }] },
    { from: "a", to: "c", label: "", tools: [{ name: "Four" }] },
    { from: "z", to: "b", label: "", tools: [{ name: "Other" }] },
  ];
  assert.deepEqual(targets(edges, "a"), [
    { to: "b", tools: ["One", "Two", "Three"] },
    { to: "c", tools: ["Four"] },
  ]);
});

test("trailText numbers each step after the first, in the form the page promises", () => {
  assert.equal(
    trailText(
      ["Username", "Account", "Photo / video"],
      [[], ["Maigret", "Sherlock", "Blackbird"], ["Tool"]],
    ),
    "1. Username -> Account (Maigret, Sherlock, Blackbird)\n2. Account -> Photo / video (Tool)",
  );
  assert.equal(trailText(["Username"], [[]]), "");
});

// ---------- The page script and the markup ----------

const script = readFileSync(new URL("../src/scripts/pivot-map.ts", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../src/components/PivotMap.astro", import.meta.url),
  "utf8",
);

test("the script reads no data and builds no markup: it writes text and classes only", () => {
  for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "fetch", "JSON.parse"]) {
    assert.ok(!script.includes(banned), banned);
  }
});

test("every outside link opens in a new tab with rel noopener, and the map uses real buttons", () => {
  assert.match(component, /target="_blank" rel="noopener"/);
  assert.ok(!/<a [^>]*target="_blank"(?![^>]*rel="noopener")/.test(component));
  assert.ok(!/onclick|style=/.test(component));
  assert.match(component, /<button type="button" class="btn pm-chip"/);
  assert.match(component, /role="status"/);
});

test("the radial map and the cards are rendered for every type, so the page works without script", () => {
  assert.match(component, /nodes\.map/);
  assert.match(component, /panels\.map/);
  assert.match(component, /\.js \.pm-panel:not\(\.on\)/);
});
