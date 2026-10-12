"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fitMapPoints, constrainMapViewport, zoomMapViewport, type MapViewport } from "./soil-map-viewport";
import { firstMetricInGroup, metricMatchesGroup, type SoilMetricGroup } from "./soil-metric-groups";
import {
  AGRONOMY_SOURCES,
  LAND_USE_LABELS,
  agronomyJudgementsForMetric,
  groupAgronomyJudgements,
  inferLandUse,
  isWheatProxyApplicable,
  primaryJudgement,
  primaryJudgementBoundaries,
  type LandUse,
  type MetricKey,
} from "./agronomy";
import {
  interpolateSpatialValue,
  selectInterpolationParameters,
  type InterpolationPolicy,
  type SpatialSample,
} from "./spatial-interpolation";
import {
  TEST_AGE_BANDS,
  latestSoilRecord,
  soilTestAgeBand,
  type TestAgeBandKey,
} from "./soil-test-age";
import {
  NO_DATA,
  colourFromScale,
  relativeColourScale,
  reportedIndex,
  indexColourValue,
  nutrientAgronomicScale,
  usesIndexColours,
  STATUS_COLORS,
  interpretationColour,
  type ColourBand,
} from "./soil-map-scale";

type Position = [number, number];
type Geometry =
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "Polygon"; coordinates: Position[][] };

export type GenericMetricResult = {
  value?: number;
  text?: string;
  operator?: string;
  unit?: string;
  indexValue?: number;
  indexBand?: string;
  displayBand?: string;
  interpretation?: string;
  method?: string;
  category?: string;
  comment?: string;
  sourceImage?: string;
};

export type SoilMetricMeta = {
  id: string;
  name: string;
  category: string;
  categories: string[];
  units: string[];
  methods: string[];
  kind: "numeric" | "categorical";
  resultCount: number;
  gridResultCount: number;
  indexAvailable: boolean;
  gridIndexAvailable: boolean;
  boundaryPolicy: "field-constrained" | "cross-field" | "not-smoothed";
};

type GridField = {
  id: string;
  name: string;
  canonicalId?: string;
  crop?: string;
  areaHa: number;
  geometry: Geometry;
  results: {
    date: string;
    dateSort: string;
    matchedFrom?: string;
    crop?: string;
    samplingGridId?: string;
    metrics?: Record<string, GenericMetricResult>;
  }[];
};

export type SamplingGrid = {
  id: string;
  fieldId?: string;
  canonicalFieldId?: string;
  fieldName?: string;
  centroid: Position;
  geometry: Geometry;
  areaHa: number;
  sampleId?: string;
  sampleDate?: string;
  results: Record<string, GenericMetricResult>;
};

export type SoilGridPayload = {
  generatedAt: string;
  sources: { workbook: string; boundaries: string; grids?: string | null };
  fields: GridField[];
  metrics?: SoilMetricMeta[];
  grids?: SamplingGrid[];
};

type ResolutionMode = "field" | "grid" | "smooth";
type UnitMode = "reported" | "index";
type ColourMode = "relative" | "interpretation";
type TimeMode = "latest" | "timeline" | "last-test";
type FieldEvidenceMode = "auto" | "s1-average" | "bse-average";
type AdvancedEvidenceMode = FieldEvidenceMode | "grid";
type ObservationEvidence =
  | "s1-average"
  | "bse-average"
  | "interpolated-bse"
  | "legacy";

type DisplayObservation = {
  numeric: number | null;
  text: string;
  unit: string;
  reportedUnit: string;
  rawValue: number | null;
  indexValue: number | null;
  colourIndex: number | null;
  interpretation?: string;
  method?: string;
  comment?: string;
  date?: string;
  samples: number;
  evidence: ObservationEvidence;
};

type SelectedArea =
  | { kind: "field"; id: string }
  | { kind: "grid"; id: string };

type MetricHistoryPoint = DisplayObservation & { date: string };

type SmoothFieldSurface = {
  fieldId: string;
  predictions: number;
  baseColour: string;
  bands: { colour: string; path: string }[];
  supportGrids: SamplingGrid[];
  supportSamples: SpatialSample[];
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 720;
const CATEGORY_PALETTE = [
  "#3f6e8f",
  "#8a6f9e",
  "#bd7f28",
  "#53856a",
  "#b15f5b",
  "#6f806b",
] as const;
const LAND_USE_STORAGE_KEY = "soil-intelligence-soil-land-use-overrides";
const EMPTY_METRIC: SoilMetricMeta = {
  id: "",
  name: "Soil metric",
  category: "Other",
  categories: [],
  units: [],
  methods: [],
  kind: "numeric",
  resultCount: 0,
  gridResultCount: 0,
  indexAvailable: false,
  gridIndexAvailable: false,
  boundaryPolicy: "field-constrained",
};

const polygonsFor = (geometry: Geometry): Position[][][] =>
  geometry.type === "MultiPolygon"
    ? geometry.coordinates
    : [geometry.coordinates];

const coordinatesFor = (geometry: Geometry) => polygonsFor(geometry).flatMap((polygon) => polygon.flat());

const geometryCentroid = (geometry: Geometry): Position => {
  const points = polygonsFor(geometry)[0]?.[0] ?? [];
  if (!points.length) return [0, 0];
  return [
    points.reduce((sum, [longitude]) => sum + longitude, 0) / points.length,
    points.reduce((sum, [, latitude]) => sum + latitude, 0) / points.length,
  ];
};

const createProjection = (fields: GridField[]) => {
  const positions = fields.flatMap((field) =>
    polygonsFor(field.geometry).flatMap((polygon) => polygon.flat()),
  );
  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  const minX = Math.min(...longitudes);
  const maxX = Math.max(...longitudes);
  const minY = Math.min(...latitudes);
  const maxY = Math.max(...latitudes);
  const padding = 42;
  const longitudeScale = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const dataWidth = Math.max((maxX - minX) * longitudeScale, 0.0001);
  const dataHeight = Math.max(maxY - minY, 0.0001);
  const scale = Math.min(
    (MAP_WIDTH - padding * 2) / dataWidth,
    (MAP_HEIGHT - padding * 2) / dataHeight,
  );
  const renderedWidth = dataWidth * scale;
  const renderedHeight = dataHeight * scale;
  const offsetX = (MAP_WIDTH - renderedWidth) / 2;
  const offsetY = (MAP_HEIGHT - renderedHeight) / 2;

  const project = ([longitude, latitude]: Position): Position => [
    offsetX + (longitude - minX) * longitudeScale * scale,
    MAP_HEIGHT - (offsetY + (latitude - minY) * scale),
  ];
  const unproject = ([x, y]: Position): Position => [
    minX + (x - offsetX) / (longitudeScale * scale),
    minY + (MAP_HEIGHT - y - offsetY) / scale,
  ];
  return { project, unproject };
};

const pathForGeometry = (
  geometry: Geometry,
  project: (position: Position) => Position,
) =>
  polygonsFor(geometry)
    .map((polygon) =>
      polygon
        .map(
          (ring) =>
            `${ring
              .map((position, index) => {
                const [x, y] = project(position);
                return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ")} Z`,
        )
        .join(" "),
    )
    .join(" ");

const percentile = (values: number[], fraction: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const readLandUseOverrides = (): Partial<Record<string, LandUse>> => {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(LAND_USE_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) =>
        ["permanent-grass", "mixed-rotation", "permanent-arable"].includes(
          String(value),
        ),
      ),
    ) as Partial<Record<string, LandUse>>;
  } catch {
    return {};
  }
};

const modeValue = (result: GenericMetricResult, unitMode: UnitMode) => {
  if (unitMode === "index") {
    return {
      numeric: reportedIndex(result),
      text:
        result.displayBand ??
        result.indexBand ??
        (typeof result.indexValue === "number"
          ? result.indexValue.toFixed(1)
          : "No index"),
      unit: "reported index",
      reportedUnit: result.unit ?? "unit not supplied",
    };
  }
  return {
    numeric: typeof result.value === "number" ? result.value : null,
    text: `${result.operator ?? ""}${result.text ?? result.value ?? "No result"}`,
    unit: result.unit ?? "reported result",
    reportedUnit: result.unit ?? "unit not supplied",
  };
};

const displayNumber = (value: number, unitMode: UnitMode) => {
  if (unitMode === "index") return value.toFixed(1).replace(/\.0$/, "");
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, "");
  if (Math.abs(value) >= 1) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};

const resultDate = (value?: string) => value?.slice(0, 4) ?? "";

const meanOrNull = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

const isBseResult = (result: GridField["results"][number]) =>
  !result.samplingGridId &&
  /field composite|enhanced analysis|\bbse\b/i.test(result.matchedFrom ?? "");

const observationFromResults = (
  results: GridField["results"],
  metricId: string,
  unitMode: UnitMode,
  date: string,
): DisplayObservation | null => {
  // A same-day field composite may use a different extraction scale. When
  // spatial grid samples exist, aggregate those like-for-like observations and
  // do not blend the separate enhanced/composite panel into their mean.
  const comparable = results.some((result) => result.samplingGridId)
    ? results.filter((result) => result.samplingGridId)
    : results;
  const values = comparable.flatMap((result) => {
    const raw = result.metrics?.[metricId];
    return raw ? [{ raw, ...modeValue(raw, unitMode) }] : [];
  });
  if (!values.length) return null;
  const evidence: ObservationEvidence = comparable.some(
    (result) => result.samplingGridId,
  )
    ? "s1-average"
    : comparable.some(isBseResult)
      ? "bse-average"
      : "legacy";
  const mean = meanOrNull(
    values
      .map((value) => value.numeric)
      .filter((value): value is number => value !== null),
  );
  const textCounts = new Map<string, number>();
  values.forEach((value) =>
    textCounts.set(value.text, (textCounts.get(value.text) ?? 0) + 1),
  );
  return {
    numeric: mean,
    text:
      mean === null
        ? ([...textCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
          "No result")
        : displayNumber(mean, unitMode),
    unit: values[0]?.unit ?? "reported result",
    reportedUnit: values[0]?.reportedUnit ?? "unit not supplied",
    rawValue: meanOrNull(
      values
        .map((value) => value.raw.value)
        .filter((value): value is number => typeof value === "number"),
    ),
    indexValue: meanOrNull(
      values
        .map((value) => reportedIndex(value.raw))
        .filter((value): value is number => value !== null),
    ),
    colourIndex: meanOrNull(values.map((value) => indexColourValue(value.raw)).filter((value): value is number => value !== null)),
    interpretation: values.map((value) => value.raw.interpretation).find(Boolean),
    method: values.map((value) => value.raw.method).find(Boolean),
    comment: values.map((value) => value.raw.comment).find(Boolean),
    date,
    samples: comparable.length,
    evidence,
  };
};

const resultForField = (
  field: GridField,
  metricId: string,
  year: string,
  unitMode: UnitMode,
  fieldEvidenceMode: FieldEvidenceMode,
): DisplayObservation | null => {
  const available = field.results
    .filter(
      (result) =>
        result.dateSort.slice(0, 4) <= year && result.metrics?.[metricId],
    )
    .sort((left, right) => right.dateSort.localeCompare(left.dateSort));
  if (!available.length) return null;
  const newestObservation = (candidates: typeof available) => {
    if (!candidates.length) return null;
    const newestDate = candidates[0].dateSort;
    return observationFromResults(
      candidates.filter((result) => result.dateSort === newestDate),
      metricId,
      unitMode,
      newestDate,
    );
  };
  const s1Results = available.filter((result) => result.samplingGridId);
  const bseResults = available.filter(isBseResult);
  if (fieldEvidenceMode === "s1-average") return newestObservation(s1Results);
  if (fieldEvidenceMode === "bse-average") return newestObservation(bseResults);
  return (
    newestObservation(s1Results) ??
    newestObservation(bseResults) ??
    newestObservation(available)
  );
};

const historyForField = (
  field: GridField,
  metricId: string,
  year: string,
  unitMode: UnitMode,
): MetricHistoryPoint[] => {
  const dates = [
    ...new Set(
      field.results
        .filter(
          (result) =>
            result.dateSort.slice(0, 4) <= year && result.metrics?.[metricId],
        )
        .map((result) => result.dateSort),
    ),
  ].sort();
  return dates.flatMap((date) => {
    const sameDate = field.results.filter((result) => result.dateSort === date);
    const observation = observationFromResults(sameDate, metricId, unitMode, date);
    return observation ? [{ ...observation, date }] : [];
  });
};

const coreMetricFor = (metricId: string): MetricKey | null => {
  const metrics: Partial<Record<string, MetricKey>> = {
    ph: "ph",
    phosphorus: "p",
    potassium: "k",
    magnesium: "mg",
    "organic-matter": "om",
  };
  return metrics[metricId] ?? null;
};

const yieldLossFraction = (
  metricId: string,
  indexValue: number | null,
) => {
  if (indexValue === null) return null;
  if (metricId === "phosphorus") {
    if (indexValue >= 2) return 0;
    if (indexValue <= 0) return 0.19;
    if (indexValue <= 1) return 0.19 + (0.145 - 0.19) * indexValue;
    return 0.145 * (2 - indexValue);
  }
  if (metricId === "potassium") {
    if (indexValue >= 1.7) return 0;
    if (indexValue <= 0) return 0.382;
    if (indexValue <= 1) return 0.382 + (0.082 - 0.382) * indexValue;
    return 0.082 * ((1.7 - indexValue) / 0.7);
  }
  return null;
};

type ContourSegment = [Position, Position];

const contourPoint = (
  first: Position,
  second: Position,
  firstValue: number | null,
  secondValue: number | null,
  threshold: number,
): Position => {
  if (firstValue === null || secondValue === null) {
    return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
  }
  const fraction = Math.max(
    0,
    Math.min(
      1,
      secondValue === firstValue
        ? 0.5
        : (threshold - firstValue) / (secondValue - firstValue),
    ),
  );
  return [
    first[0] + (second[0] - first[0]) * fraction,
    first[1] + (second[1] - first[1]) * fraction,
  ];
};

const smoothClosedPath = (points: Position[]) => {
  if (points.length < 3) return "";
  const count = points.length;
  const parts = [`M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`];
  for (let index = 0; index < count; index += 1) {
    const previous = points[(index - 1 + count) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const afterNext = points[(index + 2) % count];
    const control1: Position = [
      current[0] + (next[0] - previous[0]) / 6,
      current[1] + (next[1] - previous[1]) / 6,
    ];
    const control2: Position = [
      next[0] - (afterNext[0] - current[0]) / 6,
      next[1] - (afterNext[1] - current[1]) / 6,
    ];
    parts.push(
      `C${control1[0].toFixed(2)},${control1[1].toFixed(2)} ${control2[0].toFixed(2)},${control2[1].toFixed(2)} ${next[0].toFixed(2)},${next[1].toFixed(2)}`,
    );
  }
  return `${parts.join(" ")} Z`;
};

const stitchContourSegments = (segments: ContourSegment[]) => {
  const keyFor = ([x, y]: Position) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const links = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    segment.forEach((point) => {
      const key = keyFor(point);
      links.set(key, [...(links.get(key) ?? []), index]);
    });
  });
  const unused = new Set(segments.map((_, index) => index));
  const loops: Position[][] = [];

  while (unused.size) {
    const firstIndex = unused.values().next().value as number;
    unused.delete(firstIndex);
    const [start, next] = segments[firstIndex];
    const points: Position[] = [start, next];
    let currentKey = keyFor(next);
    const startKey = keyFor(start);

    while (currentKey !== startKey && points.length <= segments.length + 2) {
      const nextIndex = (links.get(currentKey) ?? []).find((index) => unused.has(index));
      if (nextIndex === undefined) break;
      unused.delete(nextIndex);
      const segment = segments[nextIndex];
      const candidate = keyFor(segment[0]) === currentKey ? segment[1] : segment[0];
      points.push(candidate);
      currentKey = keyFor(candidate);
    }
    if (currentKey === startKey && points.length >= 4) {
      loops.push(points.slice(0, -1));
    }
  }
  return loops;
};

export const buildContourBands = ({
  values,
  columns,
  rows,
  stepX,
  stepY,
  bands,
}: {
  values: (number | null)[];
  columns: number;
  rows: number;
  stepX: number;
  stepY: number;
  bands: ColourBand[];
}) => {
  const edgePairs: Record<number, [number, number][]> = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
    5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]],
    9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[1, 2]],
    12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]],
  };

  return bands.slice(1).map(({ colour, minimum: threshold }) => {
    const segments: ContourSegment[] = [];
    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const corners: Position[] = [
          [column * stepX, row * stepY],
          [(column + 1) * stepX, row * stepY],
          [(column + 1) * stepX, (row + 1) * stepY],
          [column * stepX, (row + 1) * stepY],
        ];
        const cornerValues = [
          values[row * columns + column],
          values[row * columns + column + 1],
          values[(row + 1) * columns + column + 1],
          values[(row + 1) * columns + column],
        ];
        const state = cornerValues.reduce<number>(
          (sum, value, index) => sum + (value !== null && value >= threshold ? 1 << index : 0),
          0,
        );
        const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];
        (edgePairs[state] ?? []).forEach(([firstEdge, secondEdge]) => {
          const [firstA, firstB] = edges[firstEdge];
          const [secondA, secondB] = edges[secondEdge];
          segments.push([
            contourPoint(corners[firstA], corners[firstB], cornerValues[firstA], cornerValues[firstB], threshold),
            contourPoint(corners[secondA], corners[secondB], cornerValues[secondA], cornerValues[secondB], threshold),
          ]);
        });
      }
    }
    return {
      colour,
      path: stitchContourSegments(segments).map(smoothClosedPath).filter(Boolean).join(" "),
    };
  });
};

const labelPosition = (
  geometry: Geometry,
  project: (position: Position) => Position,
): Position => {
  const points = polygonsFor(geometry)[0]?.[0]?.map(project) ?? [];
  if (!points.length) return [0, 0];
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
};

const safeSvgId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");

function MetricHistoryChart({
  history,
  unitMode,
}: {
  history: MetricHistoryPoint[];
  unitMode: UnitMode;
}) {
  const points = history.filter(
    (item): item is MetricHistoryPoint & { numeric: number } =>
      item.numeric !== null,
  );
  if (!points.length) {
    return <p className="grid-history-empty">No numeric history is available for this result format.</p>;
  }
  const width = 820;
  const height = 210;
  const padding = 34;
  const values = points.map((point) => point.numeric);
  const lower = Math.min(...values);
  const upper = Math.max(...values);
  const range = Math.max(upper - lower, Math.abs(upper) * 0.08, 1);
  const xFor = (index: number) =>
    points.length === 1
      ? width / 2
      : padding + (index / (points.length - 1)) * (width - padding * 2);
  const yFor = (value: number) =>
    height - padding - ((value - (lower - range * 0.08)) / (range * 1.16)) * (height - padding * 2);
  const line = points
    .map((point, index) => `${index ? "L" : "M"}${xFor(index)},${yFor(point.numeric)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="grid-history-chart" role="img" aria-label="Soil result history chart">
      {[0, 0.5, 1].map((fraction) => {
        const y = padding + fraction * (height - padding * 2);
        return <line key={fraction} x1={padding} x2={width - padding} y1={y} y2={y} className="chart-gridline" />;
      })}
      <path d={line} className="chart-line" />
      {points.map((point, index) => (
        <g key={`${point.date}-${index}`}>
          <circle cx={xFor(index)} cy={yFor(point.numeric)} r={5} className="chart-dot" />
          <text x={xFor(index)} y={height - 9} textAnchor="middle" className="chart-axis-label">
            {point.date.slice(0, 4)}
          </text>
          <text x={xFor(index)} y={yFor(point.numeric) - 10} textAnchor="middle" className="grid-chart-value">
            {displayNumber(point.numeric, unitMode)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="control-group">
      <span className="control-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "is-active" : ""}
            disabled={option.disabled}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SoilGridExplorer({
  data,
  onPlanner,
  onLock,
  demoMode = false,
}: {
  data: SoilGridPayload;
  onPlanner: () => void;
  onLock: () => void | Promise<void>;
  demoMode?: boolean;
}) {
  const metrics = useMemo(() => data.metrics ?? [], [data.metrics]);
  const grids = useMemo(() => data.grids ?? [], [data.grids]);
  const [metricId, setMetricId] = useState(
    metrics.some((metric) => metric.id === "phosphorus")
      ? "phosphorus"
      : metrics[0]?.id ?? "",
  );
  const [resolution, setResolution] = useState<ResolutionMode>("grid");
  const [metricGroup, setMetricGroup] = useState<SoilMetricGroup>("all");
  const [unitMode, setUnitMode] = useState<UnitMode>("index");
  const [colourMode, setColourMode] = useState<ColourMode>("interpretation");
  const [timeMode, setTimeMode] = useState<TimeMode>("latest");
  const [fieldEvidenceMode, setFieldEvidenceMode] =
    useState<FieldEvidenceMode>("auto");
  const [year, setYear] = useState("2026");
  const [playing, setPlaying] = useState(false);
  const [referenceYield, setReferenceYield] = useState(11);
  const [selectedArea, setSelectedArea] = useState<SelectedArea | null>(null);
  const mapRef = useRef<SVGSVGElement>(null);
  const [mapSize, setMapSize] = useState({ width: MAP_WIDTH, height: MAP_HEIGHT });
  const [mapViewport, setMapViewport] = useState<MapViewport | null>(null);
  const [zoomedFieldId, setZoomedFieldId] = useState("");
  const [draggingMap, setDraggingMap] = useState(false);
  const panGesture = useRef<{
    pointerId: number; startX: number; startY: number;
    view: MapViewport; unitsPerPixel: number; moved: boolean;
  } | null>(null);
  const [landUseOverrides, setLandUseOverrides] = useState<
    Partial<Record<string, LandUse>>
  >(readLandUseOverrides);
  const [hovered, setHovered] = useState<{
    title: string;
    value: string;
    detail: string;
  } | null>(null);

  const metric =
    metrics.find((item) => item.id === metricId) ?? metrics[0] ?? EMPTY_METRIC;
  const metricKind = metric.kind;
  const bseMetricResults = data.fields.flatMap((field) =>
    field.results.filter(
      (result) => isBseResult(result) && result.metrics?.[metric.id],
    ),
  );
  const hasBseMetric = bseMetricResults.length > 0;
  const hasBseIndex = bseMetricResults.some(
    (result) => typeof result.metrics?.[metric.id]?.indexValue === "number",
  );
  const indexAllowed =
    resolution === "field"
      ? fieldEvidenceMode === "bse-average"
        ? hasBseIndex
        : fieldEvidenceMode === "s1-average"
          ? metric.gridIndexAvailable
          : metric.indexAvailable
      : metric.gridIndexAvailable;
  const years = useMemo(() => {
    const values = new Set<string>();
    if (resolution === "field") {
      data.fields.forEach((field) =>
        field.results.forEach((result) => {
          if (result.metrics?.[metricId]) values.add(result.dateSort.slice(0, 4));
        }),
      );
    } else {
      grids.forEach((grid) => {
        if (grid.results[metricId] && grid.sampleDate) {
          values.add(resultDate(grid.sampleDate));
        }
      });
    }
    return [...values].filter(Boolean).sort();
  }, [data.fields, grids, metricId, resolution]);
  const mapYear =
    timeMode === "latest" || timeMode === "last-test"
      ? years.at(-1) ?? year
      : year;

  useEffect(() => {
    if (!playing || years.length < 2) return;
    const timer = window.setInterval(() => {
      setYear((current) => {
        const index = years.indexOf(current);
        if (index < 0 || index >= years.length - 1) {
          setPlaying(false);
          return years.at(-1) ?? current;
        }
        return years[index + 1];
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [playing, years]);

  useEffect(() => {
    if (!selectedArea) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedArea(null);
    };
    document.addEventListener("keydown", close);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", close);
      document.body.classList.remove("modal-open");
    };
  }, [selectedArea]);

  useEffect(() => {
    // Keep the chosen view valid as users move between all-database metrics.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (years.length && !years.includes(year)) setYear(years.at(-1)!);
    if (!indexAllowed && unitMode === "index") setUnitMode("reported");
    if (!coreMetricFor(metric.id) && !data.fields.some((field) => field.results.some((result) => interpretationColour(result.metrics?.[metric.id]?.interpretation)))) setColourMode("relative");
    if (metric?.gridResultCount === 0 && resolution !== "field") {
      setResolution("field");
    }
    if (metric?.kind !== "numeric" && resolution === "smooth") {
      setResolution(metric.gridResultCount ? "grid" : "field");
    }
    if (fieldEvidenceMode === "bse-average" && !hasBseMetric) {
      setFieldEvidenceMode("auto");
    }
    if (resolution !== "field" && timeMode !== "latest") {
      setTimeMode("latest");
      setPlaying(false);
    }
    if (resolution === "smooth" && colourMode === "interpretation" && !coreMetricFor(metric.id)) setResolution("grid");
  }, [colourMode, data.fields, fieldEvidenceMode, hasBseMetric, indexAllowed, metric, resolution, timeMode, unitMode, year, years]);

  const projection = useMemo(() => createProjection(data.fields), [data.fields]);
  const mapAspect = mapSize.width / mapSize.height;
  const farmViewport = useMemo(() => fitMapPoints(
    [...data.fields, ...grids].flatMap((area) => coordinatesFor(area.geometry).map(projection.project)), mapAspect,
  ), [data.fields, grids, projection, mapAspect]);
  const view = mapViewport ? constrainMapViewport(mapViewport, farmViewport) : farmViewport;
  const mapZoom = farmViewport.width / view.width;
  const isMapZoomed = mapZoom > 1.001;
  const resetMap = () => {
    setMapViewport(null);
    setZoomedFieldId("");
    setHovered(null);
  };
  const fitField = (fieldId?: string) => {
    const field = data.fields.find((item) => item.id === fieldId);
    if (!field) return;
    setMapViewport(constrainMapViewport(fitMapPoints(
      [field, ...grids.filter((grid) => grid.fieldId === field.id)].flatMap((area) => coordinatesFor(area.geometry).map(projection.project)), mapAspect, 0.16,
    ), farmViewport));
    setZoomedFieldId(field.id);
    setHovered(null);
  };
  const openMapArea = (event: { stopPropagation: () => void; shiftKey: boolean }, area: SelectedArea, fieldId?: string) => {
    event.stopPropagation();
    if (event.shiftKey) {
      fitField(fieldId);
      return;
    }
    setSelectedArea(area);
  };
  const zoomMap = (factor: number) => {
    setMapViewport((current) => zoomMapViewport(current ? constrainMapViewport(current, farmViewport) : farmViewport, farmViewport, factor));
    setHovered(null);
  };

  useLayoutEffect(() => {
    const svg = mapRef.current;
    if (!svg) return;
    const initialSize = svg.getBoundingClientRect();
    if (initialSize.width > 0 && initialSize.height > 0) {
      setMapSize({ width: initialSize.width, height: initialSize.height });
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setMapSize({ width, height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svg = mapRef.current;
    if (!svg) return;
    // Plain scrolling still scrolls the page. Ctrl/trackpad pinch zooms only this map.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const matrix = svg.getScreenCTM()?.inverse();
      if (!matrix) return;
      event.preventDefault();
      const anchor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? mapSize.height : 1);
      setMapViewport((current) => zoomMapViewport(current ? constrainMapViewport(current, farmViewport) : farmViewport, farmViewport, Math.exp(-delta * 0.003), [anchor.x, anchor.y]));
      setHovered(null);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [farmViewport, mapSize.height]);

  const [scaleLongitude, scaleLatitude] = projection.unproject([view.x + view.width / 2, view.y + view.height / 2]);
  const scaleOrigin = projection.project([scaleLongitude, scaleLatitude]);
  const scaleEast = projection.project([scaleLongitude + 1 / (111195 * Math.cos(scaleLatitude * Math.PI / 180)), scaleLatitude]);
  const mapUnitsPerMetre = scaleEast[0] - scaleOrigin[0];
  const scaleMetres = [1000, 500, 250, 100, 50, 25, 10, 5, 1].find((distance) => distance * mapUnitsPerMetre < view.width * 0.22) ?? 1;
  const scaleLength = scaleMetres * mapUnitsPerMetre;
  const screenUnit = view.width / mapSize.width;
  const scaleX = view.x + view.width - 18 * screenUnit;
  const scaleY = view.y + view.height - 20 * screenUnit;
  const fieldObservations = useMemo(() => {
    const observations = new Map(
      data.fields.map((field) => [
        field.id,
        resultForField(
          field,
          metricId,
          mapYear,
          unitMode,
          fieldEvidenceMode,
        ),
      ]),
    );
    if (
      metric.boundaryPolicy !== "cross-field" ||
      metric.kind !== "numeric" ||
      fieldEvidenceMode === "s1-average"
    ) {
      return observations;
    }

    const directBse = new Map(
      data.fields.map((field) => [
        field.id,
        resultForField(field, metricId, mapYear, unitMode, "bse-average"),
      ]),
    );
    const bseSamples: SpatialSample[] = data.fields.flatMap((field) => {
      const observation = directBse.get(field.id);
      if (!observation || observation.numeric === null) return [];
      const [longitude, latitude] = geometryCentroid(field.geometry);
      return [{
        id: `bse-${field.id}`,
        fieldId: field.id,
        longitude,
        latitude,
        value: observation.numeric,
        supportRadiusM: Math.sqrt((field.areaHa * 10_000) / Math.PI),
      }];
    });
    if (bseSamples.length < 2) return observations;
    const parameters = selectInterpolationParameters(bseSamples, "cross-field");
    data.fields.forEach((field) => {
      const current = observations.get(field.id);
      const shouldEstimate =
        !current ||
        (fieldEvidenceMode === "auto" && current.evidence === "legacy");
      if (!shouldEstimate) return;
      const [longitude, latitude] = geometryCentroid(field.geometry);
      const prediction = interpolateSpatialValue(
        { longitude, latitude, fieldId: field.id },
        bseSamples,
        "cross-field",
        parameters,
      );
      if (!prediction) return;
      const reportedUnit =
        [...directBse.values()].find(Boolean)?.reportedUnit ?? "unit not supplied";
      observations.set(field.id, {
        numeric: prediction.value,
        text: displayNumber(prediction.value, unitMode),
        unit: unitMode === "index" ? "reported index" : reportedUnit,
        reportedUnit,
        rawValue: unitMode === "reported" ? prediction.value : null,
        indexValue: unitMode === "index" ? prediction.value : null,
        colourIndex: unitMode === "index" ? prediction.value : null,
        date: bseSamples.length
          ? [...directBse.values()]
              .flatMap((item) => item?.date ?? [])
              .sort()
              .at(-1)
          : undefined,
        samples: bseSamples.length,
        evidence: "interpolated-bse",
        method: "Cross-field IDW from BSE field composites",
        comment: "Estimated only for a metric whose boundary policy permits cross-field interpolation.",
      });
    });
    return observations;
  }, [data.fields, fieldEvidenceMode, mapYear, metric, metricId, unitMode]);
  const gridObservations = useMemo(
    () =>
      new Map(
        grids.map((grid) => {
          const result =
            !grid.sampleDate || resultDate(grid.sampleDate) <= mapYear
              ? grid.results[metricId]
              : undefined;
          if (!result) return [grid.id, null] as const;
          const display = modeValue(result, unitMode);
          return [
            grid.id,
            {
              ...display,
              rawValue: typeof result.value === "number" ? result.value : null,
              indexValue: reportedIndex(result),
              colourIndex: indexColourValue(result),
              interpretation: result.interpretation,
              method: result.method,
              comment: result.comment,
              date: grid.sampleDate,
              samples: 1,
              evidence: "s1-average",
            } satisfies DisplayObservation,
          ] as const;
        }),
      ),
    [grids, mapYear, metricId, unitMode],
  );

  const visibleObservations =
    resolution === "field"
      ? [...fieldObservations.values()]
      : [...gridObservations.values()];
  const numericValues = visibleObservations
    .filter((item): item is DisplayObservation => Boolean(item))
    .map((item) => item.numeric)
    .filter((value): value is number => value !== null);
  const colourValue = (observation: DisplayObservation) =>
    usesIndexColours(metricId) ? observation.colourIndex : observation.rawValue;
  const agronomicScale = nutrientAgronomicScale(metricId);
  const colourScale = useMemo(() => {
    const results = data.fields.flatMap((field) => field.results.flatMap((result) =>
      result.metrics?.[metricId] ? [result.metrics[metricId]] : [],
    ));
    return relativeColourScale(
      metricId,
      results.flatMap((result) => typeof result.value === "number" ? [result.value] : []),
      metricId === "ph" ? "pH" : metric.units.filter((unit) => unit !== "index").join(" / ") || "reported result",
    );
  }, [data.fields, metricId, metric.units]);
  const categoricalValues = [
    ...new Set(
      data.fields.flatMap((field) => field.results.flatMap((result) =>
        result.metrics?.[metricId]?.text ? [result.metrics[metricId].text!] : [],
      )),
    ),
  ].sort();
  const hasInterpretations =
    Boolean(coreMetricFor(metric.id)) ||
    visibleObservations.some((item) =>
      interpretationColour(item?.interpretation),
    );

  const spatialSamples = useMemo<SpatialSample[]>(
    () =>
      grids.flatMap((grid) => {
        if (!grid.fieldId || !grid.sampleDate || resultDate(grid.sampleDate) > mapYear) {
          return [];
        }
        const result = grid.results[metricId];
        if (!result) return [];
        const value = usesIndexColours(metricId) ? indexColourValue(result) : result.value ?? null;
        if (value === null) return [];
        return [
          {
            id: grid.id,
            fieldId: grid.fieldId,
            longitude: grid.centroid[0],
            latitude: grid.centroid[1],
            value,
            supportRadiusM: Math.sqrt((grid.areaHa * 10_000) / Math.PI),
          },
        ];
      }),
    [grids, mapYear, metricId],
  );
  const interpolationPolicy: InterpolationPolicy =
    metric.boundaryPolicy === "cross-field" ? "cross-field" : "field-constrained";
  const interpolationParameters = useMemo(
    () => selectInterpolationParameters(spatialSamples, interpolationPolicy),
    [interpolationPolicy, spatialSamples],
  );
  const landUseFor = (field?: GridField): LandUse =>
    field ? landUseOverrides[field.id] ?? inferLandUse(field) : "mixed-rotation";
  const smoothBandsFor = (field: GridField): ColourBand[] => {
    const coreMetric = coreMetricFor(metric.id);
    if (colourMode !== "interpretation" || !coreMetric) return colourScale.bands;
    if (agronomicScale) return agronomicScale.bands;
    const landUse = landUseFor(field);
    return [-Infinity, ...primaryJudgementBoundaries(coreMetric, landUse)].map((minimum) => {
      const value = Number.isFinite(minimum) ? minimum : 0;
      const judgement = primaryJudgement({ metric: coreMetric, value, rawValue: value, indexValue: value, landUse });
      return { minimum, colour: STATUS_COLORS[judgement.key], label: judgement.label };
    });
  };
  // The contour surface intentionally memoizes a sizeable cross-validated
  // calculation; its scalar scale inputs are derived immediately above.
  /* eslint-disable react-hooks/preserve-manual-memoization */
  const smoothSurfaces = useMemo<SmoothFieldSurface[]>(() => {
    if (
      resolution !== "smooth" ||
      metricKind !== "numeric" ||
      !spatialSamples.length
    ) {
      return [];
    }
    const stepX = 5;
    const stepY = 5;
    const columns = Math.floor(MAP_WIDTH / stepX) + 1;
    const rows = Math.floor(MAP_HEIGHT / stepY) + 1;

    return data.fields.flatMap((field) => {
      const donors =
        interpolationPolicy === "cross-field"
          ? spatialSamples
          : spatialSamples.filter((sample) => sample.fieldId === field.id);
      if (!donors.length) return [];
      const supportGrids = grids.filter((grid) => grid.fieldId === field.id && spatialSamples.some((sample) => sample.id === grid.id));
      const bands = smoothBandsFor(field);
      const bounds = [...coordinatesFor(field.geometry), ...supportGrids.flatMap((grid) => coordinatesFor(grid.geometry))].map(projection.project);
      const minX = Math.min(...bounds.map(([x]) => x)) - stepX * 2;
      const maxX = Math.max(...bounds.map(([x]) => x)) + stepX * 2;
      const minY = Math.min(...bounds.map(([, y]) => y)) - stepY * 2;
      const maxY = Math.max(...bounds.map(([, y]) => y)) + stepY * 2;
      let predictions = 0;
      const values: (number | null)[] = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const mapPoint: Position = [column * stepX, row * stepY];
          const [longitude, latitude] = projection.unproject(mapPoint);
          if (mapPoint[0] < minX || mapPoint[0] > maxX || mapPoint[1] < minY || mapPoint[1] > maxY) {
            values.push(null);
            continue;
          }
          const prediction = interpolateSpatialValue(
            { longitude, latitude, fieldId: field.id },
            spatialSamples,
            interpolationPolicy,
            interpolationParameters,
            Infinity,
          );
          values.push(prediction?.value ?? null);
          if (prediction) predictions += 1;
        }
      }
      if (!predictions) return [];
      return [{
        fieldId: field.id,
        predictions,
        baseColour: bands[0].colour,
        supportGrids,
        supportSamples: donors,
        bands: buildContourBands({
          values,
          columns,
          rows,
          stepX,
          stepY,
          bands,
        }),
      }];
    });
  }, [
    data.fields,
    interpolationParameters,
    interpolationPolicy,
    metricKind,
    projection,
    resolution,
    colourScale,
    colourMode,
    landUseOverrides,
    grids,
    spatialSamples,
  ]);
  /* eslint-enable react-hooks/preserve-manual-memoization */

  if (!metrics.length) {
    return (
      <main className="planner-loading">
        No generic metric catalogue is available in this dataset.
      </main>
    );
  }

  const observationFill = (
    observation: DisplayObservation | null,
    field?: GridField,
  ) => {
    if (!observation) return NO_DATA;
    if (colourMode === "interpretation") {
      if (agronomicScale) return colourFromScale(observation.colourIndex, agronomicScale.bands);
      const coreMetric = coreMetricFor(metric.id);
      if (coreMetric) {
        const judgement = primaryJudgement({
          metric: coreMetric,
          value: observation.rawValue,
          rawValue: observation.rawValue,
          indexValue: observation.colourIndex,
          landUse: landUseFor(field),
        });
        return STATUS_COLORS[judgement.key];
      }
      return interpretationColour(observation.interpretation) ?? NO_DATA;
    }
    if (metric.kind === "numeric") return colourFromScale(colourValue(observation), colourScale.bands);
    const categoryIndex = categoricalValues.indexOf(observation.text);
    return CATEGORY_PALETTE[
      Math.max(0, categoryIndex) % CATEGORY_PALETTE.length
    ];
  };

  const reportedUnits = [
    ...new Set(
      visibleObservations
        .filter((item): item is DisplayObservation => Boolean(item))
        .map((item) => item.reportedUnit)
        .filter((unit) => unit !== "unit not supplied"),
    ),
  ];
  const reportedUnitDetail =
    reportedUnits.length
      ? reportedUnits.join(" / ")
      : metric.units.length
        ? metric.units.join(" / ")
        : "unit supplied with each laboratory result";
  const unitLabel =
    unitMode === "index"
      ? "reported index"
      : reportedUnitDetail;
  const displayedCount = visibleObservations.filter(Boolean).length;
  const latestTests = new Map(
    data.fields.map((field) => [field.id, latestSoilRecord(field.results)]),
  );
  const testAgeCounts = data.fields.reduce<Record<TestAgeBandKey, number>>(
    (counts, field) => {
      counts[soilTestAgeBand(latestTests.get(field.id) ?? null)] += 1;
      return counts;
    },
    { recent: 0, current: 0, dueSoon: 0, overdue: 0, noData: 0 },
  );
  const selectedGrid =
    selectedArea?.kind === "grid"
      ? grids.find((grid) => grid.id === selectedArea.id) ?? null
      : null;
  const selectedField =
    selectedArea?.kind === "field"
      ? data.fields.find((field) => field.id === selectedArea.id) ?? null
      : selectedGrid?.fieldId
        ? data.fields.find((field) => field.id === selectedGrid.fieldId) ?? null
        : null;
  const selectedObservation = selectedArea
    ? selectedArea.kind === "grid"
      ? gridObservations.get(selectedArea.id) ?? null
      : fieldObservations.get(selectedArea.id) ?? null
    : null;
  const selectedLandUse = landUseFor(selectedField ?? undefined);
  const selectedHistory = selectedField
    ? historyForField(selectedField, metric.id, mapYear, unitMode)
    : [];
  const selectedJudgements = groupAgronomyJudgements(
    agronomyJudgementsForMetric({
      metric,
      value: selectedObservation?.rawValue ?? null,
      indexValue: selectedObservation?.colourIndex ?? null,
      text: selectedObservation?.text,
      unit: selectedObservation?.unit,
      interpretation: selectedObservation?.interpretation,
      method: selectedObservation?.method,
      landUse: selectedLandUse,
    }),
  );
  const selectedCoreMetric = coreMetricFor(metric.id);
  const selectedPrimary = selectedCoreMetric
    ? primaryJudgement({
        metric: selectedCoreMetric,
        value: selectedObservation?.rawValue ?? null,
        rawValue: selectedObservation?.rawValue ?? null,
        indexValue: selectedObservation?.colourIndex ?? null,
        landUse: selectedLandUse,
      })
    : null;
  const selectedYieldLoss = isWheatProxyApplicable(selectedLandUse)
    ? yieldLossFraction(metric.id, selectedObservation?.indexValue ?? null)
    : null;
  const guidanceField =
    selectedField ??
    data.fields.find((field) => fieldObservations.get(field.id)) ??
    data.fields[0];
  const guidanceObservation = guidanceField
    ? fieldObservations.get(guidanceField.id) ?? null
    : null;
  const guidanceLandUse = landUseFor(guidanceField);
  const guidanceJudgements = groupAgronomyJudgements(
    agronomyJudgementsForMetric({
      metric,
      value: guidanceObservation?.rawValue ?? null,
      indexValue: guidanceObservation?.colourIndex ?? null,
      text: guidanceObservation?.text,
      unit: guidanceObservation?.unit,
      interpretation: guidanceObservation?.interpretation,
      method: guidanceObservation?.method,
      landUse: guidanceLandUse,
    }),
  );
  const mappedArea = data.fields.reduce((sum, field) => sum + field.areaHa, 0);
  const fieldMedian = numericValues.length
    ? percentile(numericValues, 0.5)
    : null;
  const farmYieldAtRisk = data.fields.reduce((sum, field) => {
    if (!isWheatProxyApplicable(landUseFor(field))) return sum;
    const loss = yieldLossFraction(
      metric.id,
      fieldObservations.get(field.id)?.indexValue ?? null,
    );
    return sum + (loss ?? 0) * referenceYield * field.areaHa;
  }, 0);
  const updateLandUse = (landUse: LandUse) => {
    if (!selectedField) return;
    setLandUseOverrides((current) => {
      const next = { ...current, [selectedField.id]: landUse };
      window.localStorage.setItem(LAND_USE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  const metricGroups = Object.entries(
    metrics.filter(item => metricMatchesGroup(item.id, metricGroup)).reduce<Record<string, SoilMetricMeta[]>>((groups, item) => {
      (groups[item.category] ??= []).push(item);
      return groups;
    }, {}),
  );

  return (
    <main className="app-shell grid-explorer-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">S</span>
          <div>
            <strong>Soil Intelligence</strong>
          </div>
        </div>
        <div className="topbar-meta">
          <div className="topbar-actions">
            <details className="site-navigation-menu" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
            }} onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}>
              <summary>Menu</summary>
              <nav aria-label="Site navigation">
                <button type="button" onClick={onPlanner}>Nutrient planner</button>
              </nav>
            </details>
            <button type="button" className="lock-button" onClick={onLock}>
              {demoMode ? "Reload demo" : "Lock"}
            </button>
          </div>
        </div>
      </header>

      <section className="dashboard">
        <aside className="control-panel" aria-label="Soil map controls">
          <div className="panel-heading">
            <h1>Soil test maps</h1>
          </div>

          <Toggle<SoilMetricGroup>
            label="Analysis type"
            value={metricGroup}
            onChange={(group) => {
              setMetricGroup(group);
              if (!metricMatchesGroup(metricId, group)) {
                setMetricId(firstMetricInGroup(metrics.map(item => item.id), group) ?? metricId);
              }
              if (group === "texture" || group === "trace") {
                setResolution("grid");
                setUnitMode("reported");
                setColourMode("relative");
                setTimeMode("latest");
                setPlaying(false);
              }
            }}
            options={[
              { value: "all", label: "All" },
              { value: "core", label: "Core", disabled: !metrics.some(item => metricMatchesGroup(item.id, "core")) },
              { value: "texture", label: "Texture", disabled: !metrics.some(item => metricMatchesGroup(item.id, "texture")) },
              { value: "trace", label: "Trace", disabled: !metrics.some(item => metricMatchesGroup(item.id, "trace")) },
            ]}
          />

          <label className="select-control">
            <span className="control-label">Metric</span>
            <select
              value={metric.id}
              onChange={(event) => setMetricId(event.target.value)}
            >
              {metricGroups.map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <Toggle
            label="Detail level"
            value={resolution}
            onChange={setResolution}
            options={[
              { value: "field", label: "Fields" },
              {
                value: "grid",
                label: "1 ha grids",
                disabled: metric.gridResultCount === 0,
              },
              {
                value: "smooth",
                label: "Smoothed",
                disabled:
                  metric.gridResultCount === 0 || metric.kind !== "numeric" || (colourMode === "interpretation" && !coreMetricFor(metric.id)),
              },
            ]}
          />

          <Toggle
            label="Date of test"
            value={timeMode}
            onChange={(nextMode) => {
              setTimeMode(nextMode);
              setPlaying(false);
              if (nextMode === "last-test") setResolution("field");
              if (nextMode === "timeline") setYear(years.at(-1) ?? year);
            }}
            options={[
              { value: "latest", label: "Latest" },
              { value: "timeline", label: "Timeline", disabled: resolution !== "field" },
            ]}
          />

          <Toggle
            label="Result format"
            value={unitMode}
            onChange={setUnitMode}
            options={[
              {
                value: "index",
                label: "Index",
                disabled: !indexAllowed,
              },
              { value: "reported", label: "Reported units" },
            ]}
          />
          <small className="result-unit-detail">
            Reported units for this metric: <strong>{reportedUnitDetail}</strong>
          </small>

          <Toggle
            label="Colour meaning"
            value={colourMode}
            onChange={setColourMode}
            options={[
              { value: "relative", label: "Low → high" },
              {
                value: "interpretation",
                label: "Agronomic band",
                disabled: !hasInterpretations || (resolution === "smooth" && !coreMetricFor(metric.id)),
              },
            ]}
          />

          <details className="advanced-map-controls">
            <summary>Advanced</summary>
            <Toggle
              label="Sampling recency"
              value={timeMode === "last-test" ? "last-test" : "results"}
              onChange={(nextMode) => {
                setPlaying(false);
                setTimeMode(nextMode === "last-test" ? "last-test" : "latest");
                if (nextMode === "last-test") setResolution("field");
              }}
              options={[
                { value: "results", label: "Test results" },
                { value: "last-test", label: "Last tested" },
              ]}
            />
            <Toggle<AdvancedEvidenceMode>
              label="Map evidence calculation"
              value={resolution === "grid" ? "grid" : fieldEvidenceMode}
              onChange={(nextMode) => {
                setPlaying(false);
                if (nextMode === "grid") {
                  setResolution("grid");
                  return;
                }
                setResolution("field");
                setFieldEvidenceMode(nextMode);
              }}
              options={[
                { value: "auto", label: "Best available" },
                {
                  value: "grid",
                  label: "Grid cells",
                  disabled: metric.gridResultCount === 0,
                },
                {
                  value: "s1-average",
                  label: "S1 field average",
                  disabled: metric.gridResultCount === 0,
                },
                {
                  value: "bse-average",
                  label: "BSE field average",
                  disabled: !hasBseMetric,
                },
              ]}
            />
            <p>
              Best available uses the mathematical mean of the latest S1 grid tests where present, then a whole-field BSE mean for broader analyses. Appropriate stable properties may be estimated from nearby BSE field composites; management-responsive metrics stay within their field evidence.
            </p>
          </details>

          {timeMode === "timeline" && years.length > 1 && (
            <div className="grid-timeline" aria-label="Soil result timeline">
              <input
                type="range"
                min={0}
                max={years.length - 1}
                step={1}
                value={Math.max(0, years.indexOf(year))}
                onChange={(event) => {
                  setPlaying(false);
                  setYear(years[Number(event.target.value)]);
                }}
                aria-label="Result year"
              />
              <div>
                <span>{years[0]}</span>
                <button
                  type="button"
                  className="timeline-play"
                  onClick={() => {
                    if (year === years.at(-1)) setYear(years[0]);
                    setPlaying((current) => !current);
                  }}
                >
                  {playing ? "Pause" : "Play timelapse"}
                </button>
                <span>{years.at(-1)}</span>
              </div>
            </div>
          )}

          {resolution === "field" && timeMode !== "last-test" && (
            <label className="yield-control">
              <div>
                <span className="control-label">Wheat reference yield</span>
                <small>Used only for the P/K yield-at-risk proxy</small>
              </div>
              <input
                type="number"
                min={4}
                max={15}
                step={0.5}
                value={referenceYield}
                onChange={(event) => setReferenceYield(Number(event.target.value) || 11)}
                aria-label="Wheat reference yield in tonnes per hectare"
              />
            </label>
          )}


          <details className="advanced-map-controls source-summary-panel" aria-label="Guidance sources and smoothing method">
            <summary>Evidence & method</summary>
            <p>
              Guidance compares RB209 2026, AHDB/GREATsoils, SRUC/FAS and the Organic Research Centre. Sources stay separate where they disagree.
            </p>
            <p>
              Smoothed maps use cross-validated local IDW. Every measured grid is covered, including irregular edges. Beyond measured grids, estimates extend up to 225 m from a sample centre within the field. Management-responsive metrics never borrow across field boundaries. A lone grid gives a constant estimate, not evidence of within-grid variation.
            </p>
            <a href="https://doi.org/10.1016/j.compag.2005.07.003" target="_blank" rel="noreferrer">
              Soil interpolation method reference
            </a>
          </details>
          <details className="advanced-map-controls map-summary-details">
            <summary>Map summary</summary>
          <section className="stat-grid" aria-label="Grid map summary">
            <article className="stat-card">
              <span>{resolution === "field" ? "Mapped farm area" : "Database metrics"}</span>
              <strong>{resolution === "field" ? `${mappedArea.toFixed(0)} ha` : metrics.length}</strong>
              {resolution === "field" && <small>{data.fields.length} mapped fields</small>}
            </article>
            <article className="stat-card">
              <span>Coverage</span>
              <strong>
                {timeMode === "last-test"
                  ? `${data.fields.length - testAgeCounts.noData}/${data.fields.length} fields`
                  : resolution === "smooth" ? `${spatialSamples.length} grids` : displayedCount}
              </strong>
              <small>
                {timeMode === "last-test"
                  ? `${testAgeCounts.recent + testAgeCounts.current} tested within 3 years`
                  : resolution === "smooth"
                  ? smoothSurfaces.length
                    ? "Continuous vector contours rendered"
                    : "No supported continuous surface"
                  : `${resolution} observations with results`}
              </small>
            </article>
            <article className="stat-card">
              <span>{timeMode === "last-test" ? "Sampling overdue" : resolution === "field" ? "Farm median" : "Boundary rule"}</span>
              <strong>
                {timeMode === "last-test"
                  ? `${testAgeCounts.overdue} fields`
                  : resolution === "field"
                    ? fieldMedian === null ? "No numeric data" : displayNumber(fieldMedian, unitMode)
                    : metric.boundaryPolicy === "cross-field" ? "Cross-field" : metric.boundaryPolicy === "not-smoothed" ? "Measured only" : "Within field"}
              </strong>
              <small>
                {timeMode === "last-test"
                  ? `${testAgeCounts.dueSoon} more are 3–5 years old`
                  : resolution === "field" ? unitLabel : metric.boundaryPolicy === "cross-field" ? "Stable texture property" : "Conservative management boundary"}
              </small>
            </article>
            <article className="stat-card accent">
              <span>{resolution === "field" && timeMode !== "last-test" ? "Wheat-equivalent at risk" : "Interpolation check"}</span>
              <strong>
                {resolution === "field" && timeMode !== "last-test"
                  ? farmYieldAtRisk ? `${farmYieldAtRisk.toFixed(0)} t` : "None modelled"
                  : resolution !== "smooth" ? "Exact cells"
                  : interpolationParameters.rmse === null
                    ? "Limited support"
                    : `RMSE ${displayNumber(interpolationParameters.rmse, "reported")}`}
              </strong>
              <small>
                {resolution === "field" && timeMode !== "last-test"
                  ? `P/K proxy only · ${referenceYield} t/ha reference yield`
                  : resolution !== "smooth" ? "No interpolation applied"
                  : `${colourScale.unit} · ${interpolationParameters.validatedSamples} held-out grids`}
              </small>
            </article>
          </section>
          </details>
        </aside>

        <div className="workspace">
          <div className="map-and-guidance">
          <section className="map-card">
            <div className="map-card-heading">
              <div>
                <span className="eyebrow">
                  {timeMode === "last-test" ? "Sampling recency" : resolution === "field" ? "Field evidence" : resolution === "grid" ? "Measured sampling support" : "Cross-validated local interpolation"}
                </span>
                <h2>
                  {timeMode === "last-test" ? "Last recorded soil test" : metric.name} <span>· {timeMode === "last-test" ? "field sampling age" : `${unitLabel} · ${mapYear}`}</span>
                </h2>
              </div>
              <p>
                {resolution === "smooth"
                  ? "Click a field for evidence; switch to grids for exact measurements"
                  : "Click a mapped area for history and source interpretation"}
              </p>
            </div>

              <div className="map-navigation" role="group" aria-label="Map navigation">
                <select aria-label="Zoom to field" value={isMapZoomed ? zoomedFieldId : ""} onChange={(event) => event.target.value ? fitField(event.target.value) : resetMap()}>
                  <option value="">Zoom to field…</option>
                  {[...data.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
                </select>
                <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!isMapZoomed} onClick={() => zoomMap(1 / 1.5)}>−</button>
                <button type="button" aria-label="Zoom in" title="Zoom in" disabled={mapZoom >= 31.999} onClick={() => zoomMap(1.5)}>+</button>
                <button type="button" className="map-reset-button" aria-label="Reset to whole farm" title="Show whole farm" onClick={resetMap}>Farm</button>
              </div>
            <div className={`map-stage grid-map-stage${isMapZoomed ? " map-is-zoomed" : ""}${draggingMap ? " map-is-dragging" : ""}`}>
              <svg
                ref={mapRef}
                viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
                className="field-map"
                role="group"
                tabIndex={0}
                aria-label={`${timeMode === "last-test" ? "Last recorded soil test" : metric.name} ${resolution} map for ${mapYear}`}
                aria-describedby="map-navigation-help"
                onClick={resetMap}
                onClickCapture={(event) => {
                  if (panGesture.current?.moved) {
                    event.preventDefault();
                    event.stopPropagation();
                    panGesture.current = null;
                  }
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomMap(1.5); }
                  if (event.key === "-") { event.preventDefault(); zoomMap(1 / 1.5); }
                  if (event.key === "Escape") resetMap();
                  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                  if (isMapZoomed && directions[event.key]) {
                    event.preventDefault();
                    const [dx, dy] = directions[event.key];
                    setMapViewport(constrainMapViewport({ ...view, x: view.x + dx * view.width / 5, y: view.y + dy * view.height / 5 }, farmViewport));
                  }
                }}
                onPointerDown={(event) => {
                  panGesture.current = null;
                  if (!isMapZoomed || event.button !== 0 || event.shiftKey) return;
                  const matrix = event.currentTarget.getScreenCTM()?.inverse();
                  if (!matrix) return;
                  panGesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, view, unitsPerPixel: matrix.a, moved: false };
                }}
                onPointerMove={(event) => {
                  const gesture = panGesture.current;
                  if (!gesture || gesture.pointerId !== event.pointerId || !event.buttons) return;
                  const dx = event.clientX - gesture.startX;
                  const dy = event.clientY - gesture.startY;
                  if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
                  gesture.moved = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDraggingMap(true);
                  setHovered(null);
                  setMapViewport(constrainMapViewport({ ...gesture.view, x: gesture.view.x - dx * gesture.unitsPerPixel, y: gesture.view.y - dy * gesture.unitsPerPixel }, farmViewport));
                }}
                onPointerUp={(event) => {
                  setDraggingMap(false);
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => { panGesture.current = null; setDraggingMap(false); }}
              >
                {resolution === "smooth" && (
                  <defs>
                    {smoothSurfaces.map((surface) => {
                      const field = data.fields.find((item) => item.id === surface.fieldId)!;
                      return <g key={field.id}>
                        <clipPath id={`field-clip-${safeSvgId(field.id)}`}>
                          <path d={pathForGeometry(field.geometry, projection.project)} clipRule="evenodd" />
                          {surface.supportGrids.map((grid) => <path key={grid.id} d={pathForGeometry(grid.geometry, projection.project)} clipRule="evenodd" />)}
                        </clipPath>
                        <clipPath id={`support-clip-${safeSvgId(field.id)}`}>
                          {surface.supportGrids.map((grid) => <path key={grid.id} d={pathForGeometry(grid.geometry, projection.project)} clipRule="evenodd" />)}
                          {surface.supportSamples.map((sample) => {
                            const [cx, cy] = projection.project([sample.longitude, sample.latitude]);
                            const [east] = projection.project([sample.longitude + 225 / (111195 * Math.cos(sample.latitude * Math.PI / 180)), sample.latitude]);
                            const [, north] = projection.project([sample.longitude, sample.latitude + 225 / 111195]);
                            return <ellipse key={sample.id} cx={cx} cy={cy} rx={Math.abs(east - cx)} ry={Math.abs(north - cy)} />;
                          })}
                        </clipPath>
                      </g>;
                    })}
                  </defs>
                )}
                <g className="map-contours" aria-hidden="true" pointerEvents="none">
                  {[110, 205, 300, 395, 490, 585].map((offset) => (
                    <path key={offset} d={`M -60 ${offset} C 180 ${offset - 65}, 360 ${offset + 70}, 610 ${offset - 10} S 900 ${offset + 40}, 1080 ${offset - 50}`} />
                  ))}
                </g>

                {resolution !== "field" && data.fields.map((field) => (
                  <path
                    key={`base-${field.id}`}
                    d={pathForGeometry(field.geometry, projection.project)}
                    className="grid-field-base"
                    fill={NO_DATA}
                    fillRule="evenodd"
                    onClick={(event) => openMapArea(event, { kind: "field", id: field.id }, field.id)}
                  />
                ))}

                {resolution === "smooth" && (
                  <g className="smooth-surface" aria-hidden="true">
                    {smoothSurfaces.map((surface) => (
                      <g key={surface.fieldId} clipPath={`url(#field-clip-${safeSvgId(surface.fieldId)})`}>
                      <g clipPath={`url(#support-clip-${safeSvgId(surface.fieldId)})`}>
                      <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill={surface.baseColour} />
                      {surface.bands.map((band, index) => band.path ? (
                        <path
                          key={`${surface.fieldId}-${index}`}
                          className="smooth-contour-band"
                          d={band.path}
                          fill={band.colour}
                          fillRule="evenodd"
                        />
                      ) : null)}
                      </g>
                      </g>
                    ))}
                  </g>
                )}

                {resolution === "field" && data.fields.map((field) => {
                  const observation = fieldObservations.get(field.id) ?? null;
                  const latestTest = latestTests.get(field.id) ?? null;
                  const ageBand = TEST_AGE_BANDS[soilTestAgeBand(latestTest)];
                  return (
                    <g key={field.id}>
                      <path
                        d={pathForGeometry(field.geometry, projection.project)}
                        fill={timeMode === "last-test" ? ageBand.color : observationFill(observation, field)}
                        fillRule="evenodd"
                        className="field-shape"
                        role="button"
                        aria-label={`${field.name}: open soil evidence; Shift-click to zoom`}
                        data-field-id={field.id}
                        tabIndex={0}
                        onClick={(event) => openMapArea(event, { kind: "field", id: field.id }, field.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openMapArea(event, { kind: "field", id: field.id }, field.id);
                          }
                        }}
                        onMouseEnter={() => setHovered({
                          title: field.name,
                          value: timeMode === "last-test" ? ageBand.label : observation ? `${observation.text} · ${observation.unit}` : "No result",
                          detail: timeMode === "last-test" ? latestTest?.dateSort ?? "No recorded soil test" : observation ? `${observation.date?.slice(0, 10)} · ${observation.samples} sample${observation.samples === 1 ? "" : "s"}${observation.interpretation ? ` · ${observation.interpretation}` : ""}` : `No ${metric.name} result by ${mapYear}`,
                        })}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered({
                          title: field.name,
                          value: timeMode === "last-test" ? ageBand.label : observation ? `${observation.text} · ${observation.unit}` : "No result",
                          detail: timeMode === "last-test" ? latestTest?.dateSort ?? "No recorded soil test" : observation?.date?.slice(0, 10) ?? `No ${metric.name} result by ${mapYear}`,
                        })}
                        onBlur={() => setHovered(null)}
                      />
                      {field.areaHa >= 2.2 && (() => {
                        const [x, y] = labelPosition(field.geometry, projection.project);
                        return (
                          <text x={x} y={y} textAnchor="middle" className="field-label" style={isMapZoomed ? { fontSize: 12 * screenUnit, strokeWidth: 3 * screenUnit } : undefined}>
                            <tspan x={x}>{field.name}</tspan>
                            <tspan x={x} dy={isMapZoomed ? 14 * screenUnit : 12} className="field-value" style={isMapZoomed ? { fontSize: 10 * screenUnit } : undefined}>
                              {timeMode === "last-test" ? latestTest?.dateSort.slice(0, 4) ?? "No test" : observation?.text ?? "No result"}
                            </tspan>
                          </text>
                        );
                      })()}
                    </g>
                  );
                })}

                {resolution === "grid" && grids.map((grid) => {
                  const observation = gridObservations.get(grid.id) ?? null;
                  const field = data.fields.find((item) => item.id === grid.fieldId);
                  return (
                    <g key={grid.id}>
                      <path
                        d={pathForGeometry(grid.geometry, projection.project)}
                        fill={observationFill(observation, field)}
                        className="sampling-grid-shape"
                        role="button"
                        aria-label={`${grid.fieldName ?? "Mapped field"}, ${grid.id}: open soil evidence; Shift-click to zoom`}
                        data-field-id={grid.fieldId}
                        data-grid-id={grid.id}
                        tabIndex={0}
                        onClick={(event) => openMapArea(event, { kind: "grid", id: grid.id }, grid.fieldId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openMapArea(event, { kind: "grid", id: grid.id }, grid.fieldId);
                          }
                        }}
                        onMouseEnter={() => setHovered({
                          title: `${grid.fieldName ?? "Mapped field"} · ${grid.id.replace("DEMO_GRID_", "Grid ")}`,
                          value: observation ? `${observation.text} · ${observation.unit}` : "No laboratory result",
                          detail: observation ? `${grid.sampleDate} · ${observation.interpretation ?? "No written lab interpretation"}` : `${grid.areaHa.toFixed(1)} ha polygon · unsampled in linked database`,
                        })}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered({
                          title: `${grid.fieldName ?? "Mapped field"} · ${grid.id.replace("DEMO_GRID_", "Grid ")}`,
                          value: observation ? `${observation.text} · ${observation.unit}` : "No laboratory result",
                          detail: observation ? `${grid.sampleDate} · ${observation.interpretation ?? "No written lab interpretation"}` : "No linked sample",
                        })}
                        onBlur={() => setHovered(null)}
                      />
                    </g>
                  );
                })}

                {resolution === "smooth" && data.fields.map((field) => (
                  <path
                    key={`outline-${field.id}`}
                    d={pathForGeometry(field.geometry, projection.project)}
                    className="smooth-field-outline smooth-field-hit"
                    fill="transparent"
                    fillRule="evenodd"
                    role="button"
                    aria-label={`${field.name}: open soil evidence; Shift-click to zoom`}
                    data-field-id={field.id}
                    tabIndex={0}
                    onClick={(event) => openMapArea(event, { kind: "field", id: field.id }, field.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openMapArea(event, { kind: "field", id: field.id }, field.id);
                      }
                    }}
                    onMouseEnter={() => {
                      const observation = fieldObservations.get(field.id) ?? null;
                      setHovered({
                        title: field.name,
                        value: observation
                          ? `${observation.text} · ${observation.unit}`
                          : "No field result",
                        detail: "Interpolated surface · click for measured evidence",
                      });
                    }}
                    onMouseLeave={() => setHovered(null)}
                  />
                ))}
                <g className="map-distance-scale" aria-label={`Scale: ${scaleMetres} metres`} pointerEvents="none">
                  <path d={`M ${scaleX - scaleLength} ${scaleY - 5 * screenUnit} V ${scaleY} H ${scaleX} V ${scaleY - 5 * screenUnit}`} fill="none" vectorEffect="non-scaling-stroke" />
                  <text x={scaleX} y={scaleY - 10 * screenUnit} textAnchor="end" fontSize={11 * screenUnit}>{scaleMetres >= 1000 ? `${scaleMetres / 1000} km` : `${scaleMetres} m`}</text>
                </g>
              </svg>

              {hovered && (
                <div className="map-hover-card" aria-live="polite">
                  <span>{hovered.title}</span>
                  <strong>{hovered.value}</strong>
                  <small>{hovered.detail}</small>
                </div>
              )}
              <p className="map-navigation-hint" id="map-navigation-help">Shift-click a field to fit it. {isMapZoomed ? "Drag to pan · click empty background to reset." : "Ctrl + scroll to zoom."}</p>
            </div>
          </section>
          <aside className="map-guidance-panel" aria-label={`Guidance for ${metric.name}`}>
          <div className="legend" aria-label="Grid map legend">
            <div className="legend-heading">
              <span className="control-label">Legend</span>
              {(timeMode === "last-test" || colourMode === "relative") && <small>{timeMode === "last-test" ? "Test age" : colourScale.unit}</small>}
            </div>
            {timeMode === "last-test" ? (
              <div className="legend-list">
                {Object.entries(TEST_AGE_BANDS).map(([key, band]) => (
                  <span key={key}><i style={{ background: band.color }} />{band.label}</span>
                ))}
              </div>
            ) : colourMode === "interpretation" && agronomicScale ? (
              <div className="legend-list">
                {agronomicScale.bands.map((band) => <span key={band.label}><i style={{ background: band.colour }} />{band.label}</span>)}
                <span><i style={{ background: NO_DATA }} />No comparable index band</span>
                <details className="legend-explainer"><summary>Explainer</summary><p className="map-legend-note">{agronomicScale.description}</p></details>
              </div>
            ) : colourMode === "interpretation" ? (
              <div className="legend-list">
                {Object.entries(
                  {
                    "Very low / well below": STATUS_COLORS.critical,
                    "Low / below target": STATUS_COLORS.below,
                    "Adequate / at target": STATUS_COLORS.target,
                    "High / above target": STATUS_COLORS.above,
                    "Context needed": STATUS_COLORS.context,
                  },
                ).map(([label, color]) => (
                  <span key={label}>
                    <i style={{ background: color }} />
                    {label.replace(/\b\w/g, (letter) => letter.toUpperCase())}
                  </span>
                ))}
                <span><i style={{ background: NO_DATA }} />No source or lab band</span>
                <details className="legend-explainer"><summary>Explainer</summary><p className="map-legend-note">Red = low; amber = below target; green = adequate; blue = above target. Above target does not mean better. pH targets follow each field’s land use; other targets and laboratory bands are explained in Guidance.</p></details>
              </div>
            ) : metric.kind === "numeric" ? (
              <div className="legend-list numeric-band-legend">
                {colourScale.bands.map((band) => (
                  <span key={band.label}><i style={{ background: band.colour }} />{band.label}</span>
                ))}
                <span><i style={{ background: NO_DATA }} />No comparable result</span>
                <details className="legend-explainer"><summary>Explainer</summary><p className="map-legend-note">{colourScale.description}</p></details>
              </div>
            ) : (
              <div className="legend-list">
                {categoricalValues.map((label, index) => (
                  <span key={label}>
                    <i style={{ background: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] }} />
                    {label}
                  </span>
                ))}
                <span><i style={{ background: NO_DATA }} />No result</span>
              </div>
            )}
          </div>
            <h3>Tailored guidance</h3>
            <p>
              {guidanceField
                ? `Showing ${guidanceField.name} · ${LAND_USE_LABELS[guidanceLandUse]}.`
                : "Select a mapped field to see source guidance."}
            </p>
            <div className="map-guidance-list">
              {guidanceJudgements.slice(0, 4).map((judgement) => (
                <article key={judgement.agreementKey} className={`status-${judgement.key}`}>
                  <div className="source-chips">
                    {judgement.sourceIds.map((sourceId) => (
                      <a key={sourceId} href={AGRONOMY_SOURCES[sourceId].href} target="_blank" rel="noreferrer">
                        {AGRONOMY_SOURCES[sourceId].shortLabel}
                      </a>
                    ))}
                  </div>
                  <strong>{judgement.headline}</strong>
                  <span>{judgement.target}</span>
                </article>
              ))}
            </div>
            {guidanceField && (
              <button type="button" onClick={() => setSelectedArea({ kind: "field", id: guidanceField.id })}>
                Open full field guidance
              </button>
            )}
            <small>Guidance is decision support. Confirm crop, sampling method and field conditions before acting.</small>
          </aside>
          </div>

          <footer className="data-footer">
            <span>Data: {data.sources.workbook} + {data.sources.grids ?? "grid crosswalk"}</span>
            <span>Smoothed colours are decision-support estimates, not additional measurements.</span>
          </footer>
        </div>
      </section>

      {selectedArea && selectedField && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedArea(null);
          }}
        >
          <section
            className="field-modal grid-evidence-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="grid-evidence-title"
          >
            <header className="modal-header">
              <div>
                <span className="eyebrow">
                  {selectedGrid ? "Hectare-grid deep dive" : "Field deep dive"}
                </span>
                <h2 id="grid-evidence-title">
                  {selectedField.name}
                  {selectedGrid
                    ? ` · ${selectedGrid.id.replace("DEMO_GRID_", "Grid ")}`
                    : ""}
                </h2>
                <p>
                  {metric.name} · {selectedGrid ? `${selectedGrid.areaHa.toFixed(1)} ha grid` : `${selectedField.areaHa.toFixed(1)} ha field`} · map as at {mapYear}
                </p>
                <label className="modal-management">
                  <span>Management system</span>
                  <select
                    value={selectedLandUse}
                    onChange={(event) => updateLandUse(event.target.value as LandUse)}
                  >
                    {Object.entries(LAND_USE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <small>
                    {landUseOverrides[selectedField.id]
                      ? "Your saved choice on this device"
                      : "Inferred from recorded crop history · change if needed"}
                  </small>
                </label>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close soil evidence"
                onClick={() => setSelectedArea(null)}
              >
                Close
              </button>
            </header>

            <div className="modal-summary">
              <article>
                <span>Selected result</span>
                <strong>{selectedObservation ? selectedObservation.text : "No result"}</strong>
                <small>
                  {selectedObservation
                    ? `${selectedObservation.unit} · ${selectedObservation.date?.slice(0, 10) ?? mapYear}`
                    : `No ${metric.name} result by ${mapYear}`}
                </small>
              </article>
              <article
                style={{
                  "--status-color": selectedPrimary
                    ? STATUS_COLORS[selectedPrimary.key]
                    : STATUS_COLORS.context,
                } as CSSProperties}
              >
                <span>{selectedPrimary ? "RB209 primary view" : "Result interpretation"}</span>
                <strong>
                  {selectedPrimary?.label ?? selectedObservation?.interpretation ?? "Context required"}
                </strong>
                <small>
                  {selectedPrimary?.detail ?? "No universal source threshold; compare the evidence cards below."}
                </small>
              </article>
              <article>
                <span>Wheat-equivalent at risk</span>
                <strong>
                  {!isWheatProxyApplicable(selectedLandUse)
                    ? "Not applicable"
                    : selectedYieldLoss === null
                      ? "Not modelled"
                      : `${(selectedYieldLoss * referenceYield).toFixed(1)} t/ha`}
                </strong>
                <small>
                  {!isWheatProxyApplicable(selectedLandUse)
                    ? "Permanent grass: wheat proxy suppressed"
                    : selectedYieldLoss === null
                      ? "Evidence-based P & K proxy only"
                      : `${Math.round(selectedYieldLoss * 100)}% of a ${referenceYield} t/ha reference yield`}
                </small>
              </article>
            </div>

            {selectedGrid && (
              <section className="grid-lab-results" aria-labelledby="grid-lab-results-title">
                <h3 id="grid-lab-results-title">All measured results in this grid</h3>
                <p>
                  {selectedGrid.sampleDate ?? "Date not supplied"} · Only tests recorded for this square are listed.
                  Texture and trace nutrients were tested on selected grids, not every square.
                </p>
                <div className="grid-lab-table-scroll">
                  <table>
                    <thead><tr><th>Test</th><th>Reported result</th><th>Index / interpretation</th></tr></thead>
                    <tbody>
                      {metrics.filter(item => selectedGrid.results[item.id]).map(item => {
                        const result = selectedGrid.results[item.id];
                        const display = modeValue(result, "reported");
                        return (
                          <tr key={item.id}>
                            <th scope="row">
                              <button type="button" onClick={() => {
                                if (!metricMatchesGroup(item.id, metricGroup)) setMetricGroup("all");
                                setMetricId(item.id);
                                setUnitMode("reported");
                              }}>{item.name}</button>
                            </th>
                            <td title={result.sourceImage}>{display.text}{result.unit ? ` ${result.unit}` : ""}</td>
                            <td>{result.displayBand ?? result.indexBand ?? result.interpretation ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="agronomy-evidence" aria-labelledby="grid-agronomy-title">
              <div className="section-heading agronomy-heading">
                <div>
                  <span className="eyebrow">Evidence comparison</span>
                  <h3 id="grid-agronomy-title">Agronomic judgement</h3>
                </div>
                <span className="management-badge">{LAND_USE_LABELS[selectedLandUse]}</span>
              </div>
              <div className="judgement-grid">
                {selectedJudgements.map((judgement) => (
                  <article
                    key={judgement.agreementKey}
                    className={`judgement-card status-${judgement.key}`}
                  >
                    <div className="judgement-card-heading">
                      <div className="source-chips">
                        {judgement.sourceIds.map((sourceId) => {
                          const source = AGRONOMY_SOURCES[sourceId];
                          return (
                            <a key={sourceId} href={source.href} target="_blank" rel="noreferrer">
                              {source.shortLabel}
                            </a>
                          );
                        })}
                      </div>
                      <span>{judgement.sourceIds.length > 1 ? "Sources agree" : "Source view"}</span>
                    </div>
                    <h4>{judgement.headline}</h4>
                    <p>{judgement.action}</p>
                    <small>{judgement.target}</small>
                    {judgement.caveat && <div className="judgement-caveat">{judgement.caveat}</div>}
                  </article>
                ))}
              </div>
              <p className="agronomy-disclaimer">
                The four sources are kept separate where their targets or scope differ. “No universal threshold” is deliberate: a laboratory method, crop plan and field inspection are still required.
              </p>
            </section>

            <div className="chart-panel">
              <div className="chart-heading">
                <div>
                  <span className="control-label">{metric.name} field history</span>
                  <small>{unitLabel} · newest result included up to {mapYear}</small>
                </div>
                <strong>{selectedHistory.length} observations</strong>
              </div>
              <MetricHistoryChart history={selectedHistory} unitMode={unitMode} />
            </div>

            <div className="grid-evidence-lower">
              <div className="result-history">
                <div className="section-heading">
                  <span className="control-label">Result trail</span>
                  <small>Newest first</small>
                </div>
                <div className="history-list">
                  {[...selectedHistory].reverse().slice(0, 8).map((observation) => (
                    <article key={`${observation.date}-${observation.text}`}>
                      <time>{observation.date.slice(0, 10)}</time>
                      <strong>{observation.text}</strong>
                      <span>{observation.interpretation ?? observation.unit}</span>
                      <small>{observation.samples} sample{observation.samples === 1 ? "" : "s"}</small>
                    </article>
                  ))}
                  {!selectedHistory.length && <p>No historical records are available for this metric.</p>}
                </div>
              </div>
              <aside className="interpretation-note">
                <span className="eyebrow">Laboratory context</span>
                <h3>{selectedObservation?.interpretation ?? "Method-specific result"}</h3>
                <p>
                  {selectedObservation?.method
                    ? `Method: ${selectedObservation.method}. `
                    : "Analytical method was not recorded. "}
                  Reported units and extraction methods are not interchangeable; interpret repeat trends only on a like-for-like basis.
                </p>
                {selectedObservation?.comment && <blockquote>Lab note: {selectedObservation.comment}</blockquote>}
              </aside>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
