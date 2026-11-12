import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// Runs scripts/check_workflows.py on small fixture repos: the real .github folder must pass,
// and each supply-chain rule must fail on a deliberate break.

const repo = join(import.meta.dirname, "..");
const script = join(repo, "scripts", "check_workflows.py");
const python = process.env.PYTHON ?? "python";
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const DEPENDABOT = [
  "version: 2",
  "updates:",
  "  - package-ecosystem: npm",
  "    directory: /",
  "  - package-ecosystem: github-actions",
  "    directory: /",
  "",
].join("\n");

const GOOD = `name: CI
on:
  pull_request:
permissions: {}
jobs:
  verify:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          persist-credentials: false
      - run: npm ci --ignore-scripts
      - run: npx --yes lighthouse@13.5.0 http://localhost:4321/
`;

/** A repo with one workflow and a Dependabot config, then run the check on it. */
function run(workflow, dependabot = DEPENDABOT) {
  const root = mkdtempSync(join(tmpdir(), "wf-"));
  roots.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), workflow);
  if (dependabot !== null) writeFileSync(join(root, ".github", "dependabot.yml"), dependabot);
  const result = spawnSync(python, [script, root], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const fails = (workflow, pattern, dependabot) => {
  const result = run(workflow, dependabot);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, pattern);
};

test("workflows: the real .github folder passes", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-real-"));
  roots.push(root);
  cpSync(join(repo, ".github"), join(root, ".github"), { recursive: true });
  const result = spawnSync(python, [script, root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 failure\(s\)/);
});

test("workflows: the good fixture passes", () => {
  const result = run(GOOD);
  assert.equal(result.code, 0, result.out);
});

test("workflows: an action on a tag or branch fails", () => {
  fails(
    GOOD.replace(`@${SHA} # v7.0.1`, "@v7 # v7"),
    /actions\/checkout@v7 is not pinned to a full commit SHA/,
  );
  fails(GOOD.replace(`@${SHA} # v7.0.1`, "@main"), /not pinned to a full commit SHA/);
});

test("workflows: a short SHA fails", () => {
  fails(GOOD.replace(SHA, SHA.slice(0, 12)), /not pinned to a full commit SHA/);
});

test("workflows: a pinned action with no version comment fails", () => {
  fails(GOOD.replace(" # v7.0.1", ""), /needs a '# vX\.Y\.Z' comment/);
});

test("workflows: a missing top-level permissions block fails", () => {
  fails(GOOD.replace("permissions: {}\n", ""), /no top-level permissions/);
});

test("workflows: write at the top level fails, write on a job is allowed", () => {
  fails(
    GOOD.replace("permissions: {}", "permissions:\n  contents: write"),
    /top-level permissions grants write/,
  );
  fails(
    GOOD.replace("permissions: {}", "permissions: write-all"),
    /top-level permissions grants write/,
  );
  const job = run(
    GOOD.replace("      contents: read", "      contents: read\n      id-token: write"),
  );
  assert.equal(job.code, 0, job.out);
});

test("workflows: pull_request_target fails", () => {
  fails(GOOD.replace("  pull_request:", "  pull_request_target:"), /pull_request_target/);
});

test("workflows: npm install and npm ci without --ignore-scripts fail", () => {
  fails(GOOD.replace("npm ci --ignore-scripts", "npm install"), /never npm install/);
  fails(GOOD.replace("npm ci --ignore-scripts", "npm ci"), /npm ci needs --ignore-scripts/);
});

test("workflows: npx without an exact version fails", () => {
  fails(
    GOOD.replace("lighthouse@13.5.0", "lighthouse"),
    /npx must name a package at an exact version/,
  );
  fails(
    GOOD.replace("lighthouse@13.5.0", "lighthouse@latest"),
    /npx must name a package at an exact version/,
  );
  fails(
    GOOD.replace("lighthouse@13.5.0", "lighthouse@13"),
    /npx must name a package at an exact version/,
  );
});

test("workflows: checkout must not keep credentials", () => {
  fails(GOOD.replace("persist-credentials: false", "fetch-depth: 0"), /persist-credentials: false/);
  fails(
    GOOD.replace("        with:\n          persist-credentials: false\n", ""),
    /persist-credentials: false/,
  );
});

test("workflows: persist-credentials on a later step does not count for checkout", () => {
  const later = GOOD.replace("persist-credentials: false", "fetch-depth: 0").replace(
    "      - run: npm ci",
    "      - uses: actions/setup-node@" +
      SHA +
      " # v7.1.0\n        with:\n          persist-credentials: false\n      - run: npm ci",
  );
  fails(later, /actions\/checkout needs `persist-credentials: false`/);
});

test("workflows: a missing or incomplete Dependabot config fails", () => {
  fails(GOOD, /dependabot\.yml is missing/, null);
  fails(GOOD, /no github-actions ecosystem/, DEPENDABOT.replace("github-actions", "pip"));
  fails(GOOD, /no npm ecosystem/, DEPENDABOT.replace("npm", "pip"));
});

test("workflows: a repo with no workflows exits 2", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-none-"));
  roots.push(root);
  const result = spawnSync(python, [script, root], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no workflows/);
});
