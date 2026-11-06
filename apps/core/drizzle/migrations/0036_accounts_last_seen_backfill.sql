-- Backfill accounts.last_seen_at from the newest session token, once.
-- Until core 0.39.0 a signup and a token refresh did not stamp last_seen_at,
-- so a person who signed up and stayed signed in read as "Never" in the admin
-- list. Every token row is a session the person started or an app that
-- refreshed, so its created_at is a lower bound on when they were last seen.
-- greatest() keeps a newer existing stamp, so no value moves backward.
UPDATE "accounts"
SET "last_seen_at" = greatest(coalesce("accounts"."last_seen_at", 'epoch'::timestamp), "t"."last_token_at")
FROM (
  SELECT "account_id", max("created_at") AS "last_token_at"
  FROM "account_tokens"
  GROUP BY "account_id"
) AS "t"
WHERE "t"."account_id" = "accounts"."id";
