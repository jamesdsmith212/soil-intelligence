import { applicationNutrients } from "./nutrient-applications.ts";
import {
  buildCoefficientForScenario,
  DEFAULT_BUILD_COEFFICIENTS,
} from "./correction-requirement.ts";
import { relativeYield, type InteractionMethod } from "./crop-response.ts";
import { applicationPlanCost } from "./product-costs.ts";
import { soilTrajectory } from "./soil-trajectory.ts";
import { terminalSoilCapitalValue } from "./terminal-value.ts";
import {
  type NutrientProduct,
  type PlannedYear,
  type Scenario,
  SCENARIOS,
  type SoilBuildCoefficient,
  type SoilConcentrations,
  type TargetStrategy,
} from "./nutrient-types.ts";

export type AnnualPlanEconomics = {
  year: number;
  crop: PlannedYear["crop"];
  untreatedStatus: SoilConcentrations;
  treatedStatus: SoilConcentrations;
  untreatedRelativeYield: number;
  treatedRelativeYield: number;
  untreatedYieldTPerHa: number;
  treatedYieldTPerHa: number;
  incrementalGrainValue: number | null;
  incrementalStrawValue: number | null;
  incrementalCropValue: number | null;
  maintenanceCost: number | null;
  correctionCost: number | null;
  applicationCost: number | null;
  applicationCostBreakdown: {
    material: number;
    haulage: number;
    handling: number;
    spreading: number;
    fixedPass: number;
  };
  netCashFlow: number | null;
  discountedNetCashFlow: number | null;
};

export type ScenarioEconomics = {
  scenario: Scenario;
  annual: AnnualPlanEconomics[];
  untreatedTrajectory: ReturnType<typeof soilTrajectory>;
  treatedTrajectory: ReturnType<typeof soilTrajectory>;
  discountedCropResponseValue: number | null;
  discountedApplicationCost: number | null;
  discountedCostBreakdown: AnnualPlanEconomics["applicationCostBreakdown"];
  terminalSoilCapitalValue: number | null;
  discountedTerminalSoilCapitalValue: number | null;
  npv: number | null;
  complete: boolean;
  warnings: string[];
};

const costComponents = (
  plan: ReturnType<typeof applicationPlanCost>,
): AnnualPlanEconomics["applicationCostBreakdown"] =>
  plan.lines.reduce(
    (sum, line) => {
      sum.material += line.breakdown.material;
      sum.haulage += line.breakdown.haulage;
      sum.handling += line.breakdown.handling;
      sum.spreading += line.breakdown.spreading;
      sum.fixedPass += line.breakdown.fixedPass;
      return sum;
    },
    { material: 0, haulage: 0, handling: 0, spreading: 0, fixedPass: 0 },
  );

const costForPurpose = (
  applications: NonNullable<PlannedYear["treatedApplications"]>,
  purpose: "maintenance" | "correction",
) => {
  const selected = applications.filter(
    (application) =>
      application.purpose === purpose || application.purpose === "combined",
  );
  return applicationPlanCost(selected);
};

const evaluateScenario = ({
  anchor,
  years,
  scenario,
  productsForTerminalValue,
  discountRate,
  interaction,
  coefficients,
  targets,
  priceMultiplier,
  costMultiplier,
  forceNoCropResponse,
  enableGrassResponse,
}: {
  anchor: SoilConcentrations;
  years: PlannedYear[];
  scenario: Scenario;
  productsForTerminalValue: NutrientProduct[];
  discountRate: number;
  interaction: InteractionMethod;
  coefficients?: Record<"p" | "k", SoilBuildCoefficient>;
  targets?: Record<"p" | "k", TargetStrategy>;
  priceMultiplier: number;
  costMultiplier: number;
  forceNoCropResponse: boolean;
  enableGrassResponse: boolean;
}): ScenarioEconomics => {
  const untreatedTrajectory = soilTrajectory({
    anchor,
    years,
    scenario,
    path: "untreated",
    coefficients,
  });
  const treatedTrajectory = soilTrajectory({
    anchor,
    years,
    scenario,
    path: "treated",
    coefficients,
  });
  const warnings: string[] = [
    ...untreatedTrajectory.flatMap((year) => year.warnings),
    ...treatedTrajectory.flatMap((year) => year.warnings),
  ];
  const annual = years.map<AnnualPlanEconomics>((year, index) => {
    const untreatedStatus = untreatedTrajectory[index].end;
    const treatedStatus = treatedTrajectory[index].end;
    const rootingModifier = year.rootingModifier ?? 1;
    const responseStatus = (
      status: SoilConcentrations,
      applications: NonNullable<PlannedYear["treatedApplications"]>,
    ) => {
      const nutrients = applicationNutrients(applications, scenario);
      const pCoefficient = buildCoefficientForScenario(
        coefficients?.p ?? DEFAULT_BUILD_COEFFICIENTS.p,
        scenario,
      );
      const kCoefficient = buildCoefficientForScenario(
        coefficients?.k ?? DEFAULT_BUILD_COEFFICIENTS.k,
        scenario,
      );
      return {
        pMgL: Math.max(
          0,
          status.pMgL +
            (nutrients.effectiveFirstYear.p2o5KgHa -
              nutrients.effectiveBuild.p2o5KgHa) /
              pCoefficient,
        ),
        kMgL: Math.max(
          0,
          status.kMgL +
            (nutrients.effectiveFirstYear.k2oKgHa -
              nutrients.effectiveBuild.k2oKgHa) /
              kCoefficient,
        ),
      };
    };
    const untreatedResponseStatus = responseStatus(
      untreatedStatus,
      year.untreatedApplications ?? [],
    );
    const treatedResponseStatus = responseStatus(
      treatedStatus,
      year.treatedApplications ?? [],
    );
    const untreatedRelativeYield = relativeYield({
      crop: year.crop,
      status: untreatedResponseStatus,
      scenario,
      interaction,
      rootingModifier,
      enableGrassResponse,
    });
    const modelledTreatedRelativeYield = relativeYield({
      crop: year.crop,
      status: treatedResponseStatus,
      scenario,
      interaction,
      rootingModifier,
      enableGrassResponse,
    });
    const treatedRelativeYield = forceNoCropResponse
      ? untreatedRelativeYield
      : Math.max(untreatedRelativeYield, modelledTreatedRelativeYield);
    const untreatedYieldTPerHa =
      year.expectedYieldTPerHa * untreatedRelativeYield;
    const treatedYieldTPerHa = year.expectedYieldTPerHa * treatedRelativeYield;
    const incrementalGrainValue =
      year.cropPricePerTonne == null
        ? null
        : (treatedYieldTPerHa - untreatedYieldTPerHa) *
          year.cropPricePerTonne *
          priceMultiplier;
    const removedStrawYield =
      year.removals.find((removal) => removal.material === "straw")
        ?.yieldTPerHa ?? null;
    const incrementalStrawValue =
      removedStrawYield == null
        ? 0
        : year.strawPricePerTonne == null
          ? null
          : removedStrawYield *
            (treatedRelativeYield - untreatedRelativeYield) *
            year.strawPricePerTonne *
            priceMultiplier;
    const incrementalCropValue =
      incrementalGrainValue == null || incrementalStrawValue == null
        ? null
        : incrementalGrainValue + incrementalStrawValue;
    if (year.cropPricePerTonne == null) {
      warnings.push(`${year.year}: crop price is missing`);
    }
    if (removedStrawYield != null && year.strawPricePerTonne == null) {
      warnings.push(`${year.year}: removed-straw price is missing`);
    }
    const untreatedCosts = applicationPlanCost(year.untreatedApplications ?? []);
    const treatedCosts = applicationPlanCost(year.treatedApplications ?? []);
    const incrementalApplicationCost =
      untreatedCosts.total == null || treatedCosts.total == null
        ? null
        : Math.max(0, treatedCosts.total - untreatedCosts.total) * costMultiplier;
    const untreatedComponents = costComponents(untreatedCosts);
    const treatedComponents = costComponents(treatedCosts);
    const applicationCostBreakdown = Object.fromEntries(
      (
        [
          "material",
          "haulage",
          "handling",
          "spreading",
          "fixedPass",
        ] as const
      ).map((component) => [
        component,
        Math.max(0, treatedComponents[component] - untreatedComponents[component]) *
          costMultiplier,
      ]),
    ) as AnnualPlanEconomics["applicationCostBreakdown"];
    if (incrementalApplicationCost == null) {
      warnings.push(`${year.year}: product or application cost is incomplete`);
    }
    const maintenance = costForPurpose(
      year.treatedApplications ?? [],
      "maintenance",
    );
    const correction = costForPurpose(
      year.treatedApplications ?? [],
      "correction",
    );
    const netCashFlow =
      incrementalCropValue == null || incrementalApplicationCost == null
        ? null
        : incrementalCropValue - incrementalApplicationCost;
    return {
      year: year.year,
      crop: year.crop,
      untreatedStatus,
      treatedStatus,
      untreatedRelativeYield,
      treatedRelativeYield,
      untreatedYieldTPerHa,
      treatedYieldTPerHa,
      incrementalGrainValue,
      incrementalStrawValue,
      incrementalCropValue,
      maintenanceCost:
        maintenance.total == null ? null : maintenance.total * costMultiplier,
      correctionCost:
        correction.total == null ? null : correction.total * costMultiplier,
      applicationCost: incrementalApplicationCost,
      applicationCostBreakdown,
      netCashFlow,
      discountedNetCashFlow:
        netCashFlow == null
          ? null
          : netCashFlow / (1 + discountRate) ** (index + 1),
    };
  });
  const terminal = terminalSoilCapitalValue({
    untreated: untreatedTrajectory.at(-1)?.end ?? anchor,
    treated: treatedTrajectory.at(-1)?.end ?? anchor,
    products: productsForTerminalValue,
    scenario,
    targets,
    coefficients,
  });
  const terminalValue =
    terminal.value == null ? null : terminal.value * costMultiplier;
  if (!terminal.complete) warnings.push("Terminal correction cost is incomplete");
  const discountedTerminal =
    terminalValue == null
      ? null
      : terminalValue / (1 + discountRate) ** years.length;
  const annualComplete = annual.every(
    (item) =>
      item.incrementalCropValue != null &&
      item.applicationCost != null &&
      item.discountedNetCashFlow != null,
  );
  const trajectoryComplete = [...untreatedTrajectory, ...treatedTrajectory].every(
    (year) =>
      year.maintenanceComplete && year.applicationEffectivenessComplete,
  );
  const complete =
    annualComplete && trajectoryComplete && discountedTerminal != null;
  const discountedCropResponseValue = annualComplete
    ? annual.reduce(
        (sum, item, index) =>
          sum +
          item.incrementalCropValue! / (1 + discountRate) ** (index + 1),
        0,
      )
    : null;
  const discountedApplicationCost = annualComplete
    ? annual.reduce(
        (sum, item, index) =>
          sum + item.applicationCost! / (1 + discountRate) ** (index + 1),
        0,
      )
    : null;
  const discountedCostBreakdown = annual.reduce(
    (sum, item, index) => {
      const divisor = (1 + discountRate) ** (index + 1);
      for (const component of [
        "material",
        "haulage",
        "handling",
        "spreading",
        "fixedPass",
      ] as const) {
        sum[component] += item.applicationCostBreakdown[component] / divisor;
      }
      return sum;
    },
    { material: 0, haulage: 0, handling: 0, spreading: 0, fixedPass: 0 },
  );
  return {
    scenario,
    annual,
    untreatedTrajectory,
    treatedTrajectory,
    discountedCropResponseValue,
    discountedApplicationCost,
    discountedCostBreakdown,
    terminalSoilCapitalValue: terminalValue,
    discountedTerminalSoilCapitalValue: discountedTerminal,
    npv:
      complete &&
      discountedCropResponseValue != null &&
      discountedApplicationCost != null &&
      discountedTerminal != null
        ? discountedCropResponseValue -
          discountedApplicationCost +
          discountedTerminal
        : null,
    complete,
    warnings: [...new Set(warnings)],
  };
};

export const evaluateNutrientPlan = ({
  anchor,
  years,
  productsForTerminalValue,
  discountRate = 0.05,
  interaction = "multiplicative",
  coefficients,
  targets,
  forceNoCropResponseInLow = false,
  enableGrassResponse = false,
  scenarioMultipliers = {
    price: { low: 0.9, central: 1, high: 1.1 },
    cost: { low: 1.1, central: 1, high: 0.9 },
  },
}: {
  anchor: SoilConcentrations;
  years: PlannedYear[];
  productsForTerminalValue: NutrientProduct[];
  discountRate?: number;
  interaction?: InteractionMethod;
  coefficients?: Record<"p" | "k", SoilBuildCoefficient>;
  targets?: Record<"p" | "k", TargetStrategy>;
  forceNoCropResponseInLow?: boolean;
  enableGrassResponse?: boolean;
  scenarioMultipliers?: {
    price: Record<Scenario, number>;
    cost: Record<Scenario, number>;
  };
}) => {
  if (!Number.isFinite(discountRate) || discountRate < 0) {
    throw new RangeError("Discount rate must be a finite non-negative decimal");
  }
  return Object.fromEntries(
    SCENARIOS.map((scenario) => [
      scenario,
      evaluateScenario({
        anchor,
        years,
        scenario,
        productsForTerminalValue,
        discountRate,
        interaction,
        coefficients,
        targets,
        priceMultiplier: scenarioMultipliers.price[scenario],
        costMultiplier: scenarioMultipliers.cost[scenario],
        forceNoCropResponse:
          scenario === "low" && forceNoCropResponseInLow,
        enableGrassResponse,
      }),
    ]),
  ) as Record<Scenario, ScenarioEconomics>;
};
