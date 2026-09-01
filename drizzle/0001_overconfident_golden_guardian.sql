CREATE TABLE `api_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_credentials_key_hash` ON `api_credentials` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_credentials_org` ON `api_credentials` (`organization_id`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_users_email` ON `app_users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_app_users_org_role` ON `app_users` (`organization_id`,`role`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_org_created` ON `audit_events` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_sessions_token_hash` ON `auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`external_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`processed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_billing_events_external` ON `billing_events` (`external_event_id`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`description` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_credit_ledger_org_created` ON `credit_ledger` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `crm_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`type` text NOT NULL,
	`subject` text NOT NULL,
	`notes` text,
	`due_at` text,
	`completed_at` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_crm_activities_org_lead` ON `crm_activities` (`organization_id`,`lead_id`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'needs_configuration' NOT NULL,
	`public_config_json` text DEFAULT '{}' NOT NULL,
	`encrypted_secret` text,
	`last_checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_connections_org_type` ON `integration_connections` (`organization_id`,`type`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`line_items_json` text DEFAULT '[]' NOT NULL,
	`subtotal` integer NOT NULL,
	`tax` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`external_invoice_id` text,
	`hosted_url` text,
	`issued_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`due_at` text,
	`paid_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invoices_number` ON `invoices` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `idx_invoices_org_issued` ON `invoices` (`organization_id`,`issued_at`);--> statement-breakpoint
CREATE TABLE `number_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_number_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`method` text DEFAULT 'otp' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`phone_number_id`) REFERENCES `phone_numbers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_number_verifications_phone` ON `number_verifications` (`phone_number_id`);--> statement-breakpoint
CREATE TABLE `organization_wallets` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`low_balance_threshold` integer DEFAULT 500 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `phone_numbers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`phone_number` text NOT NULL,
	`country` text DEFAULT 'IN' NOT NULL,
	`number_type` text DEFAULT 'local' NOT NULL,
	`acquisition_type` text NOT NULL,
	`public_provider_name` text DEFAULT 'Vaani Connect' NOT NULL,
	`provider_reference` text,
	`assigned_agent_name` text,
	`direction` text DEFAULT 'inbound_outbound' NOT NULL,
	`kyc_status` text DEFAULT 'not_submitted' NOT NULL,
	`status` text DEFAULT 'pending_verification' NOT NULL,
	`monthly_rental` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_phone_numbers_number` ON `phone_numbers` (`phone_number`);--> statement-breakpoint
CREATE INDEX `idx_phone_numbers_org_status` ON `phone_numbers` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`monthly_price` integer NOT NULL,
	`included_credits` integer NOT NULL,
	`max_agents` integer NOT NULL,
	`max_numbers` integer NOT NULL,
	`concurrency` integer NOT NULL,
	`features_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plans_code` ON `plans` (`code`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`external_customer_id` text,
	`external_subscription_id` text,
	`current_period_end` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_subscriptions_org` ON `subscriptions` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_external` ON `subscriptions` (`external_subscription_id`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status_code` integer,
	`attempt` integer DEFAULT 1 NOT NULL,
	`response_snippet` text,
	`delivered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_endpoint` ON `webhook_deliveries` (`endpoint_id`);--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret_hash` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`events_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_delivery_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_endpoints_org` ON `webhook_endpoints` (`organization_id`);