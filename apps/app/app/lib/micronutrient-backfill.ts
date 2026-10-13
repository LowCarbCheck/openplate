/**
 * The micronutrient backfill's PURE core (2026-10-13): which entries qualify,
 * which slugs to ask about, what an answer does to the ledger, and how a
 * settled answer reaches the numbers. No store, no fetch, no clock.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────
 *
 * An entry snapshots its food's vitamins when it is logged
 * (`LocalFoodLog.micronutrientsPer100g`). Until 2026-10-13 the 6,896 BLS foods
 * in LowCarbCheck had none, so every entry logged from one before then carries
 * no block, and its day reads "not enough data" for ever. The entry still
 * names its food: `curatedSource` is `lowcarbcheck:<slug>`.
 *
 * ── SCOPE, AND NOTHING WIDER ─────────────────────────────────────────────
 *
 * An entry qualifies only when it has a `lowcarbcheck:<slug>` source AND no
 * `micronutrientsPer100g` key at all. Nothing else about it is read or
 * changed. An AI estimate, a hand-typed food and a personal food carry no LCC
 * slug and are never matched by name: a name match is a guess, and a guess
 * would be reported as a measured intake. Personal foods (`LocalPersonalFood`)
 * carry no LCC link of any kind, so none of them qualifies.
 *
 * ── THE BLOCK IS LENT AT READ TIME, NEVER WRITTEN ONTO THE ENTRY ─────────
 *
 * See `MICRONUTRIENT_BACKFILL_TABLE` in `local-store/schema.ts` for the merge
 * rule that decides this. {@link withBackfilledMicronutrients} is the one
 * place the ledger meets the log, and it runs where a micronutrient screen
 * reads its logs. An entry that later gains its own block (a re-log, an edit
 * that carries one) is no longer lent anything: its own figures win.
 *
 * Still a SNAPSHOT, as the field's doc demands: a slug is asked once, its
 * answer is kept in the ledger, and nothing ever re-reads LowCarbCheck to
 * rewrite a day that already has figures.
 *
 * ── THE STOP RULE ────────────────────────────────────────────────────────
 *
 * `filled`, `no-data` and `not-found` are final. A failure (`unknown`) counts
 * one attempt, and a slug that has failed {@link MAX_BACKFILL_ATTEMPTS} times
 * is never asked again. So a device spends at most one lookup per distinct
 * slug that settles, and at most three per slug that never does.
 */
import { z } from 'zod';
import type { LocalFoodLog } from '#app/lib/local-store/schema';
import { micronutrientsPer100gSchema, type MicronutrientsPer100g } from '#app/lib/micronutrients';
import { MAX_SLUGS_PER_REQUEST, type SlugMicronutrientsOutcome } from '#app/services/food-db/micronutrients-wire';

/** A slug that has failed this many times is not asked again. */
export const MAX_BACKFILL_ATTEMPTS = 3;

/** Slugs per request: the route's own cap. */
export const BACKFILL_BATCH_SIZE = MAX_SLUGS_PER_REQUEST;

/** The provenance prefix `toCuratedSource` (`food-resolution/apply-match.ts`) writes. */
const CURATED_SOURCE_PREFIX = 'lowcarbcheck:';

/**
 * What this device knows about one slug.
 *
 * `retry` is the only unsettled state, and only while `attempts` is under
 * {@link MAX_BACKFILL_ATTEMPTS}. The timestamps are diagnostics; nothing
 * branches on them.
 */
export type BackfillLedgerEntry =
  | { status: 'filled'; micronutrientsPer100g: MicronutrientsPer100g; settledAt: number }
  | { status: 'no-data'; settledAt: number }
  | { status: 'not-found'; settledAt: number }
  | { status: 'retry'; attempts: number; lastAttemptAt: number };

/** The ledger, by slug. */
export type BackfillLedger = ReadonlyMap<string, BackfillLedgerEntry>;

/** One ledger row as stored, validated on the way in. */
export const backfillLedgerEntrySchema: z.ZodType<BackfillLedgerEntry> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('filled'), micronutrientsPer100g: micronutrientsPer100gSchema, settledAt: z.number() }),
  z.object({ status: z.literal('no-data'), settledAt: z.number() }),
  z.object({ status: z.literal('not-found'), settledAt: z.number() }),
  z.object({ status: z.literal('retry'), attempts: z.number().int().min(1), lastAttemptAt: z.number() }),
]);

/**
 * The LowCarbCheck slug an entry's provenance names.
 *
 * @param curatedSource - `LocalFoodLog.curatedSource`.
 * @returns the slug, or `null` for no source, another source, or an empty slug.
 */
export function lowCarbCheckSlugOf(curatedSource: string | null): string | null {
  if (curatedSource === null || !curatedSource.startsWith(CURATED_SOURCE_PREFIX)) return null;
  const slug = curatedSource.slice(CURATED_SOURCE_PREFIX.length).trim();
  return slug === '' ? null : slug;
}

/**
 * The slug an entry would be backfilled from, or `null` when it does not qualify.
 *
 * @param log - one entry.
 * @returns the slug for an entry with an LCC source and no block of its own.
 */
export function backfillSlugOf(log: LocalFoodLog): string | null {
  if (log.micronutrientsPer100g !== undefined) return null;
  return lowCarbCheckSlugOf(log.curatedSource);
}

/**
 * Whether a slug's answer is final.
 *
 * @param entry - the slug's ledger row, or `undefined` when it was never asked.
 * @returns true for every answer the device must not ask about again.
 */
export function isSettledLedgerEntry(entry: BackfillLedgerEntry | undefined): boolean {
  if (entry === undefined) return false;
  return entry.status !== 'retry' || entry.attempts >= MAX_BACKFILL_ATTEMPTS;
}

/**
 * The distinct slugs worth a lookup: those qualifying entries name whose
 * answer is not settled. Sorted, so a run asks in a stable order.
 *
 * @param options.logs - every entry on the device.
 * @param options.ledger - what the device already knows.
 * @returns the slugs to ask about, each once.
 */
export function selectSlugsToAsk({
  logs,
  ledger,
}: {
  logs: readonly LocalFoodLog[];
  ledger: BackfillLedger;
}): string[] {
  const slugs = new Set<string>();
  for (const log of logs) {
    const slug = backfillSlugOf(log);
    if (slug !== null && !isSettledLedgerEntry(ledger.get(slug))) slugs.add(slug);
  }
  return [...slugs].toSorted();
}

/**
 * The ledger row an answer leaves behind.
 *
 * A settled row is never moved: the job only asks about unsettled slugs, and a
 * row another tab settled in the meantime must not be downgraded by a late
 * failure.
 *
 * @param options.previous - the row before this answer, if any.
 * @param options.outcome - what the route said about the slug.
 * @param options.now - epoch-ms, for the diagnostics fields.
 * @returns the next row.
 */
export function nextLedgerEntry({
  previous,
  outcome,
  now,
}: {
  previous: BackfillLedgerEntry | undefined;
  outcome: SlugMicronutrientsOutcome;
  now: number;
}): BackfillLedgerEntry {
  if (previous !== undefined && isSettledLedgerEntry(previous)) return previous;
  if (outcome.kind === 'filled') {
    return { status: 'filled', micronutrientsPer100g: outcome.micronutrientsPer100g, settledAt: now };
  }
  if (outcome.kind === 'no-data') return { status: 'no-data', settledAt: now };
  if (outcome.kind === 'not-found') return { status: 'not-found', settledAt: now };
  const attempts = previous?.status === 'retry' ? previous.attempts + 1 : 1;
  return { status: 'retry', attempts, lastAttemptAt: now };
}

/**
 * The entries as the micronutrient screens should read them: every
 * qualifying entry whose slug the ledger holds as `filled` carries that block,
 * and every other entry is passed through untouched.
 *
 * The one place the ledger meets the log. Pure, and it copies: the input
 * entries are never mutated, so a caller holding the store's rows cannot
 * write a lent block back by accident.
 *
 * @param options.logs - entries, any order.
 * @param options.ledger - the device's ledger.
 * @returns the same entries, in the same order.
 */
export function withBackfilledMicronutrients({
  logs,
  ledger,
}: {
  logs: readonly LocalFoodLog[];
  ledger: BackfillLedger;
}): LocalFoodLog[] {
  return logs.map((log) => {
    const slug = backfillSlugOf(log);
    if (slug === null) return log;
    const entry = ledger.get(slug);
    if (entry?.status !== 'filled') return log;
    return { ...log, micronutrientsPer100g: entry.micronutrientsPer100g };
  });
}

/**
 * Whether any of these entries is still waiting on an answer that could
 * change its figures. The vitamins block reads it to hold the ready layout's
 * box open while the job may still fill the day (DESIGN.md section 7).
 *
 * @param options.logs - the entries of the window on screen.
 * @param options.ledger - the device's ledger.
 * @returns true when a qualifying entry's slug is not settled.
 */
export function hasPendingBackfill({
  logs,
  ledger,
}: {
  logs: readonly LocalFoodLog[];
  ledger: BackfillLedger;
}): boolean {
  return logs.some((log) => {
    const slug = backfillSlugOf(log);
    return slug !== null && !isSettledLedgerEntry(ledger.get(slug));
  });
}
