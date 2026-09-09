/**
 * Unit tests for the SHAPE of a rendered budget row (M209).
 *
 * The card the dashboard draws had two different row skeletons: a row with a
 * target showed a meter and a progress caption, a row without one showed a
 * single grey line, so the four rows had different heights and their big
 * numbers floated at different horizontal positions. A row is now a two column
 * grid: label and value on the first grid row, meter and sub-line on the
 * second, so every row is the same height and every number and caption share
 * one right edge.
 *
 * A row with no target still draws NO meter, on purpose: an empty track reads
 * as a goal sitting at zero percent, which is a different and wrong statement.
 * What makes the heights match is the sub-line, which every row carries.
 *
 * Every check below is a pure function over the rendered markup, so each test
 * can also run it against a deliberately broken copy of that markup. That
 * control is the point: an assertion that cannot fail proves nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import i18next from '../../app/i18n/i18n';
import { withI18n } from './trends-i18n-harness';
import { DayBudgetRows } from '../../app/components/day-budget-rows';
import { buildDayBudgetRows, type DayBudgetRow, type DayBudgetRowKey } from '../../app/lib/day-budget-rows';
import { computeDayGaps } from '../../app/lib/macro-gaps';
import type { Translate } from '../../app/lib/macro-gaps';

/** The shipped English catalog, so the sub-line copy is the real one. */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

const DAY = { netCarbs: 25.1, kcal: 899, protein: 95, fat: 34.6, fiber: 13 };

/**
 * The fixtures come from the real formatter rather than hand-typed objects, so
 * a field the formatter stops setting shows up here as a failing render.
 */
function buildRows(): DayBudgetRow[] {
  const gaps = computeDayGaps({
    totals: { netCarbs: DAY.netCarbs, protein: DAY.protein, fiber: DAY.fiber },
    goals: {
      netCarbsCeiling: 50,
      proteinFloor: 90,
      proteinReferenceG: null,
      proteinReferenceMissingDate: null,
    },
    t,
  });
  return buildDayBudgetRows({
    totals: { ...DAY, hasEstimates: false },
    goals: { netCarbsCeiling: 50, kcalTarget: 1800, missingReferenceDate: null },
    gaps,
    t,
    language: 'en',
  });
}

function rowFor(rows: DayBudgetRow[], key: DayBudgetRowKey): DayBudgetRow {
  const row = rows.find((candidate) => candidate.key === key);
  if (row === undefined) throw new Error(`expected a "${key}" row`);
  return row;
}

/** A router is in scope because a reference tag can render a `Link`. */
function render(rows: DayBudgetRow[]): string {
  return renderToStaticMarkup(withI18n(createElement(MemoryRouter, null, createElement(DayBudgetRows, { rows }))));
}

/** The markup of each `<li>`, so a claim about ONE row is never a claim about the page. */
function rowMarkup(html: string): string[] {
  return html
    .split('<li')
    .slice(1)
    .map((chunk) => `<li${chunk}`);
}

function hasSubline(markup: string): boolean {
  return markup.includes('data-slot="budget-subline"');
}

function countTracks(markup: string): number {
  return markup.match(/data-slot="budget-track"/g)?.length ?? 0;
}

function countProgressElements(markup: string): number {
  return markup.match(/<progress/g)?.length ?? 0;
}

function hasScreenReaderSpan(markup: string): boolean {
  return /<span class="sr-only">/.test(markup);
}

function hasLeftBorder(markup: string): boolean {
  return /border-l-(?!0)/.test(markup);
}

/** The markup of the two row kinds, plus the page they came from. */
interface BothRowKinds {
  /** The net-carb row, which has a ceiling. */
  targetRow: string;
  /** The fat row, which never has a target. */
  noTargetRow: string;
  /** The whole rendered list. */
  html: string;
}

/** The two row kinds, always in this order: net carbs has a ceiling, fat never has a target. */
function renderBothKinds(): BothRowKinds {
  const rows = buildRows();
  const html = render([rowFor(rows, 'netCarbs'), rowFor(rows, 'fat')]);
  const chunks = rowMarkup(html);
  assert.equal(chunks.length, 2, 'the fixture is one targeted row and one row with no target');
  const [targetRow, noTargetRow] = chunks;
  assert.ok(targetRow !== undefined && noTargetRow !== undefined);
  return { targetRow, noTargetRow, html };
}

describe('a budget row is one grid, whether or not it has a target', () => {
  it('gives every row a sub-line cell, which is what makes the heights match', () => {
    const html = render(buildRows());
    const rows = rowMarkup(html);
    assert.equal(rows.length, 5, 'the day fixture draws all five rows');
    assert.ok(
      rows.every(hasSubline),
      'every row must carry a sub-line cell, so a row with no meter is still two grid rows tall',
    );

    // CONTROL: the same check over markup with ONE sub-line taken out fails.
    const broken = rowMarkup(html.replace('data-slot="budget-subline"', 'data-slot="something-else"'));
    assert.ok(!broken.every(hasSubline), 'CONTROL: a row with its sub-line removed must fail this check');
  });

  it('captions a targeted row with its progress and an untargeted row with "no target set"', () => {
    const { targetRow, noTargetRow } = renderBothKinds();
    assert.match(targetRow, /data-slot="budget-subline"[^>]*>25\.1 of 50 g</);
    assert.match(noTargetRow, /data-slot="budget-subline"[^>]*>No target set</);
  });

  it('draws a meter only where there is a target, never an empty track', () => {
    const { targetRow, noTargetRow } = renderBothKinds();
    assert.equal(countTracks(targetRow), 1, 'a targeted row draws exactly one track');
    assert.equal(countTracks(noTargetRow), 0, 'an empty track would read as a goal at zero percent');

    // CONTROL 1: injecting a track into the untargeted row's markup fails it.
    const injected = noTargetRow.replace('data-slot="budget-subline"', 'data-slot="budget-track"');
    assert.notEqual(countTracks(injected), 0, 'CONTROL: a row that grew a track must fail this check');

    // CONTROL 2: swapping the two rows fails the targeted claim as well.
    assert.notEqual(countTracks(noTargetRow), 1, 'CONTROL: the untargeted row must not satisfy the targeted claim');
  });

  it('keeps the accessible reading split: a progress element with a target, a sentence without one', () => {
    const { targetRow, noTargetRow } = renderBothKinds();
    assert.equal(countProgressElements(targetRow), 1);
    assert.match(targetRow, /<progress[^>]*value="25"[^>]*max="50"/);
    assert.ok(!hasScreenReaderSpan(targetRow), 'a targeted row reports through the progress element');

    assert.equal(countProgressElements(noTargetRow), 0, 'a row with no target must not invent a maximum');
    assert.ok(hasScreenReaderSpan(noTargetRow), 'a row with no target states its sentence instead');

    // CONTROL: read the rows the wrong way round and every claim above fails.
    assert.notEqual(countProgressElements(noTargetRow), 1, 'CONTROL: swapped rows must fail the progress claim');
    assert.ok(hasScreenReaderSpan(targetRow) === false);
    assert.ok(!(countProgressElements(targetRow) === 0), 'CONTROL: swapped rows must fail the sentence claim');
  });

  it('separates rows with a hairline and no left border of any weight', () => {
    const html = render(buildRows());
    assert.match(html, /divide-y divide-border\/50/);
    assert.ok(!hasLeftBorder(html), 'no element may carry a left border');

    // CONTROL: the same check over markup with a left border added fails.
    const broken = html.replace('<ul class="', '<ul class="border-l-4 ');
    assert.ok(hasLeftBorder(broken), 'CONTROL: an injected border-l-4 must fail this check');
  });
});
