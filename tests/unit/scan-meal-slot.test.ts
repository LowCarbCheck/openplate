/**
 * Unit tests for the meal slot a PHOTOGRAPHED food lands in (M202).
 *
 * The defect this pins: `/add` has always let a person pick a meal, while the
 * scan confirm step wrote a hardcoded `mealType: null` for every food it
 * logged. A photographed lunch therefore fell out of the diary's lunch group
 * forever, with no control anywhere on the screen to put it back.
 *
 * A `mealType` that reaches zero call sites passes every gate while every
 * screen is wrong, so these tests follow the WHOLE chain and never stop at
 * "the select rendered":
 *
 *   1. `mealTypeForCapture` picks the slot from when the photo was taken.
 *   2. The confirm step emits that slot in a real hidden `mealType` input.
 *   3. The real confirm schema parses that posted value.
 *   4. `buildConfirmedBatch` puts it on EVERY written entry of the batch.
 *
 * Steps 2 to 4 are chained through the values the previous step produced, the
 * same way `authoritative-net-carbs-wiring.test.ts` chains its hidden field, so
 * deleting the input, the schema field or the builder argument breaks the run.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';

import { withI18n } from './trends-i18n-harness';

import { mealTypeForCapture, resolveCaptureInstant } from '../../app/lib/scan-capture-time';
import {
  ConfirmDraftForm,
  ConfirmDraftSchema,
  LabelConfirmForm,
  LabelConfirmSchema,
  buildConfirmedBatch,
} from '../../app/routes/scan';
import { buildLabelScanEntry } from '../../app/lib/label-scan-confirm';
import { MEAL_LABEL_KEYS, MEAL_TYPES } from '../../app/lib/meal-choice';
import type { PlateIdentification } from '../../app/services/vision/types';
import type { MealType } from '../../types/enums';

/** A fixed "now" used wherever the current clock is the fallback answer. */
const NOW_MS = Date.parse('2026-09-08T20:30:00Z');
/** One hour and one day in milliseconds, for the fallback windows below. */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A UTC instant at a given wall-clock time on a fixed day. */
function atUtc(hhmm: string): number {
  return Date.parse(`2026-09-08T${hhmm}:00Z`);
}

describe('mealTypeForCapture, the slot comes from WHEN THE PHOTO WAS TAKEN', () => {
  const cases: readonly (readonly [string, MealType])[] = [
    ['04:00', 'breakfast'],
    ['07:30', 'breakfast'],
    ['10:59', 'breakfast'],
    ['11:00', 'lunch'],
    ['14:59', 'lunch'],
    ['15:00', 'snack'],
    ['16:59', 'snack'],
    ['17:00', 'dinner'],
    ['21:59', 'dinner'],
    ['22:00', 'snack'],
    ['03:59', 'snack'],
  ];

  for (const [time, expected] of cases) {
    it(`a photo taken at ${time} lands in ${expected}`, () => {
      const capturedAtMs = atUtc(time);
      assert.equal(
        mealTypeForCapture({
          fileLastModifiedMs: capturedAtMs,
          // Confirming hours later must not move the slot: that is the whole point.
          nowMs: capturedAtMs + 3 * HOUR_MS,
          timezone: 'UTC',
        }),
        expected,
      );
    });
  }

  it('reads the capture instant in the DEVICE zone, not UTC', () => {
    // 23:30 UTC is 00:30 the next day in Berlin (CEST, +02:00), a late-night snack.
    assert.equal(
      mealTypeForCapture({ fileLastModifiedMs: atUtc('23:30'), nowMs: NOW_MS, timezone: 'Europe/Berlin' }),
      'snack',
    );
    // 10:30 UTC is 12:30 in Berlin, lunch there, breakfast if the zone were ignored.
    assert.equal(
      mealTypeForCapture({ fileLastModifiedMs: atUtc('10:30'), nowMs: NOW_MS, timezone: 'Europe/Berlin' }),
      'lunch',
    );
  });
});

describe('resolveCaptureInstant, an unusable file timestamp falls back to the clock', () => {
  it('takes a sane file timestamp', () => {
    const capturedAtMs = NOW_MS - HOUR_MS;
    assert.deepEqual(resolveCaptureInstant({ fileLastModifiedMs: capturedAtMs, nowMs: NOW_MS }), {
      atMs: capturedAtMs,
      source: 'file',
    });
  });

  it('falls back when the browser reported no timestamp at all', () => {
    assert.deepEqual(resolveCaptureInstant({ fileLastModifiedMs: null, nowMs: NOW_MS }), {
      atMs: NOW_MS,
      source: 'clock',
    });
  });

  it('falls back on the epoch zero some browsers report for a synthesised file', () => {
    assert.equal(resolveCaptureInstant({ fileLastModifiedMs: 0, nowMs: NOW_MS }).source, 'clock');
  });

  it('falls back on a non-finite timestamp', () => {
    assert.equal(resolveCaptureInstant({ fileLastModifiedMs: Number.NaN, nowMs: NOW_MS }).source, 'clock');
  });

  it('falls back on a timestamp from the future, a camera clock set wrong', () => {
    assert.equal(resolveCaptureInstant({ fileLastModifiedMs: NOW_MS + HOUR_MS, nowMs: NOW_MS }).source, 'clock');
  });

  it('tolerates a few minutes of clock skew rather than calling it the future', () => {
    const skewed = NOW_MS + 60 * 1000;
    assert.deepEqual(resolveCaptureInstant({ fileLastModifiedMs: skewed, nowMs: NOW_MS }), {
      atMs: skewed,
      source: 'file',
    });
  });

  it('falls back on an absurdly old timestamp, that photo is not this meal', () => {
    assert.equal(resolveCaptureInstant({ fileLastModifiedMs: NOW_MS - 40 * DAY_MS, nowMs: NOW_MS }).source, 'clock');
  });

  it('still takes a timestamp from earlier the same day', () => {
    assert.equal(resolveCaptureInstant({ fileLastModifiedMs: NOW_MS - 8 * HOUR_MS, nowMs: NOW_MS }).source, 'file');
  });

  it('a fallback answers with the confirming clock, so the slot is still a real one', () => {
    assert.equal(mealTypeForCapture({ fileLastModifiedMs: null, nowMs: atUtc('12:15'), timezone: 'UTC' }), 'lunch');
  });
});

/** Two foods on one plate: the batch case the owner's complaint is really about. */
const AI_IDENTIFICATION: PlateIdentification = {
  foods: [
    { name: 'Grilled salmon', estimatedGrams: 150, confidence: 'high', macrosPer100g: { carbs: 0, protein: 20 } },
    { name: 'Green salad', estimatedGrams: 80, confidence: 'medium', macrosPer100g: { carbs: 3, protein: 1 } },
  ],
};

/** The hidden input the confirm step emits to carry the chosen slot into the write. */
const MEAL_FIELD = /<input[^>]*name="mealType"[^>]*value="([^"]*)"[^>]*>/;

function emittedMealType(html: string): string {
  const match = MEAL_FIELD.exec(html);
  assert.ok(match, `the confirm step emitted no mealType input at all:\n${html.slice(0, 600)}`);
  return match[1] ?? '';
}

function renderUnderRouter(element: ReturnType<typeof createElement>): string {
  const router = createMemoryRouter([{ path: '/scan', element: withI18n(element) }], { initialEntries: ['/scan'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function renderPlateConfirm(defaultMealType: MealType | null): string {
  return renderUnderRouter(
    createElement(ConfirmDraftForm, {
      // The intake this draft arrived by. A photograph here: these tests are
      // about what the plate path writes, not about which way in produced it.
      intakeSource: 'photo',
      identification: AI_IDENTIFICATION,
      modelId: 'test-model',
      lastResult: undefined,
      logDate: null,
      logDateLabel: null,
      photoFile: null,
      userId: 0,
      defaultMealType,
    }),
  );
}

describe('the plate confirm step posts the preselected slot', () => {
  it('emits the capture-time slot in a real hidden field', () => {
    assert.equal(emittedMealType(renderPlateConfirm('dinner')), 'dinner');
  });

  it('emits an empty value when no slot could be preselected, "no meal", never a guess', () => {
    assert.equal(emittedMealType(renderPlateConfirm(null)), '');
  });

  it('labels the select with the SAME shipped English /add\u2019s portion step uses, bound to the control', () => {
    const html = renderPlateConfirm('lunch');
    // The dropdown ROWS cannot be asserted here: a Radix select renders its
    // content into a portal that a static render never produces. What is
    // renderable is the label, the binding, and the posted field \u2014 and the
    // rows come from one shared catalog, pinned below without a render.
    assert.match(html, /<label[^>]*for="confirm-plate-draft-mealType"[^>]*>Meal<\/label>/);
  });

  it('draws its rows from the one shared catalog \u2014 the scan never invents a meal vocabulary', () => {
    // Non-rendered, and the real reason the select cannot drift from /add's:
    // both read these keys, and the confirm schema accepts exactly these slots.
    assert.deepEqual([...MEAL_TYPES], ['breakfast', 'lunch', 'dinner', 'snack']);
    for (const meal of MEAL_TYPES) assert.equal(MEAL_LABEL_KEYS[meal], `add.meal.${meal}`);
    assert.equal(MEAL_LABEL_KEYS.none, 'add.meal.none');
    for (const meal of MEAL_TYPES) {
      const formData = new FormData();
      formData.set('mealType', meal);
      formData.set('items[0].include', 'on');
      formData.set('items[0].name', 'One food');
      formData.set('items[0].estimatedGrams', '100');
      formData.set('items[0].macros.carbs', '1');
      const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
      assert.equal(submission.status, 'success', `the confirm schema refused the ${meal} slot`);
    }
  });
});

describe('a confirmed plate scan writes the chosen slot onto EVERY entry in the batch', () => {
  /** The real submission a rendered confirm step produces, parsed by the real schema. */
  function submitPlate(defaultMealType: MealType | null) {
    const posted = emittedMealType(renderPlateConfirm(defaultMealType));
    const formData = new FormData();
    formData.set('mealType', posted);
    AI_IDENTIFICATION.foods.forEach((food, index) => {
      formData.set(`items[${index}].include`, 'on');
      formData.set(`items[${index}].name`, food.name);
      formData.set(`items[${index}].estimatedGrams`, String(food.estimatedGrams));
      formData.set(`items[${index}].macros.carbs`, String(food.macrosPer100g?.carbs ?? 0));
    });
    const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
    assert.equal(submission.status, 'success', 'ConfirmDraftSchema rejected the confirm-step submission');
    if (submission.status !== 'success') throw new Error('unreachable');
    return submission.value;
  }

  /** The write payload, built exactly as `handleConfirm` builds it. */
  function writtenBatch(defaultMealType: MealType | null) {
    const value = submitPlate(defaultMealType);
    let counter = 0;
    return buildConfirmedBatch({
      items: value.items,
      mealType: value.mealType ?? null,
      loggedAtMs: NOW_MS,
      dayKey: '2026-09-08',
      createdAtMs: NOW_MS,
      logBatchId: 'batch-1',
      newId: () => `id-${(counter += 1)}`,
    });
  }

  it('is one plate at one sitting: both foods carry the same slot', () => {
    const written = writtenBatch('dinner');
    assert.equal(written.length, 2);
    for (const { entry } of written) assert.equal(entry.mealType, 'dinner');
  });

  it('writes null when the person chose "no meal"', () => {
    for (const { entry } of writtenBatch(null)) assert.equal(entry.mealType, null);
  });

  it('still writes the food rows the batch always wrote', () => {
    const written = writtenBatch('lunch');
    assert.deepEqual(
      written.map(({ food }) => food.name),
      ['Grilled salmon', 'Green salad'],
    );
    for (const { entry, food } of written) assert.equal(entry.foodId, food.id);
  });
});

describe('the label scan gets the same treatment, it writes by the same route', () => {
  it('emits the preselected slot in its own hidden field', () => {
    const html = renderUnderRouter(
      createElement(LabelConfirmForm, {
        reading: {
          unreadable: false,
          productName: 'Crispbread',
          brand: 'Test',
          servingSize: { asPrinted: '1 slice (20 g)', grams: 20 },
          macrosPer100g: { carbs: 60, fiber: 15 },
        },
        modelId: 'test-model',
        lastResult: undefined,
        logDate: null,
        logDateLabel: null,
        defaultMealType: 'breakfast',
      }),
    );
    assert.equal(emittedMealType(html), 'breakfast');
  });

  it('parses the posted slot and puts it on the written entry', () => {
    const formData = new FormData();
    formData.set('name', 'Crispbread');
    formData.set('quantityGrams', '20');
    formData.set('macros.carbs', '60');
    formData.set('mealType', 'breakfast');
    const submission = parseWithZod(formData, { schema: LabelConfirmSchema });
    assert.equal(submission.status, 'success');
    if (submission.status !== 'success') throw new Error('unreachable');

    const entry = buildLabelScanEntry({
      name: submission.value.name,
      quantityGrams: submission.value.quantityGrams,
      macrosPer100g: { carbs: 60, fiber: null, sugars: null, polyols: null, protein: null, fat: null, kcal: null },
      carbBasis: null,
      mealType: submission.value.mealType ?? null,
      foodId: 'food-1',
      id: 'entry-1',
      loggedAtMs: NOW_MS,
      dayKey: '2026-09-08',
      createdAtMs: NOW_MS,
    });
    assert.equal(entry.mealType, 'breakfast');
  });
});
