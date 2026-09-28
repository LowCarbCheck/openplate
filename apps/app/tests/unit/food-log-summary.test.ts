/**
 * Unit tests for `#app/models/food-log-summary` — pure daily-totals
 * arithmetic. No database import (this module has none), so these tests
 * run without any DB connection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeDay } from '../../app/models/food-log-summary';
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

describe('summarizeDay', () => {
  it('returns all-zero totals with hasUnknowns/hasEstimates false for an empty day', () => {
    const summary = summarizeDay([]);

    assert.deepStrictEqual(summary, {
      carbs: 0,
      fiber: 0,
      polyols: 0,
      netCarbs: 0,
      protein: 0,
      fat: 0,
      kcal: 0,
      hasUnknowns: false,
      hasEstimates: false,
    });
  });

  it('sums macros and computes netCarbs = carbs - fiber - polyols for full data', () => {
    const logs = [
      makeLog({ carbs: 10, fiber: 2, polyols: 1, protein: 20, fat: 5, kcal: 150 }),
      makeLog({ carbs: 20, fiber: 4, polyols: 0, protein: 10, fat: 8, kcal: 200 }),
    ];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.carbs, 30);
    assert.strictEqual(summary.fiber, 6);
    assert.strictEqual(summary.polyols, 1);
    assert.strictEqual(summary.netCarbs, 30 - 6 - 1);
    assert.strictEqual(summary.protein, 30);
    assert.strictEqual(summary.fat, 13);
    assert.strictEqual(summary.kcal, 350);
    assert.strictEqual(summary.hasUnknowns, false);
  });

  ////////////////////////////////////////////////////////////////////////////
  // Negative net carbs (bug repro: 100 g wheat bran, carbs 27 / fiber 43)
  ////////////////////////////////////////////////////////////////////////////

  it('clamps a single fiber-heavy entry at zero net carbs instead of going negative', () => {
    const wheatBran = makeLog({ carbs: 27, fiber: 43, polyols: 0 });

    const summary = summarizeDay([wheatBran]);

    assert.strictEqual(summary.netCarbs, 0);
  });

  it('does not let a fiber-heavy entry cancel out another entry\'s carbs in the day total', () => {
    // Before the fix: (27 + 20) - (43 + 0) - 0 = -16 for the DAY, wiping out the
    // apple's real 20 g. Clamped per entry: max(0, 27-43) + max(0, 20-0) = 0 + 20 = 20.
    const wheatBran = makeLog({ carbs: 27, fiber: 43, polyols: 0 });
    const apple = makeLog({ carbs: 20, fiber: 0, polyols: 0 });

    const summary = summarizeDay([wheatBran, apple]);

    assert.strictEqual(summary.netCarbs, 20);
  });

  it('prefers an authoritative upstream netCarbs figure over recomputing from parts', () => {
    // Carbs/fiber/polyols would recompute to a different (and here, wrong) figure;
    // the upstream value must win.
    const log = makeLog({ carbs: 27, fiber: 43, polyols: 0, netCarbs: 12 });

    const summary = summarizeDay([log]);

    assert.strictEqual(summary.netCarbs, 12);
  });

  it('clamps a negative authoritative netCarbs figure at zero too', () => {
    const log = makeLog({ netCarbs: -5 });

    const summary = summarizeDay([log]);

    assert.strictEqual(summary.netCarbs, 0);
  });

  it('falls back to computing from parts when netCarbs is null or absent', () => {
    const explicitNull = makeLog({ carbs: 10, fiber: 2, polyols: 0, netCarbs: null });
    const absent = makeLog({ carbs: 10, fiber: 2, polyols: 0 });

    assert.strictEqual(summarizeDay([explicitNull]).netCarbs, 8);
    assert.strictEqual(summarizeDay([absent]).netCarbs, 8);
  });

  ////////////////////////////////////////////////////////////////////////////
  // Calories (bug repro: reads 0 kcal in one surface, 481 in another)
  ////////////////////////////////////////////////////////////////////////////

  it('sums reported kcal directly', () => {
    const summary = summarizeDay([makeLog({ kcal: 100 }), makeLog({ kcal: 200 })]);

    assert.strictEqual(summary.kcal, 300);
  });

  it('Atwater-derives kcal for an entry with no reported kcal but known carbs/protein/fat', () => {
    // 4*10 + 4*5 + 9*2 = 40 + 20 + 18 = 78 — never silently dropped to 0.
    const log = makeLog({ kcal: null, carbs: 10, protein: 5, fat: 2 });

    const summary = summarizeDay([log]);

    assert.strictEqual(summary.kcal, 78);
  });

  it('mixes reported and Atwater-derived kcal across entries in one day', () => {
    const reported = makeLog({ kcal: 100 });
    const derived = makeLog({ kcal: null, carbs: 10, protein: 5, fat: 2 });

    const summary = summarizeDay([reported, derived]);

    assert.strictEqual(summary.kcal, 178);
  });

  it('contributes nothing (not a fabricated 0) for an entry with no kcal and incomplete Atwater inputs', () => {
    const uncomputable = makeLog({ kcal: null, carbs: null, protein: 5, fat: 2 });
    const known = makeLog({ kcal: 150 });

    const summary = summarizeDay([uncomputable, known]);

    assert.strictEqual(summary.kcal, 150);
  });

  ////////////////////////////////////////////////////////////////////////////
  // hasUnknowns — accurate and actionable (bug repro: fires on virtually every
  // food because of null polyols, never fires when kcal is actually missing)
  ////////////////////////////////////////////////////////////////////////////

  it('flags hasUnknowns when any log has a null fiber value, using 0 in the arithmetic', () => {
    const logs = [makeLog({ carbs: 10, fiber: null, polyols: 0 })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasUnknowns, true);
    assert.strictEqual(summary.fiber, 0);
    assert.strictEqual(summary.netCarbs, 10 - 0 - 0);
  });

  it('does NOT flag hasUnknowns for a null polyols value alone (the near-universal case)', () => {
    const logs = [makeLog({ carbs: 10, fiber: 2, polyols: null })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasUnknowns, false);
    assert.strictEqual(summary.polyols, 0);
  });

  it('flags hasUnknowns when any log has a null carbs value', () => {
    const logs = [makeLog({ carbs: null })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasUnknowns, true);
    assert.strictEqual(summary.carbs, 0);
  });

  it('does not flag netCarbs as unknown when carbs/fiber are null but an authoritative netCarbs is present', () => {
    const logs = [makeLog({ carbs: null, fiber: null, polyols: null, netCarbs: 5 })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasUnknowns, false);
  });

  it('flags hasUnknowns when kcal is unreported and not Atwater-derivable', () => {
    const logs = [makeLog({ kcal: null, carbs: null, protein: 5, fat: 2 })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasUnknowns, true);
  });

  it('does not flag hasUnknowns when kcal is unreported but Atwater-derivable', () => {
    const logs = [makeLog({ kcal: null, carbs: 10, protein: 5, fat: 2 })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasUnknowns, false);
  });

  it('does not flag hasUnknowns for a null protein/fat value alone (kcal still reported)', () => {
    const logs = [makeLog({ protein: null, fat: null, kcal: 150 })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasUnknowns, false);
    assert.strictEqual(summary.protein, 0);
    assert.strictEqual(summary.fat, 0);
    assert.strictEqual(summary.kcal, 150);
  });

  it('flags hasEstimates when any log is AI-estimated', () => {
    const logs = [makeLog({ aiEstimated: false }), makeLog({ aiEstimated: true })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasEstimates, true);
  });

  it('does not flag hasEstimates when every log is manual/curated', () => {
    const logs = [makeLog({ aiEstimated: false }), makeLog({ aiEstimated: false })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasEstimates, false);
  });

  it('keeps hasUnknowns and hasEstimates independent (estimated but fully known)', () => {
    const logs = [makeLog({ carbs: 10, fiber: 2, polyols: 0, aiEstimated: true })];

    const summary = summarizeDay(logs);

    assert.strictEqual(summary.hasEstimates, true);
    assert.strictEqual(summary.hasUnknowns, false);
  });
});
