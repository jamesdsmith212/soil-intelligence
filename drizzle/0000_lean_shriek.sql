CREATE TABLE `nutrient_plans` (
	`field_id` text PRIMARY KEY NOT NULL,
	`plan_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
