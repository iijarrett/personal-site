import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// Runs scripts/check_lighthouse.py on small fake reports, so each budget is proven to pass at
// its limit and to fail just beyond it.

const script = join(import.meta.dirname, "..", "scripts", "check_lighthouse.py");
const python = process.env.PYTHON ?? "python";
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A report that sits inside every budget; `over` changes individual numbers. */
function report(over = {}) {
  const v = {
    performance: 1,
    accessibility: 1,
    bestPractices: 1,
    seo: 1,
    lcp: 1_500,
    tbt: 50,
    cls: 0,
    ...over,
  };
  return {
    categories: {
      performance: { score: v.performance },
      accessibility: { score: v.accessibility },
      "best-practices": { score: v.bestPractices },
      seo: { score: v.seo },
    },
    audits: {
      "largest-contentful-paint": { numericValue: v.lcp },
      "total-blocking-time": { numericValue: v.tbt },
      "cumulative-layout-shift": { numericValue: v.cls },
    },
  };
}

function run(files) {
  const root = mkdtempSync(join(tmpdir(), "lh-"));
  roots.push(root);
  const folder = join(root, "reports");
  mkdirSync(folder);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(
      join(folder, `${name}.json`),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  const result = spawnSync(python, [script, folder], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test("lighthouse: reports inside the budgets pass, including exactly at the limits", () => {
  const result = run({
    home: report(),
    edge: report({ performance: 0.9, bestPractices: 0.95, lcp: 2_500, tbt: 400, cls: 0.1 }),
  });
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /2 page\(s\), 0 over budget/);
});

test("lighthouse: each score budget fails just below its limit", () => {
  for (const [over, pattern] of [
    [{ performance: 0.89 }, /performance is 89, budget is 90/],
    [{ accessibility: 0.99 }, /accessibility is 99, budget is 100/],
    [{ bestPractices: 0.94 }, /best-practices is 94, budget is 95/],
    [{ seo: 0.99 }, /seo is 99, budget is 100/],
  ]) {
    const result = run({ page: report(over) });
    assert.equal(result.code, 1, JSON.stringify(over));
    assert.match(result.out, pattern);
  }
});

test("lighthouse: each metric budget fails just over its limit", () => {
  for (const [over, pattern] of [
    [{ lcp: 2_501 }, /largest-contentful-paint is 2501ms, budget is 2500ms/],
    [{ tbt: 401 }, /total-blocking-time is 401ms, budget is 400ms/],
    [{ cls: 0.11 }, /cumulative-layout-shift is 0\.110, budget is 0\.1/],
  ]) {
    const result = run({ page: report(over) });
    assert.equal(result.code, 1, JSON.stringify(over));
    assert.match(result.out, pattern);
  }
});

test("lighthouse: one bad page fails the run and the good ones are still listed", () => {
  const result = run({ good: report(), bad: report({ seo: 0.5 }) });
  assert.equal(result.code, 1);
  assert.match(result.out, /ok\s+good/);
  assert.match(result.out, /FAIL bad/);
  assert.match(result.out, /2 page\(s\), 1 over budget/);
});

test("lighthouse: a run error is a failure, not a pass", () => {
  const result = run({ page: { runtimeError: { code: "NO_NAVSTART" } } });
  assert.equal(result.code, 1);
  assert.match(result.out, /did not finish \(NO_NAVSTART\)/);
});

test("lighthouse: a report with no scores or metrics fails", () => {
  const result = run({ page: { categories: {}, audits: {} } });
  assert.equal(result.code, 1);
  assert.match(result.out, /performance: no score/);
  assert.match(result.out, /largest-contentful-paint: no value/);
});

test("lighthouse: a file that is not JSON fails", () => {
  const result = run({ page: "not json" });
  assert.equal(result.code, 1);
  assert.match(result.out, /cannot read the report/);
});

test("lighthouse: with several runs of a page, the median performance run is judged", () => {
  // One noisy run (a failing score and a slow blocking time) among two good ones passes.
  const noisy = run({
    "home.1": report({ performance: 0.77, tbt: 1_073 }),
    "home.2": report({ performance: 0.97 }),
    "home.3": report({ performance: 0.95 }),
  });
  assert.equal(noisy.code, 0, noisy.out);
  assert.match(noisy.out, /ok\s+home \(median of 3 runs\)/);
  assert.match(noisy.out, /1 page\(s\), 0 over budget/);

  // Two bad runs out of three is a real regression and still fails.
  const real = run({
    "home.1": report({ performance: 0.77, tbt: 1_073 }),
    "home.2": report({ performance: 0.8, tbt: 900 }),
    "home.3": report({ performance: 0.97 }),
  });
  assert.equal(real.code, 1);
  assert.match(real.out, /FAIL home \(median of 3 runs\)/);
  assert.match(real.out, /performance is 80, budget is 90/);
});

test("lighthouse: an even number of runs is judged on the lower middle one", () => {
  const result = run({
    "page.1": report({ performance: 0.85 }),
    "page.2": report({ performance: 0.99 }),
  });
  assert.equal(result.code, 1);
  assert.match(result.out, /performance is 85, budget is 90/);
});

test("lighthouse: runs are grouped by page, so one page failing does not hide another", () => {
  const result = run({
    "a.1": report(),
    "a.2": report(),
    "a.3": report(),
    "b.1": report({ seo: 0.5 }),
    "b.2": report({ seo: 0.5 }),
    "b.3": report(),
  });
  assert.equal(result.code, 1);
  assert.match(result.out, /ok\s+a \(median of 3 runs\)/);
  assert.match(result.out, /FAIL b \(median of 3 runs\)/);
  assert.match(result.out, /2 page\(s\), 1 over budget/);
});

test("lighthouse: a run that errored is ignored when another run of the page finished", () => {
  const result = run({
    "home.1": { runtimeError: { code: "NO_NAVSTART" } },
    "home.2": report(),
    "home.3": report(),
  });
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /ok\s+home \(median of 2 runs\)/);
});

test("lighthouse: a page where every run errored fails", () => {
  const result = run({
    "home.1": { runtimeError: { code: "NO_NAVSTART" } },
    "home.2": { runtimeError: { code: "NO_NAVSTART" } },
  });
  assert.equal(result.code, 1);
  assert.match(result.out, /did not finish \(NO_NAVSTART\)/);
});

test("lighthouse: no reports exits 2, not 0", () => {
  const result = run({});
  assert.equal(result.code, 2);
  assert.match(result.err, /no Lighthouse reports/);
});
