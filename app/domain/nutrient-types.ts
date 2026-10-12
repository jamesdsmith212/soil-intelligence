export type Scenario = "low" | "central" | "high";

export type ScenarioRange = {
  low: number;
  central: number;
  high: number;
};

export type Nutrient = "p" | "k";
export type NutrientAmounts = { p2o5KgHa: number; k2oKgHa: number };
export type SoilConcentrations = { pMgL: number; kMgL: number };

export type SoilBuildCoefficient = {
  nutrient: Nutrient;
  optimisticKgPerHaPerMgL: number;
  centralKgPerHaPerMgL: number;
  conservativeKgPerHaPerMgL: number;
  source: string;
  interpretation: string;
  calibratedForField: boolean;
};

export type TargetStrategy = {
  nutrient: Nutrient;
  name: "lower_index_2" | "mid_index_2" | "custom";
  concentrationMgL: number;
};

export type ProductEffectiveness = {
  firstYearPAvailability?: ScenarioRange | null;
  longTermPBuildRae?: ScenarioRange | null;
  kAvailability?: ScenarioRange | null;
  evidenceClass:
    | "peer_reviewed_field"
    | "independent_field"
    | "official_guidance"
    | "pot_trial"
    | "supplier_claim"
    | "farm_trial"
    | "farm_assumption"
    | "unknown";
  source?: string | null;
  note?: string | null;
};

export type ProductCost = {
  materialPricePerTonne: number | null;
  haulagePerTonne: number | null;
  handlingPerTonne: number | null;
  spreadingPerTonne: number | null;
  spreadingPerHa: number | null;
  fixedPassCostPerHa: number | null;
};

export type NutrientProduct = {
  id: string;
  name: string;
  p2o5Fraction: number;
  k2oFraction: number;
  effectiveness: ProductEffectiveness;
  cost: ProductCost;
  minRateKgHa?: number;
  maxRateKgHa?: number;
  substantialNeutralisingValue?: boolean;
};

export type ProductApplication = {
  product: NutrientProduct;
  rateKgHa: number;
  purpose?: "maintenance" | "correction" | "combined";
};

export type CropKind =
  | "winter_wheat"
  | "spring_barley"
  | "winter_barley"
  | "faba_beans"
  | "grass"
  | "other";

export type CropResponseConfig = {
  crop: CropKind;
  modelType:
    | "continuous_critical_concentration"
    | "index_lookup"
    | "proxy"
    | "none";
  evidenceStrength: "high" | "moderate" | "low" | "none";
  transferabilityNote: string;
  source: string;
  pCriticalMgL: ScenarioRange;
  kCriticalMgL: ScenarioRange;
  maximumPLossFraction: ScenarioRange;
  maximumKLossFraction: ScenarioRange;
};

export type RemovalLine = {
  material: "grain" | "straw" | "silage" | "hay" | "other";
  yieldTPerHa: number | null;
  p2o5KgPerTonne: number;
  k2oKgPerTonne: number;
};

export type GrassManagement =
  | "grazed_only"
  | "silage"
  | "hay"
  | "mixed"
  | "custom"
  | "unknown";

export type CropYear = {
  year: number;
  crop: CropKind;
  expectedYieldTPerHa: number;
  cropPricePerTonne: number | null;
  strawPricePerTonne?: number | null;
  removals: RemovalLine[];
  grassManagement?: GrassManagement;
  rootingModifier?: number | null;
};

export type PlannedYear = CropYear & {
  untreatedApplications?: ProductApplication[];
  treatedApplications?: ProductApplication[];
};

export const SCENARIOS: Scenario[] = ["low", "central", "high"];

export const scenarioValue = (value: ScenarioRange, scenario: Scenario) =>
  value[scenario];

export const zeroNutrients = (): NutrientAmounts => ({
  p2o5KgHa: 0,
  k2oKgHa: 0,
});
