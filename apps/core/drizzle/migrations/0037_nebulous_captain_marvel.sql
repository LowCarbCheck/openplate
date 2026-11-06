ALTER TABLE "accounts" ADD COLUMN "activity_mail_opt_in_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "activity_mail_opt_out_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "mail_language" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "first_scan_mail_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "quiet_mail_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "activity_mail_first_scan_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "activity_mail_first_scan_days" smallint DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "activity_mail_quiet_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "activity_mail_quiet_days" smallint DEFAULT 14 NOT NULL;--> statement-breakpoint
CREATE INDEX "accounts_activity_mail_opt_in_idx" ON "accounts" USING btree ("activity_mail_opt_in_at") WHERE "accounts"."activity_mail_opt_in_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_activity_mail_first_scan_days" CHECK ("instance_settings"."activity_mail_first_scan_days" BETWEEN 3 AND 30);--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_activity_mail_quiet_days" CHECK ("instance_settings"."activity_mail_quiet_days" BETWEEN 7 AND 60);