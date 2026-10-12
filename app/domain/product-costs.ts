import { type ProductApplication } from "./nutrient-types.ts";

export type CostBreakdown = {
  material: number;
  haulage: number;
  handling: number;
  spreading: number;
  fixedPass: number;
  knownSubtotal: number;
  total: number | null;
  missing: string[];
};

export const productApplicationCost = ({
  product,
  rateKgHa,
}: ProductApplication): CostBreakdown => {
  if (!Number.isFinite(rateKgHa) || rateKgHa < 0) {
    throw new RangeError("Application rate must be a finite non-negative number");
  }
  if (rateKgHa === 0) {
    return {
      material: 0,
      haulage: 0,
      handling: 0,
      spreading: 0,
      fixedPass: 0,
      knownSubtotal: 0,
      total: 0,
      missing: [],
    };
  }
  const tonnesPerHa = rateKgHa / 1000;
  const components = {
    material:
      product.cost.materialPricePerTonne == null
        ? null
        : tonnesPerHa * product.cost.materialPricePerTonne,
    haulage:
      product.cost.haulagePerTonne == null
        ? null
        : tonnesPerHa * product.cost.haulagePerTonne,
    handling:
      product.cost.handlingPerTonne == null
        ? null
        : tonnesPerHa * product.cost.handlingPerTonne,
    spreadingByTonne:
      product.cost.spreadingPerTonne == null
        ? null
        : tonnesPerHa * product.cost.spreadingPerTonne,
    spreadingByArea: product.cost.spreadingPerHa,
    fixedPass: product.cost.fixedPassCostPerHa,
  };
  const missing = Object.entries(components)
    .filter(([, value]) => value == null)
    .map(([name]) => name);
  const known = (value: number | null) => value ?? 0;
  const result = {
    material: known(components.material),
    haulage: known(components.haulage),
    handling: known(components.handling),
    spreading:
      known(components.spreadingByTonne) + known(components.spreadingByArea),
    fixedPass: known(components.fixedPass),
  };
  const knownSubtotal = Object.values(result).reduce((sum, value) => sum + value, 0);
  return {
    ...result,
    knownSubtotal,
    total: missing.length === 0 ? knownSubtotal : null,
    missing,
  };
};

export const applicationPlanCost = (applications: ProductApplication[]) => {
  const lines = applications.map((application) => ({
    application,
    breakdown: productApplicationCost(application),
  }));
  const complete = lines.every(({ breakdown }) => breakdown.total != null);
  const knownSubtotal = lines.reduce(
    (sum, { breakdown }) => sum + breakdown.knownSubtotal,
    0,
  );
  return {
    lines,
    complete,
    knownSubtotal,
    total: complete ? knownSubtotal : null,
  };
};
