import assert from "node:assert/strict";
import test from "node:test";

import {
  latestSoilRecord,
  soilTestAgeBand,
  soilTestAgeYears,
} from "../app/soil-test-age.ts";

const asAt = new Date("2026-07-29T12:00:00Z");

test("finds the latest recorded test independently of metric availability", () => {
  const latest = latestSoilRecord([
    { dateSort: "2023-02-21", pValue: 14 },
    { dateSort: "2026-01-10", ph: 6.2 },
    { dateSort: "2025-04-03", kValue: 120 },
  ]);

  assert.equal(latest?.dateSort, "2026-01-10");
});

test("classifies test age against the three-to-five-year sampling cycle", () => {
  assert.equal(soilTestAgeBand({ dateSort: "2026-01-10" }, asAt), "recent");
  assert.equal(soilTestAgeBand({ dateSort: "2024-01-10" }, asAt), "current");
  assert.equal(soilTestAgeBand({ dateSort: "2022-01-10" }, asAt), "dueSoon");
  assert.equal(soilTestAgeBand({ dateSort: "2020-01-10" }, asAt), "overdue");
  assert.equal(soilTestAgeBand(null, asAt), "noData");
});

test("never reports a negative age for a future-dated record", () => {
  assert.equal(soilTestAgeYears("2027-01-01", asAt), 0);
});
