// Colour coordinates are independent of the chosen result display units.
// A band-only report supplies an ordinal position, not a reconstructed ppm value.
export const reportedIndex = (result: {
  indexValue?: number;
  displayBand?: string;
  indexBand?: string;
}): number | null => {
  if (Number.isFinite(result.indexValue)) return result.indexValue!;
  const match = (result.displayBand ?? result.indexBand ?? "")
    .trim().replace(/[−–]/g, "-").match(/^(\d+(?:\.\d+)?)([+-])?$/);
  if (!match) return null;
  return Math.max(0, Number(match[1]) + (match[2] === "+" ? 0.3 : match[2] === "-" ? -0.3 : 0));
};

// The lab's decimal index and its displayed band are different scales.
// For example, a decimal 0.7 can explicitly belong to band 0+; never round
// that decimal into band 1 for colouring. Preserve it separately for inspection.
export const indexColourValue = (result: Parameters<typeof reportedIndex>[0]): number | null =>
  reportedIndex({ displayBand: result.displayBand, indexBand: result.indexBand }) ?? reportedIndex(result);

export const NO_DATA = "#d4d8d0";
export const STATUS_COLORS = {
  critical: "#bd4739", below: "#dc9a2f", target: "#2e7355",
  above: "#326b91", context: "#6a746f", "no-data": NO_DATA,
} as const;
export const NUMERIC_PALETTE = [
  "#e0ecf4", "#bfd3e6", "#9ebcda", "#8c96c6", "#8c6bb1", "#88419d", "#6e016b",
] as const;
export type ColourBand = { colour: string; minimum: number; label: string };
export type ColourScale = { bands: ColourBand[]; unit: string; description: string };
export const usesIndexColours = (metricId: string) =>
  ["phosphorus", "potassium", "magnesium"].includes(metricId);

export const nutrientAgronomicScale = (metricId: string): ColourScale | null => {
  if (!usesIndexColours(metricId)) return null;
  const rows: [number, string, string][] = metricId === "phosphorus"
    ? [[-Infinity, "critical", "Index 0 · low"], [0.5, "below", "Index 1 · below target"], [1.5, "target", "Index 2 · at target"], [2.5, "above", "Index 3 and above · above target"]]
    : metricId === "potassium"
      ? [[-Infinity, "critical", "Index 0 · low"], [0.5, "below", "Index 1 · below target"], [1.5, "target", "Index 2− / unsplit 2 · at target"], [2 + 1e-9, "above", "Index 2+ and above · above target"]]
      : [[-Infinity, "critical", "Index 0 · deficient"], [0.5, "target", "Indices 1–2 · adequate"], [2.5, "above", "Index 3 and above · above requirement"]];
  return {
    bands: rows.map(([minimum, key, label]) => ({ minimum, colour: STATUS_COLORS[key as keyof typeof STATUS_COLORS], label })),
    unit: "Laboratory index band",
    description: "Colours follow the displayed laboratory band in both Index and Reported units. 0+ stays in Index 0; 1− and 1+ stay in Index 1. K 2− and 2+ are separate. Field averages and smoothing use these band positions. Above target does not mean better.",
  };
};

export const interpretationColour = (value?: string) => {
  const status: Record<string, keyof typeof STATUS_COLORS> = {
    "very low": "critical", low: "below", "slightly low": "below",
    normal: "target", adequate: "target", high: "above", "very high": "above",
  };
  const key = status[value?.trim().toLowerCase() ?? ""];
  return key ? STATUS_COLORS[key] : undefined;
};

export const colourFromScale = (value: number | null, bands: ColourBand[]) => {
  if (value === null || !Number.isFinite(value)) return NO_DATA;
  return bands.findLast((band) => value >= band.minimum)?.colour ?? NO_DATA;
};

const numberLabel = (value: number) => Number(value.toPrecision(4)).toString();

export const relativeColourScale = (
  metricId: string,
  referenceValues: number[],
  unit: string,
): ColourScale => {
  if (usesIndexColours(metricId)) {
    const potassium = metricId === "potassium";
    const boundaries = potassium ? [0.5, 1.5, 2, 2.5, 3.5, 4.5] : [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
    const labels = potassium ? ["0", "1", "2−", "2 (unsplit) / 2+", "3", "4", "5 and above"] : ["0", "1", "2", "3", "4", "5", "6 and above"];
    return {
      bands: labels.map((label, index) => ({ colour: NUMERIC_PALETTE[index], minimum: index ? boundaries[index - 1] : -Infinity, label: `Index ${label}` })),
      unit: "Laboratory index",
      description: "Light = lower index; dark = higher index, not better performance. Colours stay the same in Index and Reported units. +/− subdivisions use their position within the band; K 2− and 2+ are separate. Smoothing estimates index position, not ppm.",
    };
  }
  const values = referenceValues.filter(Number.isFinite);
  const lower = values.length ? Math.min(...values) : 0;
  const upper = values.length ? Math.max(...values) : 0;
  const boundaries = Array.from({ length: 6 }, (_, i) => lower + ((i + 1) / 7) * (upper - lower));
  return {
    bands: upper === lower
      ? [{ colour: NUMERIC_PALETTE[3], minimum: -Infinity, label: values.length ? `${numberLabel(lower)} ${unit}` : "No numeric results" }]
      : NUMERIC_PALETTE.map((colour, index) => ({
        colour,
        minimum: index ? boundaries[index - 1] : -Infinity,
        label: index === 0 ? `< ${numberLabel(boundaries[0])}` : index === 6 ? `≥ ${numberLabel(boundaries[5])}` : `${numberLabel(boundaries[index - 1])} to < ${numberLabel(boundaries[index])}`,
      })),
    unit,
    description: "Light = lower; dark = higher, not better performance. Fixed ranges across all recorded years, fields, grids and smoothed maps. Colours use reported concentrations even when indices are displayed.",
  };
};
