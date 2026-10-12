export type MetricKey = "ph" | "p" | "k" | "mg" | "om";
export type UnitMode = "index" | "value";
export type LandUse =
  | "permanent-grass"
  | "mixed-rotation"
  | "permanent-arable";
export type JudgementKey =
  | "critical"
  | "below"
  | "target"
  | "above"
  | "context"
  | "no-data";
export type AgronomySourceId = "rb209" | "greatsoils" | "sruc" | "orc";

export type FieldForLandUse = {
  crop?: string;
  results: { crop?: string }[];
};

export type PrimaryJudgement = {
  key: JudgementKey;
  label: string;
  detail: string;
};

export type AgronomyInput = {
  metric: MetricKey;
  value: number | null;
  rawValue: number | null;
  indexValue: number | null;
  landUse: LandUse;
};

export type SourceJudgement = {
  sourceIds: AgronomySourceId[];
  agreementKey: string;
  key: JudgementKey;
  headline: string;
  action: string;
  target: string;
  caveat?: string;
};

export type GenericAgronomyInput = {
  metric: {
    id: string;
    name: string;
    category: string;
  };
  value: number | null;
  indexValue: number | null;
  text?: string;
  unit?: string;
  interpretation?: string;
  method?: string;
  landUse: LandUse;
};

export const LAND_USE_LABELS: Record<LandUse, string> = {
  "permanent-grass": "Permanent grass",
  "mixed-rotation": "Mixed ley–arable rotation",
  "permanent-arable": "Permanent arable",
};

export const AGRONOMY_SOURCES: Record<
  AgronomySourceId,
  { shortLabel: string; label: string; href: string }
> = {
  rb209: {
    shortLabel: "RB209 2026",
    label: "AHDB Nutrient Management Guide (RB209), Section 1, March 2026",
    href: "https://projectblue.blob.core.windows.net/media/Default/Publications/RB209/NutrientManagementGuideRB209S1_260310_WEB.pdf",
  },
  greatsoils: {
    shortLabel: "AHDB / GREATsoils",
    label: "AHDB Principles of soil management / GREATsoils",
    href: "https://projectblue.blob.core.windows.net/media/Default/Imported%20Publication%20Docs/AHDB/GREATsoils/Principles%20of%20soil%20management%20%282025%29.pdf",
  },
  sruc: {
    shortLabel: "SRUC / FAS",
    label: "SRUC / Farm Advisory Service soil and fertiliser Technical Notes",
    href: "https://www.fas.scot/technical-notes/",
  },
  orc: {
    shortLabel: "Organic Research Centre",
    label: "Organic Research Centre: Soil and nutrient management on organic farms",
    href: "https://www.organicresearchcentre.com/manage/authincludes/article_uploads/iota/technical-leaflets/soil-and-nutrient-management-on-organic-farms.pdf",
  },
};

const GRASS_CROP =
  /\b(grass|graz|pasture|sward|clover|ley|reseed|silage|hay)\b/i;
const ARABLE_CROP =
  /\b(wheat|barley|oat|bean|pea|cereal|oilseed|rape|maize|potato|beet)\b/i;

export const inferLandUse = (field: FieldForLandUse): LandUse => {
  const crops = [field.crop, ...field.results.map((result) => result.crop)]
    .filter((crop): crop is string => Boolean(crop))
    .map((crop) => crop.replaceAll("_", " "));
  const hasGrass = crops.some((crop) => GRASS_CROP.test(crop));
  const hasArable = crops.some((crop) => ARABLE_CROP.test(crop));

  if (hasGrass && hasArable) return "mixed-rotation";
  if (hasGrass) return "permanent-grass";
  if (hasArable) return "permanent-arable";

  // With no usable crop history, mixed rotation is the least specific assumption.
  return "mixed-rotation";
};

export const isWheatProxyApplicable = (landUse: LandUse) =>
  landUse !== "permanent-grass";

const phTarget = (landUse: LandUse) => {
  if (landUse === "permanent-grass") return 6;
  if (landUse === "mixed-rotation") return 6.2;
  return 6.5;
};

const phUpper = (landUse: LandUse) =>
  landUse === "permanent-grass" ? 6.5 : 7;

const phJudgement = (
  value: number | null,
  target: number,
  upper: number,
): PrimaryJudgement => {
  if (value === null) {
    return {
      key: "no-data",
      label: "No result",
      detail: "No pH result is available for this date.",
    };
  }
  if (value < 5.5) {
    return {
      key: "critical",
      label: "Strongly acidic",
      detail: `Below pH 5.5 and well below the ${target.toFixed(1)} working optimum.`,
    };
  }
  if (value < target) {
    return {
      key: "below",
      label: "Below system optimum",
      detail: `Below the ${target.toFixed(1)} working optimum for this management system.`,
    };
  }
  if (value <= upper) {
    return {
      key: "target",
      label: "Within working range",
      detail: `${target.toFixed(1)}–${upper.toFixed(1)} working range for this management system.`,
    };
  }
  return {
    key: "above",
    label: "Above working range",
    detail: `Above pH ${upper.toFixed(1)}; avoid routine lime and check local soil context.`,
  };
};

const nutrientIndexJudgement = (
  metric: "p" | "k",
  indexValue: number | null,
): PrimaryJudgement => {
  if (indexValue === null) {
    return {
      key: "no-data",
      label: "No comparable index",
      detail: "Confirm the laboratory index or analytical method.",
    };
  }

  const targetLow = 1.5;
  const targetHigh = metric === "p" ? 2.5 : 2 + 1e-9;
  const target = metric === "p" ? "P Index 2" : "K Index 2−";

  if (indexValue < targetLow - 1) {
    return {
      key: "critical",
      label: "Well below target",
      detail: `Two or more bands below ${target}.`,
    };
  }
  if (indexValue < targetLow) {
    return {
      key: "below",
      label: "Below target",
      detail: `Below the RB209 ${target} production target.`,
    };
  }
  if (indexValue < targetHigh) {
    return {
      key: "target",
      label: "At target",
      detail: `Within the RB209 ${target} production band.`,
    };
  }
  return {
    key: "above",
    label: "Above target",
    detail: `Above ${target}; avoid further build-up and monitor rundown.`,
  };
};

const magnesiumJudgement = (
  indexValue: number | null,
): PrimaryJudgement => {
  if (indexValue === null) {
    return {
      key: "no-data",
      label: "No comparable index",
      detail: "Confirm the laboratory index or analytical method.",
    };
  }
  if (indexValue < 0.5) {
    return {
      key: "critical",
      label: "Deficient",
      detail: "Mg Index 0: consider crop need and magnesium application.",
    };
  }
  if (indexValue < 2.5) {
    return {
      key: "target",
      label: "Adequate",
      detail: "Mg Index 1 is satisfactory for combinable crops; routine build-up to Index 2 is unnecessary.",
    };
  }
  return {
    key: "above",
    label: "Above crop requirement",
    detail: "No routine magnesium input indicated; high Mg can be a natural soil property.",
  };
};

export const primaryJudgement = ({
  metric,
  value,
  indexValue,
  landUse,
}: AgronomyInput): PrimaryJudgement => {
  if (metric === "ph") {
    return phJudgement(value, phTarget(landUse), phUpper(landUse));
  }
  if (metric === "p" || metric === "k") {
    return nutrientIndexJudgement(metric, indexValue);
  }
  if (metric === "mg") {
    return magnesiumJudgement(indexValue);
  }
  if (value === null) {
    return {
      key: "no-data",
      label: "No result",
      detail: "No organic matter result is available for this date.",
    };
  }
  return {
    key: "context",
    label: "Trend and context",
    detail: "No universal organic-matter target: compare like-for-like results by soil texture and management system.",
  };
};

// Boundaries for rendering the same primary judgement on a continuous map.
export const primaryJudgementBoundaries = (metric: MetricKey, landUse: LandUse) => {
  if (metric === "om") return [];
  if (metric === "ph") return [5.5, phTarget(landUse), phUpper(landUse) + 1e-9];
  if (metric === "mg") return [0.5, 2.5];
  return [0.5, 1.5, metric === "p" ? 2.5 : 2 + 1e-9];
};

const source = (
  sourceId: AgronomySourceId,
  judgement: Omit<SourceJudgement, "sourceIds">,
): SourceJudgement => ({ ...judgement, sourceIds: [sourceId] });

const noResultJudgements = (): SourceJudgement[] =>
  (Object.keys(AGRONOMY_SOURCES) as AgronomySourceId[]).map((sourceId) =>
    source(sourceId, {
      agreementKey: "no-result",
      key: "no-data",
      headline: "No result to judge",
      action: "Obtain a representative soil test before making an input decision.",
      target: "Use a consistent sampling point and laboratory method for repeat tests.",
    }),
  );

const pHSourceJudgements = ({
  value,
  landUse,
}: AgronomyInput): SourceJudgement[] => {
  const rbTarget = phTarget(landUse);
  const rb = phJudgement(value, rbTarget, phUpper(landUse));
  const rbTargetText =
    landUse === "permanent-grass"
      ? "Optimum pH 6.0; lime target 6.2 on mineral soil."
      : landUse === "permanent-arable"
        ? "Optimum pH 6.5; lime target 6.7 on mineral soil."
        : "Working optimum pH 6.2; RB209 gives 6.0 where wheat or oats are the occasional cereal.";
  const rbAction =
    rb.key === "critical" || rb.key === "below"
      ? "Plan liming from a current lime-requirement test; correct low-pH patches and avoid exceeding the single-application limit."
      : rb.key === "above"
        ? "Avoid routine lime and investigate free lime, soil type and crop sensitivity."
        : "Maintain, monitor and retest within the rotation.";

  const judgements: SourceJudgement[] = [
    source("rb209", {
      agreementKey:
        landUse === "mixed-rotation" ? `rb209-ph-${rb.key}` : `rb-orc-ph-${rb.key}`,
      key: rb.key,
      headline: rb.label,
      action: rbAction,
      target: rbTargetText,
    }),
    source("greatsoils", {
      agreementKey: "greatsoils-ph-context",
      key: value !== null && value < 5.5 ? "critical" : "context",
      headline:
        value !== null && value < 5.5
          ? "Biology and rooting at risk"
          : "Crop and soil context required",
      action:
        "Maintain crop-appropriate pH, but assess structure, drainage, texture and rooting alongside chemistry.",
      target:
        "No standalone crop-system number; the guide flags impaired biology and rooting below pH 5.5.",
    }),
  ];

  const srucTarget = landUse === "permanent-grass" ? 5.8 : 6.2;
  const srucUpper = landUse === "permanent-grass" ? 6.2 : 7;
  const sruc = phJudgement(value, srucTarget, srucUpper);
  judgements.push(
    source("sruc", {
      agreementKey: `sruc-ph-${landUse}-${sruc.key}`,
      key: sruc.key,
      headline: sruc.label,
      action:
        sruc.key === "critical" || sruc.key === "below"
          ? "Use a Scottish lime-requirement test and soil texture before setting an application rate."
          : "Maintain and sample every four to five years.",
      target:
        landUse === "permanent-grass"
          ? "Permanent pasture is generally acceptable from pH 5.8; higher-clover swards need about 6.2."
          : "Arable and rotational grass target about pH 6.2 on mineral soils.",
      caveat: "Scottish guidance; use as a comparison rather than the governing recommendation for this English farm.",
    }),
  );

  if (landUse === "mixed-rotation") {
    judgements.push(
      source("orc", {
        agreementKey: "orc-ph-mixed",
        key: "context",
        headline: "Judge the current rotation phase",
        action:
          "Maintain biological activity and nutrient cycling with drainage, structure and crop-appropriate liming.",
        target: "Organic guide: pH 6.0 for grassland and 6.5 for arable soils.",
        caveat: "Organic-system lens; the guide does not set one mixed-rotation target.",
      }),
    );
  } else {
    const orc = phJudgement(value, rbTarget, phUpper(landUse));
    judgements.push(
      source("orc", {
        agreementKey: `rb-orc-ph-${orc.key}`,
        key: orc.key,
        headline: orc.label,
        action: rbAction,
        target:
          landUse === "permanent-grass"
            ? "pH 6.0 for grassland."
            : "pH 6.5 for arable soils.",
        caveat: "Organic-system lens; use alongside the farm's certification and nutrient plan.",
      }),
    );
  }

  return judgements;
};

const pkAction = (
  metric: "p" | "k",
  key: JudgementKey,
) => {
  if (key === "critical" || key === "below") {
    return metric === "p"
      ? "Correct pH and rooting constraints, then build P gradually toward target and replace crop or forage offtake."
      : "Build K toward target, replace offtake and account for manure, removed straw and conserved grass.";
  }
  if (key === "target") {
    return "Use maintenance inputs based on measured offtake and retest through the rotation.";
  }
  if (key === "above") {
    return "Do not build further; reduce or omit routine applications, account for organic inputs and monitor rundown.";
  }
  return "Confirm the laboratory index and analytical method before making an input decision.";
};

const pkSourceJudgements = (
  input: AgronomyInput & { metric: "p" | "k" },
): SourceJudgement[] => {
  const primary = nutrientIndexJudgement(input.metric, input.indexValue);
  const nutrient = input.metric === "p" ? "phosphate" : "potash";
  const rbTarget =
    input.metric === "p"
      ? "RB209 P Index 2; SRUC Moderate P status."
      : "RB209 K Index 2−; SRUC lower-Moderate K status.";

  return [
    source("rb209", {
      agreementKey: `rb-sruc-${input.metric}-${primary.key}`,
      key: primary.key,
      headline: primary.label,
      action: pkAction(input.metric, primary.key),
      target: rbTarget,
      caveat:
        "The two systems agree on direction, but their analytical scales differ.",
    }),
    source("sruc", {
      agreementKey: `rb-sruc-${input.metric}-${primary.key}`,
      key: primary.key,
      headline: primary.label,
      action: pkAction(input.metric, primary.key),
      target: rbTarget,
      caveat:
        "The two systems agree on direction, but SRUC uses Scottish Modified Morgan status bands; do not transfer its mg/L cut-offs to this result.",
    }),
    source("greatsoils", {
      agreementKey: `greatsoils-${input.metric}`,
      key: "context",
      headline: "Chemistry must be made usable",
      action:
        "Check pH, soil type, drainage and VESS structure, then match nutrient supply to the crop and rotation demand.",
      target: `No separate ${nutrient} threshold; use the crop-system recommendation with physical and biological checks.`,
    }),
    source("orc", {
      agreementKey: `orc-${input.metric}-${primary.key}`,
      key: primary.key,
      headline:
        primary.key === "critical" || primary.key === "below"
          ? "Demonstrate and correct the long-term deficit"
          : primary.key === "above"
            ? "Avoid unnecessary supplementary inputs"
            : "Maintain the nutrient balance",
      action:
        input.metric === "p"
          ? "Use soil or foliar analysis and a field nutrient budget; permitted rock phosphate or compost is a long-term correction, not a short-term yield boost."
          : "Budget removals and returns carefully; replace large K removals from cut grass and harvested crops, with particular attention to clover.",
      target:
        "The organic guide does not prescribe a numeric index target; it prioritises rotations, residues, manures and demonstrated need.",
      caveat: "Organic-system lens; standard extraction may not capture all biologically available P.",
    }),
  ];
};

const magnesiumSourceJudgements = (
  input: AgronomyInput,
): SourceJudgement[] => {
  const rb = magnesiumJudgement(input.indexValue);
  const sruc =
    input.rawValue === null
      ? ({
          key: "no-data",
          label: "Method confirmation needed",
          detail: "",
        } as PrimaryJudgement)
      : input.rawValue < 20
        ? ({ key: "critical", label: "Very low", detail: "" } as PrimaryJudgement)
        : input.rawValue < 61
          ? ({ key: "below", label: "Low", detail: "" } as PrimaryJudgement)
          : input.rawValue <= 200
            ? ({ key: "target", label: "Moderate", detail: "" } as PrimaryJudgement)
            : ({ key: "above", label: "High", detail: "" } as PrimaryJudgement);

  return [
    source("rb209", {
      agreementKey: `rb-mg-${rb.key}`,
      key: rb.key,
      headline: rb.label,
      action:
        rb.key === "critical" || rb.key === "below"
          ? "Check crop sensitivity and pH; correct Mg Index 0 and consider Index 1 for responsive crops."
          : "Do not build magnesium routinely; monitor the index and crop symptoms.",
      target:
        "Mg Index 1 is satisfactory for combinable crops; building to Index 2 is generally unnecessary and uneconomic.",
    }),
    source("sruc", {
      agreementKey: `sruc-mg-${sruc.key}`,
      key: sruc.key,
      headline: sruc.label,
      action:
        sruc.key === "critical" || sruc.key === "below"
          ? "If acidity also needs correction, consider magnesian limestone; otherwise use a crop-specific Mg source."
          : "Avoid extra Mg where status is high and consider K balance on heavy soils.",
      target: "Modified Morgan Mg: Low below 61 mg/L; Moderate 61–200 mg/L; High above 200 mg/L.",
      caveat: "Provisional comparison only unless the laboratory used the SRUC Modified Morgan method.",
    }),
    source("greatsoils", {
      agreementKey: "context-mg",
      key: "context",
      headline: "No standalone application decision",
      action:
        "Use soil texture and CEC, pH, K balance, crop sensitivity, rooting and tissue symptoms with the Mg result.",
      target: "Lower-CEC sandy soils are more prone to Mg deficiency than clay-rich soils.",
    }),
    source("orc", {
      agreementKey: "context-mg",
      key: "context",
      headline: "No standalone application decision",
      action:
        "Use soil texture and CEC, pH, K balance, crop sensitivity, rooting and tissue symptoms with the Mg result.",
      target: "The named organic guide gives no numeric Mg target.",
      caveat: "Organic-system lens.",
    }),
  ];
};

const organicMatterSourceJudgements = (
  input: AgronomyInput,
): SourceJudgement[] => [
  source("rb209", {
    agreementKey: "rb-great-om",
    key: "context",
    headline: "No universal organic-matter threshold",
    action:
      "Compare repeat tests on the same field, method and sampling point; maintain or increase organic matter where practical.",
    target:
      "Interpret by soil texture, climate and farming system; grassland naturally carries more OM than long-term arable soil.",
  }),
  source("greatsoils", {
    agreementKey: "rb-great-om",
    key: "context",
    headline: "No universal organic-matter threshold",
    action:
      "Compare repeat tests on the same field, method and sampling point; maintain or increase organic matter where practical.",
    target:
      "Interpret by soil texture, climate and farming system; grassland naturally carries more OM than long-term arable soil.",
  }),
  source("sruc", {
    agreementKey: "sruc-om",
    key: "context",
    headline: "Use field trend and soil type",
    action:
      "Keep the laboratory method consistent and interpret the result with texture, crop system and long-term soil-carbon trend.",
    target: "The cited fertiliser Technical Notes do not set a universal OM target.",
    caveat: "Scottish technical-note lens.",
  }),
  source("orc", {
    agreementKey: "orc-om",
    key: "context",
    headline: "Organic matter is the management engine",
    action:
      input.landUse === "permanent-arable"
        ? "Return residues, use cover crops, manures or composts and consider ley phases to protect biological activity and structure."
        : input.landUse === "mixed-rotation"
          ? "Use fertility-building leys, residues and manures to balance fertility-building and fertility-depleting phases."
          : "Protect sward, rooting and manure return; avoid poaching and maintain regular fresh organic inputs.",
    target: "Judge function and trend, not a single percentage in isolation.",
    caveat: "Organic-system lens.",
  }),
];

export const agronomyJudgements = (
  input: AgronomyInput,
): SourceJudgement[] => {
  if (
    input.value === null &&
    input.rawValue === null &&
    input.indexValue === null
  ) {
    return noResultJudgements();
  }
  if (input.metric === "ph") return pHSourceJudgements(input);
  if (input.metric === "p" || input.metric === "k") {
    return pkSourceJudgements({ ...input, metric: input.metric });
  }
  if (input.metric === "mg") return magnesiumSourceJudgements(input);
  return organicMatterSourceJudgements(input);
};

const genericSource = (
  sourceId: AgronomySourceId,
  agreementKey: string,
  headline: string,
  action: string,
  target: string,
  caveat?: string,
): SourceJudgement =>
  source(sourceId, {
    agreementKey,
    key: "context",
    headline,
    action,
    target,
    caveat,
  });

const allNamedSources = Object.keys(AGRONOMY_SOURCES) as AgronomySourceId[];

const outsideAgronomicGuides = (input: GenericAgronomyInput) =>
  allNamedSources.map((sourceId) =>
    genericSource(
      sourceId,
      `outside-agronomic-guides-${input.metric.id}`,
      "No agronomic target in these guides",
      "Do not use this result alone to justify a nutrient application. Confirm the analytical method and obtain environmental or regulatory interpretation if the concentration is a concern.",
      `${input.metric.name} is outside the routine crop-fertility thresholds used by these four sources.`,
      "A total concentration is not the same as plant-available concentration or a regulatory risk assessment.",
    ),
  );

const textureJudgements = (input: GenericAgronomyInput) => [
  genericSource(
    "rb209",
    `texture-mainstream-${input.metric.id}`,
    "An inherent constraint, not a target",
    "Use the result to choose the appropriate soil category, nutrient-supply assumptions, sampling intensity and application strategy.",
    "These sources do not prescribe an optimum texture; they use it to adjust water, structural, lime and nutrient decisions.",
  ),
  genericSource(
    "greatsoils",
    `texture-mainstream-${input.metric.id}`,
    "An inherent constraint, not a target",
    "Use the result to choose the appropriate soil category, nutrient-supply assumptions, sampling intensity and application strategy.",
    "These sources do not prescribe an optimum texture; they use it to adjust water, structural, lime and nutrient decisions.",
  ),
  genericSource(
    "sruc",
    `texture-mainstream-${input.metric.id}`,
    "An inherent constraint, not a target",
    "Use the result to choose the appropriate soil category, nutrient-supply assumptions, sampling intensity and application strategy.",
    "These sources do not prescribe an optimum texture; they use it to adjust water, structural, lime and nutrient decisions.",
    "Scottish guidance is a comparison for this English farm.",
  ),
  genericSource(
    "orc",
    `texture-organic-${input.metric.id}`,
    "Adapt the fertility system to texture",
    "On lighter soil prioritise organic inputs, cover and split nutrient supply; on heavier soil prioritise drainage, trafficability and structure.",
    "The organic guide varies lime need and nutrient-loss risk by texture rather than setting an optimum texture.",
    "Organic-system lens.",
  ),
];

const physicalAssessmentActions: Record<string, string> = {
  "available-water":
    "Match crop choice, establishment and drought planning to the soil's water-holding constraint; inspect rooting depth and compaction before attributing it to texture alone.",
  "drainage-rate":
    "Ground-truth drainage, wetness and structure in the field; avoid trafficking wet soil and correct drainage or compaction constraints before expecting nutrient response.",
  "inherent-fertility":
    "Treat the category as context for nutrient retention and supply, then base applications on crop need, soil analysis, manures and offtake.",
  "leaching-risk":
    "Use split and well-timed applications, retain winter cover where practical and avoid nutrient loading ahead of high drainage risk.",
  "potential-c-e-c":
    "Use this qualitative retention class with measured CEC, texture, pH and organic matter; lower retention favours smaller, better-timed applications.",
  "warming-rate":
    "Use the category to temper expectations for spring mineralisation and establishment; check wetness, cover and soil structure alongside it.",
};

const physicalAssessmentJudgements = (input: GenericAgronomyInput) => {
  const action =
    physicalAssessmentActions[input.metric.id] ??
    "Use this qualitative assessment as field context and verify it with direct field observations before changing management.";
  return allNamedSources.map((sourceId) =>
    genericSource(
      sourceId,
      `physical-assessment-${input.metric.id}`,
      "Management context, not a pass/fail score",
      action,
      `None of the four sources defines a universal agronomic target for ${input.metric.name.toLowerCase()}.`,
      sourceId === "sruc"
        ? "Scottish technical-note lens."
        : sourceId === "orc"
          ? "Organic-system lens."
          : undefined,
    ),
  );
};

const cecJudgements = (input: GenericAgronomyInput) => [
  genericSource(
    "rb209",
    `cec-no-target-${input.metric.id}`,
    "No standalone fertiliser target",
    "Use texture, pH, organic matter and crop need with this result; do not balance cations to a fixed ratio from CEC alone.",
    "Neither source defines a universal CEC target for routine fertiliser recommendation.",
  ),
  genericSource(
    "sruc",
    `cec-no-target-${input.metric.id}`,
    "No standalone fertiliser target",
    "Use texture, pH, organic matter and crop need with this result; do not balance cations to a fixed ratio from CEC alone.",
    "Neither source defines a universal CEC target for routine fertiliser recommendation.",
    "Scottish technical-note lens.",
  ),
  genericSource(
    "greatsoils",
    `cec-greatsoils-${input.metric.id}`,
    "Interpret nutrient-retention capacity",
    "Low CEC means less buffering and greater risk of acidification or K and Mg deficiency; adapt timing and organic-matter management rather than chasing a single number.",
    "CEC rises with clay, clay type, pH and well-decomposed organic matter; no universal optimum is prescribed.",
  ),
  genericSource(
    "orc",
    `cec-orc-${input.metric.id}`,
    "Specialist interpretation needed",
    "Use CEC as one part of soil type and nutrient-retention context; prioritise soil function, rotations and demonstrated crop need.",
    "The named organic guide does not set a numeric CEC target.",
    "Organic-system lens; base-saturation systems require specialist interpretation and are not treated here as a universal target.",
  ),
];

const limeRequirementJudgements = (input: GenericAgronomyInput) => [
  genericSource(
    "rb209",
    `lime-requirement-rb-${input.metric.id}`,
    "Use the laboratory rate, then adjust the product",
    "Confirm the sample pH, soil type, crop system, material neutralising value and spreading uniformity before converting the reported lime requirement into a product rate.",
    input.landUse === "permanent-grass"
      ? "RB209 mineral-soil grassland optimum pH is 6.0, with a 6.2 lime target."
      : input.landUse === "permanent-arable"
        ? "RB209 mineral-soil arable optimum pH is 6.5, with a 6.7 lime target."
        : "Use the crop sequence: RB209 does not set one universal mixed-rotation lime rate.",
  ),
  genericSource(
    "greatsoils",
    `lime-requirement-great-${input.metric.id}`,
    "Texture and material quality matter",
    "Use more spatial sampling where pH varies, account for the liming value of organic materials, and select the product by neutralising value, fineness and soil texture.",
    "The reported tonnes per hectare are method- and target-specific, not a universal performance score.",
  ),
  genericSource(
    "sruc",
    `lime-requirement-sruc-${input.metric.id}`,
    "Check soil type and land use",
    "Use a lime-requirement test calibrated for the analytical method and distinguish mineral, organic, humose and peaty soils.",
    input.landUse === "permanent-grass"
      ? "FAS comparison: mineral-soil permanent grass target pH about 5.8; intensive grass about 6.0."
      : "FAS comparison: mineral-soil arable target pH about 6.4.",
    "Scottish guidance is a comparison for this English farm.",
  ),
  genericSource(
    "orc",
    `lime-requirement-orc-${input.metric.id}`,
    "Correct acidity without over-liming",
    "Use the lime requirement with texture and neutralising value; avoid attempting a rise of more than about 0.5 pH unit in one application.",
    input.landUse === "permanent-grass"
      ? "Organic guide target: pH 6.0 for grassland."
      : "Organic guide target: pH 6.5 for arable soil.",
    "Organic-system lens.",
  ),
];

const secondaryNutrientJudgements = (input: GenericAgronomyInput) => {
  const nutrient = input.metric.name;
  const rbAction =
    input.metric.id === "sulphur"
      ? "Base sulphur decisions on crop requirement and deficiency risk; a routine extractable-soil result is not a universal predictor of response."
      : input.metric.id === "calcium"
        ? "Manage pH and lime requirement first; do not apply calcium simply to reach a universal soil concentration or cation ratio."
        : input.metric.id === "sodium"
          ? "Use sodium only for a crop-specific recommendation; there is no general arable soil target."
          : "Confirm crop sensitivity, symptoms, pH and the laboratory extractant before any trace-element application.";
  return [
    genericSource(
      "rb209",
      `secondary-rb-${input.metric.id}`,
      "Crop- and method-specific interpretation",
      rbAction,
      `RB209 does not define a universal whole-farm soil-test target for ${nutrient.toLowerCase()}.`,
    ),
    genericSource(
      "greatsoils",
      `secondary-great-${input.metric.id}`,
      "Check the soil system before treating the number",
      "Interpret availability with pH, texture, CEC, organic matter, drainage, rooting and crop symptoms; correct physical or pH constraints first.",
      `Principles of Soil Management provides context, not a universal ${nutrient.toLowerCase()} threshold.`,
    ),
    genericSource(
      "sruc",
      `secondary-sruc-${input.metric.id}`,
      "Use crop-specific technical guidance",
      input.metric.id === "sulphur"
        ? "Use crop, soil type, rainfall and organic-input history to assess sulphur risk; follow crop-specific rates rather than a generic soil ppm target."
        : "Confirm the extraction method and use a crop-specific deficiency or toxicity assessment, supported by tissue analysis where appropriate.",
      `The cited routine FAS soil interpretation does not provide a transferable universal ${nutrient.toLowerCase()} cut-off for this result.`,
      "Scottish methods and status bands must not be transferred directly to a different extraction method.",
    ),
    genericSource(
      "orc",
      `secondary-orc-${input.metric.id}`,
      "Demonstrate need and plan for the long term",
      "Use soil and/or foliar analysis, nutrient budgets, residues and manures to demonstrate need; check that any supplementary input is permitted under the applicable organic standard.",
      `The named organic guide sets no universal ${nutrient.toLowerCase()} soil-test target.`,
      "Organic-system lens; many supplementary sources act slowly and should not be treated as a short-term yield boost.",
    ),
  ];
};

const organicStatusJudgements = (input: GenericAgronomyInput) =>
  organicMatterSourceJudgements({
    metric: "om",
    value: input.value,
    rawValue: input.value,
    indexValue: null,
    landUse: input.landUse,
  });

/**
 * Source-by-source interpretation for every metric in the canonical database.
 * Quantitative recommendations remain restricted to metrics and methods the
 * cited guides actually cover; every other result receives an explicit,
 * management-oriented context rather than an invented threshold.
 */
export const agronomyJudgementsForMetric = (
  input: GenericAgronomyInput,
): SourceJudgement[] => {
  const coreMetric: Partial<Record<string, MetricKey>> = {
    ph: "ph",
    phosphorus: "p",
    potassium: "k",
    magnesium: "mg",
    "organic-matter": "om",
  };
  const core = coreMetric[input.metric.id];
  if (core) {
    return agronomyJudgements({
      metric: core,
      value: input.value,
      rawValue: input.value,
      indexValue: input.indexValue,
      landUse: input.landUse,
    });
  }

  if (
    input.metric.id === "organic-carbon" ||
    input.metric.id === "organic-matter-status"
  ) {
    return organicStatusJudgements(input);
  }
  if (
    ["sand", "silt", "clay", "soil-type", "texture"].includes(
      input.metric.id,
    )
  ) {
    return textureJudgements(input);
  }
  if (input.metric.category === "Physical assessment") {
    return physicalAssessmentJudgements(input);
  }
  if (["c-e-c", "potential-c-e-c"].includes(input.metric.id)) {
    return cecJudgements(input);
  }
  if (input.metric.id.startsWith("lime-requirement")) {
    return limeRequirementJudgements(input);
  }
  if (
    input.metric.category === "Secondary and micro nutrients" ||
    input.metric.id === "calcium"
  ) {
    return secondaryNutrientJudgements(input);
  }
  if (
    input.metric.category === "Total elements" ||
    input.metric.id === "fluoride"
  ) {
    return outsideAgronomicGuides(input);
  }

  return allNamedSources.map((sourceId) =>
    genericSource(
      sourceId,
      `generic-context-${input.metric.id}`,
      "No universal threshold in these guides",
      "Use the reported laboratory interpretation, analytical method and field trend, then seek crop- or issue-specific advice before changing inputs.",
      `The named source does not define a transferable target for ${input.metric.name.toLowerCase()}.`,
    ),
  );
};

export const groupAgronomyJudgements = (
  judgements: SourceJudgement[],
): SourceJudgement[] => {
  const groups = new Map<string, SourceJudgement>();
  judgements.forEach((judgement) => {
    const existing = groups.get(judgement.agreementKey);
    if (!existing) {
      groups.set(judgement.agreementKey, { ...judgement });
      return;
    }
    existing.sourceIds = [...existing.sourceIds, ...judgement.sourceIds];
    if (judgement.caveat && judgement.caveat !== existing.caveat) {
      existing.caveat = [existing.caveat, judgement.caveat]
        .filter(Boolean)
        .join(" ");
    }
  });
  return [...groups.values()];
};
