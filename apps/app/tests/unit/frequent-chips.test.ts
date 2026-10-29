/**
 * Unit tests for `#app/lib/frequent-chips` — pure net-carb traffic-light
 * classification for the diary's one-tap quick-add chips.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { chipCarbStatus } from '../../app/lib/frequent-chips';
import type { Macros } from '../../app/lib/macros';

const EMPTY_MACROS: Macros = {
  carbs: null,
  fiber: null,
  sugars: null,
  polyols: null,
  protein: null,
  fat: null,
  kcal: null,
};

describe('chipCarbStatus', () => {
  it('recovers per-100g net carbs from a per-serving snapshot', () => {
    // 10 g carbs over a 200 g serving → 5 g per 100 g → low.
    assert.strictEqual(chipCarbStatus({ ...EMPTY_MACROS, carbs: 10 }, 200, { carbBasis: undefined }), 'low');
    // 20 g carbs over 100 g → 20 g per 100 g → high.
    assert.strictEqual(chipCarbStatus({ ...EMPTY_MACROS, carbs: 20 }, 100, { carbBasis: undefined }), 'high');
  });

  it('subtracts fiber and polyols before classifying, on a US panel', () => {
    // (8 - 4) g net over 100 g → 4 g per 100 g → low.
    assert.strictEqual(chipCarbStatus({ ...EMPTY_MACROS, carbs: 8, fiber: 4 }, 100, { carbBasis: 'total' }), 'low');
    // CONTROL: the same figures on an EU panel keep all 8 g, which is moderate.
    assert.strictEqual(
      chipCarbStatus({ ...EMPTY_MACROS, carbs: 8, fiber: 4 }, 100, { carbBasis: 'available' }),
      'moderate',
    );
  });

  it('returns null when carbs are unknown', () => {
    assert.strictEqual(chipCarbStatus({ ...EMPTY_MACROS, carbs: null }, 100, { carbBasis: undefined }), null);
  });

  it('returns null for a non-positive serving size', () => {
    assert.strictEqual(chipCarbStatus({ ...EMPTY_MACROS, carbs: 5 }, 0, { carbBasis: undefined }), null);
  });
});

describe('chipCarbStatus — an upstream authoritative figure wins over the local subtraction', () => {
  /**
   * A bls-origin row: `carbs` is the AVAILABLE-carbohydrate figure (fibre
   * already excluded) and `fiber` is reported separately and larger, so the
   * local formula on a stated US basis computes −21.1 and classifies it `low`,
   * a confident GREEN dot on a food whose real figure, 21.7, is red.
   */
  const FIBRE_HEAVY: Macros = { ...EMPTY_MACROS, carbs: 21.7, fiber: 42.8 };

  it('classifies from the upstream figure, not the double-subtracted one', () => {
    assert.strictEqual(
      chipCarbStatus(FIBRE_HEAVY, 100, { carbBasis: 'total' }),
      'low',
      'fixture check: the US formula really does say low',
    );
    assert.strictEqual(
      chipCarbStatus(FIBRE_HEAVY, 100, { authoritativeNetCarbsPer100g: 21.7, carbBasis: 'total' }),
      'high',
    );
  });

  it('ignores the serving size, because the figure is already per 100 g', () => {
    assert.strictEqual(
      chipCarbStatus(FIBRE_HEAVY, 250, { authoritativeNetCarbsPer100g: 21.7, carbBasis: 'total' }),
      'high',
    );
    assert.strictEqual(
      chipCarbStatus(EMPTY_MACROS, 0, { authoritativeNetCarbsPer100g: 3, carbBasis: undefined }),
      'low',
    );
  });

  it('returns no status for an explicitly unknown upstream figure — never a fabricated green dot', () => {
    assert.strictEqual(
      chipCarbStatus(FIBRE_HEAVY, 100, { authoritativeNetCarbsPer100g: null, carbBasis: undefined }),
      null,
    );
  });

  it('falls back to the local formula when no figure is supplied at all', () => {
    assert.strictEqual(chipCarbStatus(FIBRE_HEAVY, 100, { carbBasis: 'total' }), 'low');
    assert.strictEqual(
      chipCarbStatus(FIBRE_HEAVY, 100, { authoritativeNetCarbsPer100g: undefined, carbBasis: 'total' }),
      'low',
    );
  });

  it('reads an UNSTATED basis from the numbers: fibre above carbs is an EU panel, so no green dot', () => {
    // Until 2026-10-29 an unstated basis meant the US formula and this chip
    // went green. CONTROL: the stated US basis above is still `low`.
    assert.strictEqual(chipCarbStatus(FIBRE_HEAVY, 100, { carbBasis: undefined }), 'high');
  });
});
