import assert from "node:assert/strict";
import { test } from "node:test";
import { isoDate, statusLabel } from "../src/lib/format.ts";

test("statusLabel turns collection values into readable text", () => {
  assert.equal(statusLabel("in-progress"), "in progress");
  assert.equal(statusLabel("planned"), "planned");
});

test("isoDate formats in UTC regardless of the build machine's time zone", () => {
  assert.equal(isoDate(new Date("2026-10-01T23:59:59Z")), "2026-10-01");
  assert.equal(isoDate(new Date("2026-10-02T00:00:00Z")), "2026-10-02");
});
