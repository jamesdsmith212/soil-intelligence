import { applicationNutrients } from "./nutrient-applications.ts";
import {
  buildCoefficientForScenario,
  cropRemoval,
  DEFAULT_BUILD_COEFFICIENTS,
} from "./correction-requirement.ts";
import { potassiumIndex, phosphorusIndex } from "./soil-index.ts";
import {
  type NutrientAmounts,
  type PlannedYear,
  type Scenario,
  type SoilBuildCoefficient,
  type SoilConcentrations,
} from "./nutrient-types.ts";

export type TrajectoryYear = {
  year: number;
  crop: PlannedYear["crop"];
  start: SoilConcentrations;
  declaredApplications: NutrientAmounts;
  effectiveApplications: NutrientAmounts;
  removals: NutrientAmounts;
  end: SoilConcentrations;
  endIndices: { p: string; k: string };
  maintenanceComplete: boolean;
  applicationEffectivenessComplete: boolean;
  warnings: string[];
};

const nextStatus = (
  start: SoilConcentrations,
  applications: NutrientAmounts,
  removals: NutrientAmounts,
  coefficients: Record<"p" | "k", SoilBuildCoefficient>,
  scenario: Scenario,
): SoilConcentrations => ({
  pMgL: Math.max(
    0,
    start.pMgL +
      (applications.p2o5KgHa - removals.p2o5KgHa) /
        buildCoefficientForScenario(coefficients.p, scenario),
  ),
  kMgL: Math.max(
    0,
    start.kMgL +
      (applications.k2oKgHa - removals.k2oKgHa) /
        buildCoefficientForScenario(coefficients.k, scenario),
  ),
});

export const soilTrajectory = ({
  anchor,
  years,
  scenario,
  path,
  coefficients = DEFAULT_BUILD_COEFFICIENTS,
}: {
  anchor: SoilConcentrations;
  years: PlannedYear[];
  scenario: Scenario;
  path: "untreated" | "treated";
  coefficients?: Record<"p" | "k", SoilBuildCoefficient>;
}) => {
  let current = { ...anchor };
  return years.map<TrajectoryYear>((year) => {
    const applications =
      path === "treated"
        ? year.treatedApplications ?? []
        : year.untreatedApplications ?? [];
    const applied = applicationNutrients(applications, scenario);
    const removed = cropRemoval(year);
    const end = nextStatus(
      current,
      applied.effectiveBuild,
      removed.nutrients,
      coefficients,
      scenario,
    );
    const result: TrajectoryYear = {
      year: year.year,
      crop: year.crop,
      start: current,
      declaredApplications: applied.declared,
      effectiveApplications: applied.effectiveBuild,
      removals: removed.nutrients,
      end,
      endIndices: {
        p: phosphorusIndex(end.pMgL),
        k: potassiumIndex(end.kMgL),
      },
      maintenanceComplete: removed.complete,
      applicationEffectivenessComplete: applied.complete,
      warnings: [
        ...(removed.warning ? [removed.warning] : []),
        ...applied.assumptions,
      ],
    };
    current = end;
    return result;
  });
};
