/**
 * THE REVIEW SCREEN SHOWS WHAT IT READ, for a meal that was typed or spoken.
 *
 * ── The finding (0.20.0, a walk of the text path) ────────────────────────
 *
 * The words appeared on the waiting screen only, behind the busy overlay that
 * blurs it. By the time the food list arrived, the sentence was gone, and the
 * person was asked to check an estimate against a memory of what they had
 * written thirty seconds earlier. The photo path never had this problem: the
 * plate is still in front of them.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 * The real confirm step, rendered through `renderToStaticMarkup` against the
 * shipped English catalog. `ConfirmDraftForm` is presentational enough to take
 * the intake as a prop, which is the only way to reach a text intake at all:
 * the container reads the hand-off slot in an effect, and a static render runs
 * none.
 *
 * THE CONTROL IS THE PHOTO INTAKE. A screen that drew the quote block for
 * everything, or one that drew the label with no sentence under it, passes
 * only the first assertion of each pair.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import { ConfirmDraftForm } from '../../app/routes/scan';

/** The shipped label the waiting screen already used, so both screens say one thing. */
const LABEL = z
  .object({ scan: z.object({ textIntake: z.object({ label: z.string() }) }) })
  .parse(
    JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
  ).scan.textIntake.label;

const TYPED_MEAL = '2 fried eggs and a slice of toast with butter';

const IDENTIFICATION = {
  unreadable: false,
  foods: [
    {
      name: 'Fried egg',
      estimatedGrams: 60,
      confidence: 'high' as const,
      macroSource: 'estimated' as const,
      macrosPer100g: { kcal: 196, protein: 13.6, fat: 15, carbs: 0.8 },
    },
  ],
};

/** The confirm step as one of the three ways in produced it. */
function renderReview({ typedText }: { typedText: string | null }): string {
  const element = createElement(ConfirmDraftForm, {
    identification: IDENTIFICATION,
    modelId: 'test-model',
    logDate: null,
    logDateLabel: null,
    photoFile: null,
    userId: 0,
    defaultMealType: null,
    intakeSource: typedText === null ? ('photo' as const) : ('text' as const),
    typedText,
  });
  const router = createMemoryRouter([{ path: '/scan', element: withI18n(element) }], { initialEntries: ['/scan'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('a typed meal', () => {
  it('carries the sentence into the review screen, under the label the waiting screen used', () => {
    const markup = renderReview({ typedText: TYPED_MEAL });
    assert.ok(markup.includes(TYPED_MEAL), 'the words are gone from the screen that checks them');
    assert.ok(markup.includes(LABEL), 'the quote is unlabelled, so it reads as part of the estimate');
    assert.match(markup, /<blockquote[^>]*>[^<]*2 fried eggs/, 'the sentence is not a quote block');
  });

  it('puts it above the food list, where it can be read before the numbers', () => {
    const markup = renderReview({ typedText: TYPED_MEAL });
    const quoteAt = markup.indexOf(TYPED_MEAL);
    const firstFoodAt = markup.indexOf('Fried egg');
    assert.ok(quoteAt !== -1 && firstFoodAt !== -1, 'the fixture rendered neither the quote nor the food');
    assert.ok(quoteAt < firstFoodAt, 'the sentence renders below the estimate it is there to be checked against');
  });
});

describe('a photo intake', () => {
  it('shows no quote block at all, because the plate was the evidence', () => {
    const markup = renderReview({ typedText: null });
    assert.ok(!markup.includes(LABEL), 'a photograph is captioned as something the person entered');
    assert.doesNotMatch(markup, /<blockquote/, 'an empty quote block rendered for a photograph');
    // The control that makes the pair mean something: the same render still
    // carries the food it identified.
    assert.ok(markup.includes('Fried egg'), 'the fixture rendered no draft at all');
  });
});
