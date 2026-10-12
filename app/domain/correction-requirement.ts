import {
  type CropYear,
  type NutrientAmounts,
  type Scenario,
  type SoilBuildCoefficient,
  type SoilConcentrations,
  type TargetStrategy,
  zeroNutrients,
} from "./nutrient-types.ts";

export const DEFAULT_BUILD_COEFFICIENTS: Record<"p" | "k", SoilBuildCoefficient> = {
  p: {
    nutrient: "p",
    optimisticKgPerHaPerMgL: 35,
    centralKgPerHaPerMgL: 50,
    conservativeKgPerHaPerMgL: 70,
    source: "Initial configurable illustrative planning scenario",
    interpretation: "Indicative P2O5 stock per 1 mg/l Olsen P movement",
    calibratedForField: false,
  },
  k: {
    nutrient: "k",
    optimisticKgPerHaPerMgL: 7,
    centralKgPerHaPerMgL: 10,
    conservativeKgPerHaPerMgL: 15,
    source: "Initial configurable illustrative planning scenario",
    interpretation: "Indicative K2O stock per 1 mg/l soil K movement",
    calibratedForField: false,
  },
};

export const DEFAULT_TARGETS: Record<"p" | "k", TargetStrategy> = {
  p: { nutrient: "p", name: "mid_index_2", concentrationMgL: 20 },
  k: { nutrient: "k", name: "mid_index_2", concentrationMgL: 150 },
};

export const buildCoefficientForScenario = (
  coefficient: SoilBuildCoefficient,
  scenario: Scenario,
) =>
  scenario === "low"
    ? coefficient.conservativeKgPerHaPerMgL
    : scenario === "high"
      ? coefficient.optimisticKgPerHaPerMgL
      : coefficient.centralKgPerHaPerMgL;

export const cropRemoval = (crop: CropYear) => {
  const nutrients = crop.removals.reduce<NutrientAmounts>(
    (sum, removal) => {
      if (removal.yieldTPerHa == null) return sum;
      sum.p2o5KgHa += removal.yieldTPerHa * removal.p2o5KgPerTonne;
      sum.k2oKgHa += removal.yieldTPerHa * removal.k2oKgPerTonne;
      return sum;
    },
    zeroNutrients(),
  );
  const grassNeedsCutYield =
    crop.crop === "grass" &&
    crop.grassManagement !== "grazed_only" &&
    crop.grassManagement !== undefined &&
    crop.grassManagement !== "unknown";
  const incomplete =
    crop.removals.some((line) => line.yieldTPerHa == null) ||
    (crop.crop === "grass" &&
      (crop.grassManagement == null || crop.grassManagement === "unknown")) ||
    (grassNeedsCutYield && crop.removals.length === 0);
  return {
    nutrients,
    complete: !incomplete,
    warning: incomplete
      ? "Maintenance is incomplete: grass management or removed yield is missing"
      : null,
  };
};

export const initialCorrectionRequirement = ({
  anchor,
  targets = DEFAULT_TARGETS,
  coefficients = DEFAULT_BUILD_COEFFICIENTS,
  scenario,
}: {
  anchor: SoilConcentrations;
  targets?: Record<"p" | "k", TargetStrategy>;
  coefficients?: Record<"p" | "k", SoilBuildCoefficient>;
  scenario: Scenario;
}): NutrientAmounts => ({
  p2o5KgHa:
    Math.max(0, targets.p.concentrationMgL - anchor.pMgL) *
    buildCoefficientForScenario(coefficients.p, scenario),
  k2oKgHa:
    Math.max(0, targets.k.concentrationMgL - anchor.kMgL) *
    buildCoefficientForScenario(coefficients.k, scenario),
});

export const stageCorrection = (
  requirement: NutrientAmounts,
  allocationFractions: number[],
) => {
  if (
    allocationFractions.length === 0 ||
    allocationFractions.some((fraction) => fraction < 0) ||
    Math.abs(allocationFractions.reduce((a, b) => a + b, 0) - 1) > 1e-9
  ) {
    throw new RangeError("Correction allocations must be non-negative and total 1");
  }
  return allocationFractions.map((fraction) => ({
    p2o5KgHa: requirement.p2o5KgHa * fraction,
    k2oKgHa: requirement.k2oKgHa * fraction,
  }));
};
