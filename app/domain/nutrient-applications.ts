import {
  type NutrientAmounts,
  type ProductApplication,
  type Scenario,
  scenarioValue,
  zeroNutrients,
} from "./nutrient-types.ts";

export type ApplicationNutrients = {
  declared: NutrientAmounts;
  effectiveFirstYear: NutrientAmounts;
  effectiveBuild: NutrientAmounts;
  assumptions: string[];
  complete: boolean;
};

export const applicationNutrients = (
  applications: ProductApplication[],
  scenario: Scenario,
): ApplicationNutrients =>
  applications.reduce<ApplicationNutrients>(
    (total, { product, rateKgHa }) => {
      if (!Number.isFinite(rateKgHa) || rateKgHa < 0) {
        throw new RangeError("Application rate must be a finite non-negative number");
      }
      const declaredP = rateKgHa * product.p2o5Fraction;
      const declaredK = rateKgHa * product.k2oFraction;
      const firstP = product.effectiveness.firstYearPAvailability;
      const buildP = product.effectiveness.longTermPBuildRae;
      const availableK = product.effectiveness.kAvailability;
      const complete =
        (declaredP === 0 || (firstP != null && buildP != null)) &&
        (declaredK === 0 || availableK != null);

      total.declared.p2o5KgHa += declaredP;
      total.declared.k2oKgHa += declaredK;
      total.effectiveFirstYear.p2o5KgHa +=
        declaredP * (firstP ? scenarioValue(firstP, scenario) : 0);
      total.effectiveFirstYear.k2oKgHa +=
        declaredK * (availableK ? scenarioValue(availableK, scenario) : 0);
      total.effectiveBuild.p2o5KgHa +=
        declaredP * (buildP ? scenarioValue(buildP, scenario) : 0);
      total.effectiveBuild.k2oKgHa +=
        declaredK * (availableK ? scenarioValue(availableK, scenario) : 0);
      total.complete &&= complete;
      if (!complete) {
        total.assumptions.push(`${product.name}: missing nutrient-effectiveness assumption`);
      }
      return total;
    },
    {
      declared: zeroNutrients(),
      effectiveFirstYear: zeroNutrients(),
      effectiveBuild: zeroNutrients(),
      assumptions: [],
      complete: true,
    },
  );
