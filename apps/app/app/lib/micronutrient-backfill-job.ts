/**
 * The micronutrient backfill's imperative shell (2026-10-13): read the log and
 * the ledger, ask about the unsettled slugs in batches, write the answers.
 *
 * ── COST, AND WHAT STOPS IT ──────────────────────────────────────────────
 *
 * One run per tab load, started by `MicronutrientBackfillController` once the
 * app is idle and online. A run asks only about slugs the ledger has not
 * settled (`selectSlugsToAsk`), so:
 *
 * - a slug answered `filled`, `no-data` or `not-found` is never asked again,
 *   on any later run, and a rerun over a settled history sends no request;
 * - a slug answered `unknown` is asked again on a later run, at most
 *   `MAX_BACKFILL_ATTEMPTS` times in all, then never;
 * - a request the route does not answer at all (offline, throttled, no
 *   account, no food database) stops the run and counts nothing, and nothing
 *   was spent upstream for it.
 *
 * Per device, the route makes one LowCarbCheck call per distinct slug in the
 * common case. The worst case is a slug no locale knows and that keeps failing:
 * three answered attempts of up to five locale calls each.
 *
 * ── IT NEVER WRITES THE DIARY ────────────────────────────────────────────
 *
 * The entries are read, and only the ledger is written
 * (`recordMicronutrientBackfill`, compare-and-set, one transaction per batch).
 * See `MICRONUTRIENT_BACKFILL_TABLE` in `local-store/schema.ts` for why.
 */
import type { Store } from 'tinybase';
import { listLocalFoodLogs } from '#app/lib/local-store';
import {
  parseMicronutrientBackfillCells,
  readMicronutrientBackfillCells,
  recordMicronutrientBackfill,
  type LedgerWrite,
} from '#app/lib/local-store/micronutrient-backfill';
import { createComponentLogger } from '#app/lib/logger';
import { BACKFILL_BATCH_SIZE, nextLedgerEntry, selectSlugsToAsk } from '#app/lib/micronutrient-backfill';
import {
  fetchFoodMicronutrients,
  type BackfillRequestResult,
  type BackfillRequestStop,
} from '#app/lib/micronutrient-backfill-client';

const log = createComponentLogger('micronutrient-backfill');

/** What one run did, for the log line and the tests. */
export interface BackfillRunReport {
  /** Slugs sent in requests the route answered. */
  askedSlugs: number;
  /** Ledger rows written. Fewer than answered when another tab settled a slug first. */
  writtenSlugs: number;
  /** Why the run ended early, or `null` when every batch was answered. */
  stoppedBy: BackfillRequestStop | null;
}

/** Everything a run needs from the outside, injected so a test drives it without a browser. */
export interface BackfillRunDeps {
  /** Asks the route about one batch. */
  ask: (slugs: readonly string[]) => Promise<BackfillRequestResult>;
  /** Epoch-ms, for the ledger's diagnostics fields. */
  now: () => number;
  /** The primary store; the singleton when absent. */
  store?: Store;
}

/**
 * One run over the whole device.
 *
 * @param deps - see {@link BackfillRunDeps}.
 * @returns what the run asked and wrote, and why it stopped if it did.
 */
export async function runMicronutrientBackfill({ ask, now, store }: BackfillRunDeps): Promise<BackfillRunReport> {
  const logs = await listLocalFoodLogs({ store });
  const cells = await readMicronutrientBackfillCells({ store });
  const ledger = parseMicronutrientBackfillCells(cells);
  const slugs = selectSlugsToAsk({ logs, ledger });

  const report: BackfillRunReport = { askedSlugs: 0, writtenSlugs: 0, stoppedBy: null };
  for (let start = 0; start < slugs.length; start += BACKFILL_BATCH_SIZE) {
    const batch = slugs.slice(start, start + BACKFILL_BATCH_SIZE);
    const result = await ask(batch);
    if (result.kind === 'stopped') return { ...report, stoppedBy: result.reason };
    report.askedSlugs += batch.length;
    const writes: LedgerWrite[] = result.answers.map(({ slug, outcome }) => ({
      slug,
      expectedCell: cells.get(slug) ?? null,
      entry: nextLedgerEntry({ previous: ledger.get(slug), outcome, now: now() }),
    }));
    report.writtenSlugs += (await recordMicronutrientBackfill({ writes, store })).length;
  }
  return report;
}

// ---------------------------------------------------------------------------
// The tab's one run, and whether it has finished
// ---------------------------------------------------------------------------

/**
 * Whether this tab's run can still change a day's figures.
 *
 * `waiting` from the first paint until the run ends, whatever it ended with.
 * The vitamins block reads it to know whether a day with an unsettled slug may
 * still turn into a covered day while it is on screen, and so must hold the
 * covered layout's box open (DESIGN.md section 7).
 */
export type BackfillPhase = 'waiting' | 'finished';

let phase: BackfillPhase = 'waiting';
const phaseListeners = new Set<() => void>();
let tabRun: Promise<BackfillRunReport> | null = null;

/** Subscribes to {@link BackfillPhase} changes, for `useSyncExternalStore`. */
export function subscribeMicronutrientBackfillPhase(listener: () => void): () => void {
  phaseListeners.add(listener);
  return () => phaseListeners.delete(listener);
}

/** This tab's phase now. */
export function getMicronutrientBackfillPhase(): BackfillPhase {
  return phase;
}

/** The phase a server render assumes: nothing has run there. */
export function getServerMicronutrientBackfillPhase(): BackfillPhase {
  return 'waiting';
}

function finishPhase(): void {
  phase = 'finished';
  for (const listener of phaseListeners) listener();
}

/** The real run, logged, and the phase finished whatever happens. Never rejects. */
async function runForThisTab(): Promise<BackfillRunReport> {
  try {
    const report = await runMicronutrientBackfill({
      ask: (slugs) => fetchFoodMicronutrients({ slugs }),
      now: Date.now,
    });
    if (report.askedSlugs > 0 || report.stoppedBy !== null) log.info('micronutrient backfill run', { ...report });
    return report;
  } catch (error) {
    log.warn('micronutrient backfill run failed', { error: error instanceof Error ? error.message : String(error) });
    return { askedSlugs: 0, writtenSlugs: 0, stoppedBy: 'failed' };
  } finally {
    finishPhase();
  }
}

/**
 * This tab's run, started on the first call and shared by every later one.
 *
 * @returns the run's report; never rejects.
 */
export function runMicronutrientBackfillOnce(): Promise<BackfillRunReport> {
  tabRun ??= runForThisTab();
  return tabRun;
}
