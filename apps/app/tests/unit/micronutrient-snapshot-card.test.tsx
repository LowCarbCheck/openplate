/**
 * `MicronutrientSnapshotCard`, rendered: the rules of `/nutrients` held in
 * markup, each with a control that makes it fail.
 *
 * 1. **No number below the coverage bar.** A not-enough-data block shows no
 *    percent of a reference; the one percent it may show is the share of food
 *    that carried figures, and with none it shows no percent at all.
 * 2. **A limit is words, never a percent, and never a gap.**
 * 3. **One box while the references load.** Every answer sits in one grid
 *    cell; exactly one layer is visible, and the others are invisible, inert
 *    and hidden from assistive technology.
 * 4. **The brand colour is spent once**, on the link, never on a gap's bar.
 *
 * The snapshots are written out by hand: this file is about the drawing, and
 * `micronutrient-snapshot.test.ts` proves the builder through the real
 * pipeline.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { MicronutrientSnapshotCard } from '../../app/components/micronutrient-snapshot-card';
import type { MicronutrientSnapshotCardProps, SnapshotScope } from '../../app/components/micronutrient-snapshot-card';
import type { MicronutrientSnapshot, ReadySnapshot } from '../../app/lib/micronutrient-snapshot';

const DAY_SCOPE: SnapshotScope = { kind: 'day' };

/** A covered day with two gaps and sodium over its limit. */
const READY: ReadySnapshot = {
  kind: 'ready',
  coveredCount: 22,
  totalCount: 24,
  references: 'available',
  gaps: [
    { key: 'magnesium', share: 0.3 },
    { key: 'vitaminD', share: 0.55 },
  ],
  overLimits: [{ key: 'sodium', unit: 'mg', amount: 3100, limit: 2000 }],
};

/** Draws the card inside a router and the English catalog. */
function render(props: Partial<MicronutrientSnapshotCardProps> & { snapshot: MicronutrientSnapshot }): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      withI18n(
        createElement(MicronutrientSnapshotCard, {
          to: '/nutrients?day=2026-10-11',
          scope: DAY_SCOPE,
          isLoading: false,
          fillReserve: 'none',
          ...props,
        }),
      ),
    ),
  );
}

/** The markup of the one layer the cell shows. */
function shownLayer(markup: string): string {
  const match = /<div class="min-w-0" data-layer-shown="true">([\s\S]*?)<\/div><div class="min-w-0 invisible"|<div class="min-w-0" data-layer-shown="true">([\s\S]*)$/.exec(
    markup,
  );
  assert.ok(match, 'one layer is shown');
  return match[1] ?? match[2] ?? '';
}

/** Every percent figure in a piece of markup. */
function percentsIn(markup: string): string[] {
  return markup.match(/\d+\s?%/g) ?? [];
}

describe('not enough data', () => {
  it('shows no percent when no logged food carried figures', () => {
    const markup = render({ snapshot: { kind: 'not-enough-data', bestCoveredFraction: 0 } });
    assert.match(markup, /Not enough data/);
    assert.deepEqual(percentsIn(markup), []);
  });

  it('shows only the coverage share, never a share of a reference', () => {
    const markup = render({ snapshot: { kind: 'not-enough-data', bestCoveredFraction: 0.55 } });
    assert.deepEqual(percentsIn(markup), ['55%', '60%']);
    assert.doesNotMatch(markup, /data-slot="micronutrient-gap"/);
  });

  it('control: a ready block does show percents, so the reader can see one', () => {
    assert.ok(percentsIn(render({ snapshot: READY })).length > 0);
  });
});

describe('a limit', () => {
  it('reads as words with no percent, outside the gap rows', () => {
    const markup = render({ snapshot: READY });
    const limitRow = /<div data-slot="micronutrient-over-limit"[\s\S]*?<\/dd><\/div>/.exec(shownLayer(markup));
    assert.ok(limitRow, 'the shown layer has a limit row');
    assert.match(limitRow[0], /Sodium/);
    assert.match(limitRow[0], /Above the limit/);
    assert.deepEqual(percentsIn(limitRow[0]), []);
    const gapNames = [...shownLayer(markup).matchAll(/data-slot="micronutrient-gap"[\s\S]*?<dt[^>]*>([^<]+)<\/dt>/g)].map(
      (row) => row[1],
    );
    assert.deepEqual(gapNames, ['Magnesium', 'Vitamin D']);
  });

  it('control: without a limit over, the shown layer has no limit row', () => {
    const markup = render({ snapshot: { ...READY, overLimits: [] } });
    assert.doesNotMatch(shownLayer(markup), /micronutrient-over-limit/);
  });
});

describe('one box while the references load', () => {
  it('shows the loading layer and marks the block busy', () => {
    const markup = render({ snapshot: READY, isLoading: true });
    assert.match(markup, /data-loading="true"/);
    assert.match(markup, /aria-busy="true"/);
    assert.match(markup, /data-layer="loading"/);
    assert.match(shownLayer(markup), /Loading reference amounts/);
    assert.doesNotMatch(shownLayer(markup), /Magnesium/);
  });

  it('control: loaded, the gap layer is the shown one', () => {
    const markup = render({ snapshot: READY });
    assert.doesNotMatch(markup, /data-loading=/);
    assert.match(markup, /data-layer="gaps"/);
    assert.match(shownLayer(markup), /Magnesium/);
  });

  it('holds every hidden layer invisible, inert and silent', () => {
    const markup = render({ snapshot: READY, isLoading: true });
    const layers = markup.match(/<div class="min-w-0[^"]*"[^>]*>/g) ?? [];
    // The reserve, loading, gaps, no gaps, no body metrics, unreachable, age.
    assert.equal(layers.length, 7);
    const hidden = layers.filter((layer) => layer.includes('invisible'));
    assert.equal(hidden.length, 6);
    for (const layer of hidden) {
      assert.match(layer, /aria-hidden="true"/);
      assert.match(layer, /inert=""/);
    }
  });

  it('keeps the same layers, in the same cell, in every ready answer', () => {
    const layersOf = (snapshot: ReadySnapshot, isLoading: boolean): number =>
      (render({ snapshot, isLoading }).match(/<div class="min-w-0[^"]*"[^>]*>/g) ?? []).length;
    assert.equal(layersOf(READY, true), layersOf(READY, false));
    assert.equal(layersOf(READY, true), layersOf({ ...READY, references: 'unreachable', gaps: [], overLimits: [] }, false));
  });

  it('holds no list-sized reserve open for the add-your-details answer, which never changes', () => {
    const layersOf = (snapshot: ReadySnapshot): number =>
      (render({ snapshot }).match(/<div class="min-w-0[^"]*"[^>]*>/g) ?? []).length;
    assert.equal(layersOf({ ...READY, references: 'no-body-metrics', gaps: [], overLimits: [] }), 6);
    // Control: an answer that arrives after loading keeps the reserve.
    assert.equal(layersOf({ ...READY, references: 'unreachable', gaps: [], overLimits: [] }), 7);
  });

  it('does not mark an answer the log alone gives as busy', () => {
    const markup = render({ snapshot: { kind: 'not-enough-data', bestCoveredFraction: 0 }, isLoading: true });
    assert.doesNotMatch(markup, /data-loading=/);
    assert.match(markup, /aria-busy="false"/);
  });
});

describe('the reasons there are no gaps', () => {
  it('names each reason in its own layer', () => {
    const cases: readonly [ReadySnapshot['references'], RegExp][] = [
      ['no-body-metrics', /year of birth and biological sex/],
      ['unreachable', /could not be loaded/],
    ];
    for (const [references, wording] of cases) {
      const markup = render({ snapshot: { ...READY, references, gaps: [], overLimits: [] } });
      assert.match(shownLayer(markup), wording, references);
    }
  });

  it('says nothing came in under the suggestion ceiling when there are no gaps', () => {
    const markup = render({ snapshot: { ...READY, gaps: [], overLimits: [] } });
    assert.match(shownLayer(markup), /under 80% of its reference amount/);
  });
});

describe('the colour and the link', () => {
  it('spends the brand colour on the link, and none in the gap answer', () => {
    const markup = render({ snapshot: READY });
    assert.match(markup, /class="[^"]*\btext-primary\b[^"]*" href="\/nutrients\?day=2026-10-11"/);
    assert.deepEqual(shownLayer(markup).match(/\b(?:text|bg|border)-primary\b/g) ?? [], []);
  });

  it('control: the no-body-metrics answer shows its one teal link in the shown layer', () => {
    const markup = render({ snapshot: { ...READY, references: 'no-body-metrics', gaps: [], overLimits: [] } });
    assert.equal((shownLayer(markup).match(/\btext-primary\b/g) ?? []).length, 1);
  });

  it('control: the gap bar is neutral', () => {
    const markup = render({ snapshot: READY });
    assert.match(markup, /bg-muted-foreground/);
  });

  it('names its window in the link', () => {
    assert.match(render({ snapshot: READY }), /All vitamins and minerals for this day/);
    const range = render({ snapshot: READY, scope: { kind: 'range', days: 30 }, to: '/nutrients?range=30' });
    assert.match(range, /All vitamins and minerals for the last 30 days/);
    assert.match(range, /per logged day/i);
  });
});

describe('the box held open while the backfill may fill a day', () => {
  const NOT_ENOUGH: MicronutrientSnapshot = { kind: 'not-enough-data', bestCoveredFraction: 0 };
  /** The ready count line, which only a ready body draws. */
  const COUNT_LINE = /nutrients have enough data/;

  it('draws the ready body unseen under the not-enough-data answer', () => {
    const markup = render({ snapshot: NOT_ENOUGH, fillReserve: 'with-body-metrics' });
    assert.match(markup, /data-slot="micronutrient-snapshot-fill-reserve"/);
    assert.match(markup, COUNT_LINE);
    assert.match(markup, /data-slot="micronutrient-gap"/, 'the reserve holds the tallest gap list');
    // What the reader sees is still the not-enough-data answer.
    assert.match(shownLayer(markup), /Not enough data/);
    assert.doesNotMatch(shownLayer(markup), COUNT_LINE);
    assert.match(markup, /<div class="min-w-0 invisible" aria-hidden="true" inert=""><div class="space-y-3"><p[^>]*>\d+ of \d+ nutrients/);
  });

  it('control: with no fill pending, no ready body is drawn at all', () => {
    const markup = render({ snapshot: NOT_ENOUGH, fillReserve: 'none' });
    assert.doesNotMatch(markup, /micronutrient-snapshot-fill-reserve/);
    assert.doesNotMatch(markup, COUNT_LINE);
  });

  it('without body metrics, reserves the shorter ready body, with no gap list', () => {
    const markup = render({ snapshot: NOT_ENOUGH, fillReserve: 'without-body-metrics' });
    assert.match(markup, COUNT_LINE);
    assert.doesNotMatch(markup, /data-slot="micronutrient-gap"/);
  });
});
