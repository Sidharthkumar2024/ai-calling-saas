CREATE TABLE `realtime_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`unit` text DEFAULT 'realtime_session_v1' NOT NULL,
	`credits` integer DEFAULT 10 NOT NULL,
	`status` text NOT NULL,
	`provider_reference` text,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `voice_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
