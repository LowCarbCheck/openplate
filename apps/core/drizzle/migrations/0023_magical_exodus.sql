ALTER TABLE "accounts" ADD COLUMN "trial_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "signup_invites" ADD COLUMN "trial_days" integer;