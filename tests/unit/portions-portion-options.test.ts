/**
 * Unit tests for `#app/lib/portions/portion-options` — real portion chip
 * choices ("2 eggs") and selection derivation, the non-photo replacement for
 * the flat ½×/1×/1.5×/2× multiplier chips — plus `portion-form`, the shared
 * hidden-input encoding every flow that carries a chosen portion through a
 * form now uses (the add flow's portion step, the diary's chip re-log, the
 * undo-delete restore).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePortionChoices,
  deriveSelectedPortionQuantity,
  formatPortionLabel,
} from '../../app/lib/portions/portion-options';
import { encodeDisplayPortion, portionField } from '../../app/lib/portions/portion-form';
import type { DisplayPortion } from '../../app/lib/portions/types';

describe('formatPortionLabel', () => {
  it('uses the singular label for quantity 1 and the plural for others', () => {
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 1 }), '1 egg');
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 2 }), '2 eggs');
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 3 }), '3 eggs');
  });

  it('renders the generic "serving" unit in plain English', () => {
    assert.equal(formatPortionLabel({ unit: 'serving', quantity: 1 }), '1 serving');
    assert.equal(formatPortionLabel({ unit: 'serving', quantity: 2 }), '2 servings');
  });

  it('renders half/one-and-a-half quantities as glyphs', () => {
    assert.equal(formatPortionLabel({ unit: 'cup', quantity: 0.5 }), '½ cup');
    assert.equal(formatPortionLabel({ unit: 'cup', quantity: 1.5 }), '1½ cups');
  });
});

describe('derivePortionChoices', () => {
  it('offers the household unit’s own typical quantities (eggs: 1/2/3)', () => {
    const portion: DisplayPortion = { unit: 'egg', quantity: 1, gramsPerUnit: 50 };
    const choices = derivePortionChoices(portion);
    assert.deepStrictEqual(
      choices.map((choice) => choice.quantity),
      [1, 2, 3],
    );
    assert.deepStrictEqual(
      choices.map((choice) => choice.label),
      ['1 egg', '2 eggs', '3 eggs'],
    );
    assert.deepStrictEqual(
      choices.map((choice) => choice.grams),
      [50, 100, 150],
    );
  });

  it('offers ½/1/1½ for a cup-based unit (rice)', () => {
    const portion: DisplayPortion = { unit: 'cup', quantity: 1, gramsPerUnit: 158 };
    const choices = derivePortionChoices(portion);
    assert.deepStrictEqual(
      choices.map((choice) => choice.quantity),
      [0.5, 1, 1.5],
    );
    assert.deepStrictEqual(
      choices.map((choice) => choice.grams),
      [79, 158, 237],
    );
  });

  it('offers 1/2/3 servings for the generic "serving" unit', () => {
    const portion: DisplayPortion = { unit: 'serving', quantity: 1, gramsPerUnit: 150 };
    const choices = derivePortionChoices(portion);
    assert.deepStrictEqual(
      choices.map((choice) => choice.label),
      ['1 serving', '2 servings', '3 servings'],
    );
  });

  it('keeps every gram value rounded to one decimal', () => {
    const portion: DisplayPortion = { unit: 'tablespoon', quantity: 1, gramsPerUnit: 13.333 };
    const choices = derivePortionChoices(portion);
    for (const choice of choices) {
      assert.equal(Math.round(choice.grams * 10) / 10, choice.grams);
    }
  });
});

describe('deriveSelectedPortionQuantity', () => {
  const portion: DisplayPortion = { unit: 'egg', quantity: 1, gramsPerUnit: 50 };
  const choices = derivePortionChoices(portion);

  it('selects the choice whose grams match the current grams', () => {
    assert.equal(deriveSelectedPortionQuantity({ choices, currentGrams: 50 }), 1);
    assert.equal(deriveSelectedPortionQuantity({ choices, currentGrams: 100 }), 2);
    assert.equal(deriveSelectedPortionQuantity({ choices, currentGrams: 150 }), 3);
  });

  it('returns null when a manual grams edit matches no choice — chip selection derives from grams, never duplicated state', () => {
    assert.equal(deriveSelectedPortionQuantity({ choices, currentGrams: 62 }), null);
  });
});

describe('portion form encoding (encodeDisplayPortion / portionField)', () => {
  const portion: DisplayPortion = { unit: 'egg', quantity: 2, gramsPerUnit: 50 };

  it('round-trips a chosen portion through the wire form unchanged', () => {
    const parsed = portionField.safeParse(encodeDisplayPortion(portion));
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.success ? parsed.data : null, portion);
  });

  it('encodes "no portion chosen" as the empty string, which decodes back to undefined', () => {
    for (const none of [null, undefined]) {
      assert.equal(encodeDisplayPortion(none), '');
    }
    const parsed = portionField.safeParse('');
    assert.equal(parsed.success && parsed.data, undefined);
  });

  it('FAILS OPEN on a malformed value — a display nicety must never block a log', () => {
    // Every writer is our own hidden input, so a bad value is an upstream bug,
    // not user input; degrading to "grams only" keeps the person able to track
    // their food. `quantityGrams` is authoritative either way.
    for (const bad of ['not json', '{"unit":"unicorn","quantity":1,"gramsPerUnit":50}', '{"unit":"egg"}', '[]', 42]) {
      const parsed = portionField.safeParse(bad);
      assert.equal(parsed.success, true, `expected ${JSON.stringify(bad)} to degrade, not reject`);
      assert.equal(parsed.success ? parsed.data : 'unreachable', undefined);
    }
  });

  it('degrades a nonsense quantity or grams-per-unit to "no portion" rather than storing it', () => {
    for (const bad of [{ ...portion, quantity: 0 }, { ...portion, gramsPerUnit: -50 }]) {
      const parsed = portionField.safeParse(JSON.stringify(bad));
      assert.equal(parsed.success, true);
      assert.equal(parsed.success ? parsed.data : 'unreachable', undefined);
    }
  });
});
