import {
  buildCoefficientForScenario,
  DEFAULT_BUILD_COEFFICIENTS,
  DEFAULT_TARGETS,
} from "./correction-requirement.ts";
import { optimiseProducts } from "./product-optimiser.ts";
import {
  type NutrientAmounts,
  type NutrientProduct,
  type Scenario,
  type SoilBuildCoefficient,
  type SoilConcentrations,
  type TargetStrategy,
} from "./nutrient-types.ts";

const remainingRequirement = (
  status: SoilConcentrations,
  targets: Record<"p" | "k", TargetStrategy>,
  coefficients: Record<"p" | "k", SoilBuildCoefficient>,
  scenario: Scenario,
): NutrientAmounts => ({
  p2o5KgHa:
    Math.max(0, targets.p.concentrationMgL - status.pMgL) *
    buildCoefficientForScenario(coefficients.p, scenario),
  k2oKgHa:
    Math.max(0, targets.k.concentrationMgL - status.kMgL) *
    buildCoefficientForScenario(coefficients.k, scenario),
});

const correctionCost = (
  requirement: NutrientAmounts,
  products: NutrientProduct[],
  scenario: Scenario,
) => {
  if (requirement.p2o5KgHa <= 1e-9 && requirement.k2oKgHa <= 1e-9) {
    return { cost: 0, complete: true, candidate: null };
  }
  const result = optimiseProducts({
    required: requirement,
    products,
    scenario,
    maximumProducts: 2,
  });
  return {
    cost: result.best?.totalCost ?? null,
    complete: result.best != null,
    candidate: result.best,
  };
};

export const terminalSoilCapitalValue = ({
  untreated,
  treated,
  products,
  scenario,
  targets = DEFAULT_TARGETS,
  coefficients = DEFAULT_BUILD_COEFFICIENTS,
}: {
  untreated: SoilConcentrations;
  treated: SoilConcentrations;
  products: NutrientProduct[];
  scenario: Scenario;
  targets?: Record<"p" | "k", TargetStrategy>;
  coefficients?: Record<"p" | "k", SoilBuildCoefficient>;
}) => {
  const untreatedRequirement = remainingRequirement(
    untreated,
    targets,
    coefficients,
    scenario,
  );
  const treatedRequirement = remainingRequirement(
    treated,
    targets,
    coefficients,
    scenario,
  );
  const untreatedCost = correctionCost(untreatedRequirement, products, scenario);
  const treatedCost = correctionCost(treatedRequirement, products, scenario);
  const complete = untreatedCost.complete && treatedCost.complete;
  return {
    untreatedRequirement,
    treatedRequirement,
    untreatedCorrectionCost: untreatedCost.cost,
    treatedCorrectionCost: treatedCost.cost,
    value:
      complete && untreatedCost.cost != null && treatedCost.cost != null
        ? Math.max(0, untreatedCost.cost - treatedCost.cost)
        : null,
    complete,
    assumptions: [
      "Value is avoided least delivered-and-applied cost to the selected target.",
      "Nutrient above target has zero terminal value.",
      "Two-product optimisation prevents automatic co-product double counting.",
    ],
  };
};
