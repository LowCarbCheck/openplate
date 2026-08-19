/**
 * Unit tests for `#app/models/dashboard`'s `computeWeightGlance` — the model
 * behind the Overview page's weight tile.
 *
 * The tile makes two claims at once ("this is your weight" and "this is how it
 * moved over the last 7 days") off one set of rows, and the interesting cases
 * are all about keeping those two claims independent: a stale weigh-in still
 * shows a weight, a single weigh-in shows no delta, and a duplicate day never
 * fabricates one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeWeightGlance, type WeightGlanceEntry } from '../../app/models/dashboard';

const TODAY = '2026-08-06';

/** A weigh-in, with `loggedAt` derived from the day so ordering is obvious. */
function entry(dayKey: string, weightKg: number, loggedAt = Date.parse(`${dayKey}T08:00:00Z`)): WeightGlanceEntry {
  return { dayKey, weightKg, loggedAt };
}

describe('computeWeightGlance', () => {
  it('reports nothing at all for a device that has never weighed in', () => {
    assert.deepEqual(computeWeightGlance({ entries: [], today: TODAY, windowDays: 7 }), {
      latestKg: null,
      latestDate: null,
      deltaKg: null,
    });
  });

  it('never renders a delta off a single weigh-in', () => {
    // A fabricated `0.0` would read as "no change" rather than "not enough data".
    assert.deepEqual(computeWeightGlance({ entries: [entry('2026-08-05', 81.2)], today: TODAY, windowDays: 7 }), {
      latestKg: 81.2,
      latestDate: '2026-08-05',
      deltaKg: null,
    });
  });

  it('keeps the sign of the change — a loss is negative', () => {
    const glance = computeWeightGlance({
      entries: [entry('2026-08-01', 82), entry('2026-08-06', 80.5)],
      today: TODAY,
      windowDays: 7,
    });
    assert.equal(glance.latestKg, 80.5);
    assert.equal(glance.latestDate, TODAY);
    assert.equal(glance.deltaKg, -1.5);
  });

  it('still shows a stale weigh-in, with no delta', () => {
    // Someone whose last weigh-in was three weeks ago wants to see their
    // weight; blanking the tile would read as "we lost it".
    const glance = computeWeightGlance({ entries: [entry('2026-07-17', 79.4)], today: TODAY, windowDays: 7 });
    assert.deepEqual(glance, { latestKg: 79.4, latestDate: '2026-07-17', deltaKg: null });
  });

  it('excludes out-of-window entries from the delta without hiding the latest figure', () => {
    const glance = computeWeightGlance({
      entries: [entry('2026-07-01', 90), entry('2026-08-02', 81), entry('2026-08-06', 80)],
      today: TODAY,
      windowDays: 7,
    });
    assert.equal(glance.latestKg, 80);
    // −1 (Aug 2 → Aug 6), NOT −10 against the July row.
    assert.equal(glance.deltaKg, -1);
  });

  it('does not rely on the store handing rows back in order', () => {
    const sorted = [entry('2026-08-02', 81), entry('2026-08-04', 80.6), entry('2026-08-06', 80)];
    const shuffled = [sorted[2], sorted[0], sorted[1]];

    assert.deepEqual(
      computeWeightGlance({ entries: shuffled, today: TODAY, windowDays: 7 }),
      computeWeightGlance({ entries: sorted, today: TODAY, windowDays: 7 }),
    );
  });

  it('lets the later write win when a restored backup carries two rows for one day', () => {
    // The store upserts per day, but an imported backup can carry duplicates.
    const glance = computeWeightGlance({
      entries: [entry('2026-08-06', 80, 1_000), entry('2026-08-06', 79.5, 2_000), entry('2026-08-02', 81)],
      today: TODAY,
      windowDays: 7,
    });
    assert.equal(glance.latestKg, 79.5);
    assert.equal(glance.deltaKg, -1.5);
  });

  it('includes the first day of the window and excludes the one before it', () => {
    // windowDays: 7 ending on 2026-08-06 ⇒ shiftDate(today, -6) = 2026-07-31.
    const included = computeWeightGlance({
      entries: [entry('2026-07-31', 82), entry('2026-08-06', 80)],
      today: TODAY,
      windowDays: 7,
    });
    assert.equal(included.deltaKg, -2);

    const excluded = computeWeightGlance({
      entries: [entry('2026-07-30', 82), entry('2026-08-06', 80)],
      today: TODAY,
      windowDays: 7,
    });
    assert.equal(excluded.deltaKg, null);
    assert.equal(excluded.latestKg, 80);
  });
});
