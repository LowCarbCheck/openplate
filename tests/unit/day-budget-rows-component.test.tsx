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

/**
 * The label cell (M216/02).
 *
 * A German label beside the reference tag used to lose its tail to an ellipsis
 * at a narrow width, and to collapse to nothing at a large root font. The fix
 * is a wrapping label cell and a label span that may shrink, so the assertions
 * below are about the label cell's classes, which is what this repo can prove:
 * there is no DOM library here, so no `scrollWidth` to read.
 */

const GERMAN_FIBER_LABEL = 'Ballaststoffe';
const GERMAN_PROTEIN_LABEL = 'Eiweiß';

/** The reference tag's own tracking value, so counting tags never pins its copy. */
const REFERENCE_TAG_MARKER = /tracking-\[0\.08em\]/g;

/** Protein and fiber, both left on a reference target, relabelled in German. */
function buildGermanReferenceRows(): DayBudgetRow[] {
  const gaps = computeDayGaps({
    totals: { netCarbs: DAY.netCarbs, protein: DAY.protein, fiber: DAY.fiber },
    goals: {
      netCarbsCeiling: 50,
      // No typed-in floor, but a reference figure, so protein is a `'default'`
      // row and wears the tag exactly as fiber always does.
      proteinFloor: null,
      proteinReferenceG: 100,
      proteinReferenceMissingDate: null,
    },
    t,
  });
  const rows = buildDayBudgetRows({
    totals: { ...DAY, hasEstimates: false },
    goals: { netCarbsCeiling: 50, kcalTarget: 1800, missingReferenceDate: null },
    gaps,
    t,
    language: 'de',
  });
  const protein: DayBudgetRow = { ...rowFor(rows, 'protein'), label: GERMAN_PROTEIN_LABEL };
  const fiber: DayBudgetRow = { ...rowFor(rows, 'fiber'), label: GERMAN_FIBER_LABEL };
  assert.equal(protein.targetSource, 'default', 'the protein fixture must carry a reference tag');
  assert.equal(fiber.targetSource, 'default', 'the fiber fixture must carry a reference tag');
  return [protein, fiber];
}

/**
 * The class tokens of one element, split on whitespace, so `truncate` can never
 * match inside a longer name such as `text-truncate-none`.
 */
function classTokens(classList: string): string[] {
  return classList.split(/\s+/).filter((token) => token.length > 0);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The class list of the row's label cell: the first `<span class="...">` in the `<li>`. */
function labelCellClass(markup: string): string {
  const match = /<span class="([^"]*)"/.exec(markup);
  const classList = match?.[1];
  if (classList === undefined) throw new Error('expected a label cell carrying a class list');
  return classList;
}

/** The class list of the span holding the label text itself, never the cell around it. */
function labelSpanClass({ markup, label }: { markup: string; label: string }): string {
  const match = new RegExp(`<span class="([^"]*)">${escapeForRegExp(label)}</span>`).exec(markup);
  const classList = match?.[1];
  if (classList === undefined) throw new Error(`expected a span holding "${label}"`);
  return classList;
}

/**
 * The whole claim of this spec as one function, so a hand-written copy of the
 * pre-fix markup can be run through the very same assertions.
 */
function assertLabelWraps({ markup, label }: { markup: string; label: string }): void {
  const cell = classTokens(labelCellClass(markup));
  const span = classTokens(labelSpanClass({ markup, label }));
  assert.ok(cell.includes('flex-wrap'), `the label cell must wrap so the reference tag drops under "${label}"`);
  assert.ok(!span.includes('truncate'), `"${label}" must never be clipped with an ellipsis`);
  assert.ok(span.includes('min-w-0'), `the "${label}" span must be free to shrink below its content width`);
}

/** The label cell exactly as it shipped before this fix: `truncate`, no `min-w-0`, no wrap. */
const PRE_FIX_ROW_MARKUP =
  '<li class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">' +
  '<span class="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">' +
  '<span class="h-2 w-2 shrink-0 rounded-full bg-macro-fiber" aria-hidden="true"></span>' +
  `<span class="truncate">${GERMAN_FIBER_LABEL}</span>` +
  '<span class="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">reference</span>' +
  '</span></li>';

/** A fixed cell whose label span carries a class that merely CONTAINS "truncate". */
const NEAR_MISS_ROW_MARKUP =
  '<li class="grid">' +
  '<span class="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-foreground">' +
  '<span class="h-2 w-2 shrink-0 rounded-full bg-macro-fiber" aria-hidden="true"></span>' +
  `<span class="min-w-0 text-truncate-none">${GERMAN_FIBER_LABEL}</span>` +
  '</span></li>';

describe('a long German label wraps in its cell instead of truncating', () => {
  it('drops the reference tag under the label and never clips the word', () => {
    const html = render(buildGermanReferenceRows());
    const rows = rowMarkup(html);
    assert.equal(rows.length, 2, 'the fixture is the two reference rows');
    const [proteinRow, fiberRow] = rows;
    assert.ok(proteinRow !== undefined && fiberRow !== undefined);
    assert.equal(html.match(REFERENCE_TAG_MARKER)?.length, 2, 'both fixture rows must render a reference tag');
    assert.ok(html.includes(GERMAN_FIBER_LABEL), 'the full German word must be in the markup');
    assert.ok(html.includes(GERMAN_PROTEIN_LABEL), 'the full German word must be in the markup');

    assertLabelWraps({ markup: fiberRow, label: GERMAN_FIBER_LABEL });
    assertLabelWraps({ markup: proteinRow, label: GERMAN_PROTEIN_LABEL });
  });

  it('CONTROL: the pre-fix label cell fails that same check', () => {
    assert.throws(
      () => assertLabelWraps({ markup: PRE_FIX_ROW_MARKUP, label: GERMAN_FIBER_LABEL }),
      /the label cell must wrap/,
      'CONTROL: a truncating label cell with no flex-wrap must fail this check',
    );
  });

  it('CONTROL: a class that merely contains "truncate" is not read as truncate', () => {
    assert.doesNotThrow(
      () => assertLabelWraps({ markup: NEAR_MISS_ROW_MARKUP, label: GERMAN_FIBER_LABEL }),
      'CONTROL: the check compares whitespace tokens, so `text-truncate-none` must pass',
    );
  });
});
