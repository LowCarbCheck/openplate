ALTER TABLE "accounts" ADD COLUMN "health_consent_version" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "health_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_health_consent_pair" CHECK (("accounts"."health_consent_version" IS NULL) = ("accounts"."health_consent_at" IS NULL));