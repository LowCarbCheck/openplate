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

import deCommon from '../../app/i18n/locales/de/common.json';
import enCommon from '../../app/i18n/locales/en/common.json';

import {
  derivePortionChoices,
  deriveSelectedPortionQuantity,
  formatPortionLabel,
} from '../../app/lib/portions/portion-options';
import { encodeDisplayPortion, portionField } from '../../app/lib/portions/portion-form';
import type { DisplayPortion, PortionUnitId } from '../../app/lib/portions/types';

/**
 * The expected label straight out of a shipped bundle, so the German cases
 * below assert the WIRING (the bundle reaches the chip, with the right plural
 * form and the right count) rather than a hand-copied German literal. The
 * German copy is machine-produced by wordsmith and may be re-run; a pinned
 * literal here would turn a legitimate re-translation into a red test.
 */
function bundleLabel(language: 'en' | 'de', key: string, count: string): string {
  const templates: Record<string, string> = language === 'de' ? deCommon.portions.unit : enCommon.portions.unit;
  const template = templates[key];
  assert.ok(template, `missing bundle key portions.unit.${key}`);
  return template.replace('{{count}}', count);
}

describe('formatPortionLabel', () => {
  it('uses the singular label for quantity 1 and the plural for others', () => {
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 1, language: 'en' }), '1 egg');
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 2, language: 'en' }), '2 eggs');
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 3, language: 'en' }), '3 eggs');
  });

  it('renders the generic "serving" unit in plain English', () => {
    assert.equal(formatPortionLabel({ unit: 'serving', quantity: 1, language: 'en' }), '1 serving');
    assert.equal(formatPortionLabel({ unit: 'serving', quantity: 2, language: 'en' }), '2 servings');
  });

  it('renders half/one-and-a-half quantities as glyphs', () => {
    assert.equal(formatPortionLabel({ unit: 'cup', quantity: 0.5, language: 'en' }), '½ cup');
    assert.equal(formatPortionLabel({ unit: 'cup', quantity: 1.5, language: 'en' }), '1½ cups');
  });

  it('reads the noun out of the ACTIVE language bundle — a German chip never says "serving"', () => {
    assert.equal(
      formatPortionLabel({ unit: 'serving', quantity: 1, language: 'de' }),
      bundleLabel('de', 'serving_one', '1'),
    );
    assert.equal(
      formatPortionLabel({ unit: 'serving', quantity: 2, language: 'de' }),
      bundleLabel('de', 'serving_other', '2'),
    );
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 2, language: 'de' }), bundleLabel('de', 'egg_other', '2'));
    // The defect this replaced: the label was hardcoded English, so the German
    // portion sheet read "1 serving".
    assert.notEqual(formatPortionLabel({ unit: 'serving', quantity: 1, language: 'de' }), '1 serving');
  });

  it('agrees with the English bundle too, so neither language is the special case', () => {
    assert.equal(
      formatPortionLabel({ unit: 'serving', quantity: 1, language: 'en' }),
      bundleLabel('en', 'serving_one', '1'),
    );
    assert.equal(
      formatPortionLabel({ unit: 'apple', quantity: 2, language: 'en' }),
      bundleLabel('en', 'apple_other', '2'),
    );
  });

  it('every unit the app can resolve has a translation in BOTH bundles', () => {
    const units: PortionUnitId[] = ['serving', 'egg', 'slice', 'cup', 'tablespoon', 'banana', 'apple'];
    for (const unit of units) {
      for (const language of ['en', 'de'] as const) {
        for (const quantity of [1, 2]) {
          // `bundleLabel` asserts the key EXISTS; the equality then proves the
          // helper actually read it rather than falling back to the raw unit id.
          const label = formatPortionLabel({ unit, quantity, language });
          assert.equal(label, bundleLabel(language, `${unit}_${quantity === 1 ? 'one' : 'other'}`, String(quantity)));
        }
      }
    }
  });

  it('formats a stray decimal quantity in the active locale (German writes 2,5)', () => {
    assert.ok(formatPortionLabel({ unit: 'cup', quantity: 2.5, language: 'en' }).startsWith('2.5'));
    assert.ok(formatPortionLabel({ unit: 'cup', quantity: 2.5, language: 'de' }).startsWith('2,5'));
  });

  it('degrades an unknown language to English rather than throwing', () => {
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 2, language: 'fr' }), '2 eggs');
    assert.equal(formatPortionLabel({ unit: 'egg', quantity: 2, language: null }), '2 eggs');
  });
});

describe('derivePortionChoices', () => {
  it('offers the household unit’s own typical quantities (eggs: 1/2/3)', () => {
    const portion: DisplayPortion = { unit: 'egg', quantity: 1, gramsPerUnit: 50 };
    const choices = derivePortionChoices(portion, 'en');
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
    const choices = derivePortionChoices(portion, 'en');
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
    const choices = derivePortionChoices(portion, 'en');
    assert.deepStrictEqual(
      choices.map((choice) => choice.label),
      ['1 serving', '2 servings', '3 servings'],
    );
  });

  it('labels the whole chip row in the requested language', () => {
    const portion: DisplayPortion = { unit: 'serving', quantity: 1, gramsPerUnit: 150 };
    assert.deepStrictEqual(
      derivePortionChoices(portion, 'de').map((choice) => choice.label),
      [1, 2, 3].map((quantity) => bundleLabel('de', `serving_${quantity === 1 ? 'one' : 'other'}`, String(quantity))),
    );
  });

  it('keeps every gram value rounded to one decimal', () => {
    const portion: DisplayPortion = { unit: 'tablespoon', quantity: 1, gramsPerUnit: 13.333 };
    const choices = derivePortionChoices(portion, 'en');
    for (const choice of choices) {
      assert.equal(Math.round(choice.grams * 10) / 10, choice.grams);
    }
  });
});

describe('deriveSelectedPortionQuantity', () => {
  const portion: DisplayPortion = { unit: 'egg', quantity: 1, gramsPerUnit: 50 };
  const choices = derivePortionChoices(portion, 'en');

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
