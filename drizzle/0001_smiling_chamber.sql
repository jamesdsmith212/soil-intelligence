CREATE TABLE `nutrient_plan_versions` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`planner_version` text NOT NULL,
	`source_plan_id` text,
	`migration_warnings_json` text DEFAULT '[]' NOT NULL,
	`plan_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
