CREATE TABLE "ai_free_network_days" (
	"day" date NOT NULL,
	"network_hash" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_free_network_days_day_network_hash_pk" PRIMARY KEY("day","network_hash")
);
--> statement-breakpoint
ALTER TABLE "ai_instance_days" ADD COLUMN "free_count" integer DEFAULT 0 NOT NULL;