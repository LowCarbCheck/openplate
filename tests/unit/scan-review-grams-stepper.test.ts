/**
 * Unit tests for the visible grams stepper on the scan review screen.
 *
 * The defect this pins: a person who scanned a nutrition label got macros per
 * 100 g and a row of portion chips that stops at 2x, so 200 g was the largest
 * portion the screen offered. The only free grams field was buried in the
 * "Fine-tune portion & nutrition" collapsible, which is closed on arrival.
 * Somebody who ate 300 g could not see how to say so.
 *
 * The fix puts one grams stepper directly under the chips. "One" is the load
 * bearing word: the collapsible had a grams field of its own, and two inputs
 * sharing a name post the field twice.
 *
 * WHY THE LAST TEST COMPARES POSITIONS. The fine-tune content is mounted with
 * Radix `forceMount` so its inputs always submit while collapsed, so its
 * fields DO appear in static markup and "the macro field is absent" could
 * never be asserted. What is assertable is ORDER: the grams field renders
 * before the fine-tune trigger, which is what "in the open, not inside the
 * collapsible" means on this screen.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';

import { ConfirmDraftForm } from '../../app/routes/scan';
import type { PlateIdentification } from '../../app/services/vision/types';

/** One transcribed nutrition panel: the exact case the chips could not cover. */
const LABEL_IDENTIFICATION: PlateIdentification = {
  unreadable: false,
  foods: [
    {
      name: 'Test crispbread',
      estimatedGrams: 100,
      confidence: 'high',
      macroSource: 'label',
      brand: 'Test',
      macrosPer100g: { carbs: 60, fiber: 15, protein: 10, fat: 2, kcal: 350 },
    },
  ],
};

function renderLabelReview(): string {
  const element = createElement(ConfirmDraftForm, {
    intakeSource: 'photo',
    identification: LABEL_IDENTIFICATION,
    modelId: 'test-model',
    lastResult: undefined,
    logDate: null,
    logDateLabel: null,
    photoFile: null,
    userId: 0,
    defaultMealType: 'lunch',
    typedText: null,
  });
  const router = createMemoryRouter([{ path: '/scan', element: withI18n(element) }], { initialEntries: ['/scan'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** Every occurrence of one exact attribute, so a duplicate field is countable. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    count += 1;
    from = haystack.indexOf(needle, from + needle.length);
  }
  return count;
}

/**
 * Throws unless the markup carries a button with this aria-label. Written as
 * a helper so the control test below can feed it markup with the label cut
 * out and prove the assertion is able to fail.
 */
function assertLabelledButton(markup: string, label: string): void {
  assert.match(
    markup,
    new RegExp(`<button[^>]*aria-label="${label}"`),
    `no button labelled "${label}" in the rendered review`,
  );
}

const GRAMS_NAME = 'name="items[0].estimatedGrams"';

/** Throws unless the grams name is posted exactly once by this markup. */
function assertOneGramsField(markup: string): void {
  assert.equal(countOccurrences(markup, GRAMS_NAME), 1, 'the grams field is posted a number of times other than once');
}

/**
 * Throws unless the grams field renders ahead of the fine-tune disclosure and
 * its macro fields, and unless all three are actually on the screen.
 */
function assertGramsAheadOfFineTune(markup: string): void {
  const gramsAt = markup.indexOf(GRAMS_NAME);
  const fineTuneAt = markup.indexOf('Fine-tune');
  const macroAt = markup.indexOf('name="items[0].macros.fat"');

  assert.notEqual(gramsAt, -1, 'the grams field is gone from the review card');
  assert.notEqual(fineTuneAt, -1, 'the fine-tune disclosure is gone');
  assert.notEqual(macroAt, -1, 'the fine-tune macro fields are gone');
  assert.ok(gramsAt < fineTuneAt, 'the grams field moved below the fine-tune disclosure');
  assert.ok(gramsAt < macroAt, 'the grams field moved in among the fine-tune macro fields');
}

describe('the scan review card carries exactly one grams field', () => {
  it('posts the grams name once, so the field is not submitted twice', () => {
    assertOneGramsField(renderLabelReview());
  });

  it('CONTROL: the same assertion fails on markup carrying a second grams field', () => {
    const html = renderLabelReview();
    const duplicated = html.replace(GRAMS_NAME, `${GRAMS_NAME} data-copy="1" ${GRAMS_NAME}`);
    assert.throws(() => assertOneGramsField(duplicated));
  });

  it('labels it with the shipped grams wording', () => {
    assert.match(renderLabelReview(), /<label[^>]*>Grams<\/label>/);
  });
});

describe('the grams field is stepped by two labelled buttons', () => {
  it('offers a decrease and an increase button', () => {
    const html = renderLabelReview();
    assertLabelledButton(html, 'Decrease grams');
    assertLabelledButton(html, 'Increase grams');
  });

  it('CONTROL: the same assertion fails on markup with the label removed', () => {
    const stripped = renderLabelReview().replaceAll('aria-label="Increase grams"', 'aria-label="something else"');
    assert.throws(() => assertLabelledButton(stripped, 'Increase grams'));
  });
});

describe('the grams field is in the open, not behind the fine-tune disclosure', () => {
  it('renders before the fine-tune trigger and before the macro fields', () => {
    assertGramsAheadOfFineTune(renderLabelReview());
  });

  it('CONTROL: the same assertion fails on markup with the grams field moved down', () => {
    // The grams field pushed past everything else, which is where it sat
    // before this change: inside the collapsible, after the macro grid.
    const moved = `${renderLabelReview().replace(GRAMS_NAME, 'name="moved-away"')}<input ${GRAMS_NAME} />`;
    assert.throws(() => assertGramsAheadOfFineTune(moved));
  });
});
