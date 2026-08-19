/**
 * Unit tests for `#app/lib/log-edit` — detecting hand-edited macros and the
 * provenance-flag demotion that follows. No React/DB/network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeEditPatch, macrosDiffer, resolveEditedProvenance } from '../../app/lib/log-edit';
import type { Macros } from '../../app/lib/macros';

function makeMacros(overrides: Partial<Macros> = {}): Macros {
  return {
    carbs: 10,
    fiber: 2,
    sugars: 5,
    polyols: 1,
    protein: 8,
    fat: 4,
    kcal: 120,
    ...overrides,
  };
}

describe('macrosDiffer', () => {
  it('is false for identical macro sets', () => {
    assert.strictEqual(macrosDiffer(makeMacros(), makeMacros()), false);
  });

  it('is true when any single field changed', () => {
    assert.strictEqual(macrosDiffer(makeMacros(), makeMacros({ carbs: 12 })), true);
    assert.strictEqual(macrosDiffer(makeMacros(), makeMacros({ protein: 9 })), true);
  });

  it('treats null vs number as a change in either direction', () => {
    assert.strictEqual(macrosDiffer(makeMacros({ fiber: null }), makeMacros({ fiber: 2 })), true);
    assert.strictEqual(macrosDiffer(makeMacros({ fiber: 2 }), makeMacros({ fiber: null })), true);
  });

  it('is false when both fields are null (unknown stays unknown)', () => {
    assert.strictEqual(macrosDiffer(makeMacros({ sugars: null }), makeMacros({ sugars: null })), false);
  });

  it('ignores sub-one-decimal noise from reconstruction rounding', () => {
    // A reconstructed basis of 33.333… prefills as "33.3"; leaving it untouched
    // must not read as a change.
    assert.strictEqual(macrosDiffer(makeMacros({ carbs: 33.3333 }), makeMacros({ carbs: 33.3 })), false);
  });

  it('flags a real one-decimal edit', () => {
    assert.strictEqual(macrosDiffer(makeMacros({ carbs: 33.3 }), makeMacros({ carbs: 33.5 })), true);
  });
});

describe('resolveEditedProvenance', () => {
  it('demotes an AI-estimated entry to manual when macros changed', () => {
    assert.deepStrictEqual(
      resolveEditedProvenance({ macrosChanged: true, current: { aiEstimated: true, curatedSource: null } }),
      { aiEstimated: false, curatedSource: null },
    );
  });

  it('clears a curated source when macros changed', () => {
    assert.deepStrictEqual(
      resolveEditedProvenance({
        macrosChanged: true,
        current: { aiEstimated: false, curatedSource: 'lowcarbcheck:chicken-breast' },
      }),
      { aiEstimated: false, curatedSource: null },
    );
  });

  it('keeps AI-estimated provenance when nothing changed', () => {
    assert.deepStrictEqual(
      resolveEditedProvenance({ macrosChanged: false, current: { aiEstimated: true, curatedSource: null } }),
      { aiEstimated: true, curatedSource: null },
    );
  });

  it('keeps a curated source when nothing changed', () => {
    assert.deepStrictEqual(
      resolveEditedProvenance({
        macrosChanged: false,
        current: { aiEstimated: false, curatedSource: 'lowcarbcheck:apple' },
      }),
      { aiEstimated: false, curatedSource: 'lowcarbcheck:apple' },
    );
  });
});

describe('computeEditPatch', () => {
  // Mirrors the reported repro: a curated 100g chicken-breast entry, portion
  // bumped to 1.5x (150g) via a chip, fine-tune left untouched. Regression
  // guard for the bug where a collapsed (non-forceMounted) fine-tune section
  // submitted no macro fields, which read as an all-fields-cleared "edit" and
  // wiped both the snapshot and provenance.
  const curatedChickenBreastPer100g: Macros = {
    carbs: 1.3,
    fiber: null,
    sugars: null,
    polyols: null,
    protein: 20,
    fat: 1.6,
    kcal: 102,
  };

  it('portion-only save: rescales the snapshot and preserves curated provenance', () => {
    const result = computeEditPatch({
      grams: 150,
      // Fine-tune untouched — the form resubmits the exact prefilled basis.
      editedPer100g: curatedChickenBreastPer100g,
      originalBasis: curatedChickenBreastPer100g,
      currentProvenance: { aiEstimated: false, curatedSource: 'lowcarbcheck:chicken-breast' },
    });

    assert.strictEqual(result.macrosChanged, false);
    assert.deepStrictEqual(result.provenance, { aiEstimated: false, curatedSource: 'lowcarbcheck:chicken-breast' });
    assert.deepStrictEqual(result.snapshot, {
      carbs: 1.95,
      fiber: null,
      sugars: null,
      polyols: null,
      protein: 30,
      fat: 2.4,
      kcal: 153,
    });
  });

  it('portion-only save: preserves AI-estimated provenance the same way', () => {
    const result = computeEditPatch({
      grams: 50,
      editedPer100g: curatedChickenBreastPer100g,
      originalBasis: curatedChickenBreastPer100g,
      currentProvenance: { aiEstimated: true, curatedSource: null },
    });

    assert.strictEqual(result.macrosChanged, false);
    assert.deepStrictEqual(result.provenance, { aiEstimated: true, curatedSource: null });
  });

  it('hand-edit: a changed per-100g value clears provenance even at the same portion', () => {
    const edited: Macros = { ...curatedChickenBreastPer100g, protein: 22 };
    const result = computeEditPatch({
      grams: 100,
      editedPer100g: edited,
      originalBasis: curatedChickenBreastPer100g,
      currentProvenance: { aiEstimated: false, curatedSource: 'lowcarbcheck:chicken-breast' },
    });

    assert.strictEqual(result.macrosChanged, true);
    assert.deepStrictEqual(result.provenance, { aiEstimated: false, curatedSource: null });
    assert.strictEqual(result.snapshot.protein, 22);
  });

  it('hand-edit: clearing a previously-known field to unknown (null) still rescales other fields', () => {
    const edited: Macros = { ...curatedChickenBreastPer100g, fat: null };
    const result = computeEditPatch({
      grams: 100,
      editedPer100g: edited,
      originalBasis: curatedChickenBreastPer100g,
      currentProvenance: { aiEstimated: false, curatedSource: 'lowcarbcheck:chicken-breast' },
    });

    assert.strictEqual(result.macrosChanged, true);
    assert.deepStrictEqual(result.provenance, { aiEstimated: false, curatedSource: null });
    assert.strictEqual(result.snapshot.fat, null);
    assert.strictEqual(result.snapshot.protein, 20);
  });
});
