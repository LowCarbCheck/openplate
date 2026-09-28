/**
 * The protein floor, from height and sex (M200 spec 03).
 *
 * Two claims are pinned here, and they are the whole spec.
 *
 * The first is arithmetic. The Devine numbers below are worked by hand in the
 * comments, digit by digit, so a wrong base, a wrong slope or a wrong inch
 * fails HERE rather than shipping a target that is quietly a few grams off. A
 * test that only asserted "returns a number" would have passed every one of
 * those mistakes.
 *
 * The second is the refusal. Devine names two sexes and is fitted from five
 * feet upward; below that it trends toward and then past zero. So `null` is a
 * real answer, and every route to it is exercised: no height, no sex, and a
 * height under the range. There is no default height and no assumed sex in the
 * function, and these tests are what keeps one from being added later.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PROTEIN_PER_KG, computeDevineIdealWeightKg, estimateProteinFloorG } from '../../app/models/body-metrics';

/** Five feet, the height at which Devine is exactly its base mass. */
const DEVINE_BASE_HEIGHT_CM = 152.4;

describe('the Devine ideal-weight basis', () => {
  it('is exactly the base mass at five feet, where the height term is zero', () => {
    assert.equal(computeDevineIdealWeightKg({ heightCm: DEVINE_BASE_HEIGHT_CM, biologicalSex: 'male' }), 50);
    assert.equal(computeDevineIdealWeightKg({ heightCm: DEVINE_BASE_HEIGHT_CM, biologicalSex: 'female' }), 45.5);
  });

  it('adds 2.3 kg per inch above five feet, for a male at 180 cm', () => {
    // 180 - 152.4 = 27.6 cm = 10.8661417 in; x 2.3 = 24.9921260 kg; + 50 = 74.9921260 kg.
    const idealWeightKg = computeDevineIdealWeightKg({ heightCm: 180, biologicalSex: 'male' });
    assert.ok(idealWeightKg !== null);
    assert.ok(Math.abs(idealWeightKg - 74.992126) < 1e-6, `got ${String(idealWeightKg)}`);
  });

  it('adds 2.3 kg per inch above five feet, for a female at 165 cm', () => {
    // 165 - 152.4 = 12.6 cm = 4.9606299 in; x 2.3 = 11.4094488 kg; + 45.5 = 56.9094488 kg.
    const idealWeightKg = computeDevineIdealWeightKg({ heightCm: 165, biologicalSex: 'female' });
    assert.ok(idealWeightKg !== null);
    assert.ok(Math.abs(idealWeightKg - 56.9094488) < 1e-6, `got ${String(idealWeightKg)}`);
  });
});

describe('estimateProteinFloorG, the worked Devine cases', () => {
  it('gives 120 g for a male at 180 cm', () => {
    // 74.9921260 kg x 1.6 g/kg = 119.9874016 g, rounded to 120.
    assert.equal(estimateProteinFloorG({ heightCm: 180, biologicalSex: 'male' }), 120);
  });

  it('gives 91 g for a female at 165 cm', () => {
    // 56.9094488 kg x 1.6 g/kg = 91.0551181 g, rounded to 91.
    assert.equal(estimateProteinFloorG({ heightCm: 165, biologicalSex: 'female' }), 91);
  });

  it('answers just above the bottom of the range, at 153 cm', () => {
    // Male: 153 - 152.4 = 0.6 cm = 0.2362205 in; x 2.3 = 0.5433071 kg; + 50 =
    // 50.5433071 kg; x 1.6 = 80.8692913 g, rounded to 81.
    assert.equal(estimateProteinFloorG({ heightCm: 153, biologicalSex: 'male' }), 81);
    // Female: 45.5 + 0.5433071 = 46.0433071 kg; x 1.6 = 73.6692913 g, rounded to 74.
    assert.equal(estimateProteinFloorG({ heightCm: 153, biologicalSex: 'female' }), 74);
  });

  it('answers at the bottom of the range itself, where only the base mass counts', () => {
    // 50 kg x 1.6 = 80 g, and 45.5 kg x 1.6 = 72.8 g, rounded to 73.
    assert.equal(estimateProteinFloorG({ heightCm: DEVINE_BASE_HEIGHT_CM, biologicalSex: 'male' }), 80);
    assert.equal(estimateProteinFloorG({ heightCm: DEVINE_BASE_HEIGHT_CM, biologicalSex: 'female' }), 73);
  });

  it('multiplies the ideal weight by 1.6 g/kg, and by nothing else', () => {
    assert.equal(PROTEIN_PER_KG, 1.6);
    // The factor is the only thing that changes when it is overridden, so the
    // shipped number IS the ideal weight times the named constant.
    const atOneGramPerKg = estimateProteinFloorG({
      heightCm: 180,
      biologicalSex: 'male',
      gramsPerKg: 1,
    });
    assert.equal(atOneGramPerKg, 75);
    assert.equal(estimateProteinFloorG({ heightCm: 180, biologicalSex: 'male', gramsPerKg: PROTEIN_PER_KG }), 120);
  });
});

describe('estimateProteinFloorG says "I cannot" instead of guessing', () => {
  it('gives null when the height is missing, rather than assuming one', () => {
    assert.equal(estimateProteinFloorG({ heightCm: null, biologicalSex: 'male' }), null);
    assert.equal(estimateProteinFloorG({ heightCm: null, biologicalSex: 'female' }), null);
  });

  it('gives null when the sex is missing, which is a designed answer, not a gap', () => {
    // "Prefer not to say" stores nothing, so this is the state of every person
    // who declined the question on the body-metrics card.
    assert.equal(estimateProteinFloorG({ heightCm: 180, biologicalSex: null }), null);
  });

  it('gives null below the range Devine is defined for, rather than extrapolating', () => {
    assert.equal(estimateProteinFloorG({ heightCm: 152, biologicalSex: 'male' }), null);
    assert.equal(estimateProteinFloorG({ heightCm: 152, biologicalSex: 'female' }), null);
    assert.equal(estimateProteinFloorG({ heightCm: 140, biologicalSex: 'female' }), null);
    // The same refusal one level down, so the basis itself never invents a mass.
    assert.equal(computeDevineIdealWeightKg({ heightCm: 152, biologicalSex: 'male' }), null);
  });

  it('gives null, never a zero and never a default, for every missing case at once', () => {
    assert.equal(estimateProteinFloorG({ heightCm: null, biologicalSex: null }), null);
  });
});
