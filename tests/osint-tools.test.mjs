import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fromHash, hashFor } from "../src/lib/osint-state.ts";
import { countLine, GATED_LINE, matches, rowView, searchText } from "../src/lib/osint-tools.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const data = JSON.parse(read("../src/data/osint-tools.json"));
const pivotText = read("../src/data/osint-pivot-map.json");
const pivot = JSON.parse(pivotText);
const gated = data.tools.filter((t) => t.tier === "gated");
const open = data.tools.filter((t) => t.tier !== "gated");

// ---- the data ------------------------------------------------------------------------

test("the counts in the file match the tools in it", () => {
  assert.equal(data.toolCount, data.tools.length);
  for (const tier of ["start", "deeper", "gated"]) {
    assert.equal(data.tierCounts[tier], data.tools.filter((t) => t.tier === tier).length, tier);
  }
  assert.equal(
    data.tierCounts.start + data.tierCounts.deeper + data.tierCounts.gated,
    data.toolCount,
  );
});

test("every tool has a known section and tier, a unique id and an https link into the guide", () => {
  const sections = new Set(data.sections.map((s) => s.id));
  assert.equal(sections.size, data.sections.length, "section ids repeat");
  const ids = new Set();
  for (const t of data.tools) {
    assert.ok(sections.has(t.section), `${t.id}: unknown section`);
    assert.ok(["start", "deeper", "gated"].includes(t.tier), `${t.id}: unknown tier`);
    assert.ok(!ids.has(t.id), `${t.id} repeats`);
    ids.add(t.id);
    assert.match(t.url, /^https:\/\/github\.com\/iijarrett\/osint-field-guide\//, t.id);
  }
});

test("the sections are in guide order", () => {
  const ranks = data.sections.map((s) => s.rank);
  assert.deepEqual(ranks, [...ranks].sort());
});

test("every Reach from type exists in the pivot map", () => {
  const types = new Set(pivot.nodes.map((n) => n.id));
  for (const t of data.tools) for (const r of t.reach) assert.ok(types.has(r), `${t.id}: ${r}`);
});

test("a gated tool carries only its id, name, section, tier, link and an empty reach", () => {
  assert.equal(gated.length, data.tierCounts.gated);
  for (const t of gated) {
    assert.deepEqual(
      Object.keys(t).sort(),
      ["id", "name", "reach", "section", "tier", "url"],
      t.id,
    );
    assert.deepEqual(t.reach, [], t.id);
  }
});

test("no gated tool is in the pivot map, by name or by id", () => {
  const text = pivotText.toLowerCase();
  for (const t of gated) {
    assert.ok(!text.includes(t.name.toLowerCase()), `${t.name} is in the pivot map`);
    assert.ok(!text.includes(`"${t.id}"`), `${t.id} is in the pivot map`);
  }
});

// ---- what a row may show ------------------------------------------------------------

test("a gated row shows the name, the tier, the link and the fixed line, and nothing more", () => {
  const sneaky = {
    ...gated[0],
    summary: "SECRET-SUMMARY",
    kind: "SECRET-KIND",
    verified: "2026-01-01",
    reach: ["name"],
  };
  const view = rowView(sneaky);
  assert.deepEqual(Object.keys(view).sort(), ["gatedLine", "name", "text", "tier", "url"]);
  assert.equal(view.gatedLine, GATED_LINE);
  assert.equal(GATED_LINE, "Easy to misuse. Details and cautions are in the guide.");
  assert.ok(!view.text.includes("secret"), "the search text leaks the summary");
});

test("an open row shows everything the data has", () => {
  const t = open.find((x) => x.summary && x.kind && x.verified && x.reach.length);
  assert.ok(t, "no open tool with every field");
  const view = rowView(t);
  assert.equal(view.summary, t.summary);
  assert.deepEqual(view.reach, t.reach);
  assert.ok(view.detail.includes(t.kind) && view.detail.includes(t.verified));
  assert.equal(view.gatedLine, undefined);
});

test("the template reads tools only through rowView", () => {
  const page = read("../src/components/AllTools.astro");
  for (const field of ["summary", "kind", "verified", "reach"]) {
    assert.ok(!new RegExp(`\\bt\\.${field}\\b`).test(page), `the template reads t.${field}`);
  }
  assert.match(page, /rowView\(t\)/);
});

// ---- search and filters -------------------------------------------------------------

const row = { text: "shodan search engine", sec: "05-ip", tier: "deeper" };

test("search matches words in the name or summary, any case, and nothing else", () => {
  assert.ok(matches(row, { q: "shodan", sec: "", tier: "" }));
  assert.ok(matches(row, { q: "engine", sec: "", tier: "" }));
  assert.ok(!matches(row, { q: "nothing", sec: "", tier: "" }));
  const t = open[0];
  assert.equal(searchText(t), `${t.name} ${t.summary ?? ""}`.toLowerCase());
});

test("a gated tool is found by name only", () => {
  const t = gated[0];
  assert.equal(searchText({ ...t, summary: "hidden words" }), t.name.toLowerCase());
});

test("section and tier filters narrow together", () => {
  assert.ok(matches(row, { q: "", sec: "05-ip", tier: "deeper" }));
  assert.ok(!matches(row, { q: "", sec: "04-x", tier: "" }));
  assert.ok(!matches(row, { q: "", sec: "", tier: "start" }));
  assert.ok(matches(row, { q: "", sec: "", tier: "" }));
});

test("the count line", () => {
  assert.equal(countLine(12, 87), "Showing 12 of 87");
});

// ---- shared state and the address bar -----------------------------------------------

test("the address bar: #all-tools opens the list, #pivot-map or a type opens the map", () => {
  const types = ["name", "email"];
  assert.deepEqual(fromHash("all-tools", types), { tab: "tools" });
  assert.deepEqual(fromHash("pivot-map", types), { tab: "pivot" });
  assert.deepEqual(fromHash("email", types), { tab: "pivot", type: "email" });
  assert.equal(fromHash("", types), null);
  assert.equal(fromHash("nonsense", types), null);
  assert.equal(hashFor({ tab: "tools", type: "email" }), "all-tools");
  assert.equal(hashFor({ tab: "pivot", type: "email" }), "email");
});

// ---- the page's markup and scripts --------------------------------------------------

test("the tabs have tablist, tab and tabpanel roles wired by id", () => {
  const tabs = read("../src/components/OsintTabs.astro");
  assert.match(tabs, /role="tablist"/);
  assert.equal(tabs.match(/role="tab"/g).length, 2);
  assert.equal(tabs.match(/role="tabpanel"/g).length, 2);
  for (const id of ["pivot", "tools"]) {
    assert.match(tabs, new RegExp(`aria-controls="os-panel-${id}"`));
    assert.match(tabs, new RegExp(`aria-labelledby="os-tab-${id}"`));
  }
  const script = read("../src/scripts/osint-tabs.ts");
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.ok(script.includes(key));
});

test("the list has a labelled search box, a live count, a clear button and an empty state", () => {
  const page = read("../src/components/AllTools.astro");
  assert.match(page, /<label class="sr-only" for="at-q">/);
  assert.match(page, /type="search"/);
  assert.match(page, /role="status" aria-live="polite" data-count/);
  assert.match(page, /data-clear/);
  assert.match(page, /data-empty/);
  assert.match(page, /target="_blank" rel="noopener"/);
});

test("the scripts write no markup, fetch nothing and parse nothing", () => {
  for (const file of ["all-tools", "osint-tabs", "osint"]) {
    const source = read(`../src/scripts/${file}.ts`);
    for (const word of ["innerHTML", "insertAdjacentHTML", "fetch(", "JSON.parse", "eval("]) {
      assert.ok(!source.includes(word), `${file}.ts uses ${word}`);
    }
  }
});

test("the page loads one script entry for all three behaviours, so the state is shared", () => {
  const entry = read("../src/scripts/osint.ts");
  for (const name of ["osint-tabs", "pivot-map", "all-tools"]) assert.ok(entry.includes(name));
  for (const file of ["AllTools", "PivotMap"]) {
    assert.ok(
      !/<script\b/i.test(read(`../src/components/${file}.astro`)),
      `${file} has its own script`,
    );
  }
});

test("the pivot map data and its test still name no gated tier", () => {
  assert.ok(!/gated/i.test(pivotText));
});
