/**
 * Unit tests for `buildOfflineLogInput` (`app/lib/local-store/add-offline-
 * input`) — the offline `/add` form → outbox-enqueue-input translation. Uses
 * the standard `FormData` Web API (global under Node), no DOM required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildOfflineLogInput } from '../../app/lib/local-store/add-offline-input';

/** A "log to today" submit — the DOM form renders no `date` hidden input for this case. */
function todaySubmitFormData(): FormData {
  const formData = new FormData();
  formData.set('_intent', 'log');
  formData.set('name', 'Egg');
  formData.set('quantityGrams', '50');
  formData.set('carbs', '1.1');
  formData.set('protein', '6.3');
  return formData;
}

describe('buildOfflineLogInput', () => {
  it('always writes dayKey into payload.date, even when the form has no date field', () => {
    const input = buildOfflineLogInput(todaySubmitFormData(), '2026-07-14');

    // The critical regression: a plain "log to today" offline write must
    // carry an explicit date so a flush after midnight doesn't stamp it with
    // the flush instant (server defaultNow()) and land on the wrong day.
    assert.equal(input.payload.date, '2026-07-14');
  });

  it('overwrites an existing payload.date (from a back-dated form) with dayKey — same value, idempotent', () => {
    const formData = todaySubmitFormData();
    formData.set('date', '2026-07-10');

    const input = buildOfflineLogInput(formData, '2026-07-10');

    assert.equal(input.payload.date, '2026-07-10');
  });

  it('sets dayKey on the record independent of the payload', () => {
    const input = buildOfflineLogInput(todaySubmitFormData(), '2026-07-14');
    assert.equal(input.dayKey, '2026-07-14');
  });

  it('generates a fresh clientId each call and mirrors it into the payload', () => {
    const a = buildOfflineLogInput(todaySubmitFormData(), '2026-07-14');
    const b = buildOfflineLogInput(todaySubmitFormData(), '2026-07-14');

    assert.notEqual(a.clientId, b.clientId);
    assert.equal(a.payload.clientId, a.clientId);
  });

  it('derives intent from the _intent field, defaulting to "log"', () => {
    const manual = new FormData();
    manual.set('_intent', 'manual');
    manual.set('name', 'Toast');
    manual.set('quantityGrams', '40');
    assert.equal(buildOfflineLogInput(manual, '2026-07-14').intent, 'manual');

    const log = todaySubmitFormData();
    assert.equal(buildOfflineLogInput(log, '2026-07-14').intent, 'log');
  });

  it('builds a per-serving display snapshot scaled from the per-100g form fields', () => {
    const input = buildOfflineLogInput(todaySubmitFormData(), '2026-07-14');

    assert.equal(input.display.name, 'Egg');
    assert.equal(input.display.quantityGrams, 50);
    // 1.1 g/100g carbs at 50g -> 0.55g
    assert.equal(input.display.macros.carbs, 0.55);
    assert.equal(input.display.macros.protein, 3.15);
    assert.equal(input.display.macros.fiber, null);
  });

  it('falls back to 0 grams when quantityGrams is missing/invalid (never NaN)', () => {
    const formData = new FormData();
    formData.set('_intent', 'log');
    formData.set('name', 'Mystery');

    const input = buildOfflineLogInput(formData, '2026-07-14');

    assert.equal(input.display.quantityGrams, 0);
    assert.equal(Number.isNaN(input.display.macros.carbs), false);
  });

  it('maps mealType blank to null and a real value through unchanged', () => {
    const blank = buildOfflineLogInput(todaySubmitFormData(), '2026-07-14');
    assert.equal(blank.display.mealType, null);

    const withMeal = todaySubmitFormData();
    withMeal.set('mealType', 'lunch');
    assert.equal(buildOfflineLogInput(withMeal, '2026-07-14').display.mealType, 'lunch');
  });
});
