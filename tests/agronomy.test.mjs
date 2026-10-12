import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  agronomyJudgements,
  agronomyJudgementsForMetric,
  groupAgronomyJudgements,
  inferLandUse,
  isWheatProxyApplicable,
  primaryJudgement,
} from "../app/agronomy.ts";

const soilData = JSON.parse(
  await readFile(new URL("../data/soil-data.json", import.meta.url), "utf8"),
);

test("infers permanent grass, mixed rotation and permanent arable separately", () => {
  assert.equal(
    inferLandUse({
      crop: "perennial_grass",
      results: [{ crop: "Grazed Grass (Sheep)" }],
    }),
    "permanent-grass",
  );
  assert.equal(
    inferLandUse({
      results: [{ crop: "Grazed Grass (Cattle)" }, { crop: "Wheat" }],
    }),
    "mixed-rotation",
  );
  assert.equal(
    inferLandUse({
      results: [{ crop: "Barley (Spring)" }, { crop: "Wheat" }],
    }),
    "permanent-arable",
  );
});

test("uses the field system when judging pH", () => {
  const permanentGrass = primaryJudgement({
    metric: "ph",
    value: 6.1,
    rawValue: 6.1,
    indexValue: null,
    landUse: "permanent-grass",
  });
  const permanentArable = primaryJudgement({
    metric: "ph",
    value: 6.1,
    rawValue: 6.1,
    indexValue: null,
    landUse: "permanent-arable",
  });

  assert.equal(permanentGrass.key, "target");
  assert.equal(permanentArable.key, "below");
});

test("groups matching source judgements and separates genuine disagreements", () => {
  const pHGroups = groupAgronomyJudgements(
    agronomyJudgements({
      metric: "ph",
      value: 6.1,
      rawValue: 6.1,
      indexValue: null,
      landUse: "permanent-arable",
    }),
  );
  const rbAndOrc = pHGroups.find((group) =>
    group.sourceIds.includes("rb209"),
  );

  assert.deepEqual(rbAndOrc?.sourceIds, ["rb209", "orc"]);
  assert.ok(
    pHGroups.some(
      (group) =>
        group.sourceIds.length === 1 && group.sourceIds[0] === "sruc",
    ),
  );

  const pGroups = groupAgronomyJudgements(
    agronomyJudgements({
      metric: "p",
      value: 1,
      rawValue: 13,
      indexValue: 1,
      landUse: "mixed-rotation",
    }),
  );
  assert.ok(
    pGroups.some(
      (group) =>
        group.sourceIds.includes("rb209") &&
        group.sourceIds.includes("sruc"),
    ),
  );
});

test("does not apply the wheat proxy to permanent grass", () => {
  assert.equal(isWheatProxyApplicable("permanent-grass"), false);
  assert.equal(isWheatProxyApplicable("mixed-rotation"), true);
  assert.equal(isWheatProxyApplicable("permanent-arable"), true);
});

test("treats organic matter as context and trend rather than a universal target", () => {
  const judgement = primaryJudgement({
    metric: "om",
    value: 2.2,
    rawValue: 2.2,
    indexValue: null,
    landUse: "permanent-arable",
  });
  assert.equal(judgement.key, "context");
  assert.match(judgement.detail, /No universal organic-matter target/);
});

test("provides all four named source views for every canonical soil metric", () => {
  for (const metric of soilData.metrics) {
    const judgements = agronomyJudgementsForMetric({
      metric,
      value: 1,
      indexValue: metric.indexAvailable ? 1 : null,
      text: "Example result",
      unit: metric.units[0],
      landUse: "mixed-rotation",
    });
    assert.deepEqual(
      [...new Set(judgements.flatMap((judgement) => judgement.sourceIds))].sort(),
      ["greatsoils", "orc", "rb209", "sruc"],
      `missing source interpretation for ${metric.id}`,
    );
  }
});

test("keeps total-element results outside routine fertility thresholds", () => {
  const groups = groupAgronomyJudgements(
    agronomyJudgementsForMetric({
      metric: {
        id: "total-cadmium",
        name: "Total Cadmium",
        category: "Total elements",
      },
      value: 0.4,
      indexValue: null,
      unit: "mg/kg",
      landUse: "permanent-arable",
    }),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceIds.length, 4);
  assert.match(groups[0].headline, /No agronomic target/);
  assert.match(groups[0].caveat, /not the same as plant-available/);
});
