import {
  type CropKind,
  type CropResponseConfig,
  type Scenario,
  type SoilConcentrations,
  scenarioValue,
} from "./nutrient-types.ts";

const range = (low: number, central: number, high: number) => ({
  low,
  central,
  high,
});

export const CROP_RESPONSE_CONFIGS: Record<CropKind, CropResponseConfig> = {
  winter_wheat: {
    crop: "winter_wheat",
    modelType: "continuous_critical_concentration",
    evidenceStrength: "moderate",
    transferabilityNote: "Continuous Olsen-P scenario; calibrate against local fields.",
    source: "Planning synthesis of UK cereal guidance",
    pCriticalMgL: range(16, 20, 25),
    kCriticalMgL: range(121, 150, 180),
    maximumPLossFraction: range(0.08, 0.18, 0.3),
    maximumKLossFraction: range(0.08, 0.16, 0.28),
  },
  spring_barley: {
    crop: "spring_barley",
    modelType: "continuous_critical_concentration",
    evidenceStrength: "moderate",
    transferabilityNote: "Cereal evidence applied directly with scenario uncertainty.",
    source: "Planning synthesis of cereal evidence",
    pCriticalMgL: range(16, 20, 24),
    kCriticalMgL: range(121, 145, 175),
    maximumPLossFraction: range(0.06, 0.15, 0.25),
    maximumKLossFraction: range(0.06, 0.14, 0.24),
  },
  winter_barley: {
    crop: "winter_barley",
    modelType: "proxy",
    evidenceStrength: "low",
    transferabilityNote:
      "Explicit extrapolation from spring-barley and general cereal evidence; wider range.",
    source: "Spring-barley/cereal proxy",
    pCriticalMgL: range(15, 21, 27),
    kCriticalMgL: range(115, 150, 190),
    maximumPLossFraction: range(0.03, 0.16, 0.34),
    maximumKLossFraction: range(0.03, 0.15, 0.32),
  },
  faba_beans: {
    crop: "faba_beans",
    modelType: "proxy",
    evidenceStrength: "low",
    transferabilityNote:
      "Overseas evidence with no robust UK Olsen-P calibration; low case assumes no response.",
    source: "Low-confidence bean evidence proxy",
    pCriticalMgL: range(16, 20, 26),
    kCriticalMgL: range(121, 150, 185),
    maximumPLossFraction: range(0, 0.1, 0.28),
    maximumKLossFraction: range(0, 0.08, 0.22),
  },
  grass: {
    crop: "grass",
    modelType: "none",
    evidenceStrength: "none",
    transferabilityNote: "No response monetised unless explicitly enabled.",
    source: "Explicit low-confidence farm planning sensitivity",
    pCriticalMgL: range(16, 20, 25),
    kCriticalMgL: range(121, 150, 180),
    maximumPLossFraction: range(0, 0.12, 0.25),
    maximumKLossFraction: range(0, 0.1, 0.22),
  },
  other: {
    crop: "other",
    modelType: "none",
    evidenceStrength: "none",
    transferabilityNote: "Crop-specific response assumption is missing.",
    source: "No model",
    pCriticalMgL: range(16, 20, 25),
    kCriticalMgL: range(121, 150, 180),
    maximumPLossFraction: range(0, 0, 0),
    maximumKLossFraction: range(0, 0, 0),
  },
};

const singleNutrientRelativeYield = (
  concentration: number,
  critical: number,
  maximumLoss: number,
) => {
  if (critical <= 0 || concentration >= critical) return 1;
  const deficitFraction = Math.max(0, 1 - concentration / critical);
  return Math.max(0, 1 - maximumLoss * deficitFraction);
};

export type InteractionMethod = "multiplicative" | "limiting_nutrient";

export const relativeYield = ({
  crop,
  status,
  scenario,
  interaction = "multiplicative",
  rootingModifier = 1,
  enableGrassResponse = false,
}: {
  crop: CropKind;
  status: SoilConcentrations;
  scenario: Scenario;
  interaction?: InteractionMethod;
  rootingModifier?: number;
  enableGrassResponse?: boolean;
}) => {
  const config = CROP_RESPONSE_CONFIGS[crop];
  if (
    config.modelType === "none" &&
    !(crop === "grass" && enableGrassResponse)
  ) {
    return 1;
  }
  const p = singleNutrientRelativeYield(
    status.pMgL,
    scenarioValue(config.pCriticalMgL, scenario),
    scenarioValue(config.maximumPLossFraction, scenario),
  );
  const k = singleNutrientRelativeYield(
    status.kMgL,
    scenarioValue(config.kCriticalMgL, scenario),
    scenarioValue(config.maximumKLossFraction, scenario),
  );
  const combined = interaction === "multiplicative" ? p * k : Math.min(p, k);
  return Math.min(1, Math.max(0, combined * Math.max(0, rootingModifier)));
};
