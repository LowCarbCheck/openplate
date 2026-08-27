/**
 * THE REDUCTION (`PROTOCOL.md` §3.5, `openplate-sync` ADR-0003).
 *
 * Turns a device snapshot into `daily-intake:v1` — the ONLY thing a research
 * contribution is ever allowed to carry. It is a pure function of a snapshot
 * and a window: no store, no network, no clock, and no configuration.
 *
 * ── The three rules that make it a reduction rather than a filter ────────
 *
 *  1. **Bucketed by `dayKey` alone.** `loggedAt` and `createdAt` are epoch-ms
 *     and are read by NOTHING here. The diary already decided which calendar
 *     day an entry belongs to, on the device, in the person's own time zone,
 *     and that is the answer they saw on screen. Re-deriving a day from an
 *     instant would put this client's zone into the data AND would let a
 *     timestamp influence output that must be day-granular.
 *  2. **Every calendar day in the window emits a row**, including days with no
 *     entries. This is why `loggedEntryCount` exists: without a row per day,
 *     "ate nothing" and "did not log" are the same absence, and a researcher
 *     cannot tell a fasting day from a missing one.
 *  3. **Macros are used AS STORED.** `LocalFoodLog.macros` is already
 *     per-serving — scaled from per-100g when the entry was written. Scaling
 *     it again by `quantityGrams` would multiply every figure by the serving
 *     size a second time, which is a plausible-looking, silently wrong
 *     dataset.
 *
 * ── Rounding is a privacy measure, not cosmetics ─────────────────────────
 *
 * Each sum is rounded to ONE DECIMAL PLACE. Unrounded float noise from
 * repeated additions is itself a fingerprint: the low-order digits of a
 * kilocalorie total encode the exact multiset of entries that produced it, at
 * a precision nobody needs and no consent screen describes.
 *
 * ── An unknown macro contributes nothing, and the count says so ──────────
 *
 * `Macros` fields are nullable, and null means UNKNOWN, never zero. A day's
 * total is therefore the sum of what is known — there is no honest alternative
 * inside a fixed numeric schema — and `loggedEntryCount` is what tells the
 * researcher how much was behind that total.
 */
import type { LocalFoodLog, LocalStoreSnapshot } from '#app/lib/local-store';
import { enumerateDates } from '#app/lib/user-days';
import type { DailyIntakeV1Row } from './tiers';

/** Rounding to one decimal place — see this module's header for why it is a privacy measure. */
const MACRO_DECIMALS = 1;

/** One day's running sums, before rounding. Not a `DailyIntakeV1Row`: this shape is internal and must never be what gets emitted. */
interface DayAccumulator {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  loggedEntryCount: number;
}

/**
 * Reduces a snapshot to one row per calendar day in `[fromDayKey, toDayKey]`.
 *
 * @param snapshot - the device's own snapshot. Only `foodLogs` is read; every other key is ignored, including the owner-private ones.
 * @param fromDayKey - inclusive window start, `YYYY-MM-DD`.
 * @param toDayKey - inclusive window end, `YYYY-MM-DD`. A window that ends before it starts yields no rows.
 * @returns rows in ascending date order, one per day, with no gaps.
 * @throws when either bound is not a valid `YYYY-MM-DD` (`enumerateDates`).
 */
export function reduceDailyIntakeV1({
  snapshot,
  fromDayKey,
  toDayKey,
}: {
  snapshot: LocalStoreSnapshot;
  fromDayKey: string;
  toDayKey: string;
}): DailyIntakeV1Row[] {
  const byDay = accumulateByDay({ logs: snapshot.foodLogs, fromDayKey, toDayKey });
  // The DAYS drive the output, not the entries. A day with nothing logged is
  // a row of zeros with `loggedEntryCount: 0`, which is a fact, not a gap.
  return enumerateDates(fromDayKey, toDayKey).map((date) => {
    const totals = byDay.get(date) ?? emptyDay();
    return {
      date,
      energyKcal: round(totals.energyKcal),
      proteinG: round(totals.proteinG),
      carbsG: round(totals.carbsG),
      fatG: round(totals.fatG),
      fiberG: round(totals.fiberG),
      loggedEntryCount: totals.loggedEntryCount,
    };
  });
}

/**
 * Sums the entries that fall inside the window, keyed by their own `dayKey`.
 *
 * The window comparison is a plain string comparison, which is exact for
 * zero-padded `YYYY-MM-DD` and involves no `Date`, no zone and no instant —
 * the same reason the app compares day keys everywhere else.
 */
function accumulateByDay({
  logs,
  fromDayKey,
  toDayKey,
}: {
  logs: readonly LocalFoodLog[];
  fromDayKey: string;
  toDayKey: string;
}): Map<string, DayAccumulator> {
  const byDay = new Map<string, DayAccumulator>();
  for (const log of logs) {
    if (log.dayKey < fromDayKey || log.dayKey > toDayKey) continue;
    const totals = byDay.get(log.dayKey) ?? emptyDay();
    // `log.macros` is used as stored — already per-serving. See rule 3 in this
    // module's header before adding a `quantityGrams` factor here.
    totals.energyKcal += log.macros.kcal ?? 0;
    totals.proteinG += log.macros.protein ?? 0;
    totals.carbsG += log.macros.carbs ?? 0;
    totals.fatG += log.macros.fat ?? 0;
    totals.fiberG += log.macros.fiber ?? 0;
    totals.loggedEntryCount += 1;
    byDay.set(log.dayKey, totals);
  }
  return byDay;
}

function emptyDay(): DayAccumulator {
  return { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, loggedEntryCount: 0 };
}

function round(value: number): number {
  const factor = 10 ** MACRO_DECIMALS;
  return Math.round(value * factor) / factor;
}
