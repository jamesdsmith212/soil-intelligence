"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CROP_RESPONSE_CONFIGS,
  applicationNutrients,
  evaluateNutrientPlan,
  optimiseProducts,
  phosphorusIndex,
  potassiumIndex,
  type InteractionMethod,
  type ProductCandidate,
  type SoilBuildCoefficient,
  type TargetStrategy,
} from "../../domain/index.ts";
import type { PlannerSoilField } from "../../NutrientPlanner";
import type { NutrientData } from "../legacy/NutrientPlannerLegacy";
import {
  DEFAULT_BUILD_COEFFICIENTS,
  domainProduct,
  estimateCurrentStatus,
  fieldAccounts,
  futureCropYears,
  type OperationalCostAssumptions,
  type RecycledEffectivenessOverride,
  type V2CropOverride,
  type V2ManualApplication,
} from "./planner-v2-adapter.ts";

type SavedPlan = {
  planId?: string;
  plannerVersion?: "legacy_v1" | "nutrient_planner_v2";
  fieldId: string;
  sourcePlanId?: string | null;
  migrationWarnings?: string[];
  targets?: {
    pMgL?: number;
    kMgL?: number;
    strategies?: Record<"p" | "k", TargetStrategy>;
  };
  soilBuildCoefficients?: Record<"p" | "k", SoilBuildCoefficient>;
  horizonYears?: number;
  repeatRotation?: boolean;
  grassResponseEnabled?: boolean;
  interactionMethod?: InteractionMethod;
  cropValuesByYear?: Record<string, number>;
  cropAdjustments?: Record<string, V2CropOverride>;
  proposedApplications?: Array<Record<string, unknown>>;
  annualApplications?: V2ManualApplication[];
  operationalCosts?: OperationalCostAssumptions;
  recycledEffectivenessOverride?: RecycledEffectivenessOverride | null;
  soilMetadata?: {
    soilClass?: "mineral" | "organic" | "peaty" | "unknown";
    textureClass?: string | null;
    limeRequirementTPerHa?: number | null;
    limeRequirementSource?: string | null;
    drainageOrStructureRating?: string | null;
    rootingConstraint?: string | null;
    rootingModifier?: number | null;
  };
  economicSummary?: Record<string, unknown> | null;
  v2EconomicSummary?: Record<string, unknown> | null;
  notes?: string;
  updatedAt?: string;
};

const formatMoney = (value: number | null) =>
  value == null
    ? "Incomplete"
    : value.toLocaleString("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0,
      });

const formatNutrient = (value: number) =>
  `${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })} kg/ha`;

const numberOrNull = (value: string) => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const addYears = (date: string | null, years: number) => {
  if (!date) return "As soon as practical";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "As soon as practical";
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
};

const defaultOperationalCosts: OperationalCostAssumptions = {
  haulagePerTonne: 20,
  handlingPerTonne: 5,
  spreadingPerTonne: 0,
  spreadingPerHa: 14.21,
  fixedPassCostPerHa: 0,
};

const defaultRecycledEffectiveness: RecycledEffectivenessOverride = {
  label: "Editable recycled-nutrient planning sensitivity",
  firstYearPAvailability: { low: 0.25, central: 0.5, high: 0.75 },
  longTermPBuildRae: { low: 0.4, central: 0.7, high: 1 },
  kAvailability: { low: 0.6, central: 0.85, high: 1 },
};

const cloneCoefficients = () => ({
  p: { ...DEFAULT_BUILD_COEFFICIENTS.p },
  k: { ...DEFAULT_BUILD_COEFFICIENTS.k },
});

const targetRecord = (
  pMgL: number,
  kMgL: number,
): Record<"p" | "k", TargetStrategy> => ({
  p: {
    nutrient: "p",
    name: pMgL === 16 ? "lower_index_2" : pMgL === 20 ? "mid_index_2" : "custom",
    concentrationMgL: pMgL,
  },
  k: {
    nutrient: "k",
    name:
      kMgL === 121 ? "lower_index_2" : kMgL === 150 ? "mid_index_2" : "custom",
    concentrationMgL: kMgL,
  },
});

const downloadText = (filename: string, contents: string, type: string) => {
  const href = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
};

export default function NutrientPlannerV2({
  soilFields,
  nutrientData,
  onBack,
  onShowLegacy,
}: {
  soilFields: PlannerSoilField[];
  nutrientData: NutrientData;
  onBack: () => void;
  onShowLegacy: () => void;
}) {
  const selectableModels = nutrientData.fields.filter((field) => field.testDate);
  const [plannerView, setPlannerView] = useState<"summary" | "field">("summary");
  const [selectedFieldId, setSelectedFieldId] = useState(
    selectableModels[0]?.fieldId ?? "",
  );
  const [horizonYears, setHorizonYears] = useState(3);
  const [repeatRotation, setRepeatRotation] = useState(false);
  const [grassResponseEnabled, setGrassResponseEnabled] = useState(false);
  const [pTargetMgL, setPTargetMgL] = useState(20);
  const [kTargetMgL, setKTargetMgL] = useState(150);
  const [correctionYears, setCorrectionYears] = useState(3);
  const [discountRatePct, setDiscountRatePct] = useState(5);
  const [interaction, setInteraction] =
    useState<InteractionMethod>("multiplicative");
  const [coefficients, setCoefficients] = useState(cloneCoefficients);
  const [operationalCosts, setOperationalCosts] = useState(
    defaultOperationalCosts,
  );
  const [useRecycledOverride, setUseRecycledOverride] = useState(false);
  const [recycledOverride, setRecycledOverride] = useState(
    defaultRecycledEffectiveness,
  );
  const [manualApplications, setManualApplications] = useState<
    V2ManualApplication[]
  >([]);
  const [cropValuesByYear, setCropValuesByYear] = useState<
    Record<string, number>
  >({});
  const [cropOverridesByYear, setCropOverridesByYear] = useState<
    Record<string, V2CropOverride>
  >({});
  const [optimizerCandidates, setOptimizerCandidates] = useState<
    ProductCandidate[]
  >([]);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "unavailable" | "error"
  >("idle");
  const [soilMetadata, setSoilMetadata] = useState({
    soilClass: "unknown" as "mineral" | "organic" | "peaty" | "unknown",
    textureClass: "",
    limeRequirementTPerHa: null as number | null,
    limeRequirementSource: "",
    drainageOrStructureRating: "",
    rootingConstraint: "",
    rootingModifier: 1,
  });
  const [notes, setNotes] = useState("");

  const fieldModel =
    nutrientData.fields.find((field) => field.fieldId === selectedFieldId) ??
    selectableModels[0];
  const soilField =
    soilFields.find((field) => field.id === fieldModel?.fieldId) ?? null;
  const selectedResult = fieldModel?.testDate
    ? soilField?.results.find(
        (result) => result.dateSort === fieldModel.testDate,
      )
    : null;
  const measuredPh =
    typeof selectedResult?.ph === "number"
      ? selectedResult.ph
      : Number(selectedResult?.ph ?? Number.NaN);
  const targets = useMemo(
    () => targetRecord(pTargetMgL, kTargetMgL),
    [pTargetMgL, kTargetMgL],
  );
  const effectiveRecycledOverride = useRecycledOverride
    ? recycledOverride
    : null;

  /* Loading a different saved plan intentionally hydrates the editable form. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/nutrient-plans", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load saved plans");
        return (await response.json()) as { plans: SavedPlan[] };
      })
      .then(({ plans }) => {
        if (!cancelled) {
          setSavedPlans(plans);
          setPlansLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setPlansLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!plansLoaded || !fieldModel) return;
    const saved = savedPlans.find(
      (plan) =>
        plan.fieldId === fieldModel.fieldId &&
        plan.plannerVersion === "nutrient_planner_v2",
    );
    if (!saved) {
      setManualApplications([]);
      setCropValuesByYear({});
      setCropOverridesByYear({});
      setGrassResponseEnabled(false);
      setNotes("");
      setSaveState("idle");
      return;
    }
    setPTargetMgL(saved.targets?.pMgL ?? 20);
    setKTargetMgL(saved.targets?.kMgL ?? 150);
    setCoefficients(saved.soilBuildCoefficients ?? cloneCoefficients());
    setHorizonYears(saved.horizonYears ?? 3);
    setRepeatRotation(saved.repeatRotation ?? false);
    setGrassResponseEnabled(saved.grassResponseEnabled ?? false);
    setInteraction(saved.interactionMethod ?? "multiplicative");
    setCropValuesByYear(saved.cropValuesByYear ?? {});
    setCropOverridesByYear(saved.cropAdjustments ?? {});
    setManualApplications(
      saved.annualApplications ??
        saved.proposedApplications?.flatMap<V2ManualApplication>(
          (application, index) => {
            const productId =
              typeof application.productId === "string"
                ? application.productId
                : null;
            const rate = Number(application.rate ?? 0);
            if (!productId || !Number.isFinite(rate)) return [];
            return [
              {
                id:
                  typeof application.id === "string"
                    ? application.id
                    : `migrated-${index}`,
                year: 2027,
                productId,
                rateKgHa:
                  application.unit === "t/ha" ? rate * 1000 : rate,
                timing:
                  typeof application.timing === "string"
                    ? application.timing
                    : "2027-01-01",
                purpose: "combined",
              },
            ];
          },
        ) ??
        [],
    );
    setOperationalCosts(saved.operationalCosts ?? defaultOperationalCosts);
    setUseRecycledOverride(Boolean(saved.recycledEffectivenessOverride));
    setRecycledOverride(
      saved.recycledEffectivenessOverride ?? defaultRecycledEffectiveness,
    );
    setSoilMetadata((current) => ({
      ...current,
      ...(saved.soilMetadata ?? {}),
      textureClass: saved.soilMetadata?.textureClass ?? "",
      limeRequirementSource:
        saved.soilMetadata?.limeRequirementSource ?? "",
      drainageOrStructureRating:
        saved.soilMetadata?.drainageOrStructureRating ?? "",
      rootingConstraint: saved.soilMetadata?.rootingConstraint ?? "",
      rootingModifier: saved.soilMetadata?.rootingModifier ?? 1,
    }));
    setNotes(saved.notes ?? "");
    setSaveState("idle");
  }, [fieldModel, plansLoaded, savedPlans]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const products = nutrientData.products;
  const domainProducts = useMemo(
    () =>
      products.map((product) =>
        domainProduct({
          product,
          operationalCosts,
          recycledOverride: effectiveRecycledOverride,
        }),
      ),
    [effectiveRecycledOverride, operationalCosts, products],
  );

  const currentEstimate = useMemo(
    () =>
      fieldModel
        ? estimateCurrentStatus({
            fieldModel,
            soilField,
            products,
            operationalCosts,
            recycledOverride: effectiveRecycledOverride,
            coefficients,
          })
        : null,
    [
      coefficients,
      effectiveRecycledOverride,
      fieldModel,
      operationalCosts,
      products,
      soilField,
    ],
  );

  const future = useMemo(
    () =>
      fieldModel
        ? futureCropYears({
            fieldModel,
            horizonYears,
            repeatRotation,
            cropValuesByYear,
            manualApplications,
            cropOverridesByYear,
            rootingModifier: soilMetadata.rootingModifier,
            products,
            operationalCosts,
            recycledOverride: effectiveRecycledOverride,
          })
        : { years: [], incompleteYears: [] },
    [
      cropValuesByYear,
      cropOverridesByYear,
      effectiveRecycledOverride,
      fieldModel,
      horizonYears,
      manualApplications,
      operationalCosts,
      products,
      repeatRotation,
      soilMetadata.rootingModifier,
    ],
  );
  const current = currentEstimate?.status.central ?? null;
  const accounts = current
    ? fieldAccounts({
        current,
        firstYear: future.years[0] ?? null,
        targets,
        coefficients,
      })
    : null;
  const grassYears = future.years.filter((year) => year.crop === "grass");
  const grassResponseReady =
    grassYears.length > 0 &&
    grassYears.every(
      (year) =>
        year.grassManagement !== undefined &&
        year.grassManagement !== "unknown" &&
        year.grassManagement !== "grazed_only" &&
        year.removals.length > 0 &&
        year.removals.every((removal) => removal.yieldTPerHa != null),
    );
  const effectiveGrassResponseEnabled =
    grassResponseEnabled && grassResponseReady;
  const economics = useMemo(
    () =>
      current && future.years.length
        ? evaluateNutrientPlan({
            anchor: current,
            years: future.years,
            productsForTerminalValue: domainProducts,
            discountRate: discountRatePct / 100,
            interaction,
            coefficients,
            targets,
            forceNoCropResponseInLow: true,
            enableGrassResponse: effectiveGrassResponseEnabled,
          })
        : null,
    [
      coefficients,
      current,
      discountRatePct,
      domainProducts,
      future.years,
      effectiveGrassResponseEnabled,
      interaction,
      targets,
    ],
  );
  const evidenceCaseComparisons = useMemo(
    () =>
      (
        [
          ["Confirmed only", currentEstimate?.status.confirmedOnly],
          ["Central · confirmed + probable", currentEstimate?.status.central],
          ["Inclusive · all records", currentEstimate?.status.inclusive],
        ] as const
      ).map(([label, status]) => {
        if (!status || !future.years.length) {
          return { label, status: null, correction: null, npv: null };
        }
        const caseAccounts = fieldAccounts({
          current: status,
          firstYear: future.years[0] ?? null,
          targets,
          coefficients,
        });
        const caseEconomics = evaluateNutrientPlan({
          anchor: status,
          years: future.years,
          productsForTerminalValue: domainProducts,
          discountRate: discountRatePct / 100,
          interaction,
          coefficients,
          targets,
          forceNoCropResponseInLow: true,
          enableGrassResponse: effectiveGrassResponseEnabled,
        });
        return {
          label,
          status,
          correction: caseAccounts.correction,
          npv: caseEconomics.central.npv,
        };
      }),
    [
      coefficients,
      currentEstimate?.status.central,
      currentEstimate?.status.confirmedOnly,
      currentEstimate?.status.inclusive,
      discountRatePct,
      domainProducts,
      future.years,
      effectiveGrassResponseEnabled,
      interaction,
      targets,
    ],
  );

  const farmRows = useMemo(
    () =>
      soilFields.map((farmSoilField) => {
        const model = nutrientData.fields.find(
          (candidate) => candidate.fieldId === farmSoilField.id,
        );
        if (!model) {
          return {
            fieldId: farmSoilField.id,
            fieldName: farmSoilField.name,
            areaHa: farmSoilField.areaHa,
            anchorValid: false,
            stale: false,
            pIndex: null,
            kIndex: null,
            current: null,
            confirmed: null,
            inclusive: null,
            sensitivity: null,
            maintenance: null,
            correction: null,
            warnings: ["No nutrient-planner field model"],
          };
        }
        const estimate = estimateCurrentStatus({
          fieldModel: model,
          soilField: farmSoilField,
          products,
          operationalCosts,
          recycledOverride: effectiveRecycledOverride,
          coefficients,
        });
        const forecast = futureCropYears({
          fieldModel: model,
          horizonYears: 3,
          repeatRotation: false,
          cropValuesByYear: {},
          manualApplications: [],
          cropOverridesByYear: {},
          rootingModifier: 1,
          products,
          operationalCosts,
          recycledOverride: effectiveRecycledOverride,
        });
        const rowAccounts = estimate.status.central
          ? fieldAccounts({
              current: estimate.status.central,
              firstYear: forecast.years[0] ?? null,
              targets,
              coefficients,
            })
          : null;
        return {
          fieldId: farmSoilField.id,
          fieldName: farmSoilField.name,
          areaHa: farmSoilField.areaHa,
          anchorValid: estimate.anchor.valid,
          stale: (estimate.anchor.testAgeYears ?? 0) > 4,
          pIndex: estimate.status.indices?.p ?? null,
          kIndex: estimate.status.indices?.k ?? null,
          current: estimate.status.central,
          confirmed: estimate.status.confirmedOnly,
          inclusive: estimate.status.inclusive,
          sensitivity: estimate.status.modelSensitivity,
          maintenance: rowAccounts?.maintenance ?? null,
          correction: rowAccounts?.correction ?? null,
          warnings: estimate.status.assumptions,
        };
      }),
    [
      coefficients,
      effectiveRecycledOverride,
      nutrientData.fields,
      operationalCosts,
      products,
      soilFields,
      targets,
    ],
  );
  const farmTotals = farmRows.reduce(
    (total, row) => {
      total.areaHa += row.areaHa;
      if (row.anchorValid) total.validAnchorHa += row.areaHa;
      else total.missingAnchorHa += row.areaHa;
      if (row.stale) total.staleHa += row.areaHa;
      if (row.maintenance?.complete) {
        total.maintenanceP +=
          row.maintenance.nutrients.p2o5KgHa * row.areaHa;
        total.maintenanceK +=
          row.maintenance.nutrients.k2oKgHa * row.areaHa;
      } else if (row.anchorValid) total.incompleteMaintenanceFields += 1;
      if (row.correction) {
        total.correctionP += row.correction.p2o5KgHa * row.areaHa;
        total.correctionK += row.correction.k2oKgHa * row.areaHa;
      }
      if (row.warnings.length) total.warningFields += 1;
      return total;
    },
    {
      areaHa: 0,
      validAnchorHa: 0,
      missingAnchorHa: 0,
      staleHa: 0,
      maintenanceP: 0,
      maintenanceK: 0,
      correctionP: 0,
      correctionK: 0,
      incompleteMaintenanceFields: 0,
      warningFields: 0,
    },
  );
  const indexAreaSummary = farmRows.reduce(
    (summary, row) => {
      if (row.pIndex) {
        summary.p[row.pIndex] = (summary.p[row.pIndex] ?? 0) + row.areaHa;
      }
      if (row.kIndex) {
        summary.k[row.kIndex] = (summary.k[row.kIndex] ?? 0) + row.areaHa;
      }
      return summary;
    },
    {
      p: {} as Record<string, number>,
      k: {} as Record<string, number>,
    },
  );
  const savedV2FarmEconomics = savedPlans
    .filter((plan) => plan.plannerVersion === "nutrient_planner_v2")
    .reduce(
      (summary, plan) => {
        const areaHa =
          soilFields.find((field) => field.id === plan.fieldId)?.areaHa ?? 0;
        const economic = plan.v2EconomicSummary as
          | Record<
              "low" | "central" | "high",
              {
                npv?: number | null;
                complete?: boolean;
                discountedCropResponseValue?: number | null;
                discountedApplicationCost?: number | null;
                discountedTerminalSoilCapitalValue?: number | null;
                discountedCostBreakdown?: {
                  material?: number;
                  haulage?: number;
                  handling?: number;
                  spreading?: number;
                  fixedPass?: number;
                };
                warnings?: string[];
              }
            >
          | undefined;
        summary.plannedFields += 1;
        summary.plannedAreaHa += areaHa;
        for (const application of plan.annualApplications ?? []) {
          const amountKg = application.rateKgHa * areaHa;
          summary.productKg += amountKg;
          summary.annualProductKg[application.year] =
            (summary.annualProductKg[application.year] ?? 0) + amountKg;
        }
        for (const scenario of ["low", "central", "high"] as const) {
          const result = economic?.[scenario];
          if (typeof result?.npv === "number") {
            summary.npv[scenario] += result.npv * areaHa;
          } else {
            summary.incompleteEconomicFields.add(plan.fieldId);
          }
        }
        const central = economic?.central;
        if (typeof central?.discountedCropResponseValue === "number") {
          summary.cropResponseValue +=
            central.discountedCropResponseValue * areaHa;
        }
        if (typeof central?.discountedApplicationCost === "number") {
          summary.applicationCost +=
            central.discountedApplicationCost * areaHa;
        }
        if (central?.discountedCostBreakdown) {
          summary.materialCost +=
            (central.discountedCostBreakdown.material ?? 0) * areaHa;
          summary.operationalCost +=
            ((central.discountedCostBreakdown.haulage ?? 0) +
              (central.discountedCostBreakdown.handling ?? 0) +
              (central.discountedCostBreakdown.spreading ?? 0) +
              (central.discountedCostBreakdown.fixedPass ?? 0)) *
            areaHa;
        }
        if (typeof central?.discountedTerminalSoilCapitalValue === "number") {
          summary.terminalValue +=
            central.discountedTerminalSoilCapitalValue * areaHa;
        }
        if (
          central?.warnings?.some((warning) =>
            warning.toLocaleLowerCase().includes("crop"),
          )
        ) {
          summary.missingCropFields.add(plan.fieldId);
        }
        return summary;
      },
      {
        plannedFields: 0,
        plannedAreaHa: 0,
        productKg: 0,
        annualProductKg: {} as Record<string, number>,
        npv: { low: 0, central: 0, high: 0 },
        cropResponseValue: 0,
        applicationCost: 0,
        materialCost: 0,
        operationalCost: 0,
        terminalValue: 0,
        incompleteEconomicFields: new Set<string>(),
        missingCropFields: new Set<string>(),
      },
    );
  const lowConfidenceResponseFields = farmRows.filter((row) => {
    const model = nutrientData.fields.find(
      (candidate) => candidate.fieldId === row.fieldId,
    );
    return model?.rotations.some((rotation) => {
      if (!rotation.economicForecast) return false;
      const crop = CROP_RESPONSE_CONFIGS[
        rotation.cropGroup === "Beans"
          ? "faba_beans"
          : rotation.cropGroup === "Barley" &&
              rotation.crop.toLocaleLowerCase().includes("winter")
            ? "winter_barley"
            : "other"
      ];
      return crop?.evidenceStrength === "low";
    });
  }).length;
  const evidenceShiftFields = farmRows.filter(
    (row) =>
      row.current &&
      row.confirmed &&
      row.inclusive &&
      (phosphorusIndex(row.current.pMgL) !==
        phosphorusIndex(row.confirmed.pMgL) ||
        potassiumIndex(row.current.kMgL) !==
          potassiumIndex(row.confirmed.kMgL) ||
        phosphorusIndex(row.current.pMgL) !==
          phosphorusIndex(row.inclusive.pMgL) ||
        potassiumIndex(row.current.kMgL) !==
          potassiumIndex(row.inclusive.kMgL)),
  ).length;
  const sensitivityBandShiftFields = farmRows.filter(
    (row) =>
      row.sensitivity &&
      (phosphorusIndex(row.sensitivity.pMgL.low) !==
        phosphorusIndex(row.sensitivity.pMgL.high) ||
        potassiumIndex(row.sensitivity.kMgL.low) !==
          potassiumIndex(row.sensitivity.kMgL.high)),
  ).length;

  const legacyPlan = savedPlans.find(
    (plan) =>
      plan.fieldId === fieldModel?.fieldId &&
      (plan.plannerVersion === "legacy_v1" || !plan.plannerVersion),
  );
  const legacySummary = legacyPlan?.economicSummary as
    | {
        latestEstimatedP?: { central?: number };
        latestEstimatedK?: { central?: number };
        npvGbpPerHa?: { central?: number };
      }
    | undefined;

  const runOptimizer = () => {
    if (!accounts || !future.years[0]) return;
    const requirement = {
      p2o5KgHa:
        accounts.maintenance.nutrients.p2o5KgHa +
        accounts.correction.p2o5KgHa / correctionYears,
      k2oKgHa:
        accounts.maintenance.nutrients.k2oKgHa +
        accounts.correction.k2oKgHa / correctionYears,
    };
    const relevantProducts = domainProducts
      .filter(
        (product) => product.p2o5Fraction > 0 || product.k2oFraction > 0,
      )
      .slice(0, 16);
    const result = optimiseProducts({
      required: requirement,
      products: relevantProducts,
      scenario: "central",
      maximumProducts: 2,
      maximumPasses: 2,
      rateStepKgHa: 100,
      oversupplyToleranceFraction: 0.35,
      excludeSubstantialNeutralisingValue:
        Number.isFinite(measuredPh) && measuredPh >= 7,
    });
    setOptimizerCandidates(
      result.candidates.filter((candidate) => candidate.feasible).slice(0, 5),
    );
  };

  const applyCandidate = (candidate: ProductCandidate) => {
    const year = future.years[0]?.year ?? 2027;
    setManualApplications((currentApplications) => [
      ...currentApplications.filter((application) => application.year !== year),
      ...candidate.applications.map((application, index) => ({
        id: `optimised-${year}-${index}-${Date.now()}`,
        year,
        timing: `${year}-01-01`,
        productId: application.product.id,
        rateKgHa: application.rateKgHa,
        purpose: "combined" as const,
      })),
    ]);
    setOptimizerCandidates([]);
    setSaveState("idle");
  };

  const savePlan = async () => {
    if (!fieldModel) return;
    setSaveState("saving");
    const body = {
      plannerVersion: "nutrient_planner_v2",
      planId:
        savedPlans.find(
          (plan) =>
            plan.fieldId === fieldModel.fieldId &&
            plan.plannerVersion === "nutrient_planner_v2",
        )?.planId ?? `v2-${fieldModel.fieldId}`,
      fieldId: fieldModel.fieldId,
      cropAdjustments: cropOverridesByYear,
      proposedApplications: manualApplications.map((application) => ({
        id: application.id,
        productId: application.productId,
        rate: application.rateKgHa,
        unit: "kg/ha",
        timing: application.timing ?? `${application.year}-01-01`,
        purpose: application.purpose,
      })),
      annualApplications: manualApplications,
      economics: {
        cropValuePerTonne: future.years[0]?.cropPricePerTonne ?? 0,
        priceUncertaintyPct: 10,
        discountRatePct,
        cropValuesByYear,
      },
      targets: {
        pMgL: pTargetMgL,
        kMgL: kTargetMgL,
        strategies: targets,
      },
      soilBuildCoefficients: coefficients,
      measurementTolerances: { pMgL: 5, kMgL: 25 },
      horizonYears,
      repeatRotation,
      grassResponseEnabled,
      cropResponseScenario: "low_central_high",
      interactionMethod: interaction,
      operationalCosts,
      recycledEffectivenessOverride: effectiveRecycledOverride,
      productEffectivenessOverrides: effectiveRecycledOverride
        ? { recycledProducts: effectiveRecycledOverride }
        : {},
      soilMetadata,
      v2Assumptions: {
        measurementToleranceMgL: { p: 5, k: 25 },
        evidenceCase: "central_confirmed_plus_probable",
        correctionYears,
        forceNoCropResponseInLow: true,
      },
      v2EconomicSummary: economics,
      notes,
    };
    try {
      const response = await fetch("/api/nutrient-plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Save failed");
      const saved = (await response.json()) as SavedPlan;
      setSavedPlans((plans) => [
        ...plans.filter(
          (plan) =>
            !(
              plan.fieldId === fieldModel.fieldId &&
              plan.plannerVersion === "nutrient_planner_v2"
            ),
        ),
        saved,
      ]);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const copyLegacyPlan = async () => {
    if (!fieldModel || !legacyPlan) {
      setCopyState("unavailable");
      return;
    }
    setCopyState("copying");
    try {
      const response = await fetch("/api/nutrient-plans/copy-to-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldId: fieldModel.fieldId,
          sourcePlanId: legacyPlan.planId ?? `legacy-${fieldModel.fieldId}`,
        }),
      });
      if (!response.ok) throw new Error("Copy failed");
      const copied = (await response.json()) as SavedPlan;
      setSavedPlans((plans) => [...plans, copied]);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const exportPlan = () => {
    if (!fieldModel) return;
    const exportRecord = {
      schemaVersion: "2.0.0",
      plannerVersion: "nutrient_planner_v2",
      exportedAt: new Date().toISOString(),
      field: {
        fieldId: fieldModel.fieldId,
        fieldName: fieldModel.fieldName,
        areaHa: soilField?.areaHa ?? null,
      },
      anchor: currentEstimate?.anchor,
      evidenceCases: currentEstimate?.status,
      assumptions: {
        targets,
        coefficients,
        measurementToleranceMgL: { p: 5, k: 25 },
        operationalCosts,
        recycledEffectivenessOverride: effectiveRecycledOverride,
        horizonYears,
        repeatRotation,
        grassResponseEnabled,
        interaction,
        correctionYears,
        soilMetadata,
        cropOverridesByYear,
      },
      maintenanceAndCorrection: accounts,
      applications: manualApplications,
      annualTrajectory: economics,
      cropEvidence: future.years.map((year) => CROP_RESPONSE_CONFIGS[year.crop]),
      legacyComparison: legacySummary ?? null,
      notes,
    };
    downloadText(
      `soil-intelligence-${fieldModel.fieldId}-nutrient-planner-v2.json`,
      `${JSON.stringify(exportRecord, null, 2)}\n`,
      "application/json;charset=utf-8",
    );
  };

  const exportFarmSummary = () => {
    const headers = [
      "field_id",
      "field_name",
      "area_ha",
      "valid_anchor",
      "stale_test",
      "current_p_mg_l",
      "current_p_index",
      "current_k_mg_l",
      "current_k_index",
      "maintenance_p2o5_kg_ha",
      "maintenance_k2o_kg_ha",
      "correction_p2o5_kg_ha",
      "correction_k2o_kg_ha",
      "warning_count",
      "planner_version",
    ];
    const csvCell = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text)
        ? `"${text.replaceAll('"', '""')}"`
        : text;
    };
    const rows = farmRows.map((row) => [
      row.fieldId,
      row.fieldName,
      row.areaHa.toFixed(2),
      row.anchorValid,
      row.stale,
      row.current?.pMgL.toFixed(2) ?? "",
      row.pIndex ?? "",
      row.current?.kMgL.toFixed(2) ?? "",
      row.kIndex ?? "",
      row.maintenance?.nutrients.p2o5KgHa.toFixed(2) ?? "",
      row.maintenance?.nutrients.k2oKgHa.toFixed(2) ?? "",
      row.correction?.p2o5KgHa.toFixed(2) ?? "",
      row.correction?.k2oKgHa.toFixed(2) ?? "",
      row.warnings.length,
      "nutrient_planner_v2",
    ]);
    downloadText(
      "soil-intelligence-nutrient-planner-v2-farm-summary.csv",
      [headers, ...rows]
        .map((row) => row.map(csvCell).join(","))
        .join("\n"),
      "text/csv;charset=utf-8",
    );
  };

  if (!fieldModel || !currentEstimate) {
    return (
      <main className="planner-shell planner-v2">
        <button type="button" onClick={onBack}>
          ← Soil map
        </button>
        <p>No field model is available.</p>
      </main>
    );
  }

  const centralEconomics = economics?.central ?? null;
  const targetApplicationYear = future.years[0]?.year ?? 2027;
  const currentSensitivity = currentEstimate.status.modelSensitivity;
  const currentIndices = currentEstimate.status.indices;
  const staleTest = (currentEstimate.anchor.testAgeYears ?? 0) > 4;
  const selectedHighNeutralisingValue = manualApplications.some(
    (application) =>
      domainProducts.find((product) => product.id === application.productId)
        ?.substantialNeutralisingValue,
  );
  const responseModels = [
    ...new Map(
      future.years.map((year) => [
        year.crop,
        CROP_RESPONSE_CONFIGS[year.crop],
      ]),
    ).values(),
  ];

  return (
    <main className="planner-shell planner-v2">
      <header className="planner-topbar">
        <div>
          <button type="button" onClick={onBack}>
            ← Soil map
          </button>
          <span className="eyebrow">Improved nutrient planner</span>
          <h1>
            {plannerView === "summary"
              ? "Farm-wide v2 nutrient position"
              : "Traceable soil correction and investment plan"}
          </h1>
        </div>
        <div className="planner-actions">
          <div className="planner-view-switch" role="group" aria-label="V2 view">
            <button
              type="button"
              className={plannerView === "summary" ? "is-active" : ""}
              onClick={() => setPlannerView("summary")}
            >
              Farm summary
            </button>
            <button
              type="button"
              className={plannerView === "field" ? "is-active" : ""}
              onClick={() => setPlannerView("field")}
            >
              Field planner
            </button>
          </div>
          <button type="button" onClick={onShowLegacy}>
            Original planner
          </button>
          {plannerView === "summary" ? (
            <button type="button" onClick={exportFarmSummary}>
              Export v2 summary CSV
            </button>
          ) : (
            <>
              <button type="button" onClick={exportPlan}>
                Export v2 plan JSON
              </button>
              <button
                type="button"
                className="primary"
                disabled={saveState === "saving"}
                onClick={() => void savePlan()}
              >
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "saved"
                    ? "Saved"
                    : saveState === "error"
                      ? "Save failed"
                      : "Save v2 plan"}
              </button>
            </>
          )}
        </div>
      </header>

      {plannerView === "summary" ? (
        <section className="farm-summary v2-summary">
          <div className="farm-summary-intro">
            <div>
              <span className="eyebrow">All mapped fields retained</span>
              <h2>Coverage, indicative status, maintenance and correction</h2>
              <p>
                Every mapped field remains in the denominator. Economic totals
                are field-plan outputs and are not invented where an anchor,
                crop assumption, product effectiveness or complete cost is
                missing.
              </p>
            </div>
          </div>
          <div className="farm-summary-kpis">
            <article>
              <small>Total mapped area</small>
              <strong>{farmTotals.areaHa.toFixed(1)} ha</strong>
              <span>{farmRows.length} fields</span>
            </article>
            <article>
              <small>Area with valid P/K anchor</small>
              <strong>{farmTotals.validAnchorHa.toFixed(1)} ha</strong>
              <span>{farmTotals.missingAnchorHa.toFixed(1)} ha incomplete</span>
            </article>
            <article className={farmTotals.staleHa > 0 ? "is-warn" : ""}>
              <small>Stale tests</small>
              <strong>{farmTotals.staleHa.toFixed(1)} ha</strong>
              <span>Anchor more than four years old</span>
            </article>
            <article>
              <small>First-year maintenance</small>
              <strong>
                P {(farmTotals.maintenanceP / 1000).toFixed(1)} t · K{" "}
                {(farmTotals.maintenanceK / 1000).toFixed(1)} t
              </strong>
              <span>
                {farmTotals.incompleteMaintenanceFields} incomplete fields
              </span>
            </article>
            <article>
              <small>Correction to selected targets</small>
              <strong>
                P {(farmTotals.correctionP / 1000).toFixed(1)} t · K{" "}
                {(farmTotals.correctionK / 1000).toFixed(1)} t
              </strong>
              <span>
                P {pTargetMgL} mg/l · K {kTargetMgL} mg/l
              </span>
            </article>
            <article className={farmTotals.warningFields ? "is-warn" : ""}>
              <small>Fields with assumptions to review</small>
              <strong>{farmTotals.warningFields}</strong>
              <span>Effectiveness, removal or anchor warnings</span>
            </article>
            <article>
              <small>Saved improved plans</small>
              <strong>
                {savedV2FarmEconomics.plannedFields} fields ·{" "}
                {savedV2FarmEconomics.plannedAreaHa.toFixed(1)} ha
              </strong>
              <span>
                {(savedV2FarmEconomics.productKg / 1000).toFixed(1)} t total ·{" "}
                {Object.entries(savedV2FarmEconomics.annualProductKg)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(
                    ([year, amountKg]) =>
                      `${year}: ${(amountKg / 1000).toFixed(1)}t`,
                  )
                  .join(" · ") || "no application lines"}
              </span>
            </article>
            <article
              className={
                savedV2FarmEconomics.incompleteEconomicFields.size
                  ? "is-warn"
                  : ""
              }
            >
              <small>Saved plan NPV · low / central / high</small>
              <strong>
                {formatMoney(
                  savedV2FarmEconomics.plannedFields
                    ? savedV2FarmEconomics.npv.low
                    : null,
                )}{" "}
                ·{" "}
                {formatMoney(
                  savedV2FarmEconomics.plannedFields
                    ? savedV2FarmEconomics.npv.central
                    : null,
                )}{" "}
                ·{" "}
                {formatMoney(
                  savedV2FarmEconomics.plannedFields
                    ? savedV2FarmEconomics.npv.high
                    : null,
                )}
              </strong>
              <span>
                {savedV2FarmEconomics.incompleteEconomicFields.size} incomplete
                economic plans
              </span>
            </article>
            <article>
              <small>Central saved-plan value breakdown</small>
              <strong>
                Crop{" "}
                {formatMoney(
                  savedV2FarmEconomics.plannedFields
                    ? savedV2FarmEconomics.cropResponseValue
                    : null,
                )}{" "}
                · terminal{" "}
                {formatMoney(
                  savedV2FarmEconomics.plannedFields
                    ? savedV2FarmEconomics.terminalValue
                    : null,
                )}
              </strong>
              <span>
                Discounted total cost{" "}
                {formatMoney(
                  savedV2FarmEconomics.plannedFields
                    ? savedV2FarmEconomics.applicationCost
                  : null,
                )}
                {" "}· material{" "}
                {formatMoney(
                  savedV2FarmEconomics.plannedFields
                    ? savedV2FarmEconomics.materialCost
                    : null,
                )}
                {" "}· operations{" "}
                {formatMoney(
                  savedV2FarmEconomics.plannedFields
                    ? savedV2FarmEconomics.operationalCost
                    : null,
                )}
              </span>
            </article>
            <article>
              <small>Estimated area by current index</small>
              <strong>
                P{" "}
                {Object.entries(indexAreaSummary.p)
                  .map(([index, area]) => `${index}: ${area.toFixed(0)}ha`)
                  .join(" · ") || "incomplete"}
              </strong>
              <span>
                K{" "}
                {Object.entries(indexAreaSummary.k)
                  .map(([index, area]) => `${index}: ${area.toFixed(0)}ha`)
                  .join(" · ") || "incomplete"}
              </span>
            </article>
            <article
              className={
                lowConfidenceResponseFields ||
                savedV2FarmEconomics.missingCropFields.size
                  ? "is-warn"
                  : ""
              }
            >
              <small>Crop-response review</small>
              <strong>
                {lowConfidenceResponseFields} low-confidence fields
              </strong>
              <span>
                {savedV2FarmEconomics.missingCropFields.size} saved plans with
                crop warnings
              </span>
            </article>
            <article
              className={
                evidenceShiftFields || sensitivityBandShiftFields
                  ? "is-warn"
                  : ""
              }
            >
              <small>Index-range sensitivity</small>
              <strong>
                {evidenceShiftFields} evidence-case index shifts
              </strong>
              <span>
                {sensitivityBandShiftFields} fields span an index under
                low/high build coefficients
              </span>
            </article>
          </div>
          <div className="v2-farm-table">
            <div className="v2-farm-row v2-farm-head">
              <span>Field</span>
              <span>Anchor</span>
              <span>Indicative current P / K</span>
              <span>Maintenance P / K</span>
              <span>Correction P / K</span>
              <span>Warnings</span>
            </div>
            {farmRows.map((row) => (
              <button
                type="button"
                className="v2-farm-row"
                key={row.fieldId}
                onClick={() => {
                  setSelectedFieldId(row.fieldId);
                  setPlannerView("field");
                }}
              >
                <span>
                  <strong>{row.fieldName}</strong>
                  <small>{row.areaHa.toFixed(1)} ha</small>
                </span>
                <span>
                  {row.anchorValid ? (row.stale ? "Valid · stale" : "Valid") : "Missing"}
                </span>
                <span>
                  {row.current
                    ? `P ${row.current.pMgL.toFixed(0)} (${row.pIndex}) · K ${row.current.kMgL.toFixed(0)} (${row.kIndex})`
                    : "Not modelled"}
                </span>
                <span>
                  {row.maintenance
                    ? `P ${row.maintenance.nutrients.p2o5KgHa.toFixed(0)} · K ${row.maintenance.nutrients.k2oKgHa.toFixed(0)}`
                    : "Incomplete"}
                </span>
                <span>
                  {row.correction
                    ? `P ${row.correction.p2o5KgHa.toFixed(0)} · K ${row.correction.k2oKgHa.toFixed(0)}`
                    : "Incomplete"}
                </span>
                <span>{row.warnings.length || "—"}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="v2-field-layout">
          <aside className="v2-field-controls">
            <label>
              <span className="control-label">Field</span>
              <select
                value={fieldModel.fieldId}
                onChange={(event) => setSelectedFieldId(event.target.value)}
              >
                {nutrientData.fields.map((field) => (
                  <option value={field.fieldId} key={field.fieldId}>
                    {field.fieldName}
                  </option>
                ))}
              </select>
            </label>
            <div className="v2-anchor-card">
              <span className="eyebrow">Measured anchor</span>
              <strong>
                {currentEstimate.anchor.actualDate ?? "No valid P/K anchor"}
              </strong>
              <p>
                Requested {currentEstimate.anchor.requestedDate ?? "none"} · P{" "}
                {currentEstimate.anchor.pMgL ?? "—"} mg/l · K{" "}
                {currentEstimate.anchor.kMgL ?? "—"} mg/l
              </p>
              <small>{currentEstimate.anchor.measurementMethod}</small>
              {currentEstimate.anchor.warning && (
                <p className="planner-error">{currentEstimate.anchor.warning}</p>
              )}
            </div>
            <label>
              <span className="control-label">P target · mg/l</span>
              <input
                type="number"
                min={0}
                list="v2-p-target-options"
                value={pTargetMgL}
                onChange={(event) => setPTargetMgL(Number(event.target.value))}
              />
              <datalist id="v2-p-target-options">
                <option value={16}>Lower edge Index 2</option>
                <option value={20}>Middle Index 2</option>
              </datalist>
            </label>
            <label>
              <span className="control-label">K target · mg/l</span>
              <input
                type="number"
                min={0}
                list="v2-k-target-options"
                value={kTargetMgL}
                onChange={(event) => setKTargetMgL(Number(event.target.value))}
              />
              <datalist id="v2-k-target-options">
                <option value={121}>Lower edge Index 2−</option>
                <option value={150}>Middle Index 2−</option>
              </datalist>
            </label>
            <label>
              <span className="control-label">Correction staging</span>
              <select
                value={correctionYears}
                onChange={(event) =>
                  setCorrectionYears(Number(event.target.value))
                }
              >
                <option value={1}>1 year</option>
                <option value={3}>3 years</option>
                <option value={5}>5 years</option>
              </select>
            </label>
            <label>
              <span className="control-label">NPV horizon · years</span>
              <input
                type="number"
                min={1}
                max={30}
                list="v2-horizon-options"
                value={horizonYears}
                onChange={(event) =>
                  setHorizonYears(
                    Math.min(30, Math.max(1, Number(event.target.value) || 1)),
                  )
                }
              />
              <datalist id="v2-horizon-options">
                <option value={3} />
                <option value={5} />
                <option value={10} />
              </datalist>
            </label>
            {horizonYears > 3 && (
              <label className="v2-check">
                <input
                  type="checkbox"
                  checked={repeatRotation}
                  onChange={(event) => setRepeatRotation(event.target.checked)}
                />
                Explicitly repeat known rotation
              </label>
            )}
            <label>
              <span className="control-label">P/K interaction</span>
              <select
                value={interaction}
                onChange={(event) =>
                  setInteraction(event.target.value as InteractionMethod)
                }
              >
                <option value="multiplicative">Multiplicative · central</option>
                <option value="limiting_nutrient">
                  Limiting nutrient · sensitivity
                </option>
              </select>
            </label>
            <label>
              <span className="control-label">Discount rate</span>
              <div className="v2-input-suffix">
                <input
                  type="number"
                  min={0}
                  max={20}
                  step={0.5}
                  value={discountRatePct}
                  onChange={(event) =>
                    setDiscountRatePct(Number(event.target.value))
                  }
                />
                <span>%</span>
              </div>
            </label>
          </aside>

          <div className="v2-workspace">
            <aside className="v2-model-caution">
              <strong>
                Indicative modelled soil-test estimates, not substitute
                laboratory results.
              </strong>
              <span>
                Model sensitivity and sampling tolerance are shown separately.
                Next recommended comparable test:{" "}
                {addYears(currentEstimate.anchor.actualDate, 4)}.
              </span>
            </aside>

            <section className="v2-card-grid">
              <article className="planner-card">
                <small>Indicative current P</small>
                <strong>
                  {current?.pMgL.toFixed(1) ?? "—"} mg/l · Index{" "}
                  {currentIndices?.p ?? "—"}
                </strong>
                <span>
                  Model span{" "}
                  {currentSensitivity
                    ? `${currentSensitivity.pMgL.low.toFixed(1)}–${currentSensitivity.pMgL.high.toFixed(1)} mg/l`
                    : "incomplete"}
                </span>
                <span>Separate sampling tolerance: ±5 mg/l</span>
              </article>
              <article className="planner-card">
                <small>Indicative current K</small>
                <strong>
                  {current?.kMgL.toFixed(0) ?? "—"} mg/l · Index{" "}
                  {currentIndices?.k ?? "—"}
                </strong>
                <span>
                  Model span{" "}
                  {currentSensitivity
                    ? `${currentSensitivity.kMgL.low.toFixed(0)}–${currentSensitivity.kMgL.high.toFixed(0)} mg/l`
                    : "incomplete"}
                </span>
                <span>Separate sampling tolerance: ±25 mg/l</span>
              </article>
              <article className="planner-card">
                <small>Application evidence cases</small>
                <strong>
                  {currentEstimate.status.includedApplications.confirmed} confirmed ·{" "}
                  {currentEstimate.status.includedApplications.probable} probable ·{" "}
                  {currentEstimate.status.includedApplications.inferred} inferred
                </strong>
                <span>
                  Confirmed-only P{" "}
                  {currentEstimate.status.confirmedOnly?.pMgL.toFixed(1) ?? "—"} /
                  K{" "}
                  {currentEstimate.status.confirmedOnly?.kMgL.toFixed(0) ?? "—"}
                </span>
                <span>
                  Inclusive P{" "}
                  {currentEstimate.status.inclusive?.pMgL.toFixed(1) ?? "—"} /
                  K {currentEstimate.status.inclusive?.kMgL.toFixed(0) ?? "—"}
                </span>
                <span>
                  Included centrally:{" "}
                  {currentEstimate.status.applicationTrace.central.join("; ") ||
                    "no recorded P/K applications"}
                </span>
              </article>
              <article className="planner-card">
                <small>Test age and trace</small>
                <strong>
                  {currentEstimate.anchor.testAgeYears?.toFixed(1) ?? "—"} years
                  {staleTest ? " · stale" : ""}
                </strong>
                <span>
                  Crop/straw removal years:{" "}
                  {currentEstimate.status.includedRemovalYears.join(", ") ||
                    "none"}
                </span>
                <span>
                  P coefficient {coefficients.p.centralKgPerHaPerMgL} · K{" "}
                  {coefficients.k.centralKgPerHaPerMgL} kg/ha per mg/l
                </span>
              </article>
            </section>

            <section className="planner-card">
              <div className="planner-section-heading">
                <div>
                  <span className="eyebrow">Maintenance and correction</span>
                  <h2>Separate nutrient accounts</h2>
                </div>
              </div>
              <div className="v2-account-grid">
                <article>
                  <small>First-year maintenance</small>
                  <strong>
                    P{" "}
                    {formatNutrient(
                      accounts?.maintenance.nutrients.p2o5KgHa ?? 0,
                    )}{" "}
                    · K{" "}
                    {formatNutrient(
                      accounts?.maintenance.nutrients.k2oKgHa ?? 0,
                    )}
                  </strong>
                  <span>
                    {accounts?.maintenance.complete
                      ? "Grain and removed biomass represented"
                      : accounts?.maintenance.warning ?? "Incomplete crop"}
                  </span>
                </article>
                <article>
                  <small>Remaining corrective build</small>
                  <strong>
                    P {formatNutrient(accounts?.correction.p2o5KgHa ?? 0)} · K{" "}
                    {formatNutrient(accounts?.correction.k2oKgHa ?? 0)}
                  </strong>
                  <span>
                    Staged over {correctionYears} year
                    {correctionYears === 1 ? "" : "s"} to P {pTargetMgL} / K{" "}
                    {kTargetMgL} mg/l
                  </span>
                </article>
              </div>
            </section>

            <section className="planner-card">
              <div className="planner-section-heading">
                <div>
                  <span className="eyebrow">Application evidence sensitivity</span>
                  <h2>Recorded-evidence effect on correction and NPV</h2>
                </div>
              </div>
              <div className="v2-comparison-grid">
                {evidenceCaseComparisons.map((comparison) => (
                  <article key={comparison.label}>
                    <small>{comparison.label}</small>
                    <strong>
                      {comparison.status
                        ? `P ${comparison.status.pMgL.toFixed(1)} · K ${comparison.status.kMgL.toFixed(0)} mg/l`
                        : "Incomplete"}
                    </strong>
                    <span>
                      Remaining correction P{" "}
                      {comparison.correction
                        ? comparison.correction.p2o5KgHa.toFixed(0)
                        : "—"}{" "}
                      · K{" "}
                      {comparison.correction
                        ? comparison.correction.k2oKgHa.toFixed(0)
                        : "—"}{" "}
                      kg/ha
                    </span>
                    <span>Central NPV {formatMoney(comparison.npv)}/ha</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="planner-card">
              <div className="planner-section-heading">
                <div>
                  <span className="eyebrow">Product plan</span>
                  <h2>Manual applications and least-cost alternatives</h2>
                </div>
                <button type="button" onClick={runOptimizer}>
                  Find least-cost alternatives
                </button>
              </div>
              {Number.isFinite(measuredPh) &&
                measuredPh >= 7 &&
                selectedHighNeutralisingValue && (
                  <p className="planner-error">
                    This plan includes a product with substantial neutralising
                    value on a high-pH field. Review product suitability.
                  </p>
                )}
              {Number.isFinite(measuredPh) && measuredPh < 6 && (
                <p className="planner-error">
                  Low pH may constrain P effectiveness; no lime rate has been
                  inferred from pH alone.
                </p>
              )}
              <p>
                Optimiser requirements combine first-year maintenance with the
                selected share of corrective build. Missing effectiveness or
                delivered-and-applied cost makes a product infeasible.
              </p>
              <div className="v2-application-list">
                {manualApplications.map((application) => {
                  const product = products.find(
                    (candidate) => candidate.id === application.productId,
                  );
                  const productModel = domainProducts.find(
                    (candidate) => candidate.id === application.productId,
                  );
                  const nutrients = productModel
                    ? applicationNutrients(
                        [
                          {
                            product: productModel,
                            rateKgHa: application.rateKgHa,
                            purpose: application.purpose,
                          },
                        ],
                        "central",
                      )
                    : null;
                  return (
                    <article key={application.id} className="v2-application-line">
                      <label>
                        Product
                        <select
                          value={application.productId}
                          onChange={(event) =>
                            setManualApplications((lines) =>
                              lines.map((line) =>
                                line.id === application.id
                                  ? { ...line, productId: event.target.value }
                                  : line,
                              ),
                            )
                          }
                        >
                          {products.map((candidate) => (
                            <option value={candidate.id} key={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Year
                        <input
                          type="number"
                          value={application.year}
                          onChange={(event) =>
                            setManualApplications((lines) =>
                              lines.map((line) =>
                                line.id === application.id
                                  ? {
                                      ...line,
                                      year: Number(event.target.value),
                                    }
                                  : line,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Timing
                        <input
                          type="date"
                          value={
                            application.timing ??
                            `${application.year}-01-01`
                          }
                          onChange={(event) =>
                            setManualApplications((lines) =>
                              lines.map((line) =>
                                line.id === application.id
                                  ? {
                                      ...line,
                                      timing: event.target.value,
                                      year:
                                        Number(
                                          event.target.value.slice(0, 4),
                                        ) || line.year,
                                    }
                                  : line,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Rate kg/ha
                        <input
                          type="number"
                          min={0}
                          value={application.rateKgHa}
                          onChange={(event) =>
                            setManualApplications((lines) =>
                              lines.map((line) =>
                                line.id === application.id
                                  ? {
                                      ...line,
                                      rateKgHa: Number(event.target.value),
                                    }
                                  : line,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Account
                        <select
                          value={application.purpose}
                          onChange={(event) =>
                            setManualApplications((lines) =>
                              lines.map((line) =>
                                line.id === application.id
                                  ? {
                                      ...line,
                                      purpose: event.target
                                        .value as V2ManualApplication["purpose"],
                                    }
                                  : line,
                              ),
                            )
                          }
                        >
                          <option value="maintenance">Maintenance</option>
                          <option value="correction">Correction</option>
                          <option value="combined">Combined</option>
                        </select>
                      </label>
                      <div>
                        <strong>
                          P{" "}
                          {nutrients?.effectiveBuild.p2o5KgHa.toFixed(0) ?? "—"}{" "}
                          · K{" "}
                          {nutrients?.effectiveBuild.k2oKgHa.toFixed(0) ?? "—"}{" "}
                          effective kg/ha
                        </strong>
                        <small>
                          {nutrients?.complete
                            ? product?.priceBasis
                            : nutrients?.assumptions.join("; ") ||
                              "Product assumption incomplete"}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setManualApplications((lines) =>
                            lines.filter((line) => line.id !== application.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </article>
                  );
                })}
                <button
                  type="button"
                  onClick={() =>
                    setManualApplications((lines) => [
                      ...lines,
                      {
                        id: `v2-application-${Date.now()}`,
                        year: targetApplicationYear,
                        timing: `${targetApplicationYear}-01-01`,
                        productId: products[0]?.id ?? "",
                        rateKgHa: 0,
                        purpose: "combined",
                      },
                    ])
                  }
                >
                  + Add application
                </button>
              </div>
              {optimizerCandidates.length > 0 && (
                <div className="v2-optimiser-results">
                  {optimizerCandidates.map((candidate, index) => (
                    <article key={`${candidate.nameKey}-${index}`}>
                      <small>Option {index + 1}</small>
                      <strong>{candidate.nameKey}</strong>
                      <span>
                        {candidate.applications
                          .map(
                            (application) =>
                              `${application.product.name} ${application.rateKgHa.toFixed(0)} kg/ha`,
                          )
                          .join(" + ")}
                      </span>
                      <span>
                        {formatMoney(candidate.totalCost)}/ha ·{" "}
                        {candidate.passes} pass
                        {candidate.passes === 1 ? "" : "es"}
                      </span>
                      <button
                        type="button"
                        onClick={() => applyCandidate(candidate)}
                      >
                        Use this option
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="planner-card">
              <div className="planner-section-heading">
                <div>
                  <span className="eyebrow">Annual trajectory</span>
                  <h2>Untreated and treated soil, yield and cash flow</h2>
                </div>
              </div>
              {future.incompleteYears.length > 0 && (
                <p className="planner-error">
                  Missing crop assumptions for{" "}
                  {future.incompleteYears.join(", ")}. Enable rotation repeat
                  explicitly or shorten the horizon.
                </p>
              )}
              <div className="v2-trajectory-table">
                <div className="v2-trajectory-row v2-trajectory-head">
                  <span>Year / crop</span>
                  <span>Untreated → treated P</span>
                  <span>Untreated → treated K</span>
                  <span>Yield untreated → treated</span>
                  <span>Crop value</span>
                  <span>Application cost</span>
                  <span>Discounted net</span>
                </div>
                {centralEconomics?.annual.map((year) => (
                  <div className="v2-trajectory-row" key={year.year}>
                    <span>
                      <strong>{year.year}</strong>
                      <small>{year.crop.replaceAll("_", " ")}</small>
                    </span>
                    <span>
                      {year.untreatedStatus.pMgL.toFixed(1)} (
                      {phosphorusIndex(year.untreatedStatus.pMgL)}) →{" "}
                      {year.treatedStatus.pMgL.toFixed(1)} (
                      {phosphorusIndex(year.treatedStatus.pMgL)})
                    </span>
                    <span>
                      {year.untreatedStatus.kMgL.toFixed(0)} (
                      {potassiumIndex(year.untreatedStatus.kMgL)}) →{" "}
                      {year.treatedStatus.kMgL.toFixed(0)} (
                      {potassiumIndex(year.treatedStatus.kMgL)})
                    </span>
                    <span>
                      {year.untreatedYieldTPerHa.toFixed(2)} →{" "}
                      {year.treatedYieldTPerHa.toFixed(2)} t/ha
                    </span>
                    <span>
                      {formatMoney(year.incrementalCropValue)}/ha
                      <small>
                        Grain {formatMoney(year.incrementalGrainValue)} · straw{" "}
                        {formatMoney(year.incrementalStrawValue)}
                      </small>
                    </span>
                    <span>{formatMoney(year.applicationCost)}/ha</span>
                    <span>{formatMoney(year.discountedNetCashFlow)}/ha</span>
                  </div>
                ))}
              </div>
              <div className="v2-annual-inputs">
                {future.years.map((year) => {
                  const yearKey = String(year.year);
                  const override = cropOverridesByYear[yearKey] ?? {};
                  const strawLine = year.removals.find(
                    (removal) => removal.material === "straw",
                  );
                  return (
                    <fieldset key={`assumptions-${year.year}`}>
                      <legend>
                        {year.year} · {year.crop.replaceAll("_", " ")}
                      </legend>
                      <label>
                        {year.crop === "grass"
                          ? "Removed forage / attainable yield t/ha"
                          : "Expected grain yield t/ha"}
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={
                            override.yieldTPerHa ??
                            year.expectedYieldTPerHa
                          }
                          onChange={(event) =>
                            setCropOverridesByYear((values) => ({
                              ...values,
                              [yearKey]: {
                                ...values[yearKey],
                                yieldTPerHa: Number(event.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        Crop price £/t
                        <input
                          type="number"
                          min={0}
                          value={year.cropPricePerTonne ?? ""}
                          onChange={(event) =>
                            setCropValuesByYear((values) => ({
                              ...values,
                              [yearKey]: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      {year.crop === "grass" && (
                        <label>
                          Grass management
                          <select
                            value={override.grassManagement ?? "unknown"}
                            onChange={(event) =>
                              setCropOverridesByYear((values) => ({
                                ...values,
                                [yearKey]: {
                                  ...values[yearKey],
                                  grassManagement: event.target
                                    .value as NonNullable<
                                    V2CropOverride["grassManagement"]
                                  >,
                                },
                              }))
                            }
                          >
                            <option value="unknown">Unknown · incomplete</option>
                            <option value="grazed_only">Grazed only</option>
                            <option value="silage">Silage</option>
                            <option value="hay">Hay</option>
                            <option value="mixed">Mixed</option>
                            <option value="custom">Custom</option>
                          </select>
                        </label>
                      )}
                      {year.crop !== "grass" && (
                        <>
                          <label className="v2-check">
                            <input
                              type="checkbox"
                              checked={
                                override.strawRemoved ??
                                Boolean(strawLine)
                              }
                              onChange={(event) =>
                                setCropOverridesByYear((values) => ({
                                  ...values,
                                  [yearKey]: {
                                    ...values[yearKey],
                                    strawRemoved: event.target.checked,
                                  },
                                }))
                              }
                            />
                            Straw removed
                          </label>
                          <label>
                            Removed straw t/ha
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              disabled={
                                !(
                                  override.strawRemoved ??
                                  Boolean(strawLine)
                                )
                              }
                              value={
                                override.strawTPerHa ??
                                strawLine?.yieldTPerHa ??
                                0
                              }
                              onChange={(event) =>
                                setCropOverridesByYear((values) => ({
                                  ...values,
                                  [yearKey]: {
                                    ...values[yearKey],
                                    strawTPerHa: Number(event.target.value),
                                  },
                                }))
                              }
                            />
                          </label>
                          <label>
                            Removed straw price £/t
                            <input
                              type="number"
                              min={0}
                              disabled={
                                !(
                                  override.strawRemoved ??
                                  Boolean(strawLine)
                                )
                              }
                              value={override.strawPricePerTonne ?? ""}
                              onChange={(event) =>
                                setCropOverridesByYear((values) => ({
                                  ...values,
                                  [yearKey]: {
                                    ...values[yearKey],
                                    strawPricePerTonne: numberOrNull(
                                      event.target.value,
                                    ),
                                  },
                                }))
                              }
                            />
                          </label>
                        </>
                      )}
                    </fieldset>
                  );
                })}
              </div>
            </section>

            <section className="v2-card-grid">
              {(["low", "central", "high"] as const).map((scenario) => (
                <article className="planner-card" key={scenario}>
                  <small>{scenario} NPV scenario</small>
                  <strong>{formatMoney(economics?.[scenario].npv ?? null)}/ha</strong>
                  <span>
                    Crop response{" "}
                    {formatMoney(
                      economics?.[scenario].discountedCropResponseValue ?? null,
                    )}{" "}
                    · applications{" "}
                    {formatMoney(
                      economics?.[scenario].discountedApplicationCost ?? null,
                    )}
                  </span>
                  <span>
                    Terminal soil capital{" "}
                    {formatMoney(
                      economics?.[scenario]
                        .discountedTerminalSoilCapitalValue ?? null,
                    )}
                  </span>
                  {!economics?.[scenario].complete && (
                    <span>
                      {economics?.[scenario].warnings.join("; ") ||
                        "Scenario incomplete"}
                    </span>
                  )}
                </article>
              ))}
            </section>

            <section className="planner-card">
              <div className="planner-section-heading">
                <div>
                  <span className="eyebrow">Original versus improved</span>
                  <h2>Model comparison for this field</h2>
                </div>
                <button
                  type="button"
                  disabled={copyState === "copying"}
                  onClick={() => void copyLegacyPlan()}
                >
                  {copyState === "copying"
                    ? "Copying…"
                    : copyState === "copied"
                      ? "Copied into v2"
                      : "Copy original plan into v2"}
                </button>
              </div>
              <div className="v2-comparison-grid">
                <article>
                  <small>Original planner · saved output</small>
                  <strong>
                    P{" "}
                    {legacySummary?.latestEstimatedP?.central?.toFixed(1) ??
                      "not saved"}{" "}
                    · K{" "}
                    {legacySummary?.latestEstimatedK?.central?.toFixed(0) ??
                      "not saved"}{" "}
                    mg/l
                  </strong>
                  <span>
                    NPV{" "}
                    {formatMoney(
                      legacySummary?.npvGbpPerHa?.central ?? null,
                    )}
                    /ha
                  </span>
                </article>
                <article>
                  <small>Improved planner</small>
                  <strong>
                    P {current?.pMgL.toFixed(1) ?? "—"} · K{" "}
                    {current?.kMgL.toFixed(0) ?? "—"} mg/l
                  </strong>
                  <span>
                    NPV {formatMoney(economics?.central.npv ?? null)}/ha
                  </span>
                </article>
              </div>
              <p>
                Divergence is expected: v2 uses 50 kg P₂O₅ and 10 kg K₂O per
                mg/l central planning coefficients, whole-record evidence
                cases, explicit product effectiveness, sequential crop-specific
                responses, costs in each year and discounted terminal soil
                capital. The original model uses its preserved recovery and
                three-harvest proxy.
              </p>
              {legacyPlan?.migrationWarnings?.map((warning) => (
                <p className="planner-error" key={warning}>
                  {warning}
                </p>
              ))}
            </section>

            <section className="planner-card">
              <div className="planner-section-heading">
                <div>
                  <span className="eyebrow">Evidence and assumptions</span>
                  <h2>Editable planning coefficients and operational costs</h2>
                </div>
              </div>
              <div className="v2-assumption-grid">
                {(["p", "k"] as const).map((nutrient) => (
                  <fieldset key={nutrient}>
                    <legend>{nutrient.toUpperCase()} soil-build coefficient</legend>
                    {[
                      ["optimisticKgPerHaPerMgL", "Optimistic"],
                      ["centralKgPerHaPerMgL", "Central"],
                      ["conservativeKgPerHaPerMgL", "Conservative"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          min={1}
                          value={
                            coefficients[nutrient][
                              key as
                                | "optimisticKgPerHaPerMgL"
                                | "centralKgPerHaPerMgL"
                                | "conservativeKgPerHaPerMgL"
                            ]
                          }
                          onChange={(event) =>
                            setCoefficients((values) => ({
                              ...values,
                              [nutrient]: {
                                ...values[nutrient],
                                [key]: Number(event.target.value),
                                calibratedForField: true,
                                source: "User-edited field planning coefficient",
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                    <small>{coefficients[nutrient].interpretation}</small>
                  </fieldset>
                ))}
                <fieldset>
                  <legend>Delivered-and-applied cost assumptions</legend>
                  {(
                    [
                      ["haulagePerTonne", "Haulage £/t"],
                      ["handlingPerTonne", "Handling £/t"],
                      ["spreadingPerTonne", "Spreading £/t"],
                      ["spreadingPerHa", "Spreading £/ha"],
                      ["fixedPassCostPerHa", "Fixed pass £/ha"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        value={operationalCosts[key] ?? ""}
                        onChange={(event) =>
                          setOperationalCosts((values) => ({
                            ...values,
                            [key]: numberOrNull(event.target.value),
                          }))
                        }
                      />
                    </label>
                  ))}
                  <small>
                    These are visible farm planning assumptions. Clearing a
                    value makes the cost incomplete; it is not replaced by zero.
                  </small>
                </fieldset>
                <fieldset>
                  <legend>Recycled P/K effectiveness</legend>
                  <label className="v2-check">
                    <input
                      type="checkbox"
                      checked={useRecycledOverride}
                      onChange={(event) =>
                        setUseRecycledOverride(event.target.checked)
                      }
                    />
                    Enable explicit farm assumption
                  </label>
                  {(
                    [
                      [
                        "firstYearPAvailability",
                        "First-year P",
                      ],
                      ["longTermPBuildRae", "Long-term P build"],
                      ["kAvailability", "K availability"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <span>{label}</span>
                      {(["low", "central", "high"] as const).map((scenario) => (
                        <label key={scenario}>
                          {scenario}
                          <input
                            type="number"
                            min={0}
                            max={1.5}
                            step={0.05}
                            value={recycledOverride[key][scenario]}
                            onChange={(event) =>
                              setRecycledOverride((value) => ({
                                ...value,
                                [key]: {
                                  ...value[key],
                                  [scenario]: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                  <small>
                    Disabled by default: recycled products are not silently
                    equated with TSP.
                  </small>
                </fieldset>
                <fieldset>
                  <legend>Grass response sensitivity</legend>
                  <label className="v2-check">
                    <input
                      type="checkbox"
                      disabled={!grassResponseReady}
                      checked={effectiveGrassResponseEnabled}
                      onChange={(event) =>
                        setGrassResponseEnabled(event.target.checked)
                      }
                    />
                    Explicitly monetise the low-confidence grass P/K response
                  </label>
                  <small>
                    {grassResponseReady
                      ? "Cut-forage management and removed yield are modelled. The assumption is recorded in the plan."
                      : "Disabled until a grass forecast year has silage, hay, mixed or custom management and a removed forage yield."}
                  </small>
                </fieldset>
              </div>
              <div className="v2-response-evidence">
                {responseModels.map((model) => (
                  <article key={model.crop}>
                    <strong>{model.crop.replaceAll("_", " ")}</strong>
                    <span>
                      {model.modelType} · {model.evidenceStrength} evidence
                    </span>
                    <small>{model.transferabilityNote}</small>
                    <small>Source: {model.source}</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="planner-card">
              <span className="eyebrow">Soil, pH and structure metadata</span>
              <h2>Optional response constraints</h2>
              <div className="v2-metadata-grid">
                <label>
                  Soil class
                  <select
                    value={soilMetadata.soilClass}
                    onChange={(event) =>
                      setSoilMetadata((value) => ({
                        ...value,
                        soilClass: event.target
                          .value as typeof soilMetadata.soilClass,
                      }))
                    }
                  >
                    <option value="unknown">Unknown</option>
                    <option value="mineral">Mineral</option>
                    <option value="organic">Organic</option>
                    <option value="peaty">Peaty</option>
                  </select>
                </label>
                <label>
                  Texture class
                  <input
                    value={soilMetadata.textureClass}
                    onChange={(event) =>
                      setSoilMetadata((value) => ({
                        ...value,
                        textureClass: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Drainage / structure rating
                  <input
                    value={soilMetadata.drainageOrStructureRating}
                    onChange={(event) =>
                      setSoilMetadata((value) => ({
                        ...value,
                        drainageOrStructureRating: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Rooting constraint
                  <input
                    value={soilMetadata.rootingConstraint}
                    onChange={(event) =>
                      setSoilMetadata((value) => ({
                        ...value,
                        rootingConstraint: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Rooting response modifier
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={soilMetadata.rootingModifier}
                    onChange={(event) =>
                      setSoilMetadata((value) => ({
                        ...value,
                        rootingModifier: Math.min(
                          1,
                          Math.max(0, Number(event.target.value)),
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  Lime requirement t/ha
                  <input
                    type="number"
                    value={soilMetadata.limeRequirementTPerHa ?? ""}
                    onChange={(event) =>
                      setSoilMetadata((value) => ({
                        ...value,
                        limeRequirementTPerHa: numberOrNull(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Lime-requirement source
                  <input
                    value={soilMetadata.limeRequirementSource}
                    onChange={(event) =>
                      setSoilMetadata((value) => ({
                        ...value,
                        limeRequirementSource: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <p>
                Measured pH: {Number.isFinite(measuredPh) ? measuredPh : "not available"}.
                No lime requirement is inferred from pH alone.{" "}
                {!soilMetadata.drainageOrStructureRating &&
                  "Drainage and structure information is missing and response transferability remains uncertain."}
              </p>
              <label>
                Field plan notes
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </section>
          </div>
        </section>
      )}
    </main>
  );
}
