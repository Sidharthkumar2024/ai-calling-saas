ALTER TABLE `lead_forms` ADD `settings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `lead_forms` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `lead_forms` ADD `published_at` text;--> statement-breakpoint
ALTER TABLE `lead_forms` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lead_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`fields_json` text NOT NULL,
	`allowed_domains_json` text DEFAULT '[]' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`published_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_lead_forms`("id", "organization_id", "name", "public_key", "fields_json", "allowed_domains_json", "settings_json", "status", "version", "published_at", "updated_at", "created_at") SELECT "id", "organization_id", "name", "public_key", "fields_json", "allowed_domains_json", "settings_json", "status", "version", "published_at", "updated_at", "created_at" FROM `lead_forms`;--> statement-breakpoint
DROP TABLE `lead_forms`;--> statement-breakpoint
ALTER TABLE `__new_lead_forms` RENAME TO `lead_forms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lead_forms_public_key` ON `lead_forms` (`public_key`);
