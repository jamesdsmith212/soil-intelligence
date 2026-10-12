export const TARGET_P_INDEX = 2;
export const TARGET_K_INDEX = 1.7;

type EstimateRange = {
  low: number;
  central: number;
  high: number;
};

export type FarmSummaryRow = {
  fieldId: string;
  fieldName: string;
  areaHa: number;
  testDate: string | null;
  latestPpmRange: EstimateRange;
  latestKppmRange: EstimateRange;
  latestPIndexRange: EstimateRange;
  latestKIndexRange: EstimateRange;
  latestPpm: number;
  latestKppm: number;
  latestPIndex: number;
  latestKIndex: number;
  postPpm: number;
  postKppm: number;
  postPIndex: number;
  postKIndex: number;
  proposedP2o5KgHa: number;
  proposedK2oKgHa: number;
  knownCostGbpHa: number;
  hasUnquotedCost: boolean;
  npvGbpHa: EstimateRange | null;
  applicationCount: number;
  productNames: string[];
};

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csvNumber = (value: number) =>
  Number.isFinite(value) ? value.toFixed(2) : "";

export const buildPostHarvestSoilScoresCsv = (
  rows: FarmSummaryRow[],
  modelAsAt: string,
) => {
  const headers = [
    "field_id",
    "field_name",
    "area_ha",
    "anchor_test_date",
    "model_as_at",
    "p_mg_l_central",
    "p_mg_l_low",
    "p_mg_l_high",
    "p_index_central",
    "p_index_low",
    "p_index_high",
    "k_mg_l_central",
    "k_mg_l_low",
    "k_mg_l_high",
    "k_index_central",
    "k_index_low",
    "k_index_high",
  ];
  const records = [...rows]
    .sort((left, right) => left.fieldName.localeCompare(right.fieldName))
    .map((row) =>
      [
        row.fieldId,
        row.fieldName,
        csvNumber(row.areaHa),
        row.testDate ?? "",
        modelAsAt,
        csvNumber(row.latestPpmRange.central),
        csvNumber(row.latestPpmRange.low),
        csvNumber(row.latestPpmRange.high),
        csvNumber(row.latestPIndexRange.central),
        csvNumber(row.latestPIndexRange.low),
        csvNumber(row.latestPIndexRange.high),
        csvNumber(row.latestKppmRange.central),
        csvNumber(row.latestKppmRange.low),
        csvNumber(row.latestKppmRange.high),
        csvNumber(row.latestKIndexRange.central),
        csvNumber(row.latestKIndexRange.low),
        csvNumber(row.latestKIndexRange.high),
      ]
        .map(csvCell)
        .join(","),
    );
  return [headers.join(","), ...records].join("\n");
};

export type FarmSummaryFilter =
  | "all"
  | "p-deficit"
  | "k-deficit"
  | "unplanned"
  | "planned";

export const hasPDeficit = (row: FarmSummaryRow) =>
  row.latestPIndex < TARGET_P_INDEX;

export const hasKDeficit = (row: FarmSummaryRow) =>
  row.latestKIndex < TARGET_K_INDEX;

export const fieldCorrectionStatus = (row: FarmSummaryRow) => {
  const before = Number(hasPDeficit(row)) + Number(hasKDeficit(row));
  const after =
    Number(row.postPIndex < TARGET_P_INDEX) +
    Number(row.postKIndex < TARGET_K_INDEX);

  if (row.applicationCount === 0) {
    return before > 0
      ? { label: "Correction needed", tone: "warn", rank: 0 }
      : { label: "At target", tone: "neutral", rank: 4 };
  }
  if (before === 0) {
    return { label: "Maintenance plan", tone: "neutral", rank: 3 };
  }
  if (after === 0) {
    return { label: "Target modelled", tone: "good", rank: 2 };
  }
  if (after < before) {
    return { label: "Partly corrected", tone: "info", rank: 1 };
  }
  return { label: "Still below target", tone: "warn", rank: 0 };
};

export const rowMatchesFilter = (
  row: FarmSummaryRow,
  filter: FarmSummaryFilter,
) => {
  if (filter === "p-deficit") return hasPDeficit(row);
  if (filter === "k-deficit") return hasKDeficit(row);
  if (filter === "unplanned")
    return row.applicationCount === 0 && (hasPDeficit(row) || hasKDeficit(row));
  if (filter === "planned") return row.applicationCount > 0;
  return true;
};

export const aggregateFarmSummary = (rows: FarmSummaryRow[]) =>
  rows.reduce(
    (total, row) => {
      total.areaHa += row.areaHa;
      if (hasPDeficit(row)) total.pDeficitHa += row.areaHa;
      if (hasKDeficit(row)) total.kDeficitHa += row.areaHa;
      if (row.applicationCount > 0) total.plannedFields += 1;
      total.plannedP2o5Tonnes +=
        (row.proposedP2o5KgHa * row.areaHa) / 1000;
      total.plannedK2oTonnes +=
        (row.proposedK2oKgHa * row.areaHa) / 1000;
      total.knownCostGbp += row.knownCostGbpHa * row.areaHa;
      if (row.hasUnquotedCost) total.fieldsAwaitingQuotes += 1;
      if (row.npvGbpHa) {
        total.npvGbp.low += row.npvGbpHa.low * row.areaHa;
        total.npvGbp.central += row.npvGbpHa.central * row.areaHa;
        total.npvGbp.high += row.npvGbpHa.high * row.areaHa;
        total.npvCoverageHa += row.areaHa;
      }
      return total;
    },
    {
      areaHa: 0,
      pDeficitHa: 0,
      kDeficitHa: 0,
      plannedFields: 0,
      plannedP2o5Tonnes: 0,
      plannedK2oTonnes: 0,
      knownCostGbp: 0,
      fieldsAwaitingQuotes: 0,
      npvGbp: { low: 0, central: 0, high: 0 },
      npvCoverageHa: 0,
    },
  );
