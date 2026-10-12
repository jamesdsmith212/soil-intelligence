export type EstimateRange = {
  low: number;
  central: number;
  high: number;
};

export type NutrientResponse = {
  likelihood: "Likely" | "Possible" | "Unlikely";
  yieldGainTPerHa: EstimateRange;
};

export type Metric = "p" | "k";

export type AnnualYieldValueInput = {
  year: number;
  crop: string;
  cropValuePerTonne: number;
  yieldGainTPerHa: EstimateRange;
};

export type AnnualEconomicValue = AnnualYieldValueInput & {
  revenueGbpPerHa: EstimateRange;
  netCashFlowGbpPerHa: EstimateRange;
  presentValueGbpPerHa: EstimateRange;
};

type ResponsePoint = {
  index: number;
  centralTPerHaAt8T: number;
  highTPerHaAt8T: number;
};

const RESPONSE_POINTS: Record<Metric, ResponsePoint[]> = {
  p: [
    { index: 0, centralTPerHaAt8T: 0.9, highTPerHaAt8T: 2.1 },
    { index: 1, centralTPerHaAt8T: 0.36, highTPerHaAt8T: 1.6 },
    { index: 2, centralTPerHaAt8T: 0.02, highTPerHaAt8T: 0.2 },
    { index: 3, centralTPerHaAt8T: 0, highTPerHaAt8T: 0.05 },
  ],
  k: [
    { index: 0, centralTPerHaAt8T: 1.1, highTPerHaAt8T: 3 },
    { index: 1, centralTPerHaAt8T: 0.36, highTPerHaAt8T: 1.5 },
    { index: 1.7, centralTPerHaAt8T: 0.02, highTPerHaAt8T: 0.3 },
    { index: 2.3, centralTPerHaAt8T: 0.01, highTPerHaAt8T: 0.15 },
    { index: 3, centralTPerHaAt8T: 0, highTPerHaAt8T: 0.05 },
  ],
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const creditableNutrientKgHa = (
  proposedKgHa: number,
  planningBenchmarkKgHa: number,
) => clamp(proposedKgHa, 0, Math.max(0, planningBenchmarkKgHa));

const SOIL_STATUS_ANCHORS: Record<Metric, { ppm: number; index: number }[]> = {
  p: [
    { ppm: 4.5, index: 0 },
    { ppm: 12.5, index: 1 },
    { ppm: 20.5, index: 2 },
    { ppm: 35, index: 3 },
    { ppm: 57.5, index: 4 },
  ],
  k: [
    { ppm: 30, index: 0 },
    { ppm: 90, index: 1 },
    { ppm: 150, index: 1.7 },
    { ppm: 210, index: 2.3 },
    { ppm: 320, index: 3 },
    { ppm: 500, index: 4 },
  ],
};

export const responseIndexFromPpm = (metric: Metric, ppm: number) => {
  const anchors = SOIL_STATUS_ANCHORS[metric];
  if (ppm <= anchors[0].ppm) return anchors[0].index;
  if (ppm >= anchors.at(-1)!.ppm) return anchors.at(-1)!.index;
  const upperIndex = anchors.findIndex((anchor) => anchor.ppm >= ppm);
  const lower = anchors[upperIndex - 1];
  const upper = anchors[upperIndex];
  const progress = (ppm - lower.ppm) / (upper.ppm - lower.ppm);
  return lower.index + (upper.index - lower.index) * progress;
};

const responsePointAt = (metric: Metric, index: number) => {
  const points = RESPONSE_POINTS[metric];
  if (index <= points[0].index) return points[0];
  if (index >= points.at(-1)!.index) return points.at(-1)!;
  const upperIndex = points.findIndex((point) => point.index >= index);
  const lower = points[upperIndex - 1];
  const upper = points[upperIndex];
  const progress = (index - lower.index) / (upper.index - lower.index);
  return {
    index,
    centralTPerHaAt8T:
      lower.centralTPerHaAt8T +
      (upper.centralTPerHaAt8T - lower.centralTPerHaAt8T) * progress,
    highTPerHaAt8T:
      lower.highTPerHaAt8T +
      (upper.highTPerHaAt8T - lower.highTPerHaAt8T) * progress,
  };
};

export const responseLikelihood = (
  metric: Metric,
  index: number,
): NutrientResponse["likelihood"] => {
  const target = metric === "p" ? 2 : 1.7;
  if (index <= 0) return "Likely";
  if (index < target) return "Possible";
  return "Unlikely";
};

export const estimateIndexImprovementResponse = ({
  metric,
  untreatedIndex,
  treatedIndex,
  referenceYieldTPerHa,
}: {
  metric: Metric;
  untreatedIndex: EstimateRange;
  treatedIndex: EstimateRange;
  referenceYieldTPerHa: number;
}): NutrientResponse => {
  if (referenceYieldTPerHa <= 0) {
    return {
      likelihood: responseLikelihood(metric, untreatedIndex.central),
      yieldGainTPerHa: { low: 0, central: 0, high: 0 },
    };
  }
  const yieldScale = clamp(referenceYieldTPerHa / 8, 0.75, 1.25);
  const centralUntreated = responsePointAt(metric, untreatedIndex.central);
  const centralTreated = responsePointAt(metric, treatedIndex.central);
  const lowUntreated = responsePointAt(metric, untreatedIndex.high);
  const lowTreated = responsePointAt(metric, treatedIndex.high);
  const highUntreated = responsePointAt(metric, untreatedIndex.low);
  const highTreated = responsePointAt(metric, treatedIndex.low);
  const central = Math.max(
    0,
    (centralUntreated.centralTPerHaAt8T -
      centralTreated.centralTPerHaAt8T) *
      yieldScale,
  );
  const low = Math.min(
    central,
    Math.max(
      0,
      (lowUntreated.centralTPerHaAt8T - lowTreated.centralTPerHaAt8T) *
        yieldScale,
    ),
  );
  const high = Math.max(
    central,
    Math.max(
      0,
      (highUntreated.highTPerHaAt8T - highTreated.highTPerHaAt8T) *
        yieldScale,
    ),
  );
  return {
    likelihood: responseLikelihood(metric, untreatedIndex.central),
    yieldGainTPerHa: {
      low: Math.min(referenceYieldTPerHa, low),
      central: Math.min(referenceYieldTPerHa, central),
      high: Math.min(referenceYieldTPerHa, high),
    },
  };
};

export const combineNutrientResponses = (
  p: EstimateRange,
  k: EstimateRange,
  referenceYieldTPerHa: number,
): EstimateRange => ({
  low: Math.max(p.low, k.low),
  central: Math.min(
    Math.max(p.central, k.central),
    referenceYieldTPerHa * 0.2,
  ),
  high: Math.min(
    p.high + k.high,
    referenceYieldTPerHa * 0.35,
  ),
});

export const valueYieldResponse = ({
  yieldGainTPerHa,
  cropValuePerTonne,
  priceUncertaintyPct,
  planCostPerHa,
}: {
  yieldGainTPerHa: EstimateRange;
  cropValuePerTonne: number;
  priceUncertaintyPct: number;
  planCostPerHa: number;
}) => {
  const priceRange = clamp(priceUncertaintyPct, 0, 100) / 100;
  const revenueGbpPerHa = {
    low: yieldGainTPerHa.low * cropValuePerTonne * (1 - priceRange),
    central: yieldGainTPerHa.central * cropValuePerTonne,
    high: yieldGainTPerHa.high * cropValuePerTonne * (1 + priceRange),
  };
  return {
    revenueGbpPerHa,
    netGbpPerHa: {
      low: revenueGbpPerHa.low - planCostPerHa,
      central: revenueGbpPerHa.central - planCostPerHa,
      high: revenueGbpPerHa.high - planCostPerHa,
    },
  };
};

export const valueThreeYearNpv = ({
  years,
  priceUncertaintyPct,
  planCostPerHa,
  discountRatePct,
}: {
  years: AnnualYieldValueInput[];
  priceUncertaintyPct: number;
  planCostPerHa: number;
  discountRatePct: number;
}) => {
  const priceRange = clamp(priceUncertaintyPct, 0, 100) / 100;
  const discountRate = clamp(discountRatePct, 0, 100) / 100;
  const annual: AnnualEconomicValue[] = years.map((year, index) => {
    const revenueGbpPerHa = {
      low:
        year.yieldGainTPerHa.low *
        year.cropValuePerTonne *
        (1 - priceRange),
      central: year.yieldGainTPerHa.central * year.cropValuePerTonne,
      high:
        year.yieldGainTPerHa.high *
        year.cropValuePerTonne *
        (1 + priceRange),
    };
    const applicationCost = index === 0 ? planCostPerHa : 0;
    const netCashFlowGbpPerHa = {
      low: revenueGbpPerHa.low - applicationCost,
      central: revenueGbpPerHa.central - applicationCost,
      high: revenueGbpPerHa.high - applicationCost,
    };
    const discountFactor = (1 + discountRate) ** (index + 1);
    return {
      ...year,
      revenueGbpPerHa,
      netCashFlowGbpPerHa,
      presentValueGbpPerHa: {
        low: netCashFlowGbpPerHa.low / discountFactor,
        central: netCashFlowGbpPerHa.central / discountFactor,
        high: netCashFlowGbpPerHa.high / discountFactor,
      },
    };
  });
  const npvGbpPerHa = annual.reduce(
    (total, year) => ({
      low: total.low + year.presentValueGbpPerHa.low,
      central: total.central + year.presentValueGbpPerHa.central,
      high: total.high + year.presentValueGbpPerHa.high,
    }),
    { low: 0, central: 0, high: 0 },
  );
  return { annual, npvGbpPerHa };
};

export const defaultCropValue = (cropGroup: string) => {
  if (cropGroup === "Wheat") return 180;
  if (cropGroup === "Barley") return 170;
  if (cropGroup === "Beans") return 220;
  if (cropGroup === "Composite") return 190;
  return 0;
};
