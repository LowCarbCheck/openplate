/**
 * Unit tests for `#app/lib/net-carbs`: the EU-vs-US carb basis.
 *
 * Spec 13 (M123) added the basis and read a MISSING one as a US label. That
 * understated every EU pack typed in with the default answer (operator report,
 * 2026-10-29: "carbs 10, fibre 6" read 4 g net carbs). Since then a missing
 * basis goes through `resolveCarbBasis`, which reads it from the numbers. This
 * file pins the two formulas, the resolver's rules on real per-100 g labels,
 * and that net carbs and total carbs follow the resolver.
 *
 * Every rule has a control: the same label with the one figure the rule reads
 * moved, so a resolver that ignored the rule would fail it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARB_BASES,
  computeNetCarbsFromParts,
  computeTotalCarbsFromParts,
  resolveCarbBasis,
} from '../../app/lib/net-carbs';
import type { CarbBasis } from '../../app/lib/net-carbs';
import type { Macros } from '../../app/lib/macros';

/** A per-100 g label with every figure unknown unless given. */
function label(figures: Partial<Macros>): Macros {
  return { carbs: null, fiber: null, sugars: null, polyols: null, protein: null, fat: null, kcal: null, ...figures };
}

/** The basis of a per-100 g label nobody stated a basis for. */
function resolvedPer100g(macros: Macros): CarbBasis {
  return resolveCarbBasis({ explicit: undefined, macros, grams: 100 });
}

/** Wholemeal rye bread, EU panel (Vollkornbrot). */
const EU_RYE_BREAD = label({ carbs: 38, fiber: 8, sugars: 3, protein: 8, fat: 1.5, kcal: 215 });
/** Crispbread whose fibre row exceeds its carbohydrate row, EU panel. */
const EU_CRISPBREAD = label({ carbs: 12, fiber: 20 });
/** A US protein bar, its panel scaled to 100 g. */
const US_PROTEIN_BAR = label({ carbs: 36.7, fiber: 23.3, sugars: 1.7, protein: 35, fat: 13.3, kcal: 317 });
/** Raw broccoli as USDA FoodData Central lists it (total carbohydrate). */
const USDA_BROCCOLI = label({ carbs: 6.6, fiber: 2.6, sugars: 1.7, protein: 2.8, fat: 0.4, kcal: 34 });
/** Raw broccoli as the German BLS lists it (available carbohydrate). */
const BLS_BROCCOLI = label({ carbs: 2.7, fiber: 3, protein: 3.5, fat: 0.2, kcal: 31 });

describe('the two formulas, on a stated basis', () => {
  it('lists exactly the two supported bases', () => {
    assert.deepStrictEqual(CARB_BASES, ['total', 'available']);
  });

  it('an `available` (EU) food does not double-subtract fibre, a `total` (US) one does', () => {
    const macros = label({ carbs: 21.7, fiber: 5 });
    assert.strictEqual(computeNetCarbsFromParts({ explicit: 'available', macros, grams: 100 }), 21.7);
    assert.strictEqual(computeNetCarbsFromParts({ explicit: 'total', macros, grams: 100 }), 16.7);
  });

  it('both bases still subtract polyols', () => {
    const macros = label({ carbs: 20, fiber: 3, polyols: 4 });
    assert.strictEqual(computeNetCarbsFromParts({ explicit: 'total', macros, grams: 100 }), 13);
    assert.strictEqual(computeNetCarbsFromParts({ explicit: 'available', macros, grams: 100 }), 16);
  });

  it('total carbs add the fibre back on `available` and take the figure as printed on `total`', () => {
    const macros = label({ carbs: 6, fiber: 8.6 });
    assert.strictEqual(computeTotalCarbsFromParts({ explicit: 'available', macros, grams: 100 }), 14.6);
    assert.strictEqual(computeTotalCarbsFromParts({ explicit: 'total', macros, grams: 100 }), 6);
  });

  it('unknown carbs yield null on every basis, never a fabricated 0', () => {
    const macros = label({ fiber: 3 });
    for (const explicit of [...CARB_BASES, undefined]) {
      assert.strictEqual(computeNetCarbsFromParts({ explicit, macros, grams: 100 }), null);
      assert.strictEqual(computeTotalCarbsFromParts({ explicit, macros, grams: 100 }), null);
    }
  });
});

describe('resolveCarbBasis on real labels', () => {
  it('a stated basis wins over every rule, both ways', () => {
    // CONTROL: the crispbread resolves `available` unstated, so a stated
    // `total` that came back `available` would be the rule overriding it.
    assert.strictEqual(resolvedPer100g(EU_CRISPBREAD), 'available');
    assert.strictEqual(resolveCarbBasis({ explicit: 'total', macros: EU_CRISPBREAD, grams: 100 }), 'total');
    assert.strictEqual(resolvedPer100g(US_PROTEIN_BAR), 'total');
    assert.strictEqual(resolveCarbBasis({ explicit: 'available', macros: US_PROTEIN_BAR, grams: 100 }), 'available');
  });

  it('EU wholemeal rye bread reads as available, from its energy', () => {
    assert.strictEqual(resolvedPer100g(EU_RYE_BREAD), 'available');
    // CONTROL: the same bread with the kcal a US total would give (fibre at 0
    // to 4 kcal, here 4 * (38 - 8) + 4 * 8 + 9 * 1.5 = 165.5) reads as total,
    // so the answer above came from the energy, not from the default.
    assert.strictEqual(resolvedPer100g({ ...EU_RYE_BREAD, kcal: 4 * 30 + 4 * 8 + 9 * 1.5 }), 'total');
  });

  it('an EU crispbread with more fibre than carbs reads as available (rule 2)', () => {
    assert.strictEqual(resolvedPer100g(EU_CRISPBREAD), 'available');
    // CONTROL: fibre within label rounding of carbs is no evidence, and with
    // kcal it is the energy that decides: a US-shaped energy then reads total.
    const atTheEdge = label({ carbs: 12, fiber: 12.4, protein: 10, fat: 2, kcal: 4 * 12 + 4 * 10 + 9 * 2 - 30 });
    assert.strictEqual(resolvedPer100g(atTheEdge), 'total');
  });

  it('sugars and fibre above carbs read as available (rule 3)', () => {
    const sugaryEu = label({ carbs: 10, fiber: 4, sugars: 8, protein: 10, fat: 2, kcal: 4 * 10 + 4 * 10 + 9 * 2 - 25 });
    assert.strictEqual(resolvedPer100g(sugaryEu), 'available');
    // CONTROL: the same label with sugars inside the carbs reads as the energy says, total.
    assert.strictEqual(resolvedPer100g({ ...sugaryEu, sugars: 5 }), 'total');
  });

  it('a US protein bar reads as total, from its energy', () => {
    assert.strictEqual(resolvedPer100g(US_PROTEIN_BAR), 'total');
    // CONTROL: without kcal there is no energy evidence, and the default answers.
    assert.strictEqual(resolvedPer100g({ ...US_PROTEIN_BAR, kcal: null }), 'available');
  });

  it('USDA raw broccoli reads as total, BLS raw broccoli as available', () => {
    assert.strictEqual(resolvedPer100g(USDA_BROCCOLI), 'total');
    assert.strictEqual(resolvedPer100g(BLS_BROCCOLI), 'available');
    // CONTROL: the USDA figures with the EU energy (4 * 6.6 + 2 * 2.6 + 4 * 2.8 + 9 * 0.4 = 46.4 kcal) read available.
    assert.strictEqual(resolvedPer100g({ ...USDA_BROCCOLI, kcal: 46.4 }), 'available');
  });

  it('with no fibre known the default is available, and net carbs are the same on both bases', () => {
    const noFibre = label({ carbs: 12, sugars: 4, protein: 3, fat: 1, kcal: 70 });
    assert.strictEqual(resolvedPer100g(noFibre), 'available');
    const zeroFibre = { ...noFibre, fiber: 0 };
    for (const macros of [noFibre, zeroFibre]) {
      assert.strictEqual(
        computeNetCarbsFromParts({ explicit: 'available', macros, grams: 100 }),
        computeNetCarbsFromParts({ explicit: 'total', macros, grams: 100 }),
      );
    }
    // CONTROL: with fibre the two bases differ, so the equality above is about the missing fibre.
    const withFibre = { ...noFibre, fiber: 3 };
    assert.notStrictEqual(
      computeNetCarbsFromParts({ explicit: 'available', macros: withFibre, grams: 100 }),
      computeNetCarbsFromParts({ explicit: 'total', macros: withFibre, grams: 100 }),
    );
  });

  it('the reported pack, carbs 10 and fibre 6 with nothing else typed, keeps 10 g net carbs', () => {
    const typed = label({ carbs: 10, fiber: 6 });
    assert.strictEqual(computeNetCarbsFromParts({ explicit: undefined, macros: typed, grams: 100 }), 10);
    // CONTROL: the US reading is the 4 g the operator saw.
    assert.strictEqual(computeNetCarbsFromParts({ explicit: 'total', macros: typed, grams: 100 }), 4);
  });

  it('reads a serving as its food: the evidence is weighed per 100 g', () => {
    // 30 g of USDA broccoli has 0.78 g fibre, under the energy check's floor
    // if it were read as it stands, so the serving would fall to the default.
    const grams = 30;
    const serving = label({
      carbs: (6.6 * grams) / 100,
      fiber: (2.6 * grams) / 100,
      sugars: (1.7 * grams) / 100,
      protein: (2.8 * grams) / 100,
      fat: (0.4 * grams) / 100,
      kcal: (34 * grams) / 100,
    });
    assert.strictEqual(resolveCarbBasis({ explicit: undefined, macros: serving, grams }), 'total');
    // CONTROL: the same numbers claimed to be 100 g are too small to tell apart.
    assert.strictEqual(resolveCarbBasis({ explicit: undefined, macros: serving, grams: 100 }), 'available');
  });

  it('a row with no positive weight falls to the default, never throws', () => {
    assert.strictEqual(resolveCarbBasis({ explicit: undefined, macros: USDA_BROCCOLI, grams: 0 }), 'available');
    assert.strictEqual(resolveCarbBasis({ explicit: 'total', macros: USDA_BROCCOLI, grams: 0 }), 'total');
  });

  it('net and total carbs follow the resolver for an unstated basis', () => {
    const input = { explicit: undefined, macros: USDA_BROCCOLI, grams: 100 };
    assert.ok(Math.abs((computeNetCarbsFromParts(input) ?? Number.NaN) - 4) < 1e-9);
    assert.strictEqual(computeTotalCarbsFromParts(input), 6.6);
    const eu = { explicit: undefined, macros: BLS_BROCCOLI, grams: 100 };
    assert.strictEqual(computeNetCarbsFromParts(eu), 2.7);
    assert.ok(Math.abs((computeTotalCarbsFromParts(eu) ?? Number.NaN) - 5.7) < 1e-9);
  });
});
