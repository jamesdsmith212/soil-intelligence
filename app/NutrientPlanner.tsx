"use client";

import { useState } from "react";
import NutrientPlannerLegacy, {
  type NutrientData,
} from "./planner/legacy/NutrientPlannerLegacy";
import NutrientPlannerV2 from "./planner/v2/NutrientPlannerV2";

export type { NutrientData };

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

export type PlannerSoilField = {
  id: string;
  canonicalId?: string;
  name: string;
  areaHa: number;
  results: SoilResult[];
};

export default function NutrientPlanner({
  soilFields,
  nutrientData,
  onBack,
}: {
  soilFields: PlannerSoilField[];
  nutrientData: NutrientData;
  onBack: () => void;
}) {
  const [plannerVersion, setPlannerVersion] = useState<
    "nutrient_planner_v2" | "legacy_v1"
  >("nutrient_planner_v2");

  return (
    <div className="planner-version-shell">
      <nav className="planner-version-bar" aria-label="Planner model">
        <div>
          <span className="eyebrow">Planner model</span>
          <strong>
            {plannerVersion === "nutrient_planner_v2"
              ? "Improved planner"
              : "Original planner"}
          </strong>
          <small>
            {plannerVersion === "nutrient_planner_v2"
              ? "Sequential soil, crop-response and cash-flow model"
              : "Legacy model retained for comparison and existing saved plans"}
          </small>
        </div>
        <div className="planner-version-switch" role="group">
          <button
            type="button"
            className={
              plannerVersion === "nutrient_planner_v2" ? "is-active" : ""
            }
            aria-pressed={plannerVersion === "nutrient_planner_v2"}
            onClick={() => setPlannerVersion("nutrient_planner_v2")}
          >
            Improved planner
          </button>
          <button
            type="button"
            className={plannerVersion === "legacy_v1" ? "is-active" : ""}
            aria-pressed={plannerVersion === "legacy_v1"}
            onClick={() => setPlannerVersion("legacy_v1")}
          >
            Original planner
          </button>
        </div>
      </nav>
      {plannerVersion === "legacy_v1" ? (
        <NutrientPlannerLegacy
          soilFields={soilFields}
          nutrientData={nutrientData}
          onBack={onBack}
        />
      ) : (
        <NutrientPlannerV2
          soilFields={soilFields}
          nutrientData={nutrientData}
          onBack={onBack}
          onShowLegacy={() => setPlannerVersion("legacy_v1")}
        />
      )}
    </div>
  );
}
