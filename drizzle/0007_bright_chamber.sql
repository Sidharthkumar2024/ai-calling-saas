ALTER TABLE `phone_numbers` ADD `provider_code` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `phone_numbers` ADD `connection_mode` text DEFAULT 'managed_number' NOT NULL;--> statement-breakpoint
ALTER TABLE `phone_numbers` ADD `provider_account_hint` text;--> statement-breakpoint
ALTER TABLE `phone_numbers` ADD `business_use_case` text;--> statement-breakpoint
ALTER TABLE `phone_numbers` ADD `estimated_monthly_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `phone_numbers` ADD `onboarding_status` text DEFAULT 'draft' NOT NULL;