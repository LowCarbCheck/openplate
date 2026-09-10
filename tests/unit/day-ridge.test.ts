/**
 * Unit tests for the Overview page's Budget Ridge (M216/01): the pure model in
 * `#app/models/day-ridge` and the aria-labels the component draws from it.
 *
 * The five day states the design was approved against each get their own case
 * (a ceiling day under its goal, a ceiling day over it, a floor day that met
 * its floor, a gap day, and an account with no goal at all), and every positive
 * assertion is paired with a control that makes it fail: a green
 * "the over day is amber" is worth nothing unless the under day is proven NOT
 * to be amber on the same render.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { buildDayRidge, ENTRIES_FOR_A_FULL_BAR } from '../../app/models/day-ridge';
import type { DayRidge, RidgeGoals } from '../../app/models/day-ridge';
import { DayRidge as DayRidgeView } from '../../app/components/day-ridge';
import { computeDailyEntry } from '../../app/models/daily-totals';
import type { LocalDailyTotals } from '../../app/lib/local-store/aggregates';

const TODAY = '2026-09-10';

const NO_GOALS: RidgeGoals = { netCarbsCeiling: null, kcalTarget: null, proteinFloor: null };

/** The figures a fixture day carries. Everything is optional; what is left out is zero, or absent. */
interface DayFixture {
  netCarbs?: number;
  protein?: number;
  /** Null means the entry reported no calories, which is the store's own "unknown". */
  kcal?: number | null;
  entryCount?: number;
}

/** A logged day carrying exactly the figures asked for (fiber and polyols zeroed so net carbs are the carbs). */
function loggedDay(
  date: string,
  { netCarbs = 0, protein = 0, kcal = null, entryCount = 1 }: DayFixture = {},
): LocalDailyTotals {
  const snapshot = {
    carbs: netCarbs,
    fiber: 0,
    sugars: null,
    polyols: 0,
    protein,
    fat: 0,
    kcal,
    aiEstimated: false,
  };
  return { date, entryCount, ...computeDailyEntry([snapshot]) };
}

/**
 * A logged day whose calories cannot be computed: carbs unknown, so no figure
 * is reported and no Atwater fallback is derivable either.
 */
function uncomputableKcalDay(date: string): LocalDailyTotals {
  return {
    date,
    entryCount: 1,
    ...computeDailyEntry([
      { carbs: null, fiber: null, sugars: null, polyols: null, protein: 10, fat: null, kcal: null, aiEstimated: false },
    ]),
  };
}

/** A day with nothing logged at all. */
function gapDay(date: string): LocalDailyTotals {
  return { date, entryCount: 0, ...computeDailyEntry([]) };
}

/** The ridge over a single day, so a case reads as one day and one verdict. */
function ridgeForOneDay(totals: LocalDailyTotals, lens: 'carb' | 'kcal' | 'protein' | 'none', goals: RidgeGoals) {
  return buildDayRidge({ dailyTotals: [totals], today: totals.date, dayCount: 1, lens, goals });
}

function renderRidge(ridge: DayRidge): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(
        MemoryRouter,
        { initialEntries: ['/dashboard'] },
        createElement(DayRidgeView, { ridge, emptyLabel: 'No days logged yet.' }),
      ),
    ),
  );
}

describe('buildDayRidge, the five day states', () => {
  it('grades a ceiling day under its goal as met, with a fraction below the rule', () => {
    const ridge = ridgeForOneDay(loggedDay(TODAY, { netCarbs: 25 }), 'carb', { ...NO_GOALS, netCarbsCeiling: 50 });

    assert.equal(ridge.metric?.key, 'netCarbs');
    assert.equal(ridge.metric?.direction, 'ceiling');
    assert.equal(ridge.goal, 50);
    assert.equal(ridge.days[0].state, 'met');
    assert.equal(ridge.days[0].fraction, 0.5);
    assert.equal(ridge.days[0].value, 25);
  });

  it('grades a ceiling day over its goal as over, keeping the true fraction above 1', () => {
    const ridge = ridgeForOneDay(loggedDay(TODAY, { netCarbs: 69 }), 'carb', { ...NO_GOALS, netCarbsCeiling: 50 });

    assert.equal(ridge.days[0].state, 'over');
    assert.equal(ridge.days[0].value, 69);
    // NOT clamped: the drawing area clips at about 1.29, the model stays honest
    // so the aria-label can read out the real figure.
    assert.equal(ridge.days[0].fraction, 69 / 50);
    // Control: the same ceiling one gram lower is not over.
    assert.equal(
      ridgeForOneDay(loggedDay(TODAY, { netCarbs: 50 }), 'carb', {
        ...NO_GOALS,
        netCarbsCeiling: 50,
      }).days[0].state,
      'met',
    );
  });

  it('grades a floor day that reached its floor as met, and never as over below it', () => {
    const goals: RidgeGoals = { ...NO_GOALS, proteinFloor: 90 };
    const met = ridgeForOneDay(loggedDay(TODAY, { protein: 95 }), 'protein', goals);

    assert.equal(met.metric?.direction, 'floor');
    assert.equal(met.days[0].state, 'met');
    assert.equal(met.days[0].value, 95);

    // Control: short of the floor is `logged`, which draws teal under the rule.
    // A floor metric has no `over` state at all, so no bar here can be amber.
    const short = ridgeForOneDay(loggedDay(TODAY, { protein: 40 }), 'protein', goals);
    assert.equal(short.days[0].state, 'logged');
    assert.notEqual(short.days[0].state, 'over');
  });

  it('leaves a gap day with no fraction and no value', () => {
    const ridge = ridgeForOneDay(gapDay(TODAY), 'carb', { ...NO_GOALS, netCarbsCeiling: 50 });

    assert.equal(ridge.days[0].state, 'none');
    assert.equal(ridge.days[0].fraction, null);
    assert.equal(ridge.days[0].value, null);
    assert.equal(ridge.loggedDayCount, 0);
    // Control: the same date with a log is not a gap.
    assert.equal(
      ridgeForOneDay(loggedDay(TODAY, { netCarbs: 25 }), 'carb', {
        ...NO_GOALS,
        netCarbsCeiling: 50,
      }).days[0].state,
      'met',
    );
  });

  it('sizes a no-goal account by logged entries, draws no rule and can never be over', () => {
    const ridge = buildDayRidge({
      dailyTotals: [loggedDay(TODAY, { netCarbs: 300, entryCount: 3 })],
      today: TODAY,
      dayCount: 1,
      lens: 'none',
      goals: NO_GOALS,
    });

    assert.equal(ridge.metric, null);
    assert.equal(ridge.goal, null);
    assert.equal(ridge.days[0].state, 'logged');
    assert.equal(ridge.days[0].value, 3);
    assert.equal(ridge.days[0].fraction, 3 / ENTRIES_FOR_A_FULL_BAR);
    // Control: 300 g of carbs would be far over any ceiling; with no goal set
    // the ridge still refuses to grade it.
    assert.notEqual(ridge.days[0].state, 'over');
  });
});

describe('buildDayRidge, the lens picks the metric, and a missing goal degrades', () => {
  it('grades a kcal lens against the calorie target', () => {
    const goals: RidgeGoals = { ...NO_GOALS, kcalTarget: 1800, netCarbsCeiling: 20 };
    const ridge = ridgeForOneDay(loggedDay(TODAY, { netCarbs: 200, kcal: 1900 }), 'kcal', goals);

    assert.equal(ridge.metric?.key, 'kcal');
    assert.equal(ridge.goal, 1800);
    assert.equal(ridge.days[0].value, 1900);
    assert.equal(ridge.days[0].state, 'over');
    // Control: the carb ceiling in the same goals is ignored by a kcal lens,
    // so the ridge never reports net carbs here.
    assert.notEqual(ridge.metric?.key, 'netCarbs');
  });

  it('falls back to the no-goal ridge when the lens has no goal to grade against', () => {
    const ridge = ridgeForOneDay(loggedDay(TODAY, { protein: 40, entryCount: 2 }), 'protein', NO_GOALS);

    assert.equal(ridge.metric, null);
    assert.equal(ridge.days[0].value, 2, 'a no-goal bar reads entries, not grams');
    // Control: give the same lens its floor and it grades.
    assert.equal(
      ridgeForOneDay(loggedDay(TODAY, { protein: 40 }), 'protein', {
        ...NO_GOALS,
        proteinFloor: 90,
      }).metric?.key,
      'protein',
    );
  });

  it('keeps a logged day with no computable figure ungraded', () => {
    const ridge = ridgeForOneDay(uncomputableKcalDay(TODAY), 'kcal', { ...NO_GOALS, kcalTarget: 1800 });

    assert.equal(ridge.days[0].state, 'logged');
    assert.equal(ridge.days[0].fraction, null);
    assert.equal(ridge.days[0].value, null);
    // Control: the same lens with a computable day does grade it.
    assert.equal(
      ridgeForOneDay(loggedDay(TODAY, { kcal: 1200 }), 'kcal', { ...NO_GOALS, kcalTarget: 1800 }).days[0].state,
      'met',
    );
  });

  it('builds the window oldest first, ending on today', () => {
    const ridge = buildDayRidge({
      dailyTotals: [loggedDay('2026-09-08', { netCarbs: 10 })],
      today: TODAY,
      dayCount: 7,
      lens: 'carb',
      goals: { ...NO_GOALS, netCarbsCeiling: 50 },
    });

    assert.deepEqual(
      ridge.days.map((day) => day.date),
      ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'],
    );
    assert.deepEqual(
      ridge.days.map((day) => day.isToday),
      [false, false, false, false, false, false, true],
    );
    assert.equal(ridge.loggedDayCount, 1);
  });
});

describe('DayRidge, what a bar draws and what it says', () => {
  const CEILING: RidgeGoals = { netCarbsCeiling: 50, kcalTarget: null, proteinFloor: null };

  it('paints an over day amber and an under day teal, on the same render', () => {
    const ridge = buildDayRidge({
      dailyTotals: [loggedDay('2026-09-09', { netCarbs: 69 }), loggedDay(TODAY, { netCarbs: 25 })],
      today: TODAY,
      dayCount: 2,
      lens: 'carb',
      goals: CEILING,
    });
    const html = renderRidge(ridge);

    assert.ok(html.includes('bg-accent-amber'), 'the over bar carries the amber token');
    assert.ok(html.includes('bg-primary'), 'the under bar stays teal');
    assert.ok(!html.includes('amber-500'), 'tokens only, never a raw Tailwind color');

    // Control: with no over day in the window, no amber is drawn at all.
    const allUnder = buildDayRidge({
      dailyTotals: [loggedDay('2026-09-09', { netCarbs: 20 }), loggedDay(TODAY, { netCarbs: 25 })],
      today: TODAY,
      dayCount: 2,
      lens: 'carb',
      goals: CEILING,
    });
    assert.ok(!renderRidge(allUnder).includes('bg-accent-amber'));
  });

  it('clips an over bar at the top of the drawing area instead of overflowing the tile', () => {
    const wild = renderRidge(ridgeForOneDay(loggedDay(TODAY, { netCarbs: 500 }), 'carb', CEILING));
    const modest = renderRidge(ridgeForOneDay(loggedDay(TODAY, { netCarbs: 62 }), 'carb', CEILING));

    // 62 px is the whole drawing area; the rule sits at 48, so the clip is 62/48.
    assert.ok(wild.includes('height:62px'), 'a wildly over day is clipped to the drawing area');
    assert.ok(!wild.includes('height:480px'), 'nothing draws outside the tile');
    // Control: a bar under the clip draws its own height, so 62px is not a constant.
    assert.ok(modest.includes('height:60px'), 'a 1.24x day draws at its own height');
  });

  it('draws a gap day as a hollow 2px stub, not a muted fill', () => {
    const html = renderRidge(ridgeForOneDay(gapDay(TODAY), 'carb', CEILING));

    assert.ok(html.includes('border-muted-foreground/30'), 'the gap stub reuses the diary strip hollow stroke');
    assert.ok(html.includes('height:2px'), 'the stub sits on the baseline at 2px');
    assert.ok(!html.includes('bg-muted"'), 'bg-muted was invisible on bg-card in both themes');

    // Control: the same day with a log draws a filled bar and no hollow stroke.
    const logged = renderRidge(ridgeForOneDay(loggedDay(TODAY, { netCarbs: 25 }), 'carb', CEILING));
    assert.ok(!logged.includes('border-muted-foreground/30'));
    assert.ok(!logged.includes('height:2px'));
  });

  it('rings today and marks it for assistive technology', () => {
    const ridge = buildDayRidge({
      dailyTotals: [loggedDay('2026-09-09', { netCarbs: 20 }), loggedDay(TODAY, { netCarbs: 25 })],
      today: TODAY,
      dayCount: 2,
      lens: 'carb',
      goals: CEILING,
    });
    const html = renderRidge(ridge);

    assert.equal(html.match(/ring-primary\/40/g)?.length, 1, 'exactly one bar is ringed');
    assert.equal(html.match(/aria-current="date"/g)?.length, 1, 'exactly one bar is today');
    assert.ok(html.includes('font-bold'), "today's weekday label is bold");
  });

  it('links every bar to its own day in the diary', () => {
    const ridge = buildDayRidge({
      dailyTotals: [gapDay('2026-09-09'), loggedDay(TODAY, { netCarbs: 25 })],
      today: TODAY,
      dayCount: 2,
      lens: 'carb',
      goals: CEILING,
    });
    const html = renderRidge(ridge);

    assert.ok(html.includes('href="/diary?date=2026-09-09"'), 'a gap day is still reachable');
    assert.ok(html.includes(`href="/diary?date=${TODAY}"`));
  });

  it('draws the 100 percent rule only when there is a goal', () => {
    assert.ok(renderRidge(ridgeForOneDay(loggedDay(TODAY, { netCarbs: 25 }), 'carb', CEILING)).includes('bg-border'));

    const noGoal = buildDayRidge({
      dailyTotals: [loggedDay(TODAY, { netCarbs: 25, entryCount: 2 })],
      today: TODAY,
      dayCount: 1,
      lens: 'none',
      goals: NO_GOALS,
    });
    assert.ok(!renderRidge(noGoal).includes('bg-border'), 'no goal, no rule');
  });
});

describe('DayRidge, the aria-label shapes', () => {
  const CEILING: RidgeGoals = { netCarbsCeiling: 50, kcalTarget: null, proteinFloor: null };

  it('names the value, the goal and the verdict on a graded ceiling day', () => {
    const under = renderRidge(ridgeForOneDay(loggedDay(TODAY, { netCarbs: 25 }), 'carb', CEILING));
    const over = renderRidge(ridgeForOneDay(loggedDay(TODAY, { netCarbs: 69 }), 'carb', CEILING));

    assert.ok(under.includes('25 of 50 g net carbs, within budget'), under);
    assert.ok(over.includes('69 of 50 g net carbs, over budget'), over);
    // The magnitude a clipped bar cannot show is still spoken in full.
    assert.ok(!over.includes('within budget'));
  });

  it('leads the label with the spoken day, not the raw date', () => {
    const html = renderRidge(ridgeForOneDay(loggedDay(TODAY, { netCarbs: 25 }), 'carb', CEILING));

    assert.ok(html.includes('aria-label="Thursday 10 September, 25 of 50 g net carbs, within budget"'), html);
  });

  it('reads a floor day as reached or not reached, never as over budget', () => {
    const goals: RidgeGoals = { netCarbsCeiling: null, kcalTarget: null, proteinFloor: 90 };
    const met = renderRidge(ridgeForOneDay(loggedDay(TODAY, { protein: 95 }), 'protein', goals));
    const short = renderRidge(ridgeForOneDay(loggedDay(TODAY, { protein: 40 }), 'protein', goals));

    assert.ok(met.includes('95 of 90 g protein, goal reached'), met);
    assert.ok(short.includes('40 of 90 g protein, goal not reached'), short);
    assert.ok(!short.includes('over budget'));
  });

  it('says nothing was logged on a gap day, and says how many entries on a no-goal day', () => {
    const gap = renderRidge(ridgeForOneDay(gapDay(TODAY), 'carb', CEILING));
    assert.ok(gap.includes('nothing logged'), gap);

    const one = buildDayRidge({
      dailyTotals: [loggedDay(TODAY, { entryCount: 1 })],
      today: TODAY,
      dayCount: 1,
      lens: 'none',
      goals: NO_GOALS,
    });
    const three = buildDayRidge({
      dailyTotals: [loggedDay(TODAY, { entryCount: 3 })],
      today: TODAY,
      dayCount: 1,
      lens: 'none',
      goals: NO_GOALS,
    });
    assert.ok(renderRidge(one).includes('1 entry logged'), 'the singular is a real plural form');
    assert.ok(renderRidge(three).includes('3 entries logged'));
  });

  it('says a logged day is not graded when its figure is not computable', () => {
    const html = renderRidge(ridgeForOneDay(uncomputableKcalDay(TODAY), 'kcal', { ...NO_GOALS, kcalTarget: 1800 }));

    assert.ok(html.includes('logged, not graded'), html);
    assert.ok(!html.includes('of 1800 kcal'), 'a figure the app cannot compute is never spoken as one');
  });

  it('carries one screen-reader sentence for the whole tile, and the empty copy when nothing is logged', () => {
    const logged = renderRidge(
      buildDayRidge({
        dailyTotals: [loggedDay(TODAY, { netCarbs: 25 })],
        today: TODAY,
        dayCount: 7,
        lens: 'carb',
        goals: CEILING,
      }),
    );
    assert.ok(logged.includes('Your last 7 days, one bar per day.'), logged);
    assert.ok(logged.includes('You logged on 1 of them.'));

    const empty = renderRidge(
      buildDayRidge({ dailyTotals: [], today: TODAY, dayCount: 7, lens: 'carb', goals: CEILING }),
    );
    assert.ok(empty.includes('No days logged yet.'), empty);
    assert.ok(!empty.includes('You logged on 0 of them.'));
  });

  it('captions the tile with the goal the rule stands for', () => {
    assert.ok(renderRidge(ridgeForOneDay(loggedDay(TODAY, { netCarbs: 25 }), 'carb', CEILING)).includes('Goal 50 g'));
    assert.ok(
      renderRidge(
        ridgeForOneDay(loggedDay(TODAY, { protein: 95 }), 'protein', {
          netCarbsCeiling: null,
          kcalTarget: null,
          proteinFloor: 90,
        }),
      ).includes('At least 90 g'),
    );
    assert.ok(
      renderRidge(
        buildDayRidge({
          dailyTotals: [loggedDay(TODAY, { entryCount: 2 })],
          today: TODAY,
          dayCount: 1,
          lens: 'none',
          goals: NO_GOALS,
        }),
      ).includes('No goal set'),
    );
  });
});
