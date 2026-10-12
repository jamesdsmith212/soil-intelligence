import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const nutrientPlans = sqliteTable("nutrient_plans", {
  fieldId: text("field_id").primaryKey(),
  planJson: text("plan_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const nutrientPlanVersions = sqliteTable("nutrient_plan_versions", {
  planId: text("plan_id").primaryKey(),
  fieldId: text("field_id").notNull(),
  plannerVersion: text("planner_version", {
    enum: ["legacy_v1", "nutrient_planner_v2"],
  }).notNull(),
  sourcePlanId: text("source_plan_id"),
  migrationWarningsJson: text("migration_warnings_json")
    .notNull()
    .default("[]"),
  planJson: text("plan_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
