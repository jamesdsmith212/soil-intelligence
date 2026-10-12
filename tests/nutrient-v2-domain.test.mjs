import assert from "node:assert/strict";
import test from "node:test";

import {
  CROP_RESPONSE_CONFIGS,
  applicationNutrients,
  cropRemoval,
  evaluateNutrientPlan,
  initialCorrectionRequirement,
  magnesiumIndex,
  optimiseProducts,
  phosphorusIndex,
  potassiumIndex,
  productApplicationCost,
  relativeYield,
  soilTrajectory,
  stageCorrection,
  terminalSoilCapitalValue,
} from "../app/domain/index.ts";

const range = (low, central = low, high = central) => ({ low, central, high });

const completeCost = (materialPricePerTonne) => ({
  materialPricePerTonne,
  haulagePerTonne: 0,
  handlingPerTonne: 0,
  spreadingPerTonne: 0,
  spreadingPerHa: 0,
  fixedPassCostPerHa: 0,
});

const product = ({
  id,
  name = id,
  p = 0,
  k = 0,
  price = 100,
  pFirst = p > 0 ? range(1) : null,
  pBuild = p > 0 ? range(1) : null,
  kAvailability = k > 0 ? range(1) : null,
  cost = completeCost(price),
  minRateKgHa,
  maxRateKgHa,
}) => ({
  id,
  name,
  p2o5Fraction: p,
  k2oFraction: k,
  effectiveness: {
    firstYearPAvailability: pFirst,
    longTermPBuildRae: pBuild,
    kAvailability,
    evidenceClass: "farm_assumption",
  },
  cost,
  minRateKgHa,
  maxRateKgHa,
});

const emptyCrop = (year, crop = "winter_wheat") => ({
  year,
  crop,
  expectedYieldTPerHa: 10,
  cropPricePerTonne: 200,
  removals: [],
});

test("uses canonical P, K and Mg index boundaries, including K subdivisions", () => {
  assert.equal(phosphorusIndex(9), "0");
  assert.equal(phosphorusIndex(10), "1");
  assert.equal(phosphorusIndex(15), "1");
  assert.equal(phosphorusIndex(16), "2");
  assert.equal(potassiumIndex(60), "0");
  assert.equal(potassiumIndex(61), "1");
  assert.equal(potassiumIndex(120), "1");
  assert.equal(potassiumIndex(121), "2-");
  assert.equal(potassiumIndex(180), "2-");
  assert.equal(potassiumIndex(181), "2+");
  assert.equal(potassiumIndex(240), "2+");
  assert.equal(potassiumIndex(241), "3");
  assert.equal(potassiumIndex(300), "3");
  assert.equal(magnesiumIndex(25), "0");
  assert.equal(magnesiumIndex(26), "1");
});

test("keeps declared, first-year effective and long-term build nutrients separate", () => {
  const recycledP = product({
    id: "recycled-p",
    p: 0.2,
    pFirst: range(0.2, 0.4, 0.6),
    pBuild: range(0.5, 0.7, 0.9),
  });
  const result = applicationNutrients(
    [{ product: recycledP, rateKgHa: 500 }],
    "central",
  );
  assert.equal(result.declared.p2o5KgHa, 100);
  assert.equal(result.effectiveFirstYear.p2o5KgHa, 40);
  assert.equal(result.effectiveBuild.p2o5KgHa, 70);
  assert.equal(result.complete, true);
});

test("calculates hand-worked sequential application and removal trajectories", () => {
  const pk = product({
    id: "pk",
    p: 0.2,
    k: 0.1,
    pBuild: range(0.5),
  });
  const year = {
    ...emptyCrop(2027),
    treatedApplications: [{ product: pk, rateKgHa: 500 }],
    removals: [
      {
        material: "grain",
        yieldTPerHa: 1,
        p2o5KgPerTonne: 25,
        k2oKgPerTonne: 20,
      },
    ],
  };
  const central = soilTrajectory({
    anchor: { pMgL: 10, kMgL: 100 },
    years: [year, { ...emptyCrop(2028), removals: year.removals }],
    scenario: "central",
    path: "treated",
  });
  assert.deepEqual(central[0].declaredApplications, {
    p2o5KgHa: 100,
    k2oKgHa: 50,
  });
  assert.deepEqual(central[0].effectiveApplications, {
    p2o5KgHa: 50,
    k2oKgHa: 50,
  });
  assert.equal(central[0].end.pMgL, 10.5);
  assert.equal(central[0].end.kMgL, 103);
  assert.equal(central[1].start.pMgL, central[0].end.pMgL);
  assert.equal(central[1].end.pMgL, 10);
  assert.equal(central[1].end.kMgL, 101);

  const low = soilTrajectory({
    anchor: { pMgL: 10, kMgL: 100 },
    years: [year],
    scenario: "low",
    path: "treated",
  });
  const high = soilTrajectory({
    anchor: { pMgL: 10, kMgL: 100 },
    years: [year],
    scenario: "high",
    path: "treated",
  });
  assert.ok(low[0].end.pMgL < central[0].end.pMgL);
  assert.ok(high[0].end.pMgL > central[0].end.pMgL);
});

test("separates maintenance completeness from correction and stages correction", () => {
  const cutGrass = {
    ...emptyCrop(2027, "grass"),
    grassManagement: "silage",
    removals: [
      {
        material: "silage",
        yieldTPerHa: null,
        p2o5KgPerTonne: 1.9,
        k2oKgPerTonne: 7.5,
      },
    ],
  };
  assert.equal(cropRemoval(cutGrass).complete, false);

  const central = initialCorrectionRequirement({
    anchor: { pMgL: 10, kMgL: 120 },
    scenario: "central",
  });
  assert.deepEqual(central, { p2o5KgHa: 500, k2oKgHa: 300 });
  const low = initialCorrectionRequirement({
    anchor: { pMgL: 10, kMgL: 120 },
    scenario: "low",
  });
  assert.deepEqual(low, { p2o5KgHa: 700, k2oKgHa: 450 });
  assert.deepEqual(stageCorrection(central, [0.5, 0.25, 0.25]), [
    { p2o5KgHa: 250, k2oKgHa: 150 },
    { p2o5KgHa: 125, k2oKgHa: 75 },
    { p2o5KgHa: 125, k2oKgHa: 75 },
  ]);
});

test("uses crop-specific continuous responses and explicit evidence limitations", () => {
  const deficient = { pMgL: 8, kMgL: 90 };
  const adequate = { pMgL: 20, kMgL: 150 };
  assert.ok(
    relativeYield({
      crop: "winter_wheat",
      status: deficient,
      scenario: "central",
    }) <
      relativeYield({
        crop: "winter_wheat",
        status: adequate,
        scenario: "central",
      }),
  );
  assert.equal(
    relativeYield({
      crop: "faba_beans",
      status: deficient,
      scenario: "low",
    }),
    1,
  );
  assert.equal(CROP_RESPONSE_CONFIGS.winter_barley.modelType, "proxy");
  assert.equal(CROP_RESPONSE_CONFIGS.winter_barley.evidenceStrength, "low");
  assert.match(
    CROP_RESPONSE_CONFIGS.faba_beans.transferabilityNote,
    /no robust UK Olsen-P calibration/,
  );
  assert.equal(
    relativeYield({ crop: "grass", status: deficient, scenario: "central" }),
    1,
  );
  assert.ok(
    relativeYield({
      crop: "grass",
      status: deficient,
      scenario: "central",
      enableGrassResponse: true,
    }) < 1,
  );
});

test("supports multiplicative and limiting-nutrient P/K interactions and yield caps", () => {
  const input = {
    crop: "winter_wheat",
    status: { pMgL: 5, kMgL: 50 },
    scenario: "central",
  };
  const multiplicative = relativeYield({
    ...input,
    interaction: "multiplicative",
  });
  const limiting = relativeYield({
    ...input,
    interaction: "limiting_nutrient",
  });
  assert.ok(multiplicative <= limiting);
  assert.ok(multiplicative >= 0 && multiplicative <= 1);
  assert.equal(relativeYield({ ...input, rootingModifier: 2 }), 1);
});

test("returns a complete delivered-and-applied product cost or an explicit gap", () => {
  const priced = product({
    id: "priced",
    cost: {
      materialPricePerTonne: 100,
      haulagePerTonne: 10,
      handlingPerTonne: 5,
      spreadingPerTonne: 8,
      spreadingPerHa: 12,
      fixedPassCostPerHa: 7,
    },
  });
  const breakdown = productApplicationCost({
    product: priced,
    rateKgHa: 1000,
  });
  assert.equal(breakdown.total, 142);

  const unquoted = product({
    id: "unquoted",
    cost: { ...completeCost(100), spreadingPerHa: null },
  });
  const missing = productApplicationCost({
    product: unquoted,
    rateKgHa: 1000,
  });
  assert.equal(missing.total, null);
  assert.deepEqual(missing.missing, ["spreadingByArea"]);
});

test("deterministically selects cheapest single and two-product solutions", () => {
  const pOnly = product({ id: "p", name: "Alpha P", p: 0.2, price: 100 });
  const kOnly = product({ id: "k", name: "Beta K", k: 0.4, price: 200 });
  const compound = product({
    id: "pk",
    name: "Compound",
    p: 0.1,
    k: 0.2,
    price: 400,
  });
  const result = optimiseProducts({
    required: { p2o5KgHa: 20, k2oKgHa: 40 },
    products: [compound, kOnly, pOnly],
    scenario: "central",
    maximumProducts: 2,
    rateStepKgHa: 25,
  });
  assert.ok(result.best);
  assert.equal(result.best.nameKey, "Alpha P + Beta K");
  assert.equal(result.best.totalCost, 30);
  assert.equal(result.best.passes, 2);
  assert.deepEqual(result.best.effective, {
    p2o5KgHa: 20,
    k2oKgHa: 40,
  });

  const single = optimiseProducts({
    required: { p2o5KgHa: 20, k2oKgHa: 0 },
    products: [compound, pOnly],
    scenario: "central",
    maximumProducts: 1,
  });
  assert.equal(single.best.nameKey, "Alpha P");
});

test("rejects rate-capped, excluded, unquoted and effectiveness-incomplete products", () => {
  const capped = product({
    id: "capped",
    p: 0.2,
    maxRateKgHa: 50,
  });
  const missingEffectiveness = product({
    id: "effect",
    p: 0.2,
    pBuild: null,
  });
  const missingQuote = product({
    id: "quote",
    p: 0.2,
    cost: { ...completeCost(100), spreadingPerTonne: null },
  });
  const result = optimiseProducts({
    required: { p2o5KgHa: 20, k2oKgHa: 0 },
    products: [capped, missingEffectiveness, missingQuote],
    excludedProductIds: ["capped"],
    scenario: "central",
  });
  assert.equal(result.best, null);
  assert.ok(
    result.candidates.some((candidate) =>
      candidate.rejectionReasons.includes("missing product effectiveness"),
    ),
  );
  assert.ok(
    result.candidates.some((candidate) =>
      candidate.rejectionReasons.includes("incomplete product cost"),
    ),
  );
});

test("caps terminal soil-capital value at target and avoids co-product double counting", () => {
  const pReplacement = product({
    id: "replacement-p",
    p: 1,
    price: 100,
  });
  const terminal = terminalSoilCapitalValue({
    untreated: { pMgL: 10, kMgL: 150 },
    treated: { pMgL: 20, kMgL: 150 },
    products: [pReplacement],
    scenario: "central",
  });
  assert.equal(terminal.untreatedRequirement.p2o5KgHa, 500);
  assert.equal(terminal.treatedRequirement.p2o5KgHa, 0);
  assert.equal(terminal.value, 50);

  const noSurplusValue = terminalSoilCapitalValue({
    untreated: { pMgL: 20, kMgL: 150 },
    treated: { pMgL: 40, kMgL: 300 },
    products: [pReplacement],
    scenario: "central",
  });
  assert.equal(noSurplusValue.value, 0);
});

test("calculates sequential annual cash flows, costs, discounting and terminal value", () => {
  const pCorrection = product({
    id: "p-correction",
    p: 1,
    price: 100,
  });
  const result = evaluateNutrientPlan({
    anchor: { pMgL: 10, kMgL: 150 },
    years: [
      {
        ...emptyCrop(2027),
        treatedApplications: [
          {
            product: pCorrection,
            rateKgHa: 500,
            purpose: "correction",
          },
        ],
      },
      emptyCrop(2028),
    ],
    productsForTerminalValue: [pCorrection],
    discountRate: 0.1,
    scenarioMultipliers: {
      price: { low: 1, central: 1, high: 1 },
      cost: { low: 1, central: 1, high: 1 },
    },
  }).central;
  assert.equal(result.annual[0].treatedStatus.pMgL, 20);
  assert.equal(result.annual[1].treatedStatus.pMgL, 20);
  assert.ok(Math.abs(result.annual[0].incrementalCropValue - 180) < 1e-9);
  assert.equal(result.annual[0].applicationCost, 50);
  assert.equal(result.annual[0].applicationCostBreakdown.material, 50);
  assert.equal(result.discountedCostBreakdown.material, 50 / 1.1);
  assert.ok(Math.abs(result.annual[0].netCashFlow - 130) < 1e-9);
  assert.ok(Math.abs(result.annual[1].incrementalCropValue - 180) < 1e-9);
  assert.equal(result.terminalSoilCapitalValue, 50);
  const expected = 130 / 1.1 + 180 / 1.1 ** 2 + 50 / 1.1 ** 2;
  assert.ok(Math.abs(result.npv - expected) < 1e-9);
  assert.equal(result.complete, true);
});

test("allows a zero-response low NPV case and surfaces missing prices", () => {
  const pCorrection = product({
    id: "p-correction",
    p: 1,
    price: 100,
  });
  const result = evaluateNutrientPlan({
    anchor: { pMgL: 10, kMgL: 150 },
    years: [
      {
        ...emptyCrop(2027, "faba_beans"),
        cropPricePerTonne: null,
        treatedApplications: [
          { product: pCorrection, rateKgHa: 500, purpose: "correction" },
        ],
      },
    ],
    productsForTerminalValue: [pCorrection],
    forceNoCropResponseInLow: true,
  });
  assert.equal(result.low.annual[0].treatedRelativeYield, result.low.annual[0].untreatedRelativeYield);
  assert.equal(result.low.npv, null);
  assert.equal(result.low.complete, false);
  assert.match(result.low.warnings.join(" "), /crop price is missing/);
});

test("values removed straw separately and marks a missing straw price incomplete", () => {
  const pCorrection = product({ id: "straw-p", p: 1, price: 100 });
  const baseYear = {
    ...emptyCrop(2027),
    removals: [
      {
        material: "straw",
        yieldTPerHa: 4,
        p2o5KgPerTonne: 0,
        k2oKgPerTonne: 0,
      },
    ],
    treatedApplications: [
      { product: pCorrection, rateKgHa: 500, purpose: "correction" },
    ],
  };
  const incomplete = evaluateNutrientPlan({
    anchor: { pMgL: 10, kMgL: 150 },
    years: [baseYear],
    productsForTerminalValue: [pCorrection],
  }).central;
  assert.equal(incomplete.npv, null);
  assert.match(incomplete.warnings.join(" "), /straw price is missing/);

  const complete = evaluateNutrientPlan({
    anchor: { pMgL: 10, kMgL: 150 },
    years: [{ ...baseYear, strawPricePerTonne: 25 }],
    productsForTerminalValue: [pCorrection],
  }).central;
  assert.ok(complete.annual[0].incrementalStrawValue > 0);
  assert.equal(complete.complete, true);
});

test("uses first-year P availability for crop response and long-term RAE for soil build", () => {
  const soluble = product({
    id: "soluble",
    p: 1,
    pFirst: range(1),
    pBuild: range(1),
  });
  const slowFirstYear = product({
    id: "slow-first-year",
    p: 1,
    pFirst: range(0.2),
    pBuild: range(1),
  });
  const evaluate = (inputProduct) =>
    evaluateNutrientPlan({
      anchor: { pMgL: 10, kMgL: 150 },
      years: [
        {
          ...emptyCrop(2027),
          treatedApplications: [
            {
              product: inputProduct,
              rateKgHa: 500,
              purpose: "correction",
            },
          ],
        },
      ],
      productsForTerminalValue: [soluble],
    }).central;
  const solubleResult = evaluate(soluble);
  const slowResult = evaluate(slowFirstYear);
  assert.equal(
    slowResult.annual[0].treatedStatus.pMgL,
    solubleResult.annual[0].treatedStatus.pMgL,
  );
  assert.ok(
    slowResult.annual[0].treatedRelativeYield <
      solubleResult.annual[0].treatedRelativeYield,
  );
});

test("keeps NPV incomplete when an applied product lacks effectiveness", () => {
  const unknown = product({
    id: "unknown-effectiveness",
    p: 0.2,
    pFirst: null,
    pBuild: null,
  });
  const result = evaluateNutrientPlan({
    anchor: { pMgL: 10, kMgL: 150 },
    years: [
      {
        ...emptyCrop(2027),
        treatedApplications: [
          { product: unknown, rateKgHa: 500, purpose: "correction" },
        ],
      },
    ],
    productsForTerminalValue: [unknown],
  }).central;
  assert.equal(result.complete, false);
  assert.equal(result.npv, null);
  assert.match(result.warnings.join(" "), /missing nutrient-effectiveness/i);
});
