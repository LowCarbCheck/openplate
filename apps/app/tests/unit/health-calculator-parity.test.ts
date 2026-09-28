/**
 * The app's energy and protein functions still give the numbers openplate.de copied (M263).
 *
 * openplate.de has a kcal and a protein calculator, with the formulas COPIED from
 * `app/models/body-metrics.ts` and `app/lib/eating-style.ts`, because the two repositories have
 * separate lockfiles. The fixture holds rows whose expected values came from running these very
 * functions once, and the website repository runs its copies against a byte-identical file. So a
 * constant or a rounding step changed here fails this test, and the site cannot silently disagree
 * with the app about one person's kcal or protein.
 *
 * Nothing here imports the website. The BMI and water values are the site's own, from WHO and EFSA;
 * the app has no function for either, so the table carries none.
 *
 * The site asks for an age, the app stores a birth year. `deriveAgeYears` is `currentYear -
 * birthYear`, so `birthYear = currentYear - ageYears` gives back exactly the age the site used. The
 * year is fixed rather than read off a clock, and any year gives the same ages.
 *
 * Heights go through `parseHeightCm`, the path a typed height takes into the app, because that is
 * where the app rounds to a whole centimetre. The site rounds the same way, and one row (168.5 cm)
 * would fail if either side stopped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  computeBmrKcal,
  computeReferenceProteinFloor,
  computeTdeeKcal,
  LIGHTLY_ACTIVE_FACTOR,
  parseHeightCm,
  suggestDailyKcal,
} from '../../app/models/body-metrics';
import type { EnergyEstimateInput } from '../../app/models/body-metrics';
import { applyEatingStyle } from '../../app/lib/eating-style';
import type { BiologicalSex } from '../../app/lib/local-store/schema';

interface ParityRow {
  readonly name: string;
  readonly input: {
    readonly weightKg: number | null;
    readonly heightCm: number | null;
    readonly sex: BiologicalSex | null;
    readonly ageYears: number | null;
    readonly activityLevel: string;
    readonly activityFactor: number;
  };
  readonly expected: {
    readonly bmrKcal: number | null;
    readonly tdeeKcal: number | null;
    readonly dailyKcal: number | null;
    readonly proteinReferenceG: number | null;
    readonly proteinHighG: number | null;
  };
}

interface ParityTable {
  readonly rows: readonly ParityRow[];
}

// SAFETY: a fixture committed next to this test, generated once from the functions under test. A
// file that is not this layout fails the coverage check and the per-row equalities below by name.
const TABLE = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/health-calculator-parity.json'), 'utf8'),
) as ParityTable;

/** Any year works, because the app ages a person by subtraction; a fixed one keeps the test off the clock. */
const CURRENT_YEAR = 2026;

/** The site's id for the level whose factor is the app's one fixed factor. */
const SITE_DEFAULT_LEVEL = 'lightly-active';

/**
 * The app's energy input for a row: the height as the app parses a typed one, and the age as a
 * birth year.
 *
 * @param row - one row of the parity table.
 * @returns the input `computeBmrKcal` and its siblings read.
 */
function energyInputFor(row: ParityRow): EnergyEstimateInput {
  const { weightKg, heightCm, sex, ageYears } = row.input;
  return {
    weightKg,
    heightCm: heightCm === null ? null : parseHeightCm(String(heightCm)),
    biologicalSex: sex,
    birthYear: ageYears === null ? null : CURRENT_YEAR - ageYears,
    currentYear: CURRENT_YEAR,
  };
}

describe('the parity table', () => {
  it('covers both sexes, several activity factors and rows with no answer', () => {
    const sexes = new Set(TABLE.rows.map((row) => row.input.sex));
    const factors = new Set(TABLE.rows.map((row) => row.input.activityFactor));
    assert.ok(sexes.has('female') && sexes.has('male'), 'both sexes appear');
    assert.equal(factors.size, 5, 'all five of the site activity factors appear');
    assert.ok(TABLE.rows.some((row) => row.expected.dailyKcal === null), 'a row expects no kcal answer');
    assert.ok(TABLE.rows.some((row) => row.expected.proteinReferenceG === null), 'a row expects no protein answer');
  });

  it('gives the site default level the one fixed factor of the app', () => {
    const defaultRows = TABLE.rows.filter((row) => row.input.activityLevel === SITE_DEFAULT_LEVEL);
    assert.ok(defaultRows.length > 0, 'the table has rows at the site default level');
    for (const row of defaultRows) assert.equal(row.input.activityFactor, LIGHTLY_ACTIVE_FACTOR, row.name);
  });
});

describe('the app gives the numbers openplate.de copied', () => {
  for (const row of TABLE.rows) {
    it(row.name, () => {
      const energy = energyInputFor(row);
      const withFactor = { ...energy, activityFactor: row.input.activityFactor };
      assert.equal(computeBmrKcal(energy), row.expected.bmrKcal, 'BMR');
      assert.equal(computeTdeeKcal(withFactor), row.expected.tdeeKcal, 'TDEE');
      assert.equal(suggestDailyKcal(withFactor), row.expected.dailyKcal, 'daily kcal');
      // At the default level the app's own path, with no factor passed at all, must agree too.
      if (row.input.activityLevel === SITE_DEFAULT_LEVEL) {
        assert.equal(suggestDailyKcal(energy), row.expected.dailyKcal, 'daily kcal at the app default');
      }

      // The reference protein a person with a weigh-in sees, neither pregnant nor lactating. The
      // site answers only from a weight, so its "no answer" is the app not using a weigh-in.
      const reference = computeReferenceProteinFloor({
        latestWeighInKg: row.input.weightKg,
        heightCm: energy.heightCm,
        biologicalSex: row.input.sex,
        reproductiveStatus: null,
        trimester: null,
        lactationMonths: null,
      });
      const referenceG = reference.basis === 'weigh-in' ? reference.grams : null;
      assert.equal(referenceG, row.expected.proteinReferenceG, 'reference protein');

      // The floor the high-protein eating style stores. With no weight the app says a weight is
      // needed, which is the site's "no answer".
      const highProtein = applyEatingStyle({
        style: 'high-protein',
        currentGoals: { goalNetCarbsCeilingG: null, goalKcalTarget: null, goalProteinFloorG: null, eatingStyle: null },
        carbPresetCeiling: null,
        kcalTarget: null,
        latestWeightKg: row.input.weightKg,
        referenceProteinFloorG: reference.grams,
      });
      const highG = highProtein.needsWeight ? null : highProtein.patch.goalProteinFloorG;
      assert.equal(highG, row.expected.proteinHighG, 'high protein');
    });
  }
});
