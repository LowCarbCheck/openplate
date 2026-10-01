/**
 * `MacroRatioBar` (`app/components/macro-ratio-bar.tsx`) rendered to static
 * markup with the shipped English catalog: three segments by calories, four by
 * grams, and a sentence that names the basis it reads.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { MacroRatioBar } from '../../app/components/macro-ratio-bar';
import type { MacroShareBasis } from '../../app/lib/macro-share-basis';

const DAY = { carbs: 100, protein: 100, fat: 100, fiber: 20 };

function render(basis: MacroShareBasis, grams = DAY): string {
  return renderToStaticMarkup(withI18n(createElement(MacroRatioBar, { grams, basis })));
}

function segmentsOf(html: string): string[] {
  return [...html.matchAll(/data-slot="macro-ratio-segment" data-macro="(\w+)"/g)].map((match) => match[1] ?? '');
}

describe('MacroRatioBar', () => {
  it('draws three segments by calories, with no fibre segment', () => {
    assert.deepEqual(segmentsOf(render('kcal')), ['carbs', 'protein', 'fat']);
  });

  it('draws four segments by grams, fibre among them', () => {
    assert.deepEqual(segmentsOf(render('grams')), ['carbs', 'fiber', 'protein', 'fat']);
  });

  it('sizes the segments by the basis: fat is 53 percent of the energy but 31 percent of the grams', () => {
    // 100 g of each: fat is 900 of 1700 kcal. By grams fat is 100 of 320.
    assert.match(render('kcal'), /data-macro="fat"[^>]*width:52\.9/);
    assert.match(render('grams'), /data-macro="fat"[^>]*width:31\.2/);
  });

  it('names the basis in the sentence a screen reader gets, with each percent', () => {
    const kcal = render('kcal');
    assert.ok(kcal.includes('Macro ratio by calories: 24% carbs, 24% protein, 53% fat'), kcal);
    assert.ok(!kcal.includes('fiber'), 'a calorie sentence has no fibre in it');

    const grams = render('grams');
    assert.ok(grams.includes('Macro ratio by grams: 31% carbs, 6% fiber, 31% protein, 31% fat'), grams);
  });

  it('reports the basis on the bar itself, for the browser tier', () => {
    assert.match(render('kcal'), /data-slot="macro-ratio-bar" data-basis="kcal"/);
    assert.match(render('grams'), /data-slot="macro-ratio-bar" data-basis="grams"/);
  });

  it('draws the empty track with its words when there is nothing to share', () => {
    const none = { carbs: 0, protein: 0, fat: 0, fiber: 0 };
    for (const basis of ['kcal', 'grams'] as const) {
      const html = render(basis, none);
      assert.ok(html.includes('No macros logged yet'));
      assert.deepEqual(segmentsOf(html), []);
    }
  });
});
