CREATE TABLE `call_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`scheduled_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`outcome` text,
	`summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_call_jobs_org_status_scheduled` ON `call_jobs` (`organization_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `lead_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lead_events_org_lead` ON `lead_events` (`organization_id`,`lead_id`);--> statement-breakpoint
CREATE TABLE `lead_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`fields_json` text NOT NULL,
	`allowed_domains_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lead_forms_public_key` ON `lead_forms` (`public_key`);--> statement-breakpoint
CREATE TABLE `lead_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`external_account_id` text,
	`webhook_secret` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lead_sources_org_type` ON `lead_sources` (`organization_id`,`type`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_id` text NOT NULL,
	`external_lead_id` text,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`campaign_name` text,
	`product_interest` text,
	`notes` text,
	`status` text DEFAULT 'new' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`intent` text DEFAULT 'unknown' NOT NULL,
	`ai_summary` text DEFAULT 'Awaiting analysis' NOT NULL,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `lead_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_leads_org_captured` ON `leads` (`organization_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_leads_org_status` ON `leads` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_leads_org_score` ON `leads` (`organization_id`,`score`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_leads_org_external` ON `leads` (`organization_id`,`source_id`,`external_lead_id`);--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_org_user` ON `organization_members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_members_user` ON `organization_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_organizations_slug` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `sales_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`stage` text DEFAULT 'ai_qualified' NOT NULL,
	`estimated_value` integer DEFAULT 0 NOT NULL,
	`owner` text DEFAULT 'AI SDR' NOT NULL,
	`next_action` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_opportunities_org_stage` ON `sales_opportunities` (`organization_id`,`stage`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_opportunities_org_lead` ON `sales_opportunities` (`organization_id`,`lead_id`);