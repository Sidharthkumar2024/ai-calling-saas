CREATE TABLE `background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`queue` text DEFAULT 'default' NOT NULL,
	`type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`available_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`locked_at` text,
	`locked_by` text,
	`last_error` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_background_jobs_idempotency` ON `background_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_background_jobs_claim` ON `background_jobs` (`status`,`available_at`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_background_jobs_org` ON `background_jobs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `campaign_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`lead_id` text,
	`phone` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`consent_status` text DEFAULT 'unknown' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`outcome` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaign_contacts_campaign_phone` ON `campaign_contacts` (`campaign_id`,`phone`);--> statement-breakpoint
CREATE INDEX `idx_campaign_contacts_ready` ON `campaign_contacts` (`campaign_id`,`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `consent_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text,
	`phone` text NOT NULL,
	`purpose` text NOT NULL,
	`lawful_basis` text DEFAULT 'explicit_consent' NOT NULL,
	`status` text DEFAULT 'granted' NOT NULL,
	`proof_json` text DEFAULT '{}' NOT NULL,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_consent_org_phone` ON `consent_records` (`organization_id`,`phone`,`status`);--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer,
	`error` text,
	`result_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `background_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_job_attempts_job` ON `job_attempts` (`job_id`,`attempt`);--> statement-breakpoint
CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`content` text NOT NULL,
	`token_estimate` integer NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_knowledge_chunks_source_ordinal` ON `knowledge_chunks` (`source_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_chunks_org` ON `knowledge_chunks` (`organization_id`);--> statement-breakpoint
CREATE TABLE `knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`knowledge_base_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`source_url` text,
	`storage_key` text,
	`content_hash` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_sources_kb` ON `knowledge_sources` (`knowledge_base_id`,`status`);--> statement-breakpoint
CREATE TABLE `kyc_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`phone_number_id` text,
	`document_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`checksum` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`rejection_reason` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`phone_number_id`) REFERENCES `phone_numbers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_kyc_org_status` ON `kyc_documents` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`state_hash` text NOT NULL,
	`code_verifier_encrypted` text NOT NULL,
	`return_to` text DEFAULT '/app' NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_states_hash` ON `oauth_states` (`state_hash`);--> statement-breakpoint
CREATE TABLE `payment_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`status` text NOT NULL,
	`mismatch_reason` text,
	`reconciled_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reconciliation_provider_external` ON `payment_reconciliations` (`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `provider_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`provider_id` text NOT NULL,
	`category` text NOT NULL,
	`operation` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`provider_cost_micros` integer DEFAULT 0 NOT NULL,
	`billed_credits` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer,
	`status` text NOT NULL,
	`reference_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_provider_usage_created` ON `provider_usage_events` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`blocked_until` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `retargeting_audiences` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`destination` text NOT NULL,
	`rules_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`eligible_count` integer DEFAULT 0 NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_retargeting_org` ON `retargeting_audiences` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `security_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`token_hash` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_security_challenges_token` ON `security_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_security_challenges_user` ON `security_challenges` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `suppression_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`phone_hash` text NOT NULL,
	`scope` text DEFAULT 'organization' NOT NULL,
	`reason` text NOT NULL,
	`source` text DEFAULT 'customer_request' NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_suppression_scope_phone` ON `suppression_entries` (`organization_id`,`scope`,`phone_hash`);--> statement-breakpoint
CREATE TABLE `user_security_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_verified_at` text,
	`mfa_enabled` integer DEFAULT 0 NOT NULL,
	`totp_secret_encrypted` text,
	`recovery_code_hashes_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`step_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_json` text DEFAULT '{}' NOT NULL,
	`error` text,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_steps_run_index` ON `workflow_run_steps` (`run_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_json` text DEFAULT '{}' NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_org` ON `workflow_runs` (`organization_id`,`created_at`);