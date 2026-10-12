export type SoilIndexLabel =
  | "0"
  | "1"
  | "2-"
  | "2"
  | "2+"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9";

type Boundary = { maximum: number; label: SoilIndexLabel };

const P_BOUNDARIES: Boundary[] = [
  { maximum: 9, label: "0" },
  { maximum: 15, label: "1" },
  { maximum: 25, label: "2" },
  { maximum: 45, label: "3" },
  { maximum: 70, label: "4" },
  { maximum: 100, label: "5" },
  { maximum: 140, label: "6" },
  { maximum: 200, label: "7" },
  { maximum: 280, label: "8" },
  { maximum: Infinity, label: "9" },
];

const K_BOUNDARIES: Boundary[] = [
  { maximum: 60, label: "0" },
  { maximum: 120, label: "1" },
  { maximum: 180, label: "2-" },
  { maximum: 240, label: "2+" },
  { maximum: 400, label: "3" },
  { maximum: 600, label: "4" },
  { maximum: 900, label: "5" },
  { maximum: 1200, label: "6" },
  { maximum: 1500, label: "7" },
  { maximum: 1800, label: "8" },
  { maximum: Infinity, label: "9" },
];

const MG_BOUNDARIES: Boundary[] = [
  { maximum: 25, label: "0" },
  { maximum: 50, label: "1" },
  { maximum: 100, label: "2" },
  { maximum: 175, label: "3" },
  { maximum: 250, label: "4" },
  { maximum: 350, label: "5" },
  { maximum: Infinity, label: "6" },
];

const indexFromBoundaries = (concentrationMgL: number, boundaries: Boundary[]) => {
  if (!Number.isFinite(concentrationMgL) || concentrationMgL < 0) {
    throw new RangeError("Soil concentration must be a finite non-negative number");
  }
  return boundaries.find(({ maximum }) => concentrationMgL <= maximum)!.label;
};

export const phosphorusIndex = (concentrationMgL: number) =>
  indexFromBoundaries(concentrationMgL, P_BOUNDARIES);

export const potassiumIndex = (concentrationMgL: number) =>
  indexFromBoundaries(concentrationMgL, K_BOUNDARIES);

export const magnesiumIndex = (concentrationMgL: number) =>
  indexFromBoundaries(concentrationMgL, MG_BOUNDARIES);
