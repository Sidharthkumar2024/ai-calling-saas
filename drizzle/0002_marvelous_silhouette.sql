CREATE TABLE `agent_test_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`latency_ms` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_test_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_test_messages_session` ON `agent_test_messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `agent_test_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`mode` text DEFAULT 'text' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `voice_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_test_sessions_org_created` ON `agent_test_sessions` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `onboarding_profiles` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`phone` text,
	`use_case` text DEFAULT 'sales' NOT NULL,
	`primary_language` text DEFAULT 'hi-IN' NOT NULL,
	`stage` text DEFAULT 'agent_test' NOT NULL,
	`trial_granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `outbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text,
	`payment_link_id` text,
	`channel` text DEFAULT 'whatsapp' NOT NULL,
	`destination` text NOT NULL,
	`template_name` text,
	`message_body` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_reference` text,
	`error_message` text,
	`scheduled_for` text,
	`sent_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_outbound_messages_org_created` ON `outbound_messages` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_outbound_messages_status_scheduled` ON `outbound_messages` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text,
	`agent_id` text,
	`reference_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_email` text,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`description` text NOT NULL,
	`delivery_mode` text DEFAULT 'instant' NOT NULL,
	`scheduled_for` text,
	`provider` text DEFAULT 'razorpay_sandbox' NOT NULL,
	`external_payment_link_id` text,
	`short_url` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`provider_payload_json` text DEFAULT '{}' NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `voice_agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_links_reference` ON `payment_links` (`reference_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_links_external` ON `payment_links` (`external_payment_link_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_links_org_created` ON `payment_links` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `scheduled_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text,
	`agent_id` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`last_error` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `voice_agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_actions_status_run` ON `scheduled_actions` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_actions_org` ON `scheduled_actions` (`organization_id`);--> statement-breakpoint
CREATE TABLE `voice_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`use_case` text DEFAULT 'sales' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`welcome_message` text NOT NULL,
	`system_prompt` text NOT NULL,
	`primary_language` text DEFAULT 'hi-IN' NOT NULL,
	`voice_name` text DEFAULT 'Vaani Tara' NOT NULL,
	`intelligence_profile` text DEFAULT 'Vaani Sense Balanced' NOT NULL,
	`temperature` integer DEFAULT 20 NOT NULL,
	`max_tokens` integer DEFAULT 250 NOT NULL,
	`endpointing_ms` integer DEFAULT 250 NOT NULL,
	`interrupt_words` integer DEFAULT 2 NOT NULL,
	`tools_json` text DEFAULT '[]' NOT NULL,
	`extractions_json` text DEFAULT '[]' NOT NULL,
	`calling_config_json` text DEFAULT '{}' NOT NULL,
	`cost_per_minute` integer DEFAULT 55 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_voice_agents_org_status` ON `voice_agents` (`organization_id`,`status`);