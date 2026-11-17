CREATE TABLE `admin_idempotency` (
	`key_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status_code` integer NOT NULL,
	`response` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`key_id`) REFERENCES `admin_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_idempotency_key_idx` ON `admin_idempotency` (`key_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `admin_idempotency_created_idx` ON `admin_idempotency` (`created_at`);--> statement-breakpoint
CREATE TABLE `admin_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scopes` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`last_used_ip` text,
	`revoked_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_keys_key_hash_idx` ON `admin_keys` (`key_hash`);