"use client";

import { useEffect, useState } from "react";
import {
  combineNutrientResponses,
  creditableNutrientKgHa,
  defaultCropValue,
  estimateIndexImprovementResponse,
  responseIndexFromPpm,
  valueThreeYearNpv,
  type EstimateRange,
} from "../../nutrient-economics";
import {
  aggregateFarmSummary,
  buildPostHarvestSoilScoresCsv,
  fieldCorrectionStatus,
  hasKDeficit,
  hasPDeficit,
  rowMatchesFilter,
  type FarmSummaryFilter,
  type FarmSummaryRow,
} from "../../nutrient-summary";

type SoilResult = {
  dateSort: string;
  date?: string;
  pValue?: number | string;
  pIndex?: number | string;
  kValue?: number | string;
  kIndex?: number | string;
  mgValue?: number | string;
  mgIndex?: number | string;
  ph?: number | string;
};

type SoilField = {
  id: string;
  canonicalId?: string;
  name: string;
  areaHa: number;
  results: SoilResult[];
};

type Nutrients = {
  n?: number;
  p2o5?: number;
  k2o?: number;
  so3?: number;
  mgo?: number;
  cao?: number;
  neutralisingValue?: number;
};

type Rotation = {
  year: number;
  crop: string;
  cropGroup: string;
  forecast: boolean;
  economicForecast?: boolean;
  fallbackComposite?: boolean;
  includeInProjection: boolean;
  yieldTPerHa: number;
  yieldSource: string;
  yieldUncertaintyPct: number;
  yieldLabel: string;
  strawRemoved: boolean;
  strawTPerHa: number;
  offtake: {
    grainP2o5KgPerT: number;
    grainK2oKgPerT: number;
    strawP2o5KgPerT: number;
    strawK2oKgPerT: number;
  };
};

type RecordedApplication = {
  id: string;
  date: string | null;
  cropYear: number | null;
  productName: string;
  rateKgHa: number;
  evidence: string;
  nutrientsKgHa: Required<Nutrients>;
};

type FieldModel = {
  fieldId: string;
  canonicalId: string | null;
  fieldName: string;
  testDate: string | null;
  testDatePrecision?: string;
  rotations: Rotation[];
  recordedApplications: RecordedApplication[];
};

type Product = {
  id: string;
  name: string;
  category: string;
  pricePerTonne: number | null;
  priceBasis: string;
  applicationCostPerHa?: number | null;
  defaultUnit?: "kg/ha" | "t/ha";
  nutrients: Nutrients;
  note?: string;
};

export type NutrientData = {
  schemaVersion: string;
  generatedAt: string;
  modelAsAt: string;
  sources: {
    rotation: string;
    harvest: string;
    recordedApplications: string;
    privateProducts: string;
    publicPrices: { label: string; href: string };
    offtake: { label: string; href: string };
    organicMaterials?: { label: string; href: string };
    yieldResponse?: { label: string; href: string };
    yieldResponseComparison?: { label: string; href: string };
    cropValue?: { label: string; href: string };
  };
  model: {
    indexBuildAllowanceKgHaPerYear: {
      index0: number;
      index1: number;
      source: string;
    };
    soilMass: {
      p2o5KgPerHaPerMgLAtFullRecovery: number;
      k2oKgPerHaPerMgLAtFullRecovery: number;
    };
    recoveryRanges: {
      p: { low: number; central: number; high: number };
      k: { low: number; central: number; high: number };
      note: string;
    };
    economics: {
      referenceCrop: string;
      referenceYieldTPerHa: number;
      priceUncertaintyPct: number;
      discountRatePct: number;
      cropValueDefaultsGbpPerTonne: Record<string, number>;
      combinedCentralCapFraction: number;
      combinedHighCapFraction: number;
      responsePriorsTPerHaAt8T: Record<
        "p" | "k",
        Record<string, { central: number; high: number }>
      >;
      note: string;
    };
  };
  products: Product[];
  fields: FieldModel[];
};

type CropAdjustment = {
  included: boolean;
  yieldTPerHa: number;
  yieldUncertaintyPct: number;
  strawRemoved: boolean;
  strawTPerHa: number;
};

type ProposedApplication = {
  id: string;
  productId: string;
  rate: number;
  unit: "kg/ha" | "t/ha";
  timing: string;
  priceOverride: number | null;
  applicationCostPerHa?: number;
};

type FieldPlan = {
  fieldId: string;
  cropAdjustments: Record<string, CropAdjustment>;
  proposedApplications: ProposedApplication[];
  economics: {
    cropValuePerTonne: number;
    priceUncertaintyPct: number;
    discountRatePct: number;
    cropValuesByYear: Record<string, number>;
  };
  economicSummary?: EconomicSummary;
  notes: string;
  updatedAt?: string;
};

type Balance = {
  central: number;
  low: number;
  high: number;
};

type AnnualEconomicSummary = {
  year: number;
  crop: string;
  cropGroup: string;
  modelBasis: string;
  referenceYieldTPerHa: number;
  cropValuePerTonne: number;
  untreatedP: Balance;
  treatedP: Balance;
  untreatedK: Balance;
  treatedK: Balance;
  pYieldGainTPerHa: EstimateRange;
  kYieldGainTPerHa: EstimateRange;
  combinedYieldGainTPerHa: EstimateRange;
  revenueGbpPerHa: EstimateRange;
  netCashFlowGbpPerHa: EstimateRange;
  presentValueGbpPerHa: EstimateRange;
};

type EconomicSummary = {
  valuationHorizon: string;
  priceUncertaintyPct: number;
  discountRatePct: number;
  latestEstimatedP: Balance;
  latestEstimatedK: Balance;
  postApplicationP: Balance;
  postApplicationK: Balance;
  annual: AnnualEconomicSummary[];
  planCostGbpPerHa: number | null;
  npvGbpPerHa: EstimateRange | null;
  modelBasis: string;
};

const emptyNutrients = (): Required<Nutrients> => ({
  n: 0,
  p2o5: 0,
  k2o: 0,
  so3: 0,
  mgo: 0,
  cao: 0,
  neutralisingValue: 0,
});

const addNutrients = (
  total: Required<Nutrients>,
  addition: Nutrients,
  multiplier = 1,
) => {
  (Object.keys(total) as (keyof Required<Nutrients>)[]).forEach((key) => {
    total[key] += (addition[key] ?? 0) * multiplier;
  });
  return total;
};

const numberValue = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const indexFromPpm = (metric: "p" | "k", value: number) => {
  const bands =
    metric === "p"
      ? [9, 15, 25, 45, 70, 100, 140, 200, 280]
      : [60, 120, 180, 240, 400, 600, 900, 1500, 2400, 3600];
  const band = bands.findIndex((upper) => value <= upper);
  if (metric === "k") {
    if (band === 2) return 1.7;
    if (band === 3) return 2.3;
    return band < 0 ? 9 : band;
  }
  return band < 0 ? 9 : band;
};

const indexLabel = (value: number) => {
  if (value === 1.7) return "2−";
  if (value === 2.3) return "2+";
  return String(value);
};

const latestPKResult = (field: SoilField, testDate: string | null) =>
  [...field.results]
    .filter(
      (result) =>
        (!testDate || result.dateSort === testDate) &&
        (result.pValue !== undefined || result.kValue !== undefined),
    )
    .sort((a, b) => a.dateSort.localeCompare(b.dateSort))
    .at(-1) ??
  [...field.results]
    .filter(
      (result) => result.pValue !== undefined || result.kValue !== undefined,
    )
    .sort((a, b) => a.dateSort.localeCompare(b.dateSort))
    .at(-1) ??
  null;

const defaultPlan = (fieldModel: FieldModel): FieldPlan => ({
  fieldId: fieldModel.fieldId,
  cropAdjustments: Object.fromEntries(
    fieldModel.rotations.map((rotation) => [
      String(rotation.year),
      {
        included: rotation.includeInProjection,
        yieldTPerHa: rotation.yieldTPerHa,
        yieldUncertaintyPct: rotation.yieldUncertaintyPct,
        strawRemoved: rotation.strawRemoved,
        strawTPerHa: rotation.strawTPerHa,
      },
    ]),
  ),
  proposedApplications: [],
  economics: {
    cropValuePerTonne: defaultCropValue(
      fieldModel.rotations.find((rotation) => rotation.economicForecast)
        ?.cropGroup ?? "",
    ),
    priceUncertaintyPct: 10,
    discountRatePct: 5,
    cropValuesByYear: Object.fromEntries(
      fieldModel.rotations
        .filter((rotation) => rotation.economicForecast)
        .map((rotation) => [
          String(rotation.year),
          defaultCropValue(rotation.cropGroup),
        ]),
    ),
  },
  notes: "",
});

const mergePlan = (
  model: FieldModel,
  saved: FieldPlan | undefined,
): FieldPlan => {
  const fallback = defaultPlan(model);
  if (!saved) return fallback;
  return {
    ...fallback,
    ...saved,
    cropAdjustments: {
      ...fallback.cropAdjustments,
      ...saved.cropAdjustments,
    },
    proposedApplications: saved.proposedApplications ?? [],
    economics: {
      ...fallback.economics,
      ...saved.economics,
      cropValuesByYear: {
        ...fallback.economics.cropValuesByYear,
        ...saved.economics?.cropValuesByYear,
      },
    },
  };
};

const formatKg = (value: number) =>
  `${value.toLocaleString("en-GB", {
    maximumFractionDigits: 0,
  })} kg/ha`;

const formatMoney = (value: number) =>
  value.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: Math.abs(value) > 0 && Math.abs(value) < 10 ? 2 : 0,
  });

const formatYieldRange = (range: EstimateRange) =>
  `${range.central.toFixed(2)} t/ha · ${range.low.toFixed(2)}–${range.high.toFixed(
    2,
  )}`;

const formatMoneyRange = (range: EstimateRange) =>
  `${formatMoney(range.central)}/ha · ${formatMoney(range.low)}–${formatMoney(
    range.high,
  )}`;

function StatusEstimate({
  title,
  subtitle,
  p,
  k,
}: {
  title: string;
  subtitle: string;
  p: Balance;
  k: Balance;
}) {
  return (
    <article className="planner-estimate">
      <div>
        <span className="control-label">{title}</span>
        <small>{subtitle}</small>
      </div>
      <div className="planner-estimate-metrics">
        <span>
          <i>P</i>
          <strong>Index {indexLabel(indexFromPpm("p", p.central))}</strong>
          <small>
            {p.central.toFixed(0)} mg/L · {p.low.toFixed(0)}–{p.high.toFixed(0)}
          </small>
        </span>
        <span>
          <i>K</i>
          <strong>Index {indexLabel(indexFromPpm("k", k.central))}</strong>
          <small>
            {k.central.toFixed(0)} mg/L · {k.low.toFixed(0)}–{k.high.toFixed(0)}
          </small>
        </span>
      </div>
    </article>
  );
}

export default function NutrientPlannerLegacy({
  soilFields,
  nutrientData,
  onBack,
}: {
  soilFields: SoilField[];
  nutrientData: NutrientData;
  onBack: () => void;
}) {
  const selectableModels = nutrientData.fields.filter((field) => field.testDate);
  const [selectedFieldId, setSelectedFieldId] = useState(
    selectableModels[0]?.fieldId ?? "",
  );
  const [plannerView, setPlannerView] = useState<"summary" | "field">(
    "summary",
  );
  const [summaryFieldIds, setSummaryFieldIds] = useState(
    selectableModels.map((field) => field.fieldId),
  );
  const [summaryFilter, setSummaryFilter] =
    useState<FarmSummaryFilter>("all");
  const [summarySearch, setSummarySearch] = useState("");
  const [savedPlans, setSavedPlans] = useState<Record<string, FieldPlan>>({});
  const [draftPlans, setDraftPlans] = useState<Record<string, FieldPlan>>({});
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [plansLoaded, setPlansLoaded] = useState(false);

  const fieldModel =
    nutrientData.fields.find((field) => field.fieldId === selectedFieldId) ??
    selectableModels[0];
  const soilField =
    soilFields.find((field) => field.id === fieldModel?.fieldId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/nutrient-plans", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load shared plans.");
        return (await response.json()) as { plans: FieldPlan[] };
      })
      .then(({ plans }) => {
        if (cancelled) return;
        setSavedPlans(
          Object.fromEntries(plans.map((item) => [item.fieldId, item])),
        );
      })
      .catch(() => {
        if (!cancelled) setSaveState("error");
      })
      .finally(() => {
        if (!cancelled) setPlansLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const plan =
    fieldModel && plansLoaded
      ? (draftPlans[fieldModel.fieldId] ??
        mergePlan(fieldModel, savedPlans[fieldModel.fieldId]))
      : null;

  if (!fieldModel || !soilField || !plan) {
    return (
      <main className="planner-loading">
        <span className="loading-pulse" />
        Preparing nutrient balances…
      </main>
    );
  }

  const updatePlan = (
    updater: (current: FieldPlan) => FieldPlan | null,
  ) => {
    if (!fieldModel || !plansLoaded) return;
    setDraftPlans((current) => {
      const starting =
        current[fieldModel.fieldId] ??
        mergePlan(fieldModel, savedPlans[fieldModel.fieldId]);
      const next = updater(starting);
      return next
        ? { ...current, [fieldModel.fieldId]: next }
        : current;
    });
  };

  const result = soilField
    ? latestPKResult(soilField, fieldModel?.testDate ?? null)
    : null;
  const baseP = numberValue(result?.pValue);
  const baseK = numberValue(result?.kValue);

  const adjustedRotations =
    !fieldModel || !plan
      ? []
      : fieldModel.rotations.map((rotation) => ({
          ...rotation,
          adjustment:
            plan.cropAdjustments[String(rotation.year)] ??
            defaultPlan(fieldModel).cropAdjustments[String(rotation.year)],
        }));

  const rotationBalance = (
    rotation: (typeof adjustedRotations)[number],
  ): { p: Balance; k: Balance; nutrients: Required<Nutrients> } => {
    const nutrientOfftake = emptyNutrients();
    const adjustment = rotation.adjustment;
    if (!adjustment.included) {
      return {
        p: { central: 0, low: 0, high: 0 },
        k: { central: 0, low: 0, high: 0 },
        nutrients: nutrientOfftake,
      };
    }
    const pCentral =
      adjustment.yieldTPerHa * rotation.offtake.grainP2o5KgPerT +
      (adjustment.strawRemoved
        ? adjustment.strawTPerHa * rotation.offtake.strawP2o5KgPerT
        : 0);
    const kCentral =
      adjustment.yieldTPerHa * rotation.offtake.grainK2oKgPerT +
      (adjustment.strawRemoved
        ? adjustment.strawTPerHa * rotation.offtake.strawK2oKgPerT
        : 0);
    const uncertainty = adjustment.yieldUncertaintyPct / 100;
    nutrientOfftake.p2o5 = pCentral;
    nutrientOfftake.k2o = kCentral;
    return {
      p: {
        central: pCentral,
        low: pCentral * (1 - uncertainty),
        high: pCentral * (1 + uncertainty),
      },
      k: {
        central: kCentral,
        low: kCentral * (1 - uncertainty),
        high: kCentral * (1 + uncertainty),
      },
      nutrients: nutrientOfftake,
    };
  };

  const cropBalanceThrough = (throughYear: number) => {
    const total = {
      p: { central: 0, low: 0, high: 0 },
      k: { central: 0, low: 0, high: 0 },
      nutrients: emptyNutrients(),
    };
    for (const rotation of adjustedRotations) {
      if (rotation.year > throughYear) continue;
      const offtake = rotationBalance(rotation);
      total.p.central += offtake.p.central;
      total.p.low += offtake.p.low;
      total.p.high += offtake.p.high;
      total.k.central += offtake.k.central;
      total.k.low += offtake.k.low;
      total.k.high += offtake.k.high;
      addNutrients(total.nutrients, offtake.nutrients);
    }
    return total;
  };

  const recordedBalanceThrough = (
    throughYear: number,
    model: FieldModel = fieldModel,
  ) => {
    const nutrients = emptyNutrients();
    const low = emptyNutrients();
    const high = emptyNutrients();
    for (const application of model.recordedApplications) {
      const applicationYear =
        application.cropYear ?? Number(application.date?.slice(0, 4));
      if (Number.isFinite(applicationYear) && applicationYear > throughYear)
        continue;
      const uncertainty =
        application.evidence === "confirmed"
          ? 0.05
          : application.evidence === "probable"
            ? 0.15
            : 0.3;
      addNutrients(nutrients, application.nutrientsKgHa);
      addNutrients(low, application.nutrientsKgHa, 1 - uncertainty);
      addNutrients(high, application.nutrientsKgHa, 1 + uncertainty);
    }
    return { nutrients, low, high };
  };

  const proposalForPlan = (fieldPlan: FieldPlan) => {
    const nutrients = emptyNutrients();
    const applications = fieldPlan.proposedApplications.map(
      (application) => {
        const product = nutrientData.products.find(
          (item) => item.id === application.productId,
        );
        const rateKgHa =
          application.unit === "t/ha"
            ? application.rate * 1000
            : application.rate;
        const lineNutrients = emptyNutrients();
        if (product) {
          addNutrients(lineNutrients, product.nutrients, rateKgHa / 100);
        }
        const price =
          application.priceOverride ?? product?.pricePerTonne ?? null;
        const lineCost = price === null ? null : (rateKgHa / 1000) * price;
        const applicationCostPerHa =
          application.applicationCostPerHa ??
          product?.applicationCostPerHa ??
          0;
        addNutrients(nutrients, lineNutrients);
        return {
          ...application,
          product,
          rateKgHa,
          lineNutrients,
          lineCost:
            rateKgHa <= 0
              ? 0
              : lineCost === null
                ? null
                : lineCost + applicationCostPerHa,
        };
      },
    );
    const costPerHa = applications.reduce(
      (sum, application) => sum + (application.lineCost ?? 0),
      0,
    );
    const hasUnquotedCost = applications.some(
      (application) =>
        application.rateKgHa > 0 && application.lineCost === null,
    );
    return { applications, nutrients, costPerHa, hasUnquotedCost };
  };

  const proposal = proposalForPlan(plan);

  const concentration = (
    metric: "p" | "k",
    base: number | null,
    input: { central: number; low: number; high: number },
    offtake: Balance,
  ): Balance => {
    if (base === null) return { central: 0, low: 0, high: 0 };
    const recovery = nutrientData.model.recoveryRanges[metric];
    const kgPerMgL =
      metric === "p"
        ? nutrientData.model.soilMass.p2o5KgPerHaPerMgLAtFullRecovery
        : nutrientData.model.soilMass.k2oKgPerHaPerMgLAtFullRecovery;
    const net = input.central - offtake.central;
    const netLow = input.low - offtake.high;
    const netHigh = input.high - offtake.low;
    const delta = net * recovery.central / kgPerMgL;
    const deltaLow =
      netLow >= 0
        ? (netLow * recovery.low) / kgPerMgL
        : (netLow * recovery.high) / kgPerMgL;
    const deltaHigh =
      netHigh >= 0
        ? (netHigh * recovery.high) / kgPerMgL
        : (netHigh * recovery.low) / kgPerMgL;
    return {
      central: Math.max(0, base + delta),
      low: Math.max(0, base * 0.95 + deltaLow),
      high: Math.max(0, base * 1.05 + deltaHigh),
    };
  };

  const post2026Offtake = cropBalanceThrough(2026);
  const recordedThrough2026 = recordedBalanceThrough(2026);
  const latestP = concentration(
    "p",
    baseP,
    {
      central: recordedThrough2026.nutrients.p2o5,
      low: recordedThrough2026.low.p2o5,
      high: recordedThrough2026.high.p2o5,
    },
    post2026Offtake.p,
  );
  const latestK = concentration(
    "k",
    baseK,
    {
      central: recordedThrough2026.nutrients.k2o,
      low: recordedThrough2026.low.k2o,
      high: recordedThrough2026.high.k2o,
    },
    post2026Offtake.k,
  );
  const postApplicationP = concentration(
    "p",
    baseP,
    {
      central:
        recordedThrough2026.nutrients.p2o5 + proposal.nutrients.p2o5,
      low: recordedThrough2026.low.p2o5 + proposal.nutrients.p2o5 * 0.9,
      high: recordedThrough2026.high.p2o5 + proposal.nutrients.p2o5 * 1.1,
    },
    post2026Offtake.p,
  );
  const postApplicationK = concentration(
    "k",
    baseK,
    {
      central:
        recordedThrough2026.nutrients.k2o + proposal.nutrients.k2o,
      low: recordedThrough2026.low.k2o + proposal.nutrients.k2o * 0.9,
      high: recordedThrough2026.high.k2o + proposal.nutrients.k2o * 1.1,
    },
    post2026Offtake.k,
  );

  const economicRotations = adjustedRotations
    .filter((rotation) => rotation.economicForecast)
    .sort((a, b) => a.year - b.year)
    .slice(0, 3);
  const firstEconomicOfftake = economicRotations[0]
    ? rotationBalance(economicRotations[0])
    : {
        p: { central: 0, low: 0, high: 0 },
        k: { central: 0, low: 0, high: 0 },
      };
  const buildAllowance = (index: number) =>
    index <= 0
      ? nutrientData.model.indexBuildAllowanceKgHaPerYear.index0
      : index <= 1
        ? nutrientData.model.indexBuildAllowanceKgHaPerYear.index1
        : 0;
  const pNeed =
    firstEconomicOfftake.p.central +
    buildAllowance(indexFromPpm("p", latestP.central));
  const kNeed =
    firstEconomicOfftake.k.central +
    buildAllowance(indexFromPpm("k", latestK.central));
  const creditedP2o5 = creditableNutrientKgHa(
    proposal.nutrients.p2o5,
    pNeed,
  );
  const creditedK2o = creditableNutrientKgHa(
    proposal.nutrients.k2o,
    kNeed,
  );

  const indexRange = (metric: "p" | "k", balance: Balance): EstimateRange => ({
    low: responseIndexFromPpm(metric, balance.low),
    central: responseIndexFromPpm(metric, balance.central),
    high: responseIndexFromPpm(metric, balance.high),
  });
  const cumulativeOfftake = {
    p: { ...post2026Offtake.p },
    k: { ...post2026Offtake.k },
  };
  const annualResponseDraft = economicRotations.map((rotation) => {
    const untreatedP = concentration(
      "p",
      baseP,
      {
        central: recordedThrough2026.nutrients.p2o5,
        low: recordedThrough2026.low.p2o5,
        high: recordedThrough2026.high.p2o5,
      },
      cumulativeOfftake.p,
    );
    const treatedP = concentration(
      "p",
      baseP,
      {
        central: recordedThrough2026.nutrients.p2o5 + creditedP2o5,
        low: recordedThrough2026.low.p2o5 + creditedP2o5 * 0.9,
        high: recordedThrough2026.high.p2o5 + creditedP2o5 * 1.1,
      },
      cumulativeOfftake.p,
    );
    const untreatedK = concentration(
      "k",
      baseK,
      {
        central: recordedThrough2026.nutrients.k2o,
        low: recordedThrough2026.low.k2o,
        high: recordedThrough2026.high.k2o,
      },
      cumulativeOfftake.k,
    );
    const treatedK = concentration(
      "k",
      baseK,
      {
        central: recordedThrough2026.nutrients.k2o + creditedK2o,
        low: recordedThrough2026.low.k2o + creditedK2o * 0.9,
        high: recordedThrough2026.high.k2o + creditedK2o * 1.1,
      },
      cumulativeOfftake.k,
    );
    const isArable =
      rotation.adjustment.included &&
      rotation.cropGroup !== "Grass" &&
      rotation.adjustment.yieldTPerHa > 0;
    const referenceYieldTPerHa = isArable
      ? rotation.adjustment.yieldTPerHa
      : 0;
    const pYieldResponse = estimateIndexImprovementResponse({
      metric: "p",
      untreatedIndex: indexRange("p", untreatedP),
      treatedIndex: indexRange("p", treatedP),
      referenceYieldTPerHa,
    });
    const kYieldResponse = estimateIndexImprovementResponse({
      metric: "k",
      untreatedIndex: indexRange("k", untreatedK),
      treatedIndex: indexRange("k", treatedK),
      referenceYieldTPerHa,
    });
    const combinedYieldGainTPerHa = combineNutrientResponses(
      pYieldResponse.yieldGainTPerHa,
      kYieldResponse.yieldGainTPerHa,
      referenceYieldTPerHa,
    );
    const cropValuePerTonne =
      plan.economics.cropValuesByYear[String(rotation.year)] ??
      defaultCropValue(rotation.cropGroup);
    const modelBasis =
      rotation.cropGroup === "Wheat"
        ? "AHDB/SRUC wheat response proxy"
        : rotation.cropGroup === "Barley"
          ? "Cereal response proxy"
          : rotation.cropGroup === "Beans"
            ? "Wheat-equivalent bean proxy"
            : rotation.cropGroup === "Composite"
              ? "Equal wheat/barley/bean composite proxy"
              : "Suppressed for permanent grass";
    const offtake = rotationBalance(rotation);
    cumulativeOfftake.p.central += offtake.p.central;
    cumulativeOfftake.p.low += offtake.p.low;
    cumulativeOfftake.p.high += offtake.p.high;
    cumulativeOfftake.k.central += offtake.k.central;
    cumulativeOfftake.k.low += offtake.k.low;
    cumulativeOfftake.k.high += offtake.k.high;
    return {
      year: rotation.year,
      crop: rotation.crop,
      cropGroup: rotation.cropGroup,
      modelBasis,
      referenceYieldTPerHa,
      cropValuePerTonne,
      untreatedP,
      treatedP,
      untreatedK,
      treatedK,
      pYieldGainTPerHa: pYieldResponse.yieldGainTPerHa,
      kYieldGainTPerHa: kYieldResponse.yieldGainTPerHa,
      combinedYieldGainTPerHa,
    };
  });
  const valuedNpv = valueThreeYearNpv({
    years: annualResponseDraft.map((year) => ({
      year: year.year,
      crop: year.crop,
      cropValuePerTonne: year.cropValuePerTonne,
      yieldGainTPerHa: year.combinedYieldGainTPerHa,
    })),
    priceUncertaintyPct: plan.economics.priceUncertaintyPct,
    planCostPerHa: proposal.costPerHa,
    discountRatePct: plan.economics.discountRatePct,
  });
  const annualEconomicRows: AnnualEconomicSummary[] = annualResponseDraft.map(
    (year, index) => ({
      ...year,
      revenueGbpPerHa: valuedNpv.annual[index].revenueGbpPerHa,
      netCashFlowGbpPerHa: valuedNpv.annual[index].netCashFlowGbpPerHa,
      presentValueGbpPerHa: valuedNpv.annual[index].presentValueGbpPerHa,
    }),
  );
  const hasArableEconomicYear = annualEconomicRows.some(
    (year) => year.referenceYieldTPerHa > 0,
  );
  const threeYearRevenueGbpPerHa = annualEconomicRows.reduce(
    (total, year) => ({
      low: total.low + year.revenueGbpPerHa.low,
      central: total.central + year.revenueGbpPerHa.central,
      high: total.high + year.revenueGbpPerHa.high,
    }),
    { low: 0, central: 0, high: 0 },
  );
  const economicSummary: EconomicSummary = {
    valuationHorizon: "2027–2029 harvests",
    priceUncertaintyPct: plan.economics.priceUncertaintyPct,
    discountRatePct: plan.economics.discountRatePct,
    latestEstimatedP: latestP,
    latestEstimatedK: latestK,
    postApplicationP,
    postApplicationK,
    annual: annualEconomicRows,
    planCostGbpPerHa: proposal.hasUnquotedCost ? null : proposal.costPerHa,
    npvGbpPerHa: proposal.hasUnquotedCost ? null : valuedNpv.npvGbpPerHa,
    modelBasis:
      "Post-2026 soil balance followed by three rotation-led harvest responses; yield-response credit capped at the agronomic planning benchmark, with full application cost in 2027 and no repeat P/K",
  };
  const threeYearNpvPerHaDisplay = economicSummary.npvGbpPerHa
    ? formatMoneyRange(economicSummary.npvGbpPerHa)
    : "Quote needed";

  const farmSummaryRows = selectableModels
    .flatMap<FarmSummaryRow>((model) => {
      const matchingSoilField = soilFields.find(
        (field) => field.id === model.fieldId,
      );
      if (!matchingSoilField) return [];
      const matchingResult = latestPKResult(matchingSoilField, model.testDate);
      const matchingBaseP = numberValue(matchingResult?.pValue);
      const matchingBaseK = numberValue(matchingResult?.kValue);
      if (matchingBaseP === null || matchingBaseK === null) return [];

      const fieldPlan =
        draftPlans[model.fieldId] ??
        mergePlan(model, savedPlans[model.fieldId]);
      const rotations = model.rotations.map((rotation) => ({
        ...rotation,
        adjustment:
          fieldPlan.cropAdjustments[String(rotation.year)] ??
          defaultPlan(model).cropAdjustments[String(rotation.year)],
      }));
      const offtakeThrough2026 = {
        p: { central: 0, low: 0, high: 0 },
        k: { central: 0, low: 0, high: 0 },
      };
      for (const rotation of rotations) {
        if (rotation.year > 2026) continue;
        const offtake = rotationBalance(rotation);
        offtakeThrough2026.p.central += offtake.p.central;
        offtakeThrough2026.p.low += offtake.p.low;
        offtakeThrough2026.p.high += offtake.p.high;
        offtakeThrough2026.k.central += offtake.k.central;
        offtakeThrough2026.k.low += offtake.k.low;
        offtakeThrough2026.k.high += offtake.k.high;
      }
      const recorded = recordedBalanceThrough(2026, model);
      const fieldProposal = proposalForPlan(fieldPlan);
      const estimatedP = concentration(
        "p",
        matchingBaseP,
        {
          central: recorded.nutrients.p2o5,
          low: recorded.low.p2o5,
          high: recorded.high.p2o5,
        },
        offtakeThrough2026.p,
      );
      const estimatedK = concentration(
        "k",
        matchingBaseK,
        {
          central: recorded.nutrients.k2o,
          low: recorded.low.k2o,
          high: recorded.high.k2o,
        },
        offtakeThrough2026.k,
      );
      const fieldEconomicRotations = rotations
        .filter((rotation) => rotation.economicForecast)
        .sort((left, right) => left.year - right.year)
        .slice(0, 3);
      const firstFieldEconomicOfftake = fieldEconomicRotations[0]
        ? rotationBalance(fieldEconomicRotations[0])
        : {
            p: { central: 0, low: 0, high: 0 },
            k: { central: 0, low: 0, high: 0 },
          };
      const fieldPNeed =
        firstFieldEconomicOfftake.p.central +
        buildAllowance(indexFromPpm("p", estimatedP.central));
      const fieldKNeed =
        firstFieldEconomicOfftake.k.central +
        buildAllowance(indexFromPpm("k", estimatedK.central));
      const creditedFieldNutrients = {
        p2o5: creditableNutrientKgHa(
          fieldProposal.nutrients.p2o5,
          fieldPNeed,
        ),
        k2o: creditableNutrientKgHa(
          fieldProposal.nutrients.k2o,
          fieldKNeed,
        ),
      };
      const plannedP = concentration(
        "p",
        matchingBaseP,
        {
          central: recorded.nutrients.p2o5 + fieldProposal.nutrients.p2o5,
          low: recorded.low.p2o5 + fieldProposal.nutrients.p2o5 * 0.9,
          high: recorded.high.p2o5 + fieldProposal.nutrients.p2o5 * 1.1,
        },
        offtakeThrough2026.p,
      );
      const plannedK = concentration(
        "k",
        matchingBaseK,
        {
          central: recorded.nutrients.k2o + fieldProposal.nutrients.k2o,
          low: recorded.low.k2o + fieldProposal.nutrients.k2o * 0.9,
          high: recorded.high.k2o + fieldProposal.nutrients.k2o * 1.1,
        },
        offtakeThrough2026.k,
      );
      const cumulativeFieldOfftake = {
        p: { ...offtakeThrough2026.p },
        k: { ...offtakeThrough2026.k },
      };
      const fieldEconomicYears = fieldEconomicRotations
        .map((rotation) => {
          const projected = (metric: "p" | "k", treated: boolean) => {
            const nutrient = metric === "p" ? "p2o5" : "k2o";
            return concentration(
              metric,
              metric === "p" ? matchingBaseP : matchingBaseK,
              {
                central:
                  recorded.nutrients[nutrient] +
                  (treated ? creditedFieldNutrients[nutrient] : 0),
                low:
                  recorded.low[nutrient] +
                  (treated ? creditedFieldNutrients[nutrient] * 0.9 : 0),
                high:
                  recorded.high[nutrient] +
                  (treated ? creditedFieldNutrients[nutrient] * 1.1 : 0),
              },
              cumulativeFieldOfftake[metric],
            );
          };
          const untreatedP = projected("p", false);
          const treatedP = projected("p", true);
          const untreatedK = projected("k", false);
          const treatedK = projected("k", true);
          const referenceYieldTPerHa =
            rotation.adjustment.included &&
            rotation.cropGroup !== "Grass" &&
            rotation.adjustment.yieldTPerHa > 0
              ? rotation.adjustment.yieldTPerHa
              : 0;
          const pResponse = estimateIndexImprovementResponse({
            metric: "p",
            untreatedIndex: {
              low: responseIndexFromPpm("p", untreatedP.low),
              central: responseIndexFromPpm("p", untreatedP.central),
              high: responseIndexFromPpm("p", untreatedP.high),
            },
            treatedIndex: {
              low: responseIndexFromPpm("p", treatedP.low),
              central: responseIndexFromPpm("p", treatedP.central),
              high: responseIndexFromPpm("p", treatedP.high),
            },
            referenceYieldTPerHa,
          });
          const kResponse = estimateIndexImprovementResponse({
            metric: "k",
            untreatedIndex: {
              low: responseIndexFromPpm("k", untreatedK.low),
              central: responseIndexFromPpm("k", untreatedK.central),
              high: responseIndexFromPpm("k", untreatedK.high),
            },
            treatedIndex: {
              low: responseIndexFromPpm("k", treatedK.low),
              central: responseIndexFromPpm("k", treatedK.central),
              high: responseIndexFromPpm("k", treatedK.high),
            },
            referenceYieldTPerHa,
          });
          const yieldGainTPerHa = combineNutrientResponses(
            pResponse.yieldGainTPerHa,
            kResponse.yieldGainTPerHa,
            referenceYieldTPerHa,
          );
          const offtake = rotationBalance(rotation);
          cumulativeFieldOfftake.p.central += offtake.p.central;
          cumulativeFieldOfftake.p.low += offtake.p.low;
          cumulativeFieldOfftake.p.high += offtake.p.high;
          cumulativeFieldOfftake.k.central += offtake.k.central;
          cumulativeFieldOfftake.k.low += offtake.k.low;
          cumulativeFieldOfftake.k.high += offtake.k.high;
          return {
            year: rotation.year,
            crop: rotation.crop,
            cropValuePerTonne:
              fieldPlan.economics.cropValuesByYear[String(rotation.year)] ??
              defaultCropValue(rotation.cropGroup),
            yieldGainTPerHa,
          };
        });
      const fieldValuation = valueThreeYearNpv({
        years: fieldEconomicYears,
        priceUncertaintyPct: fieldPlan.economics.priceUncertaintyPct,
        planCostPerHa: fieldProposal.costPerHa,
        discountRatePct: fieldPlan.economics.discountRatePct,
      });
      const positiveApplications = fieldProposal.applications.filter(
        (application) => application.rateKgHa > 0,
      );
      const estimatedPIndex = indexRange("p", estimatedP);
      const estimatedKIndex = indexRange("k", estimatedK);

      return [
        {
          fieldId: model.fieldId,
          fieldName: model.fieldName,
          areaHa: matchingSoilField.areaHa,
          testDate: model.testDate,
          latestPpmRange: estimatedP,
          latestKppmRange: estimatedK,
          latestPIndexRange: estimatedPIndex,
          latestKIndexRange: estimatedKIndex,
          latestPpm: estimatedP.central,
          latestKppm: estimatedK.central,
          latestPIndex: estimatedPIndex.central,
          latestKIndex: estimatedKIndex.central,
          postPpm: plannedP.central,
          postKppm: plannedK.central,
          postPIndex: indexFromPpm("p", plannedP.central),
          postKIndex: indexFromPpm("k", plannedK.central),
          proposedP2o5KgHa: fieldProposal.nutrients.p2o5,
          proposedK2oKgHa: fieldProposal.nutrients.k2o,
          knownCostGbpHa: fieldProposal.costPerHa,
          hasUnquotedCost: fieldProposal.hasUnquotedCost,
          npvGbpHa: fieldProposal.hasUnquotedCost
            ? null
            : fieldValuation.npvGbpPerHa,
          applicationCount: positiveApplications.length,
          productNames: [
            ...new Set(
              positiveApplications
                .map((application) => application.product?.name)
                .filter((name): name is string => Boolean(name)),
            ),
          ],
        },
      ];
    })
    .sort((left, right) => {
      const statusDifference =
        fieldCorrectionStatus(left).rank - fieldCorrectionStatus(right).rank;
      if (statusDifference !== 0) return statusDifference;
      const leftGap =
        Math.max(0, 2 - left.latestPIndex) +
        Math.max(0, 1.7 - left.latestKIndex);
      const rightGap =
        Math.max(0, 2 - right.latestPIndex) +
        Math.max(0, 1.7 - right.latestKIndex);
      return rightGap - leftGap || left.fieldName.localeCompare(right.fieldName);
    });
  const summaryFieldIdSet = new Set(summaryFieldIds);
  const scopedSummaryRows = farmSummaryRows.filter((row) =>
    summaryFieldIdSet.has(row.fieldId),
  );
  const normalizedSummarySearch = summarySearch.trim().toLocaleLowerCase();
  const visibleSummaryRows = farmSummaryRows.filter(
    (row) =>
      rowMatchesFilter(row, summaryFilter) &&
      (!normalizedSummarySearch ||
        row.fieldName.toLocaleLowerCase().includes(normalizedSummarySearch)),
  );
  const farmSummaryTotals = aggregateFarmSummary(scopedSummaryRows);

  const assessment = (() => {
    const items: { tone: "good" | "warn" | "info"; text: string }[] = [];
    const pIndex = indexFromPpm("p", postApplicationP.central);
    const kIndex = indexFromPpm("k", postApplicationK.central);
    const currentPIndex = indexFromPpm("p", latestP.central);
    const currentKIndex = indexFromPpm("k", latestK.central);
    const threeYearYieldGain = annualEconomicRows.reduce(
      (total, year) => total + year.combinedYieldGainTPerHa.central,
      0,
    );
    if (pIndex < 2) {
      items.push({
        tone: "warn",
        text: `Projected P remains below RB209 target Index 2. This plan supplies ${formatKg(
          proposal.nutrients.p2o5,
        )} against about ${formatKg(pNeed)} of forecast offtake plus gradual build allowance.`,
      });
    } else if (pIndex > 2) {
      items.push({
        tone: "warn",
        text: "Projected P is above target. Avoid routine build-up: excess available P is an unnecessary cost and increases loss risk.",
      });
    } else {
      items.push({
        tone: "good",
        text: "Projected P reaches the RB209 target band. Re-test within the normal 3–5 year cycle to confirm the modelled change.",
      });
    }
    if (kIndex < 1.7) {
      items.push({
        tone: "warn",
        text: `Projected K remains below target 2−. Straw removal has a large K effect; confirm each straw choice before relying on the ${formatKg(
          proposal.nutrients.k2o,
        )} planned.`,
      });
    } else if (kIndex > 2.3) {
      items.push({
        tone: "info",
        text: "Projected K is above 2+. Review whether further K is needed and consider herbage K:Mg balance on grazed fields.",
      });
    } else {
      items.push({
        tone: "good",
        text: "Projected K is within the RB209 target working band (2− to 2+).",
      });
    }
    if (!hasArableEconomicYear) {
      items.push({
        tone: "info",
        text: "The P/K revenue proxy is suppressed where all three forecast years are permanent grass or have no harvested-yield assumption. Entering a forage-equivalent price alone would not make the wheat evidence crop-specific.",
      });
    } else if (threeYearYieldGain > 0) {
      items.push({
        tone:
          economicSummary.npvGbpPerHa?.central !== undefined &&
          economicSummary.npvGbpPerHa.central >= 0
            ? "good"
            : "info",
        text: `Across the 2027–2029 rotation, the model indicates ${threeYearYieldGain.toFixed(
          2,
        )} t/ha of cumulative potential yield protected. P and K sensitivities overlap within each harvest, so the central case uses the larger response rather than adding both.`,
      });
    } else if (proposal.costPerHa > 0) {
      items.push({
        tone: "info",
        text: "The projected soil-status change gives no central yield response over the 2027–2029 rotation. A negative three-year NPV can still be compatible with longer-term soil-index correction.",
      });
    }
    if (
      proposal.nutrients.p2o5 > creditedP2o5 ||
      proposal.nutrients.k2o > creditedK2o
    ) {
      items.push({
        tone: "info",
        text: `The NPV gives yield-response credit to no more than the planning benchmark (P ${formatKg(
          pNeed,
        )}; K ${formatKg(
          kNeed,
        )}). The full application cost is still charged, so product above that benchmark reduces NPV while remaining visible in the projected soil status.`,
      });
    }
    if (
      hasArableEconomicYear &&
      currentPIndex < 2 &&
      currentKIndex < 1.7 &&
      proposal.nutrients.p2o5 > 0 &&
      proposal.nutrients.k2o > 0
    ) {
      items.push({
        tone: "info",
        text: "Both P and K are sub-target. Realised response depends on correcting the more limiting nutrient and on rooting, pH, water and N supply; individual P and K ranges must not be added.",
      });
    }
    if (
      hasArableEconomicYear &&
      (currentPIndex < 2 || currentKIndex < 1.7) &&
      proposal.applications.some(
        (application) =>
          application.lineNutrients.p2o5 > 0 ||
          application.lineNutrients.k2o > 0,
      )
    ) {
      items.push({
        tone: "info",
        text: "At low P or K status, RB209 favours annual application and seedbed incorporation. Check that the selected product timing and placement suit crop establishment.",
      });
    }
    if (proposal.hasUnquotedCost) {
      items.push({
        tone: "warn",
        text: "At least one positive-rate application still needs a quote, so net monetary impact is withheld rather than treating the missing cost as zero.",
      });
    }
    const testYear = Number(fieldModel?.testDate?.slice(0, 4));
    const modelYear = Number(nutrientData.modelAsAt.slice(0, 4));
    if (
      Number.isFinite(testYear) &&
      Number.isFinite(modelYear) &&
      modelYear - testYear > 4
    ) {
      items.push({
        tone: "warn",
        text: "The anchor soil test is more than four years old. Treat the yield and value range as low-confidence until the field is re-sampled.",
      });
    }
    const measuredPh = numberValue(result?.ph);
    if (hasArableEconomicYear && measuredPh !== null && measuredPh < 6) {
      items.push({
        tone: "warn",
        text: `Measured pH is ${measuredPh.toFixed(
          1,
        )}. Nutrient response may be constrained until acidity and rooting conditions are addressed.`,
      });
    }
    const proposedN = proposal.nutrients.n;
    if (proposedN > 0) {
      items.push({
        tone: proposedN > 250 ? "warn" : "info",
        text: `${formatKg(proposedN)} of N is proposed. This tool totals N but does not infer SNS, crop N-max or legal timing compliance; check those before application.`,
      });
    }
    if (proposal.applications.some((item) => !item.timing)) {
      items.push({
        tone: "warn",
        text: "At least one proposed application has no timing. Add a date so the whole-season plan can be reviewed.",
      });
    }
    if (
      proposal.applications.some((item) =>
        ["custom-gypsum", "custom-ash", "custom-lime"].includes(
          item.productId,
        ),
      )
    ) {
      items.push({
        tone: "info",
        text: "One or more deployment-priced materials still need a field-specific quote. Gypsum supplies Ca and S but has negligible liming value.",
      });
    }
    if (
      proposal.applications.some((item) =>
        ["custom-liming-residue", "custom-biosolids", "custom-ash"].includes(
          item.productId,
        ),
      )
    ) {
      items.push({
        tone: "info",
        text: "Recycled materials use the supplied batch analysis. Confirm the current batch, permit/deployment controls and spreading conditions before ordering.",
      });
    }
    if (
      proposal.applications.some(
        (item) => item.productId === "organic-cattle-fym",
      )
    ) {
      items.push({
        tone: "info",
        text: "Cattle FYM uses RB209 typical available P and K values and credits 10% of total N. Available N depends on storage, application timing and incorporation; use a representative manure analysis where possible.",
      });
    }
    return items;
  })();

  const updateCrop = (
    year: number,
    change: Partial<CropAdjustment>,
  ) => {
    updatePlan((current) => ({
      ...current,
      cropAdjustments: {
        ...current.cropAdjustments,
        [String(year)]: {
          ...current.cropAdjustments[String(year)],
          ...change,
        },
      },
    }));
    setSaveState("idle");
  };

  const updateApplication = (
    id: string,
    change: Partial<ProposedApplication>,
  ) => {
    updatePlan((current) => ({
      ...current,
      proposedApplications: current.proposedApplications.map((item) =>
        item.id === id ? { ...item, ...change } : item,
      ),
    }));
    setSaveState("idle");
  };

  const savePlan = async () => {
    if (!plan) return;
    setSaveState("saving");
    try {
      const response = await fetch("/api/nutrient-plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...plan, economicSummary }),
      });
      if (!response.ok) throw new Error("Save failed.");
      const saved = (await response.json()) as FieldPlan;
      setSavedPlans((current) => ({ ...current, [saved.fieldId]: saved }));
      setDraftPlans((current) => ({ ...current, [saved.fieldId]: saved }));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const download = async (format: "json" | "csv") => {
    const response = await fetch(`/api/nutrient-export?format=${format}`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download =
      format === "json"
        ? "soil-intelligence-nutrient-planner-database.json"
        : "soil-intelligence-proposed-nutrient-applications.csv";
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const downloadPostHarvestSoilScores = () => {
    const csv = buildPostHarvestSoilScoresCsv(
      farmSummaryRows,
      nutrientData.modelAsAt,
    );
    const href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download =
      "soil-intelligence-expected-post-2026-harvest-soil-scores.csv";
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <main className="planner-shell">
      <header className="planner-topbar">
        <div>
          <button type="button" onClick={onBack}>
            ← Soil map
          </button>
          <span className="eyebrow">Nutrient correction planner</span>
          <h1>
            {plannerView === "summary"
              ? "Farm-wide deficits and corrections"
              : "From test result to timed field plan"}
          </h1>
        </div>
        <div className="planner-actions">
          <div className="planner-view-switch" role="group" aria-label="Planner view">
            <button
              type="button"
              className={plannerView === "summary" ? "is-active" : ""}
              aria-pressed={plannerView === "summary"}
              onClick={() => setPlannerView("summary")}
            >
              Farm summary
            </button>
            <button
              type="button"
              className={plannerView === "field" ? "is-active" : ""}
              aria-pressed={plannerView === "field"}
              onClick={() => setPlannerView("field")}
            >
              Field planner
            </button>
          </div>
          <button type="button" onClick={() => void download("csv")}>
            Export applications CSV
          </button>
          <button type="button" onClick={downloadPostHarvestSoilScores}>
            Export post-harvest soil scores
          </button>
          <button type="button" onClick={() => void download("json")}>
            Export database JSON
          </button>
          {plannerView === "field" && (
            <button
              type="button"
              className="primary"
              disabled={saveState === "saving"}
              onClick={() => void savePlan()}
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved for family"
                  : "Save shared plan"}
            </button>
          )}
        </div>
      </header>
      <aside className="legacy-model-notice">
        <strong>Original planner · legacy model</strong>
        <span>
          Retained for existing plans and like-for-like comparison. Its K index
          labels use the original planner interpretation and can differ from
          the improved planner at the 2−, 2+ and Index 3 boundaries.
        </span>
      </aside>

      {plannerView === "summary" ? (
        <section className="farm-summary">
          <div className="farm-summary-intro">
            <div>
              <span className="eyebrow">Whole-farm working view</span>
              <h2>Choose the fields to include, then work down the priorities.</h2>
              <p>
                Current status is the latest modelled estimate after the 2026
                harvest. Planned status applies each field’s present correction
                scenario once before 2027.
              </p>
            </div>
            <div className="farm-summary-scope">
              <span>{summaryFieldIds.length} of {farmSummaryRows.length} fields</span>
              <button
                type="button"
                onClick={() =>
                  setSummaryFieldIds(farmSummaryRows.map((row) => row.fieldId))
                }
              >
                Select all
              </button>
              <button type="button" onClick={() => setSummaryFieldIds([])}>
                Clear
              </button>
            </div>
          </div>

          <div className="farm-summary-kpis">
            <article>
              <small>Selected land</small>
              <strong>{farmSummaryTotals.areaHa.toFixed(1)} ha</strong>
              <span>{summaryFieldIds.length} fields in this view</span>
            </article>
            <article className={farmSummaryTotals.pDeficitHa > 0 ? "is-warn" : ""}>
              <small>Below P target</small>
              <strong>{farmSummaryTotals.pDeficitHa.toFixed(1)} ha</strong>
              <span>Latest modelled P below Index 2</span>
            </article>
            <article className={farmSummaryTotals.kDeficitHa > 0 ? "is-warn" : ""}>
              <small>Below K target</small>
              <strong>{farmSummaryTotals.kDeficitHa.toFixed(1)} ha</strong>
              <span>Latest modelled K below Index 2−</span>
            </article>
            <article>
              <small>Planned correction</small>
              <strong>
                P {farmSummaryTotals.plannedP2o5Tonnes.toFixed(1)} t · K{" "}
                {farmSummaryTotals.plannedK2oTonnes.toFixed(1)} t
              </strong>
              <span>
                P₂O₅ and K₂O across {farmSummaryTotals.plannedFields} planned fields
              </span>
            </article>
            <article className={farmSummaryTotals.fieldsAwaitingQuotes ? "is-warn" : ""}>
              <small>Known plan cost</small>
              <strong>{formatMoney(farmSummaryTotals.knownCostGbp)}</strong>
              <span>
                {farmSummaryTotals.fieldsAwaitingQuotes
                  ? `Plus quotes on ${farmSummaryTotals.fieldsAwaitingQuotes} field${
                      farmSummaryTotals.fieldsAwaitingQuotes === 1 ? "" : "s"
                    }`
                  : "All positive-rate lines priced"}
              </span>
            </article>
            <article className={farmSummaryTotals.npvGbp.central >= 0 ? "is-good" : "is-warn"}>
              <small>2027–2029 NPV</small>
              <strong>{formatMoney(farmSummaryTotals.npvGbp.central)}</strong>
              <span>
                {formatMoney(farmSummaryTotals.npvGbp.low)}–
                {formatMoney(farmSummaryTotals.npvGbp.high)} selected-farm range
                {farmSummaryTotals.fieldsAwaitingQuotes
                  ? " · excludes unquoted fields"
                  : ""}
              </span>
            </article>
          </div>

          <div className="farm-summary-controls">
            <label className="farm-summary-search">
              <span>Find a field</span>
              <input
                type="search"
                value={summarySearch}
                placeholder="Search by field name"
                onChange={(event) => setSummarySearch(event.target.value)}
              />
            </label>
            <div className="farm-summary-filters" role="group" aria-label="Deficit filter">
              {(
                [
                  ["all", "All"],
                  ["p-deficit", "P deficit"],
                  ["k-deficit", "K deficit"],
                  ["unplanned", "Needs a plan"],
                  ["planned", "Planned"],
                ] as [FarmSummaryFilter, string][]
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={summaryFilter === value ? "is-active" : ""}
                  aria-pressed={summaryFilter === value}
                  onClick={() => setSummaryFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="farm-summary-table">
            <div className="farm-summary-row farm-summary-head">
              <span>Include / field</span>
              <span>Latest estimate</span>
              <span>Deficit</span>
              <span>Proposed correction</span>
              <span>After correction</span>
              <span>Three-year NPV</span>
              <span>Cost / action</span>
            </div>
            {visibleSummaryRows.map((row) => {
              const status = fieldCorrectionStatus(row);
              const pDeficit = hasPDeficit(row);
              const kDeficit = hasKDeficit(row);
              return (
                <article
                  className={`farm-summary-row${
                    summaryFieldIdSet.has(row.fieldId) ? "" : " is-excluded"
                  }`}
                  key={row.fieldId}
                >
                  <span className="farm-summary-field">
                    <label>
                      <input
                        type="checkbox"
                        checked={summaryFieldIdSet.has(row.fieldId)}
                        onChange={(event) =>
                          setSummaryFieldIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, row.fieldId])]
                              : current.filter((id) => id !== row.fieldId),
                          )
                        }
                      />
                      <b>{row.fieldName}</b>
                    </label>
                    <small>
                      {row.areaHa.toFixed(1)} ha · test {row.testDate ?? "unknown"}
                    </small>
                  </span>
                  <span className="farm-summary-status">
                    <b>
                      P {indexLabel(row.latestPIndex)} · K{" "}
                      {indexLabel(row.latestKIndex)}
                    </b>
                    <small>
                      {row.latestPpm.toFixed(0)} / {row.latestKppm.toFixed(0)} mg/L
                    </small>
                  </span>
                  <span className="farm-summary-deficits">
                    <i className={pDeficit ? "is-low" : "is-ok"}>
                      P {pDeficit ? "below 2" : "at target"}
                    </i>
                    <i className={kDeficit ? "is-low" : "is-ok"}>
                      K {kDeficit ? "below 2−" : "at target"}
                    </i>
                  </span>
                  <span>
                    <b>
                      P {row.proposedP2o5KgHa.toFixed(0)} · K{" "}
                      {row.proposedK2oKgHa.toFixed(0)} kg/ha
                    </b>
                    <small>
                      {row.productNames.length
                        ? row.productNames.join(" · ")
                        : "No positive-rate application"}
                    </small>
                  </span>
                  <span className="farm-summary-status">
                    <b>
                      P {indexLabel(row.postPIndex)} · K{" "}
                      {indexLabel(row.postKIndex)}
                    </b>
                    <small className={`summary-status summary-${status.tone}`}>
                      {status.label}
                    </small>
                  </span>
                  <span className="farm-summary-npv">
                    {row.npvGbpHa ? (
                      <>
                        <b>{formatMoney(row.npvGbpHa.central)}/ha</b>
                        <small>
                          {formatMoney(row.npvGbpHa.low)}–
                          {formatMoney(row.npvGbpHa.high)}/ha
                        </small>
                        <small>
                          {formatMoney(row.npvGbpHa.central * row.areaHa)} field
                          central
                        </small>
                      </>
                    ) : (
                      <>
                        <b>Quote needed</b>
                        <small>NPV withheld for this field</small>
                      </>
                    )}
                  </span>
                  <span className="farm-summary-action">
                    <b>
                      {formatMoney(row.knownCostGbpHa)}/ha
                      {row.hasUnquotedCost ? " + quote" : ""}
                    </b>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFieldId(row.fieldId);
                        setPlannerView("field");
                        setSaveState("idle");
                      }}
                    >
                      Open field plan →
                    </button>
                  </span>
                </article>
              );
            })}
            {!visibleSummaryRows.length && (
              <div className="farm-summary-empty">
                No fields match this filter. Change the filter or search term.
              </div>
            )}
          </div>
          <p className="farm-summary-note">
            Summary values are planning estimates, not replacement soil tests.
            Target status uses P Index 2 and K Index 2−; validate material choice,
            timing and legal limits before application.
          </p>
        </section>
      ) : (
      <section className="planner-layout">
        <aside className="planner-field-panel">
          <label>
            <span className="control-label">Field</span>
            <select
              value={fieldModel.fieldId}
              onChange={(event) => setSelectedFieldId(event.target.value)}
            >
              {selectableModels.map((field) => (
                <option key={field.fieldId} value={field.fieldId}>
                  {field.fieldName}
                </option>
              ))}
            </select>
          </label>
          <div className="planner-field-facts">
            <span>
              <small>Area</small>
              <strong>{soilField.areaHa.toFixed(1)} ha</strong>
            </span>
            <span>
              <small>Anchor test</small>
              <strong>{fieldModel.testDate}</strong>
            </span>
          </div>
          <div className="planner-lab-anchor">
            <span className="control-label">Measured anchor</span>
            <p>
              <b>P</b> {baseP ?? "—"} mg/L · Index{" "}
              {baseP === null ? "—" : indexLabel(indexFromPpm("p", baseP))}
            </p>
            <p>
              <b>K</b> {baseK ?? "—"} mg/L · Index{" "}
              {baseK === null ? "—" : indexLabel(indexFromPpm("k", baseK))}
            </p>
            <small>
              The balance starts at the latest measured P/K result, then adds
              recorded inputs and subtracts harvested offtake.
            </small>
          </div>
          {saveState === "error" && (
            <p className="planner-error">
              Shared storage is unavailable. Your unsaved changes are still on
              this screen.
            </p>
          )}
          <details className="planner-method">
            <summary>Model limits</summary>
            <p>
              P and K ppm are scenario estimates, not replacement lab results.
              The range combines yield, record and soil-buffering uncertainty.
              N is totalled for planning but is not treated as a persistent soil
              index.
            </p>
            <p>
              Yield and monetary impacts are planning ranges for the 2027–2029
              rotation, not harvest forecasts. Weather, rooting, structure, pH,
              N supply and product placement can dominate the realised
              response.
            </p>
            <p>{nutrientData.model.recoveryRanges.note}</p>
          </details>
        </aside>

        <div className="planner-workspace">
          <section className="planner-estimate-grid">
            <StatusEstimate
              title="Latest estimate · after 2026 harvest"
              subtitle="Last test + recorded P/K − previous crop offtake − expected 2026 crop offtake"
              p={latestP}
              k={latestK}
            />
            <StatusEstimate
              title="After proposed correction"
              subtitle="One proposed application before the 2027 crop; no repeat P/K assumed"
              p={postApplicationP}
              k={postApplicationK}
            />
          </section>

          <section className="planner-card">
            <div className="planner-section-heading">
              <div>
                <span className="eyebrow">1 · Crop removal</span>
                <h2>Yield and straw assumptions</h2>
              </div>
              <p>Farm harvest volumes are the starting point; every row is editable.</p>
            </div>
            <div className="crop-table">
              <div className="crop-row crop-head">
                <span>Year / crop</span>
                <span>Yield</span>
                <span>Uncertainty</span>
                <span>Straw / forage</span>
                <span>Calculated offtake</span>
              </div>
              {adjustedRotations.map((rotation) => {
                const adjustment = rotation.adjustment;
                const pOfftake =
                  adjustment.yieldTPerHa *
                    rotation.offtake.grainP2o5KgPerT +
                  (adjustment.strawRemoved
                    ? adjustment.strawTPerHa *
                      rotation.offtake.strawP2o5KgPerT
                    : 0);
                const kOfftake =
                  adjustment.yieldTPerHa * rotation.offtake.grainK2oKgPerT +
                  (adjustment.strawRemoved
                    ? adjustment.strawTPerHa * rotation.offtake.strawK2oKgPerT
                    : 0);
                return (
                  <div
                    className={`crop-row${
                      rotation.forecast || rotation.economicForecast
                        ? " is-forecast"
                        : ""
                    }`}
                    key={rotation.year}
                  >
                    <span>
                      <label className="include-check">
                        <input
                          type="checkbox"
                          checked={adjustment.included}
                          onChange={(event) =>
                            updateCrop(rotation.year, {
                              included: event.target.checked,
                            })
                          }
                        />
                        <b>{rotation.year}</b>
                      </label>
                      <strong>{rotation.crop}</strong>
                      <small>
                        {rotation.forecast
                          ? "Expected 2026 harvest · "
                          : rotation.economicForecast
                            ? rotation.fallbackComposite
                              ? "NPV fallback · "
                              : "NPV rotation · "
                            : ""}
                        {rotation.yieldSource}
                      </small>
                    </span>
                    <label>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={adjustment.yieldTPerHa}
                        onChange={(event) =>
                          updateCrop(rotation.year, {
                            yieldTPerHa: Math.max(
                              0,
                              Number(event.target.value) || 0,
                            ),
                          })
                        }
                      />
                      <small>{rotation.yieldLabel}</small>
                    </label>
                    <label>
                      <input
                        type="number"
                        min={5}
                        max={60}
                        step={1}
                        value={adjustment.yieldUncertaintyPct}
                        onChange={(event) =>
                          updateCrop(rotation.year, {
                            yieldUncertaintyPct: Math.max(
                              5,
                              Math.min(60, Number(event.target.value) || 30),
                            ),
                          })
                        }
                      />
                      <small>± %</small>
                    </label>
                    <span>
                      {rotation.offtake.strawK2oKgPerT > 0 ? (
                        <>
                          <label className="include-check">
                            <input
                              type="checkbox"
                              checked={adjustment.strawRemoved}
                              onChange={(event) =>
                                updateCrop(rotation.year, {
                                  strawRemoved: event.target.checked,
                                })
                              }
                            />
                            Removed
                          </label>
                          <label className="inline-number">
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              disabled={!adjustment.strawRemoved}
                              value={adjustment.strawTPerHa}
                              onChange={(event) =>
                                updateCrop(rotation.year, {
                                  strawTPerHa: Math.max(
                                    0,
                                    Number(event.target.value) || 0,
                                  ),
                                })
                              }
                            />
                            <small>t/ha</small>
                          </label>
                        </>
                      ) : (
                        <small>
                          {rotation.cropGroup === "Grass"
                            ? "Enter removed forage as yield"
                            : "No separate straw factor"}
                        </small>
                      )}
                    </span>
                    <span>
                      <b>P {pOfftake.toFixed(0)}</b>
                      <b>K {kOfftake.toFixed(0)}</b>
                      <small>kg/ha</small>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="planner-card">
            <div className="planner-section-heading">
              <div>
                <span className="eyebrow">2 · Known inputs</span>
                <h2>Applications since the anchor test</h2>
              </div>
              <p>{fieldModel.recordedApplications.length} reconciled records</p>
            </div>
            <details className="recorded-applications">
              <summary>
                Show recorded inputs · P{" "}
                {recordedThrough2026.nutrients.p2o5.toFixed(0)} · K{" "}
                {recordedThrough2026.nutrients.k2o.toFixed(0)} · N{" "}
                {recordedThrough2026.nutrients.n.toFixed(0)} kg/ha
              </summary>
              <div>
                {fieldModel.recordedApplications.map((application) => (
                  <article key={application.id}>
                    <time>
                      {application.date ?? `Crop ${application.cropYear}`}
                    </time>
                    <strong>{application.productName}</strong>
                    <span>{formatKg(application.rateKgHa)} product</span>
                    <small>
                      N {application.nutrientsKgHa.n.toFixed(0)} · P{" "}
                      {application.nutrientsKgHa.p2o5.toFixed(0)} · K{" "}
                      {application.nutrientsKgHa.k2o.toFixed(0)} ·{" "}
                      {application.evidence}
                    </small>
                  </article>
                ))}
                {!fieldModel.recordedApplications.length && (
                  <p>No post-test application record was matched to this field.</p>
                )}
              </div>
            </details>
          </section>

          <section className="planner-card">
            <div className="planner-section-heading">
              <div>
                <span className="eyebrow">3 · Correction scenario</span>
                <h2>Proposed timed applications</h2>
              </div>
              <div className="scenario-heading-actions">
                <output
                  className={`scenario-npv${
                    economicSummary.npvGbpPerHa
                      ? economicSummary.npvGbpPerHa.central >= 0
                        ? " is-positive"
                        : " is-negative"
                      : " is-unquoted"
                  }`}
                  aria-live="polite"
                >
                  <small>2027–2029 NPV</small>
                  <strong>{threeYearNpvPerHaDisplay}</strong>
                  <span>
                    {economicSummary.npvGbpPerHa
                      ? "Central · low–high range"
                      : "Missing application cost"}
                  </span>
                </output>
                <button
                  type="button"
                  onClick={() =>
                    updatePlan((current) => ({
                      ...current,
                      proposedApplications: [
                        ...current.proposedApplications,
                        {
                          id: crypto.randomUUID(),
                          productId: nutrientData.products[0].id,
                          rate: 0,
                          unit: "kg/ha",
                          timing: "",
                          priceOverride: null,
                          applicationCostPerHa:
                            nutrientData.products[0].applicationCostPerHa ?? 0,
                        },
                      ],
                    }))
                  }
                >
                  + Add application
                </button>
              </div>
            </div>
            <div className="application-lines">
              {proposal.applications.map((application) => (
                <article key={application.id}>
                  <label className="product-select">
                    <span>Product</span>
                    <select
                      value={application.productId}
                      onChange={(event) => {
                        const selectedProduct = nutrientData.products.find(
                          (product) => product.id === event.target.value,
                        );
                        updateApplication(application.id, {
                          productId: selectedProduct?.id ?? event.target.value,
                          unit: selectedProduct?.defaultUnit ?? "kg/ha",
                          priceOverride: null,
                          applicationCostPerHa:
                            selectedProduct?.applicationCostPerHa ?? 0,
                        });
                      }}
                    >
                      {[...new Set(nutrientData.products.map((p) => p.category))].map(
                        (category) => (
                          <optgroup key={category} label={category}>
                            {nutrientData.products
                              .filter((product) => product.category === category)
                              .map((product) => (
                                <option key={product.id} value={product.id}>
                                  {product.name}
                                </option>
                              ))}
                          </optgroup>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    <span>Rate</span>
                    <div className="rate-input">
                      <input
                        type="number"
                        min={0}
                        step={application.unit === "t/ha" ? 0.1 : 10}
                        value={application.rate}
                        onChange={(event) =>
                          updateApplication(application.id, {
                            rate: Math.max(0, Number(event.target.value) || 0),
                          })
                        }
                      />
                      <select
                        value={application.unit}
                        onChange={(event) =>
                          updateApplication(application.id, {
                            unit: event.target.value as "kg/ha" | "t/ha",
                          })
                        }
                      >
                        <option value="kg/ha">kg/ha</option>
                        <option value="t/ha">t/ha</option>
                      </select>
                    </div>
                  </label>
                  <label>
                    <span>Application date</span>
                    <input
                      type="date"
                      value={application.timing}
                      onChange={(event) =>
                        updateApplication(application.id, {
                          timing: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Price £/t</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      placeholder={
                        application.product?.pricePerTonne === null
                          ? "Quote"
                          : String(application.product?.pricePerTonne ?? "")
                      }
                      value={application.priceOverride ?? ""}
                      onChange={(event) =>
                        updateApplication(application.id, {
                          priceOverride: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Spread / handling £/ha</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={
                        application.applicationCostPerHa ??
                        application.product?.applicationCostPerHa ??
                        0
                      }
                      onChange={(event) =>
                        updateApplication(application.id, {
                          applicationCostPerHa:
                            Number(event.target.value) || 0,
                        })
                      }
                    />
                  </label>
                  <div className="line-impact">
                    <span>
                      N <b>{application.lineNutrients.n.toFixed(0)}</b>
                    </span>
                    <span>
                      P <b>{application.lineNutrients.p2o5.toFixed(0)}</b>
                    </span>
                    <span>
                      K <b>{application.lineNutrients.k2o.toFixed(0)}</b>
                    </span>
                    <span>
                      S <b>{application.lineNutrients.so3.toFixed(0)}</b>
                    </span>
                    <span>
                      Mg <b>{application.lineNutrients.mgo.toFixed(0)}</b>
                    </span>
                    <span>
                      Ca <b>{application.lineNutrients.cao.toFixed(0)}</b>
                    </span>
                    <strong>
                      {application.lineCost === null
                        ? "Quote needed"
                        : `${formatMoney(application.lineCost)}/ha`}
                    </strong>
                  </div>
                  <small className="price-basis">
                    {application.product?.priceBasis}
                    {application.product?.note
                      ? ` · ${application.product.note}`
                      : ""}
                  </small>
                  <button
                    type="button"
                    className="remove-line"
                    onClick={() =>
                      updatePlan((current) => ({
                        ...current,
                        proposedApplications:
                          current.proposedApplications.filter(
                            (item) => item.id !== application.id,
                          ),
                      }))
                    }
                  >
                    Remove
                  </button>
                </article>
              ))}
              {!proposal.applications.length && (
                <div className="application-empty">
                  Add one or more products to compare nutrient combinations,
                  cost and non-target effects.
                </div>
              )}
            </div>
            <div className="plan-totals">
              <span>
                <small>Planned nutrients</small>
                <strong>
                  N {proposal.nutrients.n.toFixed(0)} · P{" "}
                  {proposal.nutrients.p2o5.toFixed(0)} · K{" "}
                  {proposal.nutrients.k2o.toFixed(0)}
                </strong>
                <small>
                  SO3 {proposal.nutrients.so3.toFixed(0)} · MgO{" "}
                  {proposal.nutrients.mgo.toFixed(0)} · CaO{" "}
                  {proposal.nutrients.cao.toFixed(0)} kg/ha
                </small>
              </span>
              <span>
                <small>Cost</small>
                <strong>{formatMoney(proposal.costPerHa)}/ha</strong>
                <small>
                  {formatMoney(proposal.costPerHa * soilField.areaHa)} for{" "}
                  {soilField.areaHa.toFixed(1)} ha, including entered spreading
                  and excluding unquoted lines
                </small>
              </span>
              <span>
                <small>Planning benchmark</small>
                <strong>
                  P {pNeed.toFixed(0)} · K {kNeed.toFixed(0)} kg/ha
                </strong>
                <small>2027 crop offtake + gradual RB209 build allowance</small>
              </span>
            </div>
          </section>

          <section className="planner-card economics-card">
            <div className="planner-section-heading">
              <div>
                <span className="eyebrow">4 · Expected yield & value</span>
                <h2>Three-harvest P/K NPV</h2>
              </div>
              <p>2027–2029 rotation · one correction cost in year 1</p>
            </div>
            <div className="economics-controls">
              <label>
                <span>Price uncertainty</span>
                <div>
                  <b>±</b>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={plan.economics.priceUncertaintyPct}
                    onChange={(event) => {
                      updatePlan((current) => ({
                        ...current,
                        economics: {
                          ...current.economics,
                          priceUncertaintyPct: Math.max(
                            0,
                            Math.min(100, Number(event.target.value) || 0),
                          ),
                        },
                      }));
                      setSaveState("idle");
                    }}
                  />
                  <small>%</small>
                </div>
              </label>
              <label>
                <span>Discount rate</span>
                <div>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step={0.5}
                    value={plan.economics.discountRatePct}
                    onChange={(event) => {
                      updatePlan((current) => ({
                        ...current,
                        economics: {
                          ...current.economics,
                          discountRatePct: Math.max(
                            0,
                            Math.min(30, Number(event.target.value) || 0),
                          ),
                        },
                      }));
                      setSaveState("idle");
                    }}
                  />
                  <small>%</small>
                </div>
              </label>
              <p>
                {economicSummary.modelBasis}. Crop prices are editable by
                harvest year below.
              </p>
            </div>
            <div className="annual-economics-table">
              <div className="annual-economics-row annual-economics-head">
                <span>Harvest / crop</span>
                <span>Soil status without → with plan</span>
                <span>P / K yield impact</span>
                <span>Expected price</span>
                <span>Combined yield / revenue</span>
                <span>Net cash / present value</span>
              </div>
              {annualEconomicRows.map((year, index) => (
                <div className="annual-economics-row" key={year.year}>
                  <span>
                    <b>{year.year}</b>
                    <strong>{year.crop}</strong>
                    <small>{year.modelBasis}</small>
                  </span>
                  <span>
                    <b>
                      P {indexLabel(indexFromPpm("p", year.untreatedP.central))}{" "}
                      → {indexLabel(indexFromPpm("p", year.treatedP.central))}
                    </b>
                    <b>
                      K {indexLabel(indexFromPpm("k", year.untreatedK.central))}{" "}
                      → {indexLabel(indexFromPpm("k", year.treatedK.central))}
                    </b>
                    <small>start of harvest year</small>
                  </span>
                  <span>
                    <b>P {formatYieldRange(year.pYieldGainTPerHa)}</b>
                    <b>K {formatYieldRange(year.kYieldGainTPerHa)}</b>
                  </span>
                  <label className="annual-price-input">
                    <b>£</b>
                    <input
                      type="number"
                      min={0}
                      max={2000}
                      step={5}
                      value={year.cropValuePerTonne}
                      disabled={year.cropGroup === "Grass"}
                      onChange={(event) => {
                        updatePlan((current) => ({
                          ...current,
                          economics: {
                            ...current.economics,
                            cropValuesByYear: {
                              ...current.economics.cropValuesByYear,
                              [String(year.year)]: Math.max(
                                0,
                                Math.min(
                                  2000,
                                  Number(event.target.value) || 0,
                                ),
                              ),
                            },
                          },
                        }));
                        setSaveState("idle");
                      }}
                    />
                    <small>/t</small>
                  </label>
                  <span>
                    <b>{formatYieldRange(year.combinedYieldGainTPerHa)}</b>
                    <strong>{formatMoneyRange(year.revenueGbpPerHa)}</strong>
                  </span>
                  <span>
                    <b>
                      {proposal.hasUnquotedCost && index === 0
                        ? "Quote needed"
                        : formatMoneyRange(year.netCashFlowGbpPerHa)}
                    </b>
                    <small>
                      PV{" "}
                      {proposal.hasUnquotedCost && index === 0
                        ? "withheld"
                        : formatMoneyRange(year.presentValueGbpPerHa)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
            <div className="economics-grid">
              <article>
                <small>Three-harvest gross revenue</small>
                <strong>{formatMoneyRange(threeYearRevenueGbpPerHa)}</strong>
                <span>
                  Undiscounted 2027–2029 yield impact before application cost.
                </span>
              </article>
              <article
                className={
                  economicSummary.npvGbpPerHa?.central !== undefined &&
                  economicSummary.npvGbpPerHa.central >= 0
                    ? "is-positive"
                    : "is-negative"
                }
              >
                <small>Three-year NPV</small>
                <strong>{threeYearNpvPerHaDisplay}</strong>
                <span>
                  {economicSummary.npvGbpPerHa
                    ? `${formatMoney(
                        economicSummary.npvGbpPerHa.central * soilField.areaHa,
                      )} central for the field.`
                    : "NPV is withheld until every positive-rate line has a cost."}
                </span>
              </article>
            </div>
            <details className="economics-method">
              <summary>How this three-year range is built</summary>
              <p>
                The untreated baseline starts after expected 2026 harvest
                removal. The proposed P/K correction is applied once before
                2027. Each later harvest reduces both scenarios using its
                editable yield and straw assumptions; no additional P/K is
                assumed in 2028 or 2029. Application cost is charged only in
                2027 and annual net cash flows are discounted at the entered
                rate.
              </p>
              <p>
                P and K central sensitivities are not added: the larger response
                is used in each year. A missing arable crop uses the declared
                wheat/barley/bean composite. Permanent-grass years receive no
                automatic grain-value response.
              </p>
              <p>{nutrientData.model.economics.note}</p>
            </details>
          </section>

          <section className="planner-card assessment-card">
            <div className="planner-section-heading">
              <div>
                <span className="eyebrow">5 · Agronomic sense-check</span>
                <h2>What the current scenario implies</h2>
              </div>
            </div>
            <div className="assessment-list">
              {assessment.map((item, index) => (
                <p className={`assessment-${item.tone}`} key={index}>
                  <i aria-hidden="true" />
                  {item.text}
                </p>
              ))}
            </div>
            <label className="plan-notes">
              <span>Field plan notes</span>
              <textarea
                rows={3}
                value={plan.notes}
                placeholder="Agronomist discussion, ordering constraints, application method…"
                onChange={(event) => {
                  updatePlan((current) => ({
                    ...current,
                    notes: event.target.value,
                  }));
                  setSaveState("idle");
                }}
              />
            </label>
          </section>

          <footer className="planner-source-footer">
            <span>
              Crop removal:{" "}
              <a
                href={nutrientData.sources.offtake.href}
                target="_blank"
                rel="noreferrer"
              >
                {nutrientData.sources.offtake.label}
              </a>
            </span>
            <span>
              Public prices:{" "}
              <a
                href={nutrientData.sources.publicPrices.href}
                target="_blank"
                rel="noreferrer"
              >
                {nutrientData.sources.publicPrices.label}
              </a>
            </span>
            <span>
              Private prices and analyses: {nutrientData.sources.privateProducts}
            </span>
            {nutrientData.sources.yieldResponse && (
              <span>
                Yield response:{" "}
                <a
                  href={nutrientData.sources.yieldResponse.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {nutrientData.sources.yieldResponse.label}
                </a>
              </span>
            )}
            {nutrientData.sources.yieldResponseComparison && (
              <span>
                Response likelihood:{" "}
                <a
                  href={nutrientData.sources.yieldResponseComparison.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {nutrientData.sources.yieldResponseComparison.label}
                </a>
              </span>
            )}
            {nutrientData.sources.cropValue && (
              <span>
                Crop-value anchor:{" "}
                <a
                  href={nutrientData.sources.cropValue.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {nutrientData.sources.cropValue.label}
                </a>
              </span>
            )}
          </footer>
        </div>
      </section>
      )}
    </main>
  );
}
