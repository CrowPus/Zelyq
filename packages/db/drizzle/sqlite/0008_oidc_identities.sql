CREATE TABLE `oidc_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES users(id) ON DELETE cascade,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oidc_identities_issuer_subject_idx` ON `oidc_identities` (`issuer`,`subject`);
--> statement-breakpoint
CREATE INDEX `oidc_identities_user_id_idx` ON `oidc_identities` (`user_id`);