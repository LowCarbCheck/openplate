CREATE TABLE "ai_trial_network_days" (
	"day" date NOT NULL,
	"network_hash" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_trial_network_days_day_network_hash_pk" PRIMARY KEY("day","network_hash")
);
