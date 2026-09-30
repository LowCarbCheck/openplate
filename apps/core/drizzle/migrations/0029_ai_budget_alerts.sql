CREATE TABLE "ai_budget_alerts" (
	"period" text PRIMARY KEY NOT NULL,
	"alerted_at" timestamp with time zone DEFAULT now() NOT NULL
);
