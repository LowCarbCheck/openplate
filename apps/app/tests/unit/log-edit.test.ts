/**
 * Unit tests for `#app/lib/log-edit` — detecting hand-edited macros and the
 * provenance-flag demotion that follows. No React/DB/network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeEditPatch, macrosDiffer, resolveEditedBasis, resolveEditedProvenance } from '../../app/lib/log-edit';
import { formatMacroNumber, formatMacroNumberIn } from '../../app/lib/format-macro-number';
import { computeMacroPreview } from '../../app/lib/portion-preview';
import { scaleMacrosPer100gToServing } from '../../app/lib/macros';
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

/**
 * Release-QA defect A: one entry, one nutrient, two printed values.
 *
 * "Apple raw", logged at 182 g (USDA's medium whole apple — see
 * `#app/lib/portions/household-units`). The receipt read "Eiweiss 0,8 g"; the
 * edit form under `?edit=1` read "Eiweiss 0,7 g". Fat and calories agreed,
 * which is the tell: only protein's per-100 g figure sits where the first
 * decimal ROUNDS AWAY enough mass to move the scaled result a tenth.
 *
 * The two paths:
 *  - receipt  — the stored per-serving snapshot (0.43 x 1.82), rounded once at
 *    render: 0.7826 -> "0.8".
 *  - edit form — the per-100 g basis is written into a number input as
 *    `formatMacroNumber(0.43)` = "0.4", parsed back, and only THEN scaled:
 *    0.4 x 1.82 = 0.728 -> "0.7". Two roundings, the first one invisible.
 *
 * `resolveEditedBasis` is the fix: an untouched form (which `macrosDiffer`
 * already calls unchanged) computes from the original unrounded basis.
 */
/** Narrows a macro field the apple fixture always populates, failing loudly if it ever doesn't. */
function known(value: number | null): number {
  assert.notStrictEqual(value, null, 'the apple fixture populates every field this test reads');
  if (value === null) throw new Error('unreachable');
  return value;
}

/** One number input's round trip: the basis written out by the prefill, then parsed back on submit. */
function roundTrip(value: number | null): number | null {
  return value === null ? null : Number(formatMacroNumber(value));
}

describe('defect A — the edit form and the receipt agree on protein', () => {
  const APPLE_GRAMS = 182;


  /** "Apple raw" per 100 g. */
  const applePer100g: Macros = {
    carbs: 14.4,
    fiber: 2.4,
    sugars: 10.4,
    polyols: null,
    protein: 0.43,
    fat: 0.49,
    kcal: 58,
  };

  /** What the receipt prints: the stored snapshot, rounded exactly once. */
  function receiptValue(key: 'protein' | 'fat' | 'kcal'): string {
    const snapshot = scaleMacrosPer100gToServing(applePer100g, APPLE_GRAMS);
    return formatMacroNumberIn('de', known(snapshot[key]));
  }

  /**
   * What the edit form prints: the basis round-tripped through the number
   * inputs (`formatMacroNumber` out, `Number` back in) and then run through the
   * production seam the form uses.
   */
  function editFormValue(key: 'protein' | 'fat' | 'kcal'): string {
    const submitted: Macros = {
      carbs: roundTrip(applePer100g.carbs),
      fiber: roundTrip(applePer100g.fiber),
      sugars: roundTrip(applePer100g.sugars),
      polyols: roundTrip(applePer100g.polyols),
      protein: roundTrip(applePer100g.protein),
      fat: roundTrip(applePer100g.fat),
      kcal: roundTrip(applePer100g.kcal),
    };
    const preview = computeMacroPreview({
      macrosPer100g: resolveEditedBasis({ originalBasis: applePer100g, editedPer100g: submitted }),
      grams: APPLE_GRAMS,
    });
    assert.ok(preview);
    const value =
      key === 'protein' ? preview.proteinForPortion
      : key === 'fat' ? preview.fatForPortion
      : preview.kcalForPortion;
    return formatMacroNumberIn('de', known(value));
  }

  it('prints the same protein on both surfaces (the reported divergence)', () => {
    assert.strictEqual(receiptValue('protein'), '0,8');
    assert.strictEqual(editFormValue('protein'), '0,8');
  });

  it('leaves fat and calories — which already agreed — alone', () => {
    assert.strictEqual(receiptValue('fat'), '0,9');
    assert.strictEqual(editFormValue('fat'), '0,9');
    assert.strictEqual(receiptValue('kcal'), '105,6');
    assert.strictEqual(editFormValue('kcal'), '105,6');
  });

  it('is non-vacuous: the pre-fix path (scaling the rounded basis) really did print 0,7', () => {
    // The exact arithmetic the code did before `resolveEditedBasis` existed.
    const preFix = scaleMacrosPer100gToServing({ ...applePer100g, protein: 0.4 }, APPLE_GRAMS);
    assert.strictEqual(formatMacroNumberIn('de', known(preFix.protein)), '0,7');
  });

  it('saving a portion-only edit stores the unrounded-basis snapshot, not the rounded one', () => {
    const submitted: Macros = { ...applePer100g, protein: 0.4, fat: 0.5 };
    const result = computeEditPatch({
      grams: APPLE_GRAMS,
      editedPer100g: submitted,
      originalBasis: applePer100g,
      currentProvenance: { aiEstimated: false, curatedSource: 'lowcarbcheck:apple' },
    });

    assert.strictEqual(result.macrosChanged, false);
    assert.strictEqual(formatMacroNumberIn('de', known(result.snapshot.protein)), '0,8');
  });

  it('a REAL macro edit still wins — the submitted value is the source', () => {
    const edited: Macros = { ...applePer100g, protein: 1.9 };
    const result = computeEditPatch({
      grams: APPLE_GRAMS,
      editedPer100g: edited,
      originalBasis: applePer100g,
      currentProvenance: { aiEstimated: false, curatedSource: 'lowcarbcheck:apple' },
    });

    assert.strictEqual(result.macrosChanged, true);
    assert.strictEqual(result.snapshot.protein, (1.9 * APPLE_GRAMS) / 100);
  });
});
