/**
 * Unit tests for the Overview page's two glance tiles.
 *
 * `computeWeightGlance` (`#app/models/dashboard`) is the model behind the
 * weight tile. The second suite covers the week tile's WIRING after M216/01:
 * the tile draws the Budget Ridge, the diary's dot strip is gone from this
 * page, and the handoff to `/trends` moved into the tile header. The ridge
 * itself is covered by `day-ridge.test.ts`; what is checked here is that the
 * dashboard actually renders it.
 *
 * The tile makes two claims at once ("this is your weight" and "this is how it
 * moved over the last 7 days") off one set of rows, and the interesting cases
 * are all about keeping those two claims independent: a stale weigh-in still
 * shows a weight, a single weigh-in shows no delta, and a duplicate day never
 * fabricates one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { computeWeightGlance, type WeightGlanceEntry } from '../../app/models/dashboard';

/**
 * The route module's source. The week tile is module-private and its loader
 * reads IndexedDB, so a render harness would buy a mock of the whole store to
 * assert something the source states plainly. Same judgment call as
 * `dashboard-route.test.ts`, which asserts the route's data without rendering.
 */
const dashboardSource = readFileSync(fileURLToPath(new URL('../../app/routes/dashboard.tsx', import.meta.url)), 'utf8');

/** The body of `WeekGlanceCard`, from its declaration to the start of the next one. */
function weekGlanceCardSource(): string {
  const start = dashboardSource.indexOf('function WeekGlanceCard(');
  assert.notEqual(start, -1, 'WeekGlanceCard must still exist in the route module');
  const end = dashboardSource.indexOf('\nfunction ', start + 1);
  assert.notEqual(end, -1, 'WeekGlanceCard must be followed by another declaration');
  return dashboardSource.slice(start, end);
}

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

describe('the week glance tile draws the budget ridge', () => {
  it('renders DayRidge and no longer the diary dot strip', () => {
    const card = weekGlanceCardSource();

    assert.ok(card.includes('<DayRidge'), 'the tile renders the ridge');
    assert.ok(!card.includes('<HabitStrip'), 'the dense dot strip is gone from this page');
    // Control: the strip is not merely renamed away. It is not imported here at
    // all any more, while `/diary` still ships it.
    assert.ok(!dashboardSource.includes("from '#app/components/habit-strip'"));
    assert.ok(dashboardSource.includes("from '#app/components/day-ridge'"));
  });

  it('keeps the handoff to /trends as a real link in the header, with its full label spoken', () => {
    const card = weekGlanceCardSource();
    const header = card.slice(card.indexOf('<CardHeader'), card.indexOf('<CardContent'));

    assert.match(header, /to="\/trends"/, 'the handoff link sits in the tile header now');
    assert.match(
      header,
      /aria-label=\{t\('dashboard\.week\.link'\)\}/,
      'the label that stopped being visible is still the accessible name',
    );
    // Control: the tile has exactly ONE link to /trends, so the header arrow
    // replaced the old row rather than being added beside it.
    assert.equal(card.match(/to="\/trends"/g)?.length, 1);
  });

  it('still names the tile and keeps its empty copy', () => {
    const card = weekGlanceCardSource();

    assert.ok(card.includes("t('dashboard.week.title')"));
    // The empty line has no room left on screen, so it became the tile's
    // screen-reader sentence rather than being deleted.
    assert.ok(card.includes("emptyLabel={t('dashboard.week.empty')}"));
  });
});
