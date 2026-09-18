/**
 * Whether LowCarbCheck is currently REFUSING this instance, and why (M238 spec 02).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * Both LowCarbCheck callers in this app fail open, and that policy does not
 * change here: a dead or refused food database must never break a scan. What
 * was wrong is that fail-open was also fail-SILENT. Every non-OK status went
 * to `logger.debug` and returned an empty result, so the day the upstream
 * started refusing unkeyed traffic this app would have quietly stopped
 * resolving foods and fallen back to the model's own macro estimate, with the
 * numbers still on screen and nothing saying they had changed meaning. For a
 * carb tracker that is the worst failure there is.
 *
 * ── WHAT IS DIFFERENT ABOUT A 401 AND A 429 ──────────────────────────────
 *
 * They are the two statuses that mean SOMEBODY MUST ACT. A timeout or a 500 is
 * weather: it clears on its own and an operator can do nothing about it, so it
 * keeps logging at debug exactly as before. A 401 means the key is wrong or
 * revoked and will stay wrong until a person fixes it. A 429 means this
 * instance has outgrown its tier. Both are worth a warning in the log and a
 * line on the screen.
 *
 * ── THE PATTERN IS BORROWED, NOT INVENTED ────────────────────────────────
 *
 * `openplate-inference/src/food-source/embedding.ts` already does this for the
 * embedding runtime: it remembers the last failure reason, publishes it
 * through `status()`, and `/readyz` reports it as DEGRADED rather than
 * unhealthy. {@link foodDbStatus} is that same surface. Like it, it never
 * throws and never performs I/O.
 *
 * ── IT MUST NOT LATCH ────────────────────────────────────────────────────
 *
 * A status that stays refused forever is a worse bug than the silence it
 * replaced, because it puts a permanent "unavailable" line under numbers that
 * are fine. {@link noteFoodDbAccepted} clears it, and both services call it on
 * every OK response.
 *
 * ── AND IT NEVER CARRIES THE KEY ─────────────────────────────────────────
 *
 * `FoodDbStatus` (defined in `./wire`, so the browser reads one definition and
 * not this module's state) is published through `/api/food-matches`. It
 * carries a status flag and one word from a closed list, and no part of it is
 * derived from the key.
 */
import { z } from 'zod';

import { FOOD_DB_REFUSAL_REASONS } from './wire';
import type { FoodDbRefusalReason, FoodDbStatus } from './wire';

/**
 * The refusal envelope M202 froze:
 * `{"error":{"code":"invalid_key","message":"...","docs":"..."}}`.
 *
 * Read DEFENSIVELY and read for message quality only. A missing, malformed or
 * unexpected body must never change what this app does, so every field but
 * `error.code` is ignored and a parse failure falls through to the status code.
 */
const refusalBodySchema = z.object({ error: z.object({ code: z.string() }) });

/**
 * Any value `JSON.parse` can yield off a refusal, before the schema above
 * looks at it. A closed JSON value type rather than `unknown`, exactly as
 * `#app/services/nutrient-reference` names its own unvalidated body: the thing
 * is always JSON, it is just not trusted yet.
 */
type UnvalidatedRefusalJson = z.infer<ReturnType<typeof z.json>>;

/**
 * The last refusal seen, module-scoped and per process.
 *
 * Per PROCESS rather than per request, because that is what it describes: the
 * relationship between this INSTANCE and LowCarbCheck. There is one key and
 * one answer, and every visitor to this instance is looking at the same one.
 */
let lastRefusal: FoodDbRefusalReason | null = null;

/**
 * What the app currently knows. Never throws, never performs I/O.
 *
 * @returns a fresh object each call, so no caller can mutate the module's state through it.
 */
export function foodDbStatus(): FoodDbStatus {
  return { ok: lastRefusal === null, reason: lastRefusal };
}

/**
 * Clears the status.
 *
 * Called by both services on every OK response, which is the ONLY thing that
 * clears it: nothing expires, nothing retries, and a refusal that has been
 * fixed announces itself by the next call working. It is also what a test
 * calls between cases, for exactly the same reason.
 */
export function noteFoodDbAccepted(): void {
  lastRefusal = null;
}

/**
 * The reason a refusal body claims, when it parses and names one this app knows.
 *
 * @param body - whatever `response.json()` yielded, trusted for nothing.
 * @returns the recognised reason, or `null` for a missing, malformed, or unfamiliar body.
 */
function reasonFromBody(body: UnvalidatedRefusalJson | null): FoodDbRefusalReason | null {
  const parsed = refusalBodySchema.safeParse(body);
  if (!parsed.success) return null;
  return FOOD_DB_REFUSAL_REASONS.find((reason) => reason === parsed.data.error.code) ?? null;
}

/**
 * The reason a status code implies on its own.
 *
 * This is the part that drives behaviour. The body can only refine it (a 429
 * that says `allowance_exhausted` is a different sentence from a 429 that says
 * `rate_limited`), never contradict it.
 *
 * @param status - the HTTP status of a non-OK response.
 * @returns the refusal this app acts on, or `null` for every other failure, which keeps failing open at debug.
 */
function reasonFromStatus(status: number): FoodDbRefusalReason | null {
  if (status === 401) return 'invalid_key';
  if (status === 429) return 'rate_limited';
  return null;
}

/**
 * Classifies a non-OK LowCarbCheck response and records it when it is a refusal.
 *
 * The RESPONSE BODY IS READ HERE, which is why this is async, and it is read
 * inside a catch that swallows everything: a refusal with no body, a truncated
 * one, or HTML from a proxy in the middle all still produce the status code's
 * own reason. Nothing about the outcome depends on the body parsing.
 *
 * Never throws. The caller's next line is its ordinary fail-open return.
 *
 * @param response - the non-OK response, whose body this function consumes.
 * @returns the refusal that was recorded, or `null` when this was an ordinary failure and nothing was recorded.
 */
export async function noteFoodDbRefusal(response: Response): Promise<FoodDbRefusalReason | null> {
  const fromStatus = reasonFromStatus(response.status);
  if (fromStatus === null) return null;

  let body: UnvalidatedRefusalJson | null = null;
  try {
    body = await response.json();
  } catch {
    // A refusal this app could not read is still a refusal. Only the wording
    // is poorer.
    body = null;
  }

  lastRefusal = reasonFromBody(body) ?? fromStatus;
  return lastRefusal;
}
