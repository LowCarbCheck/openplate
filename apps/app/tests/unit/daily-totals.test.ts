/**
 * Unit tests for `#app/models/daily-totals` — pure per-day kcal/estimate
 * arithmetic. No DB import (same split as `food-log-summary.ts`), so these run
 * without a database. The focus is the honesty rules: when a total exists, how
 * it was obtained (`basis`), and how much of it is derived/estimated.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeDailyEntry } from '../../app/models/daily-totals';
import type { FoodLogMacroSnapshot } from '../../app/models/food-log-summary';

function makeLog(overrides: Partial<FoodLogMacroSnapshot> = {}): FoodLogMacroSnapshot {
  return {
    carbs: 10,
    fiber: 2,
    sugars: 3,
    polyols: 0,
    protein: 20,
    fat: 5,
    kcal: 150,
    aiEstimated: false,
    ...overrides,
  };
}

describe('computeDailyEntry', () => {
  it('returns a "none" day with no total for an empty day', () => {
    const entry = computeDailyEntry([]);

    assert.strictEqual(entry.hasLogs, false);
    assert.strictEqual(entry.summary, null);
    assert.deepStrictEqual(entry.kcal, { total: null, basis: 'none', derivedShare: 0 });
    assert.strictEqual(entry.estimateShare, 0);
  });

  it('marks a day "reported" when every entry carries its own kcal', () => {
    const entry = computeDailyEntry([makeLog({ kcal: 100 }), makeLog({ kcal: 200 })]);

    assert.strictEqual(entry.kcal.total, 300);
    assert.strictEqual(entry.kcal.basis, 'reported');
    assert.strictEqual(entry.kcal.derivedShare, 0);
    assert.notStrictEqual(entry.summary, null);
  });

  it('Atwater-derives kcal only when carbs, protein, and fat are all known', () => {
    // Reported 100 + derived (4*10 + 4*5 + 9*2 = 78) = 178.
    const reported = makeLog({ kcal: 100 });
    const derived = makeLog({ kcal: null, carbs: 10, protein: 5, fat: 2 });
    const entry = computeDailyEntry([reported, derived]);

    assert.strictEqual(entry.kcal.total, 178);
    assert.strictEqual(entry.kcal.basis, 'partly-derived');
    assert.strictEqual(entry.kcal.derivedShare, 78 / 178);
  });

  it('marks a day "incomplete" (a floor) when an entry is uncomputable', () => {
    const derived = makeLog({ kcal: null, carbs: 10, protein: 5, fat: 2 });
    const uncomputable = makeLog({ kcal: null, carbs: null, protein: 5, fat: 2 });
    const entry = computeDailyEntry([derived, uncomputable]);

    assert.strictEqual(entry.kcal.total, 78);
    assert.strictEqual(entry.kcal.basis, 'incomplete');
    assert.strictEqual(entry.kcal.derivedShare, 1);
  });

  it('has no total when no entry is computable', () => {
    const entry = computeDailyEntry([makeLog({ kcal: null, carbs: null, protein: null, fat: null })]);

    assert.strictEqual(entry.kcal.total, null);
    assert.strictEqual(entry.kcal.basis, 'none');
  });

  it('computes estimateShare from computable kcal mass when a positive total exists', () => {
    const estimated = makeLog({ kcal: 100, aiEstimated: true });
    const manual = makeLog({ kcal: 300, aiEstimated: false });
    const entry = computeDailyEntry([estimated, manual]);

    assert.strictEqual(entry.estimateShare, 100 / 400);
  });

  it('falls back to fraction-of-entry-count for estimateShare when there is no positive total', () => {
    const estimated = makeLog({ kcal: null, carbs: null, protein: null, fat: null, aiEstimated: true });
    const manual = makeLog({ kcal: null, carbs: null, protein: null, fat: null, aiEstimated: false });
    const entry = computeDailyEntry([estimated, manual]);

    assert.strictEqual(entry.kcal.total, null);
    assert.strictEqual(entry.estimateShare, 0.5);
  });
});
