CREATE TABLE `alert_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`current_value` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`triggered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_alert_incidents_org_status` ON `alert_incidents` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`metric` text NOT NULL,
	`comparator` text DEFAULT '>' NOT NULL,
	`threshold` integer NOT NULL,
	`window_minutes` integer DEFAULT 60 NOT NULL,
	`frequency_minutes` integer DEFAULT 15 NOT NULL,
	`channels_json` text DEFAULT '["email"]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_alert_rules_org_status` ON `alert_rules` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `auth_provider_settings` (
	`provider` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`button_visible` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'not_configured' NOT NULL,
	`public_config_json` text DEFAULT '{}' NOT NULL,
	`encrypted_secret` text,
	`updated_by` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `call_quality_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`call_id` text NOT NULL,
	`overall_score` integer NOT NULL,
	`resolution_score` integer NOT NULL,
	`knowledge_score` integer NOT NULL,
	`naturalness_score` integer NOT NULL,
	`policy_score` integer NOT NULL,
	`hallucination_count` integer DEFAULT 0 NOT NULL,
	`overlap_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'passed' NOT NULL,
	`findings_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`call_id`) REFERENCES `call_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_call_quality_org_score` ON `call_quality_reviews` (`organization_id`,`overall_score`);--> statement-breakpoint
CREATE TABLE `call_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text,
	`lead_id` text,
	`campaign_id` text,
	`direction` text NOT NULL,
	`from_number` text NOT NULL,
	`to_number` text NOT NULL,
	`customer_name` text,
	`status` text NOT NULL,
	`outcome` text,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer,
	`sentiment` text,
	`summary` text,
	`transcript_json` text DEFAULT '[]' NOT NULL,
	`analysis_json` text DEFAULT '{}' NOT NULL,
	`recording_status` text DEFAULT 'not_available' NOT NULL,
	`recording_storage_key` text,
	`recording_url` text,
	`cost_credits` integer DEFAULT 0 NOT NULL,
	`disconnect_reason` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `voice_agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_call_records_org_started` ON `call_records` (`organization_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_call_records_org_status` ON `call_records` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`audience_size` integer DEFAULT 0 NOT NULL,
	`attempted` integer DEFAULT 0 NOT NULL,
	`connected` integer DEFAULT 0 NOT NULL,
	`converted` integer DEFAULT 0 NOT NULL,
	`concurrency` integer DEFAULT 1 NOT NULL,
	`retry_policy_json` text DEFAULT '{}' NOT NULL,
	`calling_window_json` text DEFAULT '{}' NOT NULL,
	`scheduled_for` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `voice_agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_campaigns_org_status` ON `campaigns` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `graph_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`entry_node` text DEFAULT 'greeting' NOT NULL,
	`graph_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_graph_agents_org_status` ON `graph_agents` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `knowledge_bases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`language` text DEFAULT 'multilingual' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_bases_org` ON `knowledge_bases` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `organization_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`default_language` text DEFAULT 'hinglish' NOT NULL,
	`enabled_languages_json` text DEFAULT '["hi-IN","en-IN","hinglish","haryanvi"]' NOT NULL,
	`recording_policy` text DEFAULT 'record_with_consent' NOT NULL,
	`recording_retention_days` integer DEFAULT 90 NOT NULL,
	`transcript_retention_days` integer DEFAULT 180 NOT NULL,
	`qa_sample_rate` integer DEFAULT 100 NOT NULL,
	`redact_sensitive_data` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `platform_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`internal_name` text NOT NULL,
	`public_name` text NOT NULL,
	`category` text NOT NULL,
	`required_credentials_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'required' NOT NULL,
	`health` text DEFAULT 'not_connected' NOT NULL,
	`usage_note` text NOT NULL,
	`customer_visible` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `report_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`report_type` text NOT NULL,
	`schedule` text DEFAULT 'manual' NOT NULL,
	`filters_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_generated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reports_org_status` ON `report_definitions` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `sip_trunks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text DEFAULT 'custom' NOT NULL,
	`gateway_uri` text NOT NULL,
	`auth_type` text DEFAULT 'userpass' NOT NULL,
	`encrypted_credentials` text,
	`transport` text DEFAULT 'tls' NOT NULL,
	`media_encryption` text DEFAULT 'sdes' NOT NULL,
	`codecs_json` text DEFAULT '["PCMU","PCMA"]' NOT NULL,
	`status` text DEFAULT 'testing_required' NOT NULL,
	`last_checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sip_trunks_org_status` ON `sip_trunks` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `support_ticket_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`sender_role` text NOT NULL,
	`sender_name` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ticket_messages_ticket` ON `support_ticket_messages` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`subject` text NOT NULL,
	`category` text DEFAULT 'technical' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_to` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_org_status` ON `support_tickets` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger_type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workflows_org_status` ON `workflows` (`organization_id`,`status`);