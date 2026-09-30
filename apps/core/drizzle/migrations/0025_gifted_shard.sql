ALTER TABLE "push_subscriptions" ADD COLUMN "failed_sends" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "retry_at" timestamp with time zone;