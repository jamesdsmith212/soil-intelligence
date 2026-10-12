export type SoilMetricGroup = "all" | "core" | "texture" | "trace";

export const CORE_METRIC_IDS = ["ph", "phosphorus", "potassium", "magnesium", "organic-matter", "organic-carbon"];
export const TEXTURE_METRIC_IDS = ["clay", "sand", "silt"];
export const TRACE_METRIC_IDS = [
  "boron", "copper", "iron", "manganese", "molybdenum", "zinc", "sodium", "sulphur",
];

const groupMetricIds = (group: Exclude<SoilMetricGroup, "all">) =>
  group === "core" ? CORE_METRIC_IDS : group === "texture" ? TEXTURE_METRIC_IDS : TRACE_METRIC_IDS;

export const metricMatchesGroup = (id: string, group: SoilMetricGroup) =>
  group === "all" || groupMetricIds(group).includes(id);

export const firstMetricInGroup = (ids: string[], group: SoilMetricGroup) =>
  (group === "all" ? ids : groupMetricIds(group))
    .find(id => ids.includes(id));
