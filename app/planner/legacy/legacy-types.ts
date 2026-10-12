export const LEGACY_PLANNER_VERSION = "legacy_v1" as const;

export type LegacyPlannerVersion = typeof LEGACY_PLANNER_VERSION;

export type VersionedLegacyPlan = {
  plannerVersion: LegacyPlannerVersion;
  fieldId: string;
  cropAdjustments: Record<string, unknown>;
  proposedApplications: Array<Record<string, unknown>>;
  economics: Record<string, unknown>;
  economicSummary?: Record<string, unknown> | null;
  notes?: string;
  updatedAt?: string;
};
