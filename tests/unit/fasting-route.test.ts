/**
 * Static-render tests for the `/fasting` screen's new blocks: the stage lines
 * under the elapsed clock, the "What happens when" list, the end control's
 * label and the practice stats row.
 *
 * Everything here renders through `withI18n`, which holds the REAL shipped
 * English catalog. That is the point: a key renamed in a component but not in
 * `en/common.json` fails here instead of shipping a raw `fasting.stages.hedge`
 * to a person mid-fast.
 *
 * There is no DOM in this repo (no jsdom, no happy-dom), so nothing below
 * clicks anything. The route's own components are split so that every
 * assertion here is about a first render of props, and each one carries a
 * CONTROL case that makes it fail: a hedge assertion that cannot fail is worse
 * than no hedge assertion, because it reads as coverage.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { StageLines, StageList } from '../../app/components/fasting/stage-panel';
import { FastingStatsRow } from '../../app/components/fasting/fasting-stats-row';
import { endLabelKey } from '../../app/components/fasting/end-fast-sheet';
import type { FastingStats } from '../../app/models/fasting-stats';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** A fixed instant so the "Entered at" clock label is deterministic. */
const START_AT = new Date(2026, 8, 12, 6, 4, 0, 0).getTime();

function renderStageLines(elapsedMs: number): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(StageLines, {
        elapsedMs,
        startAtMs: START_AT,
        // The runtime zone, so the rendered clock and the fixture agree
        // whichever machine runs the suite.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: 'en',
      }),
    ),
  );
}

describe('the stage lines on the active card', () => {
  it('names the stage and carries the hedge', () => {
    const markup = renderStageLines(17 * HOUR);
    assert.ok(markup.includes('Rising ketones'), markup);
    assert.ok(markup.includes('Averages, not a measurement of you'), markup);
  });

  it('names a DIFFERENT stage earlier in the fast', () => {
    // The control for the assertion above: a component that hardcoded one
    // stage name would pass it and fail here.
    const markup = renderStageLines(30 * MINUTE);
    assert.ok(markup.includes('Digesting'), markup);
    assert.ok(!markup.includes('Rising ketones'), markup);
  });

  it('says when the stage was entered during its first hour', () => {
    const markup = renderStageLines(16 * HOUR + 10 * MINUTE);
    assert.ok(markup.includes('Entered'), markup);
    assert.ok(markup.includes('Rising ketones'), markup);
  });

  it('drops back to the bare name once the stage is no longer fresh', () => {
    // The control for "Entered": without it, a card that ALWAYS said "Entered"
    // would pass the test above.
    const markup = renderStageLines(18 * HOUR);
    assert.ok(!markup.includes('Entered'), markup);
    assert.ok(markup.includes('Rising ketones'), markup);
  });

  it('points at the next stage, and points at nothing past the last one', () => {
    assert.ok(renderStageLines(17 * HOUR).includes('Next:'), 'no next line mid-ladder');
    // `extended` is the end of the ladder, so there is nothing to promise.
    assert.ok(!renderStageLines(80 * HOUR).includes('Next:'), 'a next line past the last stage');
  });
});

describe('the "What happens when" list', () => {
  it('is collapsed by default', () => {
    const markup = renderToStaticMarkup(withI18n(createElement(StageList, { elapsedMs: 17 * HOUR })));
    assert.ok(markup.includes('<details'), markup);
    assert.ok(!markup.includes('<details open'), 'the list opens itself');
  });

  it('lists all six stages and repeats the hedge at the top', () => {
    const markup = renderToStaticMarkup(withI18n(createElement(StageList, { elapsedMs: 17 * HOUR })));
    for (const name of ['Digesting', 'Early fasting', 'Low liver stores', 'Rising ketones', 'Ketosis', 'Extended']) {
      assert.ok(markup.includes(name), `${name} is missing from the list`);
    }
    assert.ok(markup.includes('Averages, not a measurement of you'), markup);
  });

  it('marks the current stage with aria-current and nothing else', () => {
    const markup = renderToStaticMarkup(withI18n(createElement(StageList, { elapsedMs: 17 * HOUR })));
    const marked = [...markup.matchAll(/<li[^>]*aria-current="true"[^>]*>(.*?)<\/li>/gu)];
    assert.equal(marked.length, 1, 'exactly one row must be marked');
    assert.ok(marked[0][0].includes('Rising ketones'), marked[0][0]);
  });

  it('marks a DIFFERENT row for a different elapsed', () => {
    // The control: a list that marked the first row unconditionally would pass
    // the count above.
    const markup = renderToStaticMarkup(withI18n(createElement(StageList, { elapsedMs: 30 * MINUTE })));
    const marked = [...markup.matchAll(/<li[^>]*aria-current="true"[^>]*>(.*?)<\/li>/gu)];
    assert.equal(marked.length, 1);
    assert.ok(marked[0][0].includes('Digesting'), marked[0][0]);
    assert.ok(!marked[0][0].includes('Rising ketones'), marked[0][0]);
  });
});

describe('the end control label', () => {
  it('reads Complete once the target is reached and the end label before it', () => {
    assert.equal(endLabelKey(true), 'fasting.active.complete');
    assert.equal(endLabelKey(false), 'fasting.active.end');
  });
});

/** A stats record whose only interesting figure is the streak. */
function statsWith(streakDays: number): FastingStats {
  return { completedCount: 0, longestMs: 0, currentStreakDays: streakDays, hoursLast7Days: 0 };
}

function renderStats(stats: FastingStats): string {
  return renderToStaticMarkup(withI18n(createElement(FastingStatsRow, { stats })));
}

describe('the stats row', () => {
  it('hides the streak at zero and still shows the other three', () => {
    const markup = renderStats(statsWith(0));
    assert.ok(!markup.includes('Day streak'), markup);
    assert.ok(markup.includes('Fasts completed'), markup);
    assert.ok(markup.includes('Longest'), markup);
    assert.ok(markup.includes('Hours this week'), markup);
  });

  it('shows the streak at three', () => {
    const markup = renderStats(statsWith(3));
    assert.ok(markup.includes('Day streak'), markup);
    assert.ok(markup.includes('>3</dd>'), markup);
  });

  it('shows a zero completed count rather than hiding it', () => {
    // Zero fasts is a fact about a new device, not a grade. Only the streak is
    // conditional, and this is what stops somebody "tidying" the other three
    // behind the same guard.
    const markup = renderStats({ completedCount: 0, longestMs: 0, currentStreakDays: 5, hoursLast7Days: 0 });
    assert.ok(markup.includes('Fasts completed'), markup);
    assert.ok(markup.includes('>0</dd>'), markup);
  });
});
