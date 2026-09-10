/**
 * Unit tests for the Overview page's two glance tiles.
 *
 * `computeWeightGlance` (`#app/models/dashboard`) is the model behind the
 * weight tile. The second suite covers the week tile's WIRING after M216/01:
 * the tile draws the Budget Ridge, and the diary's dot strip is gone from this
 * page. The ridge itself is covered by `day-ridge.test.ts`; what is checked
 * here is that the dashboard actually renders it.
 *
 * The last two suites cover later changes: both tiles became a single door to
 * `/trends`, wrapping the whole `Card` rather than only the week tile's header
 * arrow or the weight tile's trailing text row, and the 13-week grid from
 * `/trends` joined the page as `StreakGridCard` between the hero and that
 * glance row (owner's call, 2026-09-10).
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

/** The grid card's own source, for the same private-component reason. */
const streakGridCardSource = readFileSync(
  fileURLToPath(new URL('../../app/components/dashboard/streak-grid-card.tsx', import.meta.url)),
  'utf8',
);

/** The body of the page component, where the module order is decided. */
function pageBodySource(): string {
  const start = dashboardSource.indexOf('export default function Dashboard');
  assert.notEqual(start, -1, 'the page component must still be the default export');
  return dashboardSource.slice(start);
}

/**
 * The position of a JSX opening tag in a body, asserted to exist. Returned as a
 * number so callers can order the modules by where they are WRITTEN, which on
 * this page is also the order they render in: the page body is one flat list of
 * siblings under a single `space-y-4` wrapper.
 */
function positionOf(body: string, tag: string, label: string): number {
  const at = body.indexOf(tag);
  assert.notEqual(at, -1, `${label} must be rendered by the page`);
  return at;
}

/** The body of `WeekGlanceCard`, from its declaration to the start of the next one. */
function weekGlanceCardSource(): string {
  const start = dashboardSource.indexOf('function WeekGlanceCard(');
  assert.notEqual(start, -1, 'WeekGlanceCard must still exist in the route module');
  const end = dashboardSource.indexOf('\nfunction ', start + 1);
  assert.notEqual(end, -1, 'WeekGlanceCard must be followed by another declaration');
  return dashboardSource.slice(start, end);
}

/** The body of `WeightGlanceCard`, from its declaration to the page component below it. */
function weightGlanceCardSource(): string {
  const start = dashboardSource.indexOf('function WeightGlanceCard(');
  assert.notEqual(start, -1, 'WeightGlanceCard must still exist in the route module');
  const end = dashboardSource.indexOf('\nexport default function Dashboard', start + 1);
  assert.notEqual(end, -1, 'WeightGlanceCard must be followed by the page component');
  return dashboardSource.slice(start, end);
}

/**
 * Asserts that a glance tile's whole card is one clickable door to `/trends`:
 * exactly one `<Link>` in the tile, sitting before the `<Card>` it wraps
 * (never inside it), and pointed at `/trends`. A nested link — the header
 * arrow or the trailing text keeping a `<Link>` of its own alongside a new
 * wrapping one — would show up here as a second `<Link>` opening tag.
 */
function assertWholeCardIsOneLinkToTrends(card: string, label: string): void {
  const linkOpenings = card.match(/<Link\b/g) ?? [];
  assert.equal(linkOpenings.length, 1, `${label} must render exactly one <Link>, never a link nested inside a link`);

  const linkAt = card.indexOf('<Link');
  const cardAt = card.indexOf('<Card');
  assert.ok(linkAt !== -1 && cardAt !== -1, `${label} must have both a <Link> and a <Card>`);
  assert.ok(linkAt < cardAt, `${label}'s <Link> must wrap its <Card>, not sit inside it`);

  const linkOpenTag = card.slice(linkAt, card.indexOf('>', linkAt) + 1);
  assert.match(linkOpenTag, /to="\/trends"/, `${label}'s wrapping link must go to /trends`);
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

  it('moved the handoff to /trends off the header arrow and onto the whole tile', () => {
    const card = weekGlanceCardSource();
    const header = card.slice(card.indexOf('<CardHeader'), card.indexOf('<CardContent'));

    // The arrow is decorative now: no `to`, no `aria-label` — the card's own
    // title and content give the wrapping link its accessible name.
    assert.doesNotMatch(header, /to="\/trends"/, 'the header no longer carries its own link to /trends');
    assert.doesNotMatch(header, /aria-label/, 'the arrow carries no aria-label; the tile title names the link');
    assert.match(header, /<span className="shrink-0 text-primary">/, 'the arrow sits in a plain span, not a link');

    // Control: the tile still has exactly ONE link to /trends in total — the
    // wrapping one — so the header link was replaced, not merely duplicated.
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

/**
 * The whole tile became the door to `/trends`: before this change, only the
 * week tile's header arrow and the weight tile's trailing text row were
 * clickable, and neither tap target covered the rest of the card. The two
 * checks below would both fail against the tiles as they stood before this
 * change — the week tile's `<Link>` sat inside `<CardHeader>`, after
 * `<Card>`, and the weight tile's `<Link>` sat inside `<CardContent>`, also
 * after `<Card>` — so `linkAt < cardAt` was false in both cases and
 * `assertWholeCardIsOneLinkToTrends` would report the link failing to wrap
 * the card, which is exactly the bug this change fixes.
 */
describe('the whole tile is the door to /trends', () => {
  it('wraps the week tile in exactly one link to /trends, with none nested inside it', () => {
    assertWholeCardIsOneLinkToTrends(weekGlanceCardSource(), 'WeekGlanceCard');
  });

  it('wraps the weight tile in exactly one link to /trends, with none nested inside it', () => {
    assertWholeCardIsOneLinkToTrends(weightGlanceCardSource(), 'WeightGlanceCard');
  });

  it('keeps the weight tile\'s trailing text as the visible call to action, but not its own link', () => {
    const card = weightGlanceCardSource();

    assert.doesNotMatch(
      card,
      /<Link[^>]*>\s*\{t\('dashboard\.weight\.link'\)\}/,
      'the trailing text must not sit inside its own <Link> any more',
    );
    assert.match(
      card,
      /<span className=\{HANDOFF_LINK_CLASS\}>\s*\{t\('dashboard\.weight\.link'\)\}/,
      'the trailing text keeps its call-to-action styling as a plain span',
    );
  });
});

/**
 * The 13-week grid on Overview. The page header used to argue against exactly
 * this module on the no-scroll budget; the owner overruled that on 2026-09-10,
 * so what is pinned here is the placement the decision named, and the one rule
 * that makes the placement safe: the card is a single link, so nothing
 * clickable is nested inside a clickable card.
 */
describe('the 13-week grid on Overview', () => {
  it('renders StreakGridCard after the hero and its banner, before the fast strip and the glance row', () => {
    const body = pageBodySource();

    const hero = positionOf(body, '<TodayHeroCard', 'the today hero');
    const banner = positionOf(body, '<ReproductiveStatusPromptBanner', 'the reproductive status banner');
    const grid = positionOf(body, '<StreakGridCard', 'the streak grid card');
    const fast = positionOf(body, '<FastStrip', 'the fast strip');
    const glanceRow = positionOf(body, '<div className="grid grid-cols-2', 'the two-up glance row');

    assert.ok(hero < grid, 'the hero still leads the page');
    assert.ok(banner < grid, 'the status banner stays with the hero, above the grid');
    assert.ok(grid < fast, 'the grid sits above the conditional fast strip');
    assert.ok(grid < glanceRow, 'the grid sits above the two glance tiles');
  });

  it('feeds the card the loader-built grid, not a second store read', () => {
    const body = pageBodySource();

    assert.match(
      body,
      /<StreakGridCard grid=\{grid\} goals=\{adherenceGoals\} streak=\{streak\} \/>/,
      'every figure the card draws arrives as a prop from the client loader',
    );
    // Control: the three props are really destructured off `loaderData` here,
    // so the card cannot be reading the device store behind the route's back.
    for (const field of ['grid', 'adherenceGoals', 'streak']) {
      assert.match(body.slice(0, body.indexOf('return (')), new RegExp(`\\n\\s+${field},`), `${field} comes off loaderData`);
    }
  });

  it('builds its window through the one shared selection, exactly as /trends does', () => {
    // A private copy of the 13-week arithmetic on this page is the failure the
    // seam exists to prevent: two grids that disagree about a day.
    assert.ok(dashboardSource.includes("from '#app/lib/adherence-grid-days'"));
    assert.match(dashboardSource, /selectAdherenceGridDays\(\{ allLogs, today, weeks: GRID_WEEKS \}\)/);
    assert.ok(!dashboardSource.includes('startOfWeek'), 'the week arithmetic is not re-derived here');
  });

  it('wraps the grid card in exactly one link to /trends, with none nested inside it', () => {
    assertWholeCardIsOneLinkToTrends(streakGridCardSource, 'StreakGridCard');
  });

  it('carries no button of its own, and draws the grid read-only', () => {
    // A `<button>` inside an `<a>` is invalid HTML, and every one of the grid's
    // 91 cells is a button on `/trends`. So the trends card's "set a goal"
    // action is not repeated here, and the grid is drawn non-interactive.
    assert.doesNotMatch(streakGridCardSource, /<Button\b/, 'no button may sit inside the wrapping link');
    assert.doesNotMatch(streakGridCardSource, /trends\.grid\.noGoalsCta/, "the trends card's CTA copy stays on /trends");
    assert.match(
      streakGridCardSource,
      /<AdherenceGrid grid=\{grid\} goals=\{goals\} interactive=\{false\} \/>/,
      'the grid renders read-only cells inside the link',
    );
  });

  it('reuses the streak copy /trends already ships, adding no key of its own', () => {
    assert.ok(streakGridCardSource.includes("t('trends.streak.title')"), 'the header is the streak title');
    assert.ok(streakGridCardSource.includes('describeStreak(streak, t)'), 'the line comes from the shared selector');
    // Control: the only `t(` call in the card is that title. Any new copy key
    // would show up here as a second lookup.
    assert.equal(streakGridCardSource.match(/\bt\('/g)?.length, 1);
  });
});
