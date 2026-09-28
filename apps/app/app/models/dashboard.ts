/**
 * Pure derivation for the Overview page's glance tiles. No store import, no DB,
 * no `Date.now()` — the caller supplies `today`, exactly as `habit-strip.ts`
 * and `adherence-grid.ts` do, so every case below is directly unit-testable.
 *
 * The dashboard owns no data of its own (see `routes/dashboard.tsx`): every
 * figure on it comes from an existing aggregate. This module exists for the one
 * shape none of them produced yet — "your latest weigh-in, and how it compares
 * with the start of the window".
 */
import { shiftDate } from '#app/lib/user-days';

/** The three facts this glance needs from one stored weigh-in. */
export interface WeightGlanceEntry {
  /** Device-local calendar day (`YYYY-MM-DD`) the measurement belongs to. */
  dayKey: string;
  weightKg: number;
  /** Epoch millis the entry was written — breaks a same-day tie. */
  loggedAt: number;
}

export interface WeightGlance {
  /** The most recent weigh-in's weight, or null when there has never been one. */
  latestKg: number | null;
  /** That weigh-in's day (`YYYY-MM-DD`), or null. */
  latestDate: string | null;
  /**
   * Latest − the earliest entry inside the window; null when the window holds
   * fewer than two days. Never a fabricated `0.0` off a single weigh-in — that
   * would read as "no change" rather than "not enough data", the same
   * distinction `computeWeeklyWeightChange` draws.
   */
  deltaKg: number | null;
}

/**
 * One entry per day, oldest first. The store upserts per day, but a restored
 * backup can carry duplicates, so the later `loggedAt` wins rather than
 * whichever copy the store happened to hand back first.
 */
function _oneEntryPerDay(entries: readonly WeightGlanceEntry[]): WeightGlanceEntry[] {
  const byDay = new Map<string, WeightGlanceEntry>();
  for (const entry of entries) {
    const held = byDay.get(entry.dayKey);
    if (held === undefined || entry.loggedAt > held.loggedAt) byDay.set(entry.dayKey, entry);
  }
  return [...byDay.values()].toSorted((left, right) => left.dayKey.localeCompare(right.dayKey));
}

/**
 * The weight tile's whole model.
 *
 * `latestKg` is deliberately NOT windowed: someone whose last weigh-in was
 * three weeks ago still wants to see their weight, and blanking the tile
 * because the window is empty would read as "we lost it". The DELTA is
 * windowed, because "over the last 7 days" is a claim you can only make about
 * days inside those seven.
 *
 * @param entries - every stored weigh-in, in any order.
 * @param today - the caller's current local date (`YYYY-MM-DD`).
 * @param windowDays - the delta window, inclusive of `today` (7 ⇒ `today - 6` … `today`).
 * @returns the latest figure, its date, and the windowed delta.
 */
export function computeWeightGlance({
  entries,
  today,
  windowDays,
}: {
  entries: readonly WeightGlanceEntry[];
  today: string;
  windowDays: number;
}): WeightGlance {
  const days = _oneEntryPerDay(entries);
  const latest = days[days.length - 1];
  if (latest === undefined) return { latestKg: null, latestDate: null, deltaKg: null };

  const fromDate = shiftDate(today, -(windowDays - 1));
  const inWindow = days.filter((day) => day.dayKey >= fromDate && day.dayKey <= today);
  const earliest = inWindow[0];
  const windowLatest = inWindow[inWindow.length - 1];

  return {
    latestKg: latest.weightKg,
    latestDate: latest.dayKey,
    deltaKg: inWindow.length >= 2 ? windowLatest.weightKg - earliest.weightKg : null,
  };
}
