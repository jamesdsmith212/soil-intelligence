import { applicationNutrients } from "./nutrient-applications.ts";
import { applicationPlanCost } from "./product-costs.ts";
import {
  type NutrientAmounts,
  type NutrientProduct,
  type ProductApplication,
  type Scenario,
} from "./nutrient-types.ts";

export type OptimiserConstraints = {
  required: NutrientAmounts;
  products: NutrientProduct[];
  scenario: Scenario;
  maximumProducts?: 1 | 2;
  maximumPasses?: number;
  excludedProductIds?: string[];
  oversupplyToleranceFraction?: number;
  rateStepKgHa?: number;
  excludeSubstantialNeutralisingValue?: boolean;
};

export type ProductCandidate = {
  applications: ProductApplication[];
  declared: NutrientAmounts;
  effective: NutrientAmounts;
  shortfall: NutrientAmounts;
  oversupply: NutrientAmounts;
  totalCost: number | null;
  knownCost: number;
  passes: number;
  feasible: boolean;
  rejectionReasons: string[];
  nameKey: string;
};

const candidateRates = (
  product: NutrientProduct,
  requirement: NutrientAmounts,
  scenario: Scenario,
  step: number,
) => {
  const effectiveness = applicationNutrients(
    [{ product, rateKgHa: 1 }],
    scenario,
  ).effectiveBuild;
  const requiredRates = [
    effectiveness.p2o5KgHa > 0
      ? requirement.p2o5KgHa / effectiveness.p2o5KgHa
      : 0,
    effectiveness.k2oKgHa > 0
      ? requirement.k2oKgHa / effectiveness.k2oKgHa
      : 0,
  ];
  const minimum = product.minRateKgHa ?? 0;
  const inferredMaximum = Math.max(minimum, ...requiredRates, step) * 1.5;
  const maximum = product.maxRateKgHa ?? inferredMaximum;
  const values = new Set<number>([minimum, maximum]);
  for (const exact of requiredRates) {
    if (exact >= minimum && exact <= maximum) values.add(exact);
  }
  for (let rate = minimum; rate <= maximum + 1e-9; rate += step) {
    values.add(Math.min(maximum, rate));
  }
  return [...values].sort((a, b) => a - b);
};

const evaluateCandidate = (
  applications: ProductApplication[],
  constraints: OptimiserConstraints,
): ProductCandidate => {
  applications = applications.filter(({ rateKgHa }) => rateKgHa > 1e-9);
  const nutrients = applicationNutrients(applications, constraints.scenario);
  const costs = applicationPlanCost(applications);
  const effective = nutrients.effectiveBuild;
  const shortfall = {
    p2o5KgHa: Math.max(0, constraints.required.p2o5KgHa - effective.p2o5KgHa),
    k2oKgHa: Math.max(0, constraints.required.k2oKgHa - effective.k2oKgHa),
  };
  const oversupply = {
    p2o5KgHa: Math.max(0, effective.p2o5KgHa - constraints.required.p2o5KgHa),
    k2oKgHa: Math.max(0, effective.k2oKgHa - constraints.required.k2oKgHa),
  };
  const tolerance = constraints.oversupplyToleranceFraction ?? Infinity;
  const excessiveOversupply =
    (constraints.required.p2o5KgHa > 0 &&
      oversupply.p2o5KgHa >
        constraints.required.p2o5KgHa * tolerance + 1e-9) ||
    (constraints.required.k2oKgHa > 0 &&
      oversupply.k2oKgHa >
        constraints.required.k2oKgHa * tolerance + 1e-9);
  const rejectionReasons = [
    ...(shortfall.p2o5KgHa > 1e-7 || shortfall.k2oKgHa > 1e-7
      ? ["nutrient shortfall"]
      : []),
    ...(!nutrients.complete ? ["missing product effectiveness"] : []),
    ...(!costs.complete ? ["incomplete product cost"] : []),
    ...(applications.length > (constraints.maximumPasses ?? 2)
      ? ["maximum passes exceeded"]
      : []),
    ...(excessiveOversupply ? ["oversupply tolerance exceeded"] : []),
  ];
  return {
    applications,
    declared: nutrients.declared,
    effective,
    shortfall,
    oversupply,
    totalCost: costs.total,
    knownCost: costs.knownSubtotal,
    passes: applications.length,
    feasible: rejectionReasons.length === 0,
    rejectionReasons,
    nameKey: applications.map(({ product }) => product.name).sort().join(" + "),
  };
};

export const optimiseProducts = (constraints: OptimiserConstraints) => {
  const step = constraints.rateStepKgHa ?? 25;
  if (!(step > 0)) throw new RangeError("Rate step must be positive");
  const excluded = new Set(constraints.excludedProductIds ?? []);
  const products = constraints.products
    .filter((product) => !excluded.has(product.id))
    .filter(
      (product) =>
        !constraints.excludeSubstantialNeutralisingValue ||
        !product.substantialNeutralisingValue,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const rates = new Map(
    products.map((product) => [
      product.id,
      candidateRates(product, constraints.required, constraints.scenario, step),
    ]),
  );
  const candidates: ProductCandidate[] = [];

  for (const product of products) {
    for (const rateKgHa of rates.get(product.id)!) {
      candidates.push(
        evaluateCandidate([{ product, rateKgHa }], constraints),
      );
    }
  }
  if ((constraints.maximumProducts ?? 2) >= 2) {
    for (let first = 0; first < products.length; first += 1) {
      for (let second = first + 1; second < products.length; second += 1) {
        for (const firstRate of rates.get(products[first].id)!) {
          for (const secondRate of rates.get(products[second].id)!) {
            candidates.push(
              evaluateCandidate(
                [
                  { product: products[first], rateKgHa: firstRate },
                  { product: products[second], rateKgHa: secondRate },
                ],
                constraints,
              ),
            );
          }
        }
      }
    }
  }
  candidates.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    const costA = a.totalCost ?? Infinity;
    const costB = b.totalCost ?? Infinity;
    if (costA !== costB) return costA - costB;
    if (a.passes !== b.passes) return a.passes - b.passes;
    const oversupplyA = a.oversupply.p2o5KgHa + a.oversupply.k2oKgHa;
    const oversupplyB = b.oversupply.p2o5KgHa + b.oversupply.k2oKgHa;
    if (oversupplyA !== oversupplyB) return oversupplyA - oversupplyB;
    return a.nameKey.localeCompare(b.nameKey);
  });
  return {
    best: candidates.find(({ feasible }) => feasible) ?? null,
    candidates,
  };
};
