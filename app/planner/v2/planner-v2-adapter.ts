import {
  CROP_RESPONSE_CONFIGS,
} from "../../domain/crop-response.ts";
import {
  DEFAULT_BUILD_COEFFICIENTS,
  DEFAULT_TARGETS,
  cropRemoval,
  initialCorrectionRequirement,
} from "../../domain/correction-requirement.ts";
import { potassiumIndex, phosphorusIndex } from "../../domain/soil-index.ts";
import { soilTrajectory } from "../../domain/soil-trajectory.ts";
import type {
  CropKind,
  GrassManagement,
  NutrientProduct,
  PlannedYear,
  ProductApplication,
  ProductEffectiveness,
  Scenario,
  ScenarioRange,
  SoilBuildCoefficient,
  SoilConcentrations,
  TargetStrategy,
} from "../../domain/nutrient-types.ts";
import type { PlannerSoilField } from "../../NutrientPlanner";
import type { NutrientData } from "../legacy/NutrientPlannerLegacy";

type FieldModel = NutrientData["fields"][number];
type DataProduct = NutrientData["products"][number] & {
  effectiveness?: ProductEffectiveness;
  cost?: {
    materialPricePerTonne: number | null;
    haulagePerTonne: number | null;
    handlingPerTonne: number | null;
    spreadingPerTonne: number | null;
    spreadingPerHa: number | null;
    fixedPassCostPerHa: number | null;
    quotedBundledCost?: {
      amountPerTonne: number;
      includes: string[];
    } | null;
  };
  dataWarnings?: string[];
};

export type OperationalCostAssumptions = {
  haulagePerTonne: number | null;
  handlingPerTonne: number | null;
  spreadingPerTonne: number | null;
  spreadingPerHa: number | null;
  fixedPassCostPerHa: number | null;
};

export type RecycledEffectivenessOverride = {
  firstYearPAvailability: ScenarioRange;
  longTermPBuildRae: ScenarioRange;
  kAvailability: ScenarioRange;
  label: string;
};

export type V2ManualApplication = {
  id: string;
  year: number;
  timing?: string;
  productId: string;
  rateKgHa: number;
  purpose: "maintenance" | "correction" | "combined";
};

export type V2CropOverride = {
  yieldTPerHa?: number;
  strawRemoved?: boolean;
  strawTPerHa?: number;
  strawPricePerTonne?: number | null;
  grassManagement?: GrassManagement;
};

export type V2FieldAnchor = {
  valid: boolean;
  requestedDate: string | null;
  actualDate: string | null;
  pMgL: number | null;
  kMgL: number | null;
  measurementMethod: string;
  fallbackOccurred: boolean;
  testAgeYears: number | null;
  warning: string | null;
};

export type CurrentStatusCases = {
  confirmedOnly: SoilConcentrations | null;
  central: SoilConcentrations | null;
  inclusive: SoilConcentrations | null;
  modelSensitivity: {
    pMgL: { low: number; central: number; high: number };
    kMgL: { low: number; central: number; high: number };
  } | null;
  indices: { p: string; k: string } | null;
  includedApplications: {
    confirmed: number;
    probable: number;
    inferred: number;
  };
  applicationTrace: {
    confirmedOnly: string[];
    central: string[];
    inclusive: string[];
  };
  includedRemovalYears: number[];
  assumptions: string[];
};

const numeric = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export const cropKindForRotation = (
  crop: string,
  cropGroup: string,
): CropKind => {
  const normalized = crop.toLocaleLowerCase();
  if (cropGroup === "Wheat")
    return normalized.includes("spring") ? "other" : "winter_wheat";
  if (cropGroup === "Barley")
    return normalized.includes("winter") ? "winter_barley" : "spring_barley";
  if (cropGroup === "Beans") return "faba_beans";
  if (cropGroup === "Grass") return "grass";
  return "other";
};

export const anchorForField = (
  soilField: PlannerSoilField | null,
  fieldModel: FieldModel,
): V2FieldAnchor => {
  const requestedDate = fieldModel.testDate;
  const exact = requestedDate
    ? soilField?.results.find((result) => result.dateSort === requestedDate)
    : null;
  const pMgL = numeric(exact?.pValue);
  const kMgL = numeric(exact?.kValue);
  const valid = Boolean(exact && pMgL !== null && kMgL !== null);
  const testAgeYears = requestedDate
    ? Math.max(
        0,
        (Date.parse("2026-12-31") - Date.parse(requestedDate)) /
          (365.25 * 24 * 60 * 60 * 1000),
      )
    : null;
  return {
    valid,
    requestedDate,
    actualDate: exact?.dateSort ?? null,
    pMgL,
    kMgL,
    measurementMethod:
      exact && "omMethod" in exact && typeof exact.omMethod === "string"
        ? `P/K laboratory method not recorded; OM method ${exact.omMethod}`
        : "P/K laboratory method not recorded",
    fallbackOccurred: Boolean(requestedDate && !exact),
    testAgeYears,
    warning: valid
      ? null
      : requestedDate && !exact
        ? "The requested anchor test was not found. No earlier test was silently substituted."
        : "The requested anchor does not contain both measured P and K concentrations.",
  };
};

const removalLinesForRotation = (
  rotation: FieldModel["rotations"][number],
  override: V2CropOverride = {},
): PlannedYear["removals"] => {
  const cropYield = override.yieldTPerHa ?? rotation.yieldTPerHa;
  const strawRemoved = override.strawRemoved ?? rotation.strawRemoved;
  const strawYield = override.strawTPerHa ?? rotation.strawTPerHa;
  if (rotation.cropGroup === "Grass") {
    if (override.grassManagement === "grazed_only") return [];
    return [
      {
        material: "other",
        yieldTPerHa: override.yieldTPerHa ?? null,
        p2o5KgPerTonne: rotation.offtake.grainP2o5KgPerT,
        k2oKgPerTonne: rotation.offtake.grainK2oKgPerT,
      },
    ];
  }
  const lines: PlannedYear["removals"] = [
    {
      material: "grain",
      yieldTPerHa: cropYield,
      p2o5KgPerTonne: rotation.offtake.grainP2o5KgPerT,
      k2oKgPerTonne: rotation.offtake.grainK2oKgPerT,
    },
  ];
  if (strawRemoved) {
    lines.push({
      material: "straw",
      yieldTPerHa: strawYield,
      p2o5KgPerTonne: rotation.offtake.strawP2o5KgPerT,
      k2oKgPerTonne: rotation.offtake.strawK2oKgPerT,
    });
  }
  return lines;
};

export const domainProduct = ({
  product,
  operationalCosts,
  recycledOverride,
}: {
  product: DataProduct;
  operationalCosts: OperationalCostAssumptions;
  recycledOverride: RecycledEffectivenessOverride | null;
}): NutrientProduct => {
  const quotedBundle = product.cost?.quotedBundledCost;
  const baseEffectiveness = product.effectiveness;
  const hasDeclaredP = (product.nutrients.p2o5 ?? 0) > 0;
  const hasDeclaredK = (product.nutrients.k2o ?? 0) > 0;
  const effectiveness: ProductEffectiveness = {
    firstYearPAvailability:
      baseEffectiveness?.firstYearPAvailability ??
      (hasDeclaredP ? recycledOverride?.firstYearPAvailability ?? null : null),
    longTermPBuildRae:
      baseEffectiveness?.longTermPBuildRae ??
      (hasDeclaredP ? recycledOverride?.longTermPBuildRae ?? null : null),
    kAvailability:
      baseEffectiveness?.kAvailability ??
      (hasDeclaredK ? recycledOverride?.kAvailability ?? null : null),
    evidenceClass:
      baseEffectiveness?.evidenceClass ??
      (recycledOverride ? "farm_assumption" : "unknown"),
    source: baseEffectiveness?.source ?? null,
    note:
      baseEffectiveness?.note ??
      (recycledOverride
        ? `${recycledOverride.label}; user-selected planning assumption`
        : "No product-specific effectiveness assumption"),
  };
  return {
    id: product.id,
    name: product.name,
    p2o5Fraction: (product.nutrients.p2o5 ?? 0) / 100,
    k2oFraction: (product.nutrients.k2o ?? 0) / 100,
    effectiveness,
    cost: quotedBundle
      ? {
          materialPricePerTonne: quotedBundle.amountPerTonne,
          haulagePerTonne: 0,
          handlingPerTonne: 0,
          spreadingPerTonne: 0,
          spreadingPerHa: 0,
          fixedPassCostPerHa: 0,
        }
      : {
          materialPricePerTonne:
            product.cost?.materialPricePerTonne ??
            product.pricePerTonne ??
            null,
          haulagePerTonne:
            product.cost?.haulagePerTonne ??
            operationalCosts.haulagePerTonne,
          handlingPerTonne:
            product.cost?.handlingPerTonne ??
            operationalCosts.handlingPerTonne,
          spreadingPerTonne:
            product.cost?.spreadingPerTonne ??
            operationalCosts.spreadingPerTonne,
          spreadingPerHa:
            product.cost?.spreadingPerHa ??
            product.applicationCostPerHa ??
            operationalCosts.spreadingPerHa,
          fixedPassCostPerHa:
            product.cost?.fixedPassCostPerHa ??
            operationalCosts.fixedPassCostPerHa,
        },
    substantialNeutralisingValue:
      (product.nutrients.neutralisingValue ?? 0) >= 10,
  };
};

const syntheticRecordedProduct = (
  application: FieldModel["recordedApplications"][number],
): NutrientProduct => ({
  id: application.id,
  name: application.productName,
  p2o5Fraction:
    application.rateKgHa > 0
      ? application.nutrientsKgHa.p2o5 / application.rateKgHa
      : 0,
  k2oFraction:
    application.rateKgHa > 0
      ? application.nutrientsKgHa.k2o / application.rateKgHa
      : 0,
  effectiveness: {
    firstYearPAvailability:
      application.nutrientsKgHa.p2o5 > 0
        ? { low: 1, central: 1, high: 1 }
        : null,
    longTermPBuildRae:
      application.nutrientsKgHa.p2o5 > 0
        ? { low: 1, central: 1, high: 1 }
        : null,
    kAvailability:
      application.nutrientsKgHa.k2o > 0
        ? { low: 1, central: 1, high: 1 }
        : null,
    evidenceClass: "farm_assumption",
    note:
      "Recorded nutrient values are already availability-adjusted in the source workbook and are credited without a second availability adjustment.",
  },
  cost: {
    materialPricePerTonne: null,
    haulagePerTonne: null,
    handlingPerTonne: null,
    spreadingPerTonne: null,
    spreadingPerHa: null,
    fixedPassCostPerHa: null,
  },
});

const historicalYears = ({
  fieldModel,
  products,
  evidenceCase,
  operationalCosts,
  recycledOverride,
}: {
  fieldModel: FieldModel;
  products: DataProduct[];
  evidenceCase: "confirmed" | "central" | "inclusive";
  operationalCosts: OperationalCostAssumptions;
  recycledOverride: RecycledEffectivenessOverride | null;
}) => {
  const anchorYear = Number(fieldModel.testDate?.slice(0, 4));
  const includeEvidence = (evidence: string) =>
    evidence === "confirmed" ||
    (evidenceCase !== "confirmed" && evidence === "probable") ||
    evidenceCase === "inclusive";
  return fieldModel.rotations
    .filter(
      (rotation) =>
        Number.isFinite(anchorYear) &&
        rotation.year >= anchorYear &&
        rotation.year <= 2026,
    )
    .map<PlannedYear>((rotation) => ({
      year: rotation.year,
      crop: cropKindForRotation(rotation.crop, rotation.cropGroup),
      expectedYieldTPerHa: rotation.yieldTPerHa,
      cropPricePerTonne: null,
      removals: removalLinesForRotation(rotation),
      grassManagement:
        rotation.cropGroup === "Grass" ? "unknown" : undefined,
      treatedApplications: fieldModel.recordedApplications
        .filter(
          (application) =>
            includeEvidence(application.evidence) &&
            (application.cropYear ??
              Number(application.date?.slice(0, 4))) === rotation.year,
        )
        .map<ProductApplication>((application) => ({
          product: syntheticRecordedProduct(application),
          rateKgHa: application.rateKgHa,
          purpose: "combined",
        })),
    }));
};

const endOfTrajectory = (
  anchor: SoilConcentrations,
  years: PlannedYear[],
  scenario: Scenario,
  coefficients: Record<"p" | "k", SoilBuildCoefficient>,
) =>
  soilTrajectory({
    anchor,
    years,
    scenario,
    path: "treated",
    coefficients,
  }).at(-1)?.end ?? anchor;

export const estimateCurrentStatus = ({
  fieldModel,
  soilField,
  products,
  operationalCosts,
  recycledOverride,
  coefficients = DEFAULT_BUILD_COEFFICIENTS,
}: {
  fieldModel: FieldModel;
  soilField: PlannerSoilField | null;
  products: DataProduct[];
  operationalCosts: OperationalCostAssumptions;
  recycledOverride: RecycledEffectivenessOverride | null;
  coefficients?: Record<"p" | "k", SoilBuildCoefficient>;
}): { anchor: V2FieldAnchor; status: CurrentStatusCases } => {
  const anchor = anchorForField(soilField, fieldModel);
  const evidenceCounts = fieldModel.recordedApplications.reduce(
    (counts, application) => {
      if (application.evidence in counts) {
        counts[
          application.evidence as "confirmed" | "probable" | "inferred"
        ] += 1;
      }
      return counts;
    },
    { confirmed: 0, probable: 0, inferred: 0 },
  );
  if (!anchor.valid || anchor.pMgL === null || anchor.kMgL === null) {
    return {
      anchor,
      status: {
        confirmedOnly: null,
        central: null,
        inclusive: null,
        modelSensitivity: null,
        indices: null,
        includedApplications: evidenceCounts,
        applicationTrace: {
          confirmedOnly: [],
          central: [],
          inclusive: [],
        },
        includedRemovalYears: [],
        assumptions: [anchor.warning ?? "Missing anchor"],
      },
    };
  }
  const start = { pMgL: anchor.pMgL, kMgL: anchor.kMgL };
  const yearsFor = (evidenceCase: "confirmed" | "central" | "inclusive") =>
    historicalYears({
      fieldModel,
      products,
      evidenceCase,
      operationalCosts,
      recycledOverride,
    });
  const centralYears = yearsFor("central");
  const confirmedOnly = endOfTrajectory(
    start,
    yearsFor("confirmed"),
    "central",
    coefficients,
  );
  const central = endOfTrajectory(start, centralYears, "central", coefficients);
  const inclusive = endOfTrajectory(
    start,
    yearsFor("inclusive"),
    "central",
    coefficients,
  );
  const sensitivityStatuses = (["low", "central", "high"] as Scenario[]).map(
    (scenario) =>
      endOfTrajectory(start, centralYears, scenario, coefficients),
  );
  const pValues = sensitivityStatuses.map((status) => status.pMgL);
  const kValues = sensitivityStatuses.map((status) => status.kMgL);
  const trajectoryWarnings = soilTrajectory({
    anchor: start,
    years: centralYears,
    scenario: "central",
    path: "treated",
    coefficients,
  }).flatMap((year) => year.warnings);
  return {
    anchor,
    status: {
      confirmedOnly,
      central,
      inclusive,
      modelSensitivity: {
        pMgL: {
          low: Math.min(...pValues),
          central: central.pMgL,
          high: Math.max(...pValues),
        },
        kMgL: {
          low: Math.min(...kValues),
          central: central.kMgL,
          high: Math.max(...kValues),
        },
      },
      indices: {
        p: phosphorusIndex(central.pMgL),
        k: potassiumIndex(central.kMgL),
      },
      includedApplications: evidenceCounts,
      applicationTrace: {
        confirmedOnly: fieldModel.recordedApplications
          .filter((application) => application.evidence === "confirmed")
          .map(
            (application) =>
              `${application.date ?? application.cropYear}: ${application.productName} ${application.rateKgHa} kg/ha`,
          ),
        central: fieldModel.recordedApplications
          .filter(
            (application) =>
              application.evidence === "confirmed" ||
              application.evidence === "probable",
          )
          .map(
            (application) =>
              `${application.date ?? application.cropYear}: ${application.productName} ${application.rateKgHa} kg/ha`,
          ),
        inclusive: fieldModel.recordedApplications.map(
          (application) =>
            `${application.date ?? application.cropYear}: ${application.productName} ${application.rateKgHa} kg/ha`,
        ),
      },
      includedRemovalYears: centralYears.map((year) => year.year),
      assumptions: [...new Set(trajectoryWarnings)],
    },
  };
};

export const futureCropYears = ({
  fieldModel,
  horizonYears,
  repeatRotation,
  cropValuesByYear,
  manualApplications,
  cropOverridesByYear = {},
  rootingModifier = 1,
  products,
  operationalCosts,
  recycledOverride,
}: {
  fieldModel: FieldModel;
  horizonYears: number;
  repeatRotation: boolean;
  cropValuesByYear: Record<string, number>;
  manualApplications: V2ManualApplication[];
  cropOverridesByYear?: Record<string, V2CropOverride>;
  rootingModifier?: number;
  products: DataProduct[];
  operationalCosts: OperationalCostAssumptions;
  recycledOverride: RecycledEffectivenessOverride | null;
}) => {
  const known = fieldModel.rotations
    .filter((rotation) => rotation.economicForecast)
    .sort((left, right) => left.year - right.year);
  const startYear = known[0]?.year ?? 2027;
  const rotations = Array.from({ length: horizonYears }, (_, index) => {
    const year = startYear + index;
    const exact = known.find((rotation) => rotation.year === year);
    if (exact) return { ...exact, repeated: false };
    if (!repeatRotation || known.length === 0) return null;
    const source = known[index % known.length];
    return { ...source, year, repeated: true };
  });
  const incompleteYears = rotations
    .map((rotation, index) => (rotation ? null : startYear + index))
    .filter((year): year is number => year !== null);
  const years = rotations.flatMap<PlannedYear>((rotation) => {
    if (!rotation) return [];
    const cropOverride = cropOverridesByYear[String(rotation.year)] ?? {};
    const applications = manualApplications
      .filter((application) => application.year === rotation.year)
      .flatMap<ProductApplication>((application) => {
        const product = products.find(
          (candidate) => candidate.id === application.productId,
        );
        return product
          ? [
              {
                product: domainProduct({
                  product,
                  operationalCosts,
                  recycledOverride,
                }),
                rateKgHa: application.rateKgHa,
                purpose: application.purpose,
              },
            ]
          : [];
      });
    return [
      {
        year: rotation.year,
        crop: cropKindForRotation(rotation.crop, rotation.cropGroup),
        expectedYieldTPerHa:
          cropOverride.yieldTPerHa ?? rotation.yieldTPerHa,
        cropPricePerTonne:
          cropValuesByYear[String(rotation.year)] ??
          (rotation.cropGroup === "Wheat"
            ? 180
            : rotation.cropGroup === "Barley"
              ? 170
              : rotation.cropGroup === "Beans"
                ? 220
                : null),
        strawPricePerTonne: cropOverride.strawPricePerTonne ?? null,
        removals: removalLinesForRotation(rotation, cropOverride),
        rootingModifier,
        grassManagement:
          rotation.cropGroup === "Grass"
            ? cropOverride.grassManagement ?? "unknown"
            : undefined,
        untreatedApplications: applications.filter(
          (application) => application.purpose === "maintenance",
        ),
        treatedApplications: applications,
      },
    ];
  });
  return { years, incompleteYears };
};

export const fieldAccounts = ({
  current,
  firstYear,
  targets = DEFAULT_TARGETS,
  coefficients = DEFAULT_BUILD_COEFFICIENTS,
  scenario = "central",
}: {
  current: SoilConcentrations;
  firstYear: PlannedYear | null;
  targets?: Record<"p" | "k", TargetStrategy>;
  coefficients?: Record<"p" | "k", SoilBuildCoefficient>;
  scenario?: Scenario;
}) => ({
  maintenance: firstYear
    ? cropRemoval(firstYear)
    : {
        nutrients: { p2o5KgHa: 0, k2oKgHa: 0 },
        complete: false,
        warning: "The first forecast crop is missing",
      },
  correction: initialCorrectionRequirement({
    anchor: current,
    targets,
    coefficients,
    scenario,
  }),
});

export { CROP_RESPONSE_CONFIGS, DEFAULT_BUILD_COEFFICIENTS, DEFAULT_TARGETS };
