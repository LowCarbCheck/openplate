/**
 * The pure body-metrics model (M135): parsing, the sex ↔ reproductive-status
 * invariant, age banding from a birth YEAR (never a birth date), and the
 * Mifflin-St Jeor energy estimate — including every missing-input case, which
 * is the branch that matters most: the whole app has to work with all four
 * metrics unset, so "no suggestion" must be reachable from every direction.
 *
 * The current year is always passed in, never read off a clock, so these
 * assertions don't rot on 1 January.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BODY_BIRTH_YEAR_INVALID_KEY,
  BODY_HEIGHT_INVALID_KEY,
  EMPTY_BODY_METRICS,
  LIGHTLY_ACTIVE_FACTOR,
  PROTEIN_PER_KG,
  EFSA_LACTATION_KCAL_ADDITION_FIRST_6MO,
  EFSA_LACTATION_PROTEIN_ADDITION_AFTER_6MO_G,
  EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G,
  EFSA_PREGNANCY_T1_KCAL_ADDITION,
  EFSA_PREGNANCY_T1_PROTEIN_ADDITION_G,
  EFSA_PREGNANCY_T2_KCAL_ADDITION,
  EFSA_PREGNANCY_T2_PROTEIN_ADDITION_G,
  EFSA_PREGNANCY_T3_KCAL_ADDITION,
  EFSA_PREGNANCY_T3_PROTEIN_ADDITION_G,
  EFSA_PROTEIN_REFERENCE_G_PER_KG,
  EU_PROTEIN_REFERENCE_INTAKE_G,
  DGE_LACTATION_PROTEIN_ADDITION_G,
  DGE_NORMAL_WEIGHT_BMI_LIMIT,
  DGE_PREGNANCY_T1_PROTEIN_ADDITION_G,
  DGE_PREGNANCY_T2_PROTEIN_ADDITION_G,
  DGE_PREGNANCY_T3_PROTEIN_ADDITION_G,
  DGE_PROTEIN_ADULT_G_PER_KG,
  DGE_PROTEIN_BANDS,
  computeBmrKcal,
  computeDevineIdealWeightKg,
  computeReferenceKcalAddition,
  computeReferenceProteinFloor,
  selectLatestWeighInKg,
  selectMissingReferenceDate,
  computeTdeeKcal,
  estimateProteinFloorG,
  deriveAgeYears,
  hasAnyBodyMetric,
  hasBodyMetricsErrors,
  normalizeBodyMetrics,
  parseBiologicalSex,
  parseBirthYear,
  parseHeightCm,
  inspectPregnancyDueDate,
  parseLactationStartDate,
  parsePregnancyDueDate,
  parseReproductiveStatus,
  readBodyMetrics,
  resolveAgeBandForBirthYear,
  resolveRdaAgeBand,
  suggestDailyKcal,
  suggestProteinFloor,
  validateBodyMetricsForm,
  bodyMetricsFormKey,
  BODY_DUE_DATE_PAST_KEY,
  BODY_DUE_DATE_RANGE_KEY,
  BODY_START_DATE_FUTURE_KEY,
  MAX_WEEKS_UNTIL_DUE_DATE,
  type BodyMetrics,
} from '../../app/models/body-metrics';
import type { ReferenceProteinFloorInput, ReproductiveStageInput } from '../../app/models/body-metrics';
import type { BiologicalSex } from '../../app/lib/local-store/schema';
import type { Trimester } from '../../app/lib/reproductive-stage';
import { shiftDate } from '../../app/lib/user-days';

const CURRENT_YEAR = 2026;

/**
 * The day every date case below is measured against, fixed so the suite reads
 * the same in 2027. UTC midnight, which is the day the parsers compare on.
 */
const TODAY = new Date('2026-09-09T00:00:00.000Z');

/** The same day as a day key, so the shifts below read as calendar arithmetic. */
const TODAY_KEY = '2026-09-09';

describe('parseHeightCm', () => {
  it('reads a plain height in centimetres', () => {
    assert.equal(parseHeightCm('175'), 175);
    assert.equal(parseHeightCm(' 175 '), 175);
  });

  it('reads a decimal comma and rounds to whole centimetres', () => {
    assert.equal(parseHeightCm('175,4'), 175);
    assert.equal(parseHeightCm('175.6'), 176);
  });

  it('treats blank and absent as "not given"', () => {
    assert.equal(parseHeightCm(''), null);
    assert.equal(parseHeightCm('   '), null);
    assert.equal(parseHeightCm(null), null);
    assert.equal(parseHeightCm(undefined), null);
  });

  it('rejects implausible or unreadable heights rather than storing them', () => {
    assert.equal(parseHeightCm('49'), null);
    assert.equal(parseHeightCm('261'), null);
    assert.equal(parseHeightCm('tall'), null);
  });
});

describe('parseBirthYear', () => {
  it('reads a four-digit year', () => {
    assert.equal(parseBirthYear('1985', { currentYear: CURRENT_YEAR }), 1985);
  });

  it('treats blank as "not given"', () => {
    assert.equal(parseBirthYear('', { currentYear: CURRENT_YEAR }), null);
    assert.equal(parseBirthYear(null, { currentYear: CURRENT_YEAR }), null);
  });

  it('refuses a year below the youngest age band the reference data covers', () => {
    // 13 years old — the source has no band under 14-18, so this is a refusal,
    // not a value to clamp into the youngest band.
    assert.equal(parseBirthYear('2013', { currentYear: CURRENT_YEAR }), null);
    // 14 years old is the first year that is accepted.
    assert.equal(parseBirthYear('2012', { currentYear: CURRENT_YEAR }), 2012);
  });

  it('refuses an implausibly old year and a non-integer', () => {
    assert.equal(parseBirthYear('1800', { currentYear: CURRENT_YEAR }), null);
    assert.equal(parseBirthYear('19.85', { currentYear: CURRENT_YEAR }), null);
    assert.equal(parseBirthYear('nineteen', { currentYear: CURRENT_YEAR }), null);
  });
});

describe('parseBiologicalSex / parseReproductiveStatus', () => {
  it('narrows the known values and answers null for anything else', () => {
    assert.equal(parseBiologicalSex('female'), 'female');
    assert.equal(parseBiologicalSex('male'), 'male');
    assert.equal(parseBiologicalSex(''), null);
    assert.equal(parseBiologicalSex('other'), null);
    assert.equal(parseBiologicalSex(null), null);

    assert.equal(parseReproductiveStatus('pregnant'), 'pregnant');
    assert.equal(parseReproductiveStatus('lactating'), 'lactating');
    assert.equal(parseReproductiveStatus('none'), 'none');
    assert.equal(parseReproductiveStatus('maybe'), null);
  });
});

describe('normalizeBodyMetrics', () => {
  it('keeps a reproductive status when the sex was never given (widened in M206)', () => {
    // A person can be pregnant without having told this app their sex, so
    // "prefer not to say" must not cost them the status.
    const normalized = normalizeBodyMetrics({
      heightCm: 170,
      birthYear: 1990,
      biologicalSex: null,
      reproductiveStatus: 'pregnant',
      pregnancyDueDate: '2026-11-02',
    });
    assert.equal(normalized.reproductiveStatus, 'pregnant');
    assert.equal(normalized.pregnancyDueDate, '2026-11-02');
    assert.equal(normalized.heightCm, 170);
    // CONTROL: the same record with an explicit male sex still loses both, so
    // the assertions above are not simply "this function keeps everything".
    const male = normalizeBodyMetrics({
      heightCm: 170,
      birthYear: 1990,
      biologicalSex: 'male',
      reproductiveStatus: 'pregnant',
      pregnancyDueDate: '2026-11-02',
    });
    assert.equal(male.reproductiveStatus, null);
    assert.equal(male.pregnancyDueDate, null);
  });

  it('drops a date that no longer matches its status', () => {
    const switched = normalizeBodyMetrics({
      heightCm: null,
      birthYear: null,
      biologicalSex: 'female',
      reproductiveStatus: 'lactating',
      pregnancyDueDate: '2026-11-02',
      lactationStartDate: '2026-03-01',
    });
    // The pregnancy is over: its date goes rather than waiting in the store for
    // a status change to make it visible again.
    assert.equal(switched.pregnancyDueDate, null);
    // CONTROL: the date that DOES match the status survives the same call.
    assert.equal(switched.lactationStartDate, '2026-03-01');

    // And "neither" keeps no date at all.
    const cleared = normalizeBodyMetrics({
      heightCm: null,
      birthYear: null,
      biologicalSex: 'female',
      reproductiveStatus: 'none',
      pregnancyDueDate: '2026-11-02',
      lactationStartDate: '2026-03-01',
    });
    assert.equal(cleared.reproductiveStatus, null);
    assert.equal(cleared.pregnancyDueDate, null);
    assert.equal(cleared.lactationStartDate, null);
  });

  it('drops a reproductive status when the sex changes away from female', () => {
    const normalized = normalizeBodyMetrics({
      heightCm: null,
      birthYear: null,
      biologicalSex: 'male',
      reproductiveStatus: 'lactating',
    });
    assert.equal(normalized.reproductiveStatus, null);
  });

  it('stores the explicit "neither" answer as unset, so there is one way to be unset', () => {
    const normalized = normalizeBodyMetrics({
      heightCm: null,
      birthYear: null,
      biologicalSex: 'female',
      reproductiveStatus: 'none',
    });
    assert.equal(normalized.reproductiveStatus, null);
  });

  it('keeps a real status alongside a female sex', () => {
    const normalized = normalizeBodyMetrics({
      heightCm: null,
      birthYear: null,
      biologicalSex: 'female',
      reproductiveStatus: 'pregnant',
    });
    assert.equal(normalized.reproductiveStatus, 'pregnant');
  });
});

describe('readBodyMetrics', () => {
  it('reads a pre-v8 profile with no body metrics at all as fully unset', () => {
    // A v7 row's JSON simply lacks the four keys — the shape below is exactly
    // what `JSON.parse` hands back for one.
    const metrics = readBodyMetrics({});
    assert.deepEqual(metrics, EMPTY_BODY_METRICS);
    assert.equal(hasAnyBodyMetric(metrics), false);
  });

  it('reads a missing profile (brand-new device) as fully unset', () => {
    assert.deepEqual(readBodyMetrics(null), EMPTY_BODY_METRICS);
    assert.deepEqual(readBodyMetrics(undefined), EMPTY_BODY_METRICS);
  });

  it('reports that something is stored as soon as one metric is set', () => {
    assert.equal(hasAnyBodyMetric(readBodyMetrics({ heightCm: 175 })), true);
  });
});

describe('bodyMetricsFormKey', () => {
  const stored: BodyMetrics = {
    heightCm: 178,
    birthYear: 1990,
    biologicalSex: 'female',
    reproductiveStatus: 'pregnant',
  };

  it('is stable for the same metrics, so typing never remounts the form', () => {
    assert.equal(bodyMetricsFormKey(stored), bodyMetricsFormKey({ ...stored }));
  });

  it('changes when the details are removed, which is what resets the fields on screen', () => {
    assert.notEqual(bodyMetricsFormKey(stored), bodyMetricsFormKey(EMPTY_BODY_METRICS));
  });

  it('changes for a change in any single metric', () => {
    const baseline = bodyMetricsFormKey(stored);
    assert.notEqual(bodyMetricsFormKey({ ...stored, heightCm: 179 }), baseline);
    assert.notEqual(bodyMetricsFormKey({ ...stored, birthYear: 1991 }), baseline);
    assert.notEqual(bodyMetricsFormKey({ ...stored, biologicalSex: 'male' }), baseline);
    assert.notEqual(bodyMetricsFormKey({ ...stored, reproductiveStatus: null }), baseline);
  });

  it('does not confuse a cleared metric with one that happens to stringify alike', () => {
    assert.notEqual(
      bodyMetricsFormKey({ ...EMPTY_BODY_METRICS, heightCm: 178 }),
      bodyMetricsFormKey({ ...EMPTY_BODY_METRICS, birthYear: 178 }),
    );
  });
});

describe('validateBodyMetricsForm', () => {
  it('accepts an entirely blank form as "declined everything"', () => {
    const submission = validateBodyMetricsForm(
      { heightCm: '', birthYear: '', biologicalSex: '', reproductiveStatus: '' },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(submission), false);
    assert.deepEqual(submission.values, EMPTY_BODY_METRICS);
  });

  it('reports a filled-in field that cannot be read, instead of silently clearing it', () => {
    const submission = validateBodyMetricsForm(
      { heightCm: 'about six foot', birthYear: '85', biologicalSex: 'female', reproductiveStatus: 'none' },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(submission), true);
    assert.equal(submission.errors.heightCm, BODY_HEIGHT_INVALID_KEY);
    assert.equal(submission.errors.birthYear, BODY_BIRTH_YEAR_INVALID_KEY);
  });

  it('applies the sex invariant to what it returns', () => {
    const submission = validateBodyMetricsForm(
      { heightCm: '170', birthYear: '1990', biologicalSex: 'male', reproductiveStatus: 'pregnant' },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(submission), false);
    assert.equal(submission.values.reproductiveStatus, null);
  });
});

describe('parsePregnancyDueDate', () => {
  it('reads a blank field as "declined", not as an error', () => {
    assert.equal(parsePregnancyDueDate('', { today: TODAY }), null);
    assert.equal(parsePregnancyDueDate(null, { today: TODAY }), null);
  });

  it('accepts a due date exactly MAX_WEEKS_UNTIL_DUE_DATE weeks out, and refuses one week further', () => {
    const atCeiling = shiftDate(TODAY_KEY, MAX_WEEKS_UNTIL_DUE_DATE * 7);
    const pastCeiling = shiftDate(TODAY_KEY, (MAX_WEEKS_UNTIL_DUE_DATE + 1) * 7);
    // The control: 42 weeks is a real, if very early, pregnancy and is kept.
    assert.equal(parsePregnancyDueDate(atCeiling, { today: TODAY }), atCeiling);
    assert.equal(parsePregnancyDueDate(pastCeiling, { today: TODAY }), null);
  });

  it('accepts today itself and refuses the day before it', () => {
    assert.equal(parsePregnancyDueDate(TODAY_KEY, { today: TODAY }), TODAY_KEY);
    assert.equal(parsePregnancyDueDate(shiftDate(TODAY_KEY, -1), { today: TODAY }), null);
  });

  it('names WHY it refused, so the form can say something better than "invalid"', () => {
    assert.deepEqual(inspectPregnancyDueDate(shiftDate(TODAY_KEY, -1), { today: TODAY }), {
      kind: 'rejected',
      reason: 'past',
    });
    assert.deepEqual(inspectPregnancyDueDate(shiftDate(TODAY_KEY, (MAX_WEEKS_UNTIL_DUE_DATE + 1) * 7), {
      today: TODAY,
    }), { kind: 'rejected', reason: 'too-far' });
    assert.deepEqual(inspectPregnancyDueDate('not a date', { today: TODAY }), {
      kind: 'rejected',
      reason: 'unreadable',
    });
    // The control: a usable date is not a rejection at all.
    assert.deepEqual(inspectPregnancyDueDate(TODAY_KEY, { today: TODAY }), { kind: 'date', value: TODAY_KEY });
  });
});

describe('parseLactationStartDate', () => {
  it('reads a blank field as "declined"', () => {
    assert.equal(parseLactationStartDate('', { today: TODAY }), null);
  });

  it('refuses a birth date in the future and keeps today itself', () => {
    assert.equal(parseLactationStartDate(shiftDate(TODAY_KEY, 1), { today: TODAY }), null);
    assert.equal(parseLactationStartDate(TODAY_KEY, { today: TODAY }), TODAY_KEY);
  });

  it('keeps a long-past birth date, because a long-fed child is not a typo', () => {
    const threeYearsAgo = shiftDate(TODAY_KEY, -1095);
    assert.equal(parseLactationStartDate(threeYearsAgo, { today: TODAY }), threeYearsAgo);
  });
});

describe('validateBodyMetricsForm, the two dates', () => {
  const blank = { heightCm: '', birthYear: '', biologicalSex: '', reproductiveStatus: '' };

  it('passes a blank due date through as null with no error', () => {
    const submission = validateBodyMetricsForm(
      { ...blank, reproductiveStatus: 'pregnant', pregnancyDueDate: '' },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(submission), false);
    assert.equal(submission.values.pregnancyDueDate, null);
  });

  it('reports the out-of-range due date against its own field, and keeps an in-range one', () => {
    const rejected = validateBodyMetricsForm(
      {
        ...blank,
        reproductiveStatus: 'pregnant',
        pregnancyDueDate: shiftDate(TODAY_KEY, (MAX_WEEKS_UNTIL_DUE_DATE + 1) * 7),
      },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(rejected), true);
    assert.equal(rejected.errors.pregnancyDueDate, BODY_DUE_DATE_RANGE_KEY);

    // The control: the same form one week earlier saves without a word.
    const accepted = validateBodyMetricsForm(
      { ...blank, reproductiveStatus: 'pregnant', pregnancyDueDate: shiftDate(TODAY_KEY, MAX_WEEKS_UNTIL_DUE_DATE * 7) },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(accepted), false);
    assert.equal(accepted.values.pregnancyDueDate, shiftDate(TODAY_KEY, MAX_WEEKS_UNTIL_DUE_DATE * 7));
  });

  it('tells a passed due date apart from an implausible one', () => {
    const submission = validateBodyMetricsForm(
      { ...blank, reproductiveStatus: 'pregnant', pregnancyDueDate: shiftDate(TODAY_KEY, -1) },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(submission.errors.pregnancyDueDate, BODY_DUE_DATE_PAST_KEY);
  });

  it('reports a birth date in the future, and accepts one in the past', () => {
    const rejected = validateBodyMetricsForm(
      { ...blank, reproductiveStatus: 'lactating', lactationStartDate: shiftDate(TODAY_KEY, 1) },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(rejected), true);
    assert.equal(rejected.errors.lactationStartDate, BODY_START_DATE_FUTURE_KEY);

    const accepted = validateBodyMetricsForm(
      { ...blank, reproductiveStatus: 'lactating', lactationStartDate: shiftDate(TODAY_KEY, -120) },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(accepted), false);
    assert.equal(accepted.values.lactationStartDate, shiftDate(TODAY_KEY, -120));
  });

  it('drops a due date whose status went away, rather than storing it beside the wrong answer', () => {
    const submission = validateBodyMetricsForm(
      { ...blank, reproductiveStatus: 'lactating', pregnancyDueDate: shiftDate(TODAY_KEY, 70) },
      { currentYear: CURRENT_YEAR, today: TODAY },
    );
    assert.equal(hasBodyMetricsErrors(submission), false);
    assert.equal(submission.values.pregnancyDueDate, null);
  });
});

describe('deriveAgeYears / age bands', () => {
  it('derives whole years from the birth year alone', () => {
    assert.equal(deriveAgeYears({ birthYear: 1985, currentYear: CURRENT_YEAR }), 41);
  });

  it('answers null when the birth year is unset', () => {
    assert.equal(deriveAgeYears({ birthYear: null, currentYear: CURRENT_YEAR }), null);
  });

  it('maps every age onto the reference-data band it belongs to', () => {
    assert.equal(resolveRdaAgeBand(14), '14-18');
    assert.equal(resolveRdaAgeBand(18), '14-18');
    assert.equal(resolveRdaAgeBand(19), '19-30');
    assert.equal(resolveRdaAgeBand(30), '19-30');
    assert.equal(resolveRdaAgeBand(31), '31-50');
    assert.equal(resolveRdaAgeBand(50), '31-50');
    assert.equal(resolveRdaAgeBand(51), '51-70');
    assert.equal(resolveRdaAgeBand(70), '51-70');
    assert.equal(resolveRdaAgeBand(71), 'over_70');
    assert.equal(resolveRdaAgeBand(99), 'over_70');
  });

  it('has no band below the youngest one the source data covers', () => {
    assert.equal(resolveRdaAgeBand(13), null);
    assert.equal(resolveRdaAgeBand(0), null);
    assert.equal(resolveRdaAgeBand(null), null);
  });

  it('resolves a band straight from a stored birth year', () => {
    assert.equal(resolveAgeBandForBirthYear({ birthYear: 1985, currentYear: CURRENT_YEAR }), '31-50');
    assert.equal(resolveAgeBandForBirthYear({ birthYear: 2000, currentYear: CURRENT_YEAR }), '19-30');
    assert.equal(resolveAgeBandForBirthYear({ birthYear: null, currentYear: CURRENT_YEAR }), null);
  });
});

describe('computeBmrKcal (Mifflin-St Jeor)', () => {
  it('matches the published equation for a male', () => {
    // 10×80 + 6.25×180 − 5×41 + 5 = 800 + 1125 − 205 + 5 = 1725
    const bmr = computeBmrKcal({
      weightKg: 80,
      heightCm: 180,
      biologicalSex: 'male',
      birthYear: 1985,
      currentYear: CURRENT_YEAR,
    });
    assert.equal(bmr, 1725);
  });

  it('matches the published equation for a female', () => {
    // 10×65 + 6.25×165 − 5×36 − 161 = 650 + 1031.25 − 180 − 161 = 1340.25 → 1340
    const bmr = computeBmrKcal({
      weightKg: 65,
      heightCm: 165,
      biologicalSex: 'female',
      birthYear: 1990,
      currentYear: CURRENT_YEAR,
    });
    assert.equal(bmr, 1340);
  });

  it('answers null when any single input is missing — never a substituted average', () => {
    const complete = {
      weightKg: 80,
      heightCm: 180,
      biologicalSex: 'male',
      birthYear: 1985,
      currentYear: CURRENT_YEAR,
    } as const;
    assert.equal(computeBmrKcal({ ...complete, weightKg: null }), null);
    assert.equal(computeBmrKcal({ ...complete, heightCm: null }), null);
    assert.equal(computeBmrKcal({ ...complete, biologicalSex: null }), null);
    assert.equal(computeBmrKcal({ ...complete, birthYear: null }), null);
  });

  it('answers null for a profile with no body metrics set at all', () => {
    assert.equal(
      computeBmrKcal({
        weightKg: null,
        heightCm: EMPTY_BODY_METRICS.heightCm,
        biologicalSex: EMPTY_BODY_METRICS.biologicalSex,
        birthYear: EMPTY_BODY_METRICS.birthYear,
        currentYear: CURRENT_YEAR,
      }),
      null,
    );
  });

  it('answers null for a nonsensical weight or height rather than a negative estimate', () => {
    const base = { heightCm: 180, biologicalSex: 'male', birthYear: 1985, currentYear: CURRENT_YEAR } as const;
    assert.equal(computeBmrKcal({ ...base, weightKg: 0 }), null);
    assert.equal(computeBmrKcal({ ...base, weightKg: -5 }), null);
    assert.equal(computeBmrKcal({ ...base, weightKg: 80, heightCm: 0 }), null);
  });
});

describe('computeTdeeKcal / suggestDailyKcal', () => {
  const complete = {
    weightKg: 80,
    heightCm: 180,
    biologicalSex: 'male',
    birthYear: 1985,
    currentYear: CURRENT_YEAR,
  } as const;

  it('multiplies BMR by the disclosed activity factor', () => {
    assert.equal(computeTdeeKcal(complete), Math.round(1725 * LIGHTLY_ACTIVE_FACTOR));
  });

  it('honours an explicit activity factor', () => {
    assert.equal(computeTdeeKcal({ ...complete, activityFactor: 1 }), 1725);
  });

  it('rounds the suggested target to the nearest 10 kcal, so it reads as an estimate', () => {
    const suggestion = suggestDailyKcal(complete);
    assert.ok(suggestion !== null);
    assert.equal(suggestion % 10, 0);
    assert.equal(suggestion, 2370);
  });

  it('offers no suggestion whenever an input is missing', () => {
    assert.equal(suggestDailyKcal({ ...complete, weightKg: null }), null);
    assert.equal(suggestDailyKcal({ ...complete, heightCm: null }), null);
    assert.equal(suggestDailyKcal({ ...complete, biologicalSex: null }), null);
    assert.equal(suggestDailyKcal({ ...complete, birthYear: null }), null);
  });

  it('ignores pregnancy and lactation entirely — this is a food log, not a clinic', () => {
    // `EnergyEstimateInput` has no `reproductiveStatus` field at all, so the
    // status physically cannot reach the equation. This pins the number that
    // falls out for a pregnant profile: the plain female figure, unadjusted.
    // 10×65 + 6.25×165 − 5×36 − 161 = 1340.25 → 1340; ×1.375 = 1842.5 → 1843 → 1840.
    const pregnant: BodyMetrics = {
      heightCm: 165,
      birthYear: 1990,
      biologicalSex: 'female',
      reproductiveStatus: 'pregnant',
    };
    const suggestion = suggestDailyKcal({
      weightKg: 65,
      heightCm: pregnant.heightCm,
      biologicalSex: pregnant.biologicalSex,
      birthYear: pregnant.birthYear,
      currentYear: CURRENT_YEAR,
    });
    assert.equal(suggestion, 1840);
  });
});

describe('the protein floor, from height and sex', () => {
  it('is Devine ideal weight times 1.6 g/kg, worked through for a male at 180 cm', () => {
    // 180 - 152.4 = 27.6 cm = 10.8661417 in; x 2.3 = 24.9921260; + 50 =
    // 74.9921260 kg; x 1.6 = 119.9874016 g, rounded to 120.
    const idealWeightKg = computeDevineIdealWeightKg({ heightCm: 180, biologicalSex: 'male' });
    assert.ok(idealWeightKg !== null);
    assert.ok(Math.abs(idealWeightKg - 74.992126) < 1e-6);
    assert.equal(estimateProteinFloorG({ heightCm: 180, biologicalSex: 'male' }), 120);
    assert.equal(PROTEIN_PER_KG, 1.6);
  });

  it('is sex-segmented: the same height gives a lower floor for a female', () => {
    // 165 cm female: 45.5 + 11.4094488 = 56.9094488 kg; x 1.6 = 91.0551181 g.
    assert.equal(estimateProteinFloorG({ heightCm: 165, biologicalSex: 'female' }), 91);
    assert.equal(estimateProteinFloorG({ heightCm: 165, biologicalSex: 'male' }), 98);
  });

  it('offers no floor whenever height or sex is missing, or the height is out of range', () => {
    assert.equal(estimateProteinFloorG({ heightCm: null, biologicalSex: 'male' }), null);
    assert.equal(estimateProteinFloorG({ heightCm: 180, biologicalSex: null }), null);
    assert.equal(estimateProteinFloorG({ heightCm: 150, biologicalSex: 'male' }), null);
  });

  it('does not move with body weight, which is the reason the basis changed', () => {
    // The energy estimate above takes a weight; this one does not, by design.
    // `ProteinFloorInput` has no weight field at all, so a weigh-in physically
    // cannot reach the equation.
    const light = suggestProteinFloor({ heightCm: 180, biologicalSex: 'male', latestWeighInKg: 70 });
    const heavy = suggestProteinFloor({ heightCm: 180, biologicalSex: 'male', latestWeighInKg: 130 });
    assert.deepEqual(light, heavy);
    assert.deepEqual(light, { grams: 120, method: 'height' });
  });

  it('keeps the weigh-in rule as the fallback, so an unset profile still gets a number', () => {
    assert.deepEqual(suggestProteinFloor({ heightCm: null, biologicalSex: null, latestWeighInKg: 82 }), {
      grams: 131,
      method: 'weight',
    });
    assert.equal(suggestProteinFloor({ heightCm: null, biologicalSex: null, latestWeighInKg: null }), null);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The reference protein floor
////////////////////////////////////////////////////////////////////////////////

/**
 * `computeReferenceProteinFloor` stands in for a floor the person never set, so
 * unlike every other function in this file it must ALWAYS answer. What is
 * pinned here is the fallback ORDER (weigh-in, then height, then the flat
 * labelling figure), the two additions on top of each basis, and the rounding.
 *
 * Every figure below is arithmetic anyone can redo by hand from the four
 * exported constants, which is why the constants are imported rather than the
 * numbers being retyped.
 */
/**
 * The EFSA basis, for a person with no birth year on file. EFSA's 0.83 g/kg
 * reads no age, so these cases keep the figures they had before M263/04.
 */
const EFSA_NO_AGE = { nutrientReferenceBasis: 'efsa', birthYear: null, currentYear: 2026 } as const;

describe('computeReferenceProteinFloor', () => {
  const MALE_180 = { heightCm: 180, biologicalSex: 'male' } as const;
  /**
   * "No date on file": what every caller passed before a due date could be
   * recorded, and what a pregnancy or lactation with no date still passes today.
   * The stage-aware cases below pass a real trimester or month count instead.
   * It also carries the EFSA basis with no age, the one figure this block pins
   * (the DGE block further down pins the other).
   */
  const NO_STAGE = { trimester: null, lactationMonths: null, ...EFSA_NO_AGE } as const;

  it('scales the latest weigh-in by the EFSA reference intake', () => {
    // 82 kg x 0.83 = 68.06 g.
    assert.deepEqual(
      computeReferenceProteinFloor({
        latestWeighInKg: 82,
        heightCm: null,
        biologicalSex: null,
        ...NO_STAGE,
        reproductiveStatus: null,
      }),
      { grams: 68, basis: 'weigh-in' },
    );
    assert.equal(EFSA_PROTEIN_REFERENCE_G_PER_KG, 0.83);
  });

  it('falls back to the Devine reference mass when there is no weigh-in', () => {
    // 180 cm male: 74.992126 kg x 0.83 = 62.2434... g.
    assert.deepEqual(
      computeReferenceProteinFloor({ latestWeighInKg: null, ...MALE_180, ...NO_STAGE, reproductiveStatus: null }),
      {
        grams: 62,
        basis: 'height',
      },
    );
    // Control: the same height as a female gives a different figure, so the
    // 'height' basis really is running Devine and not returning a constant.
    assert.deepEqual(
      computeReferenceProteinFloor({
        latestWeighInKg: null,
        heightCm: 165,
        biologicalSex: 'female',
        ...NO_STAGE,
        reproductiveStatus: null,
      }),
      { grams: 47, basis: 'height' },
    );
  });

  it('falls back to the flat labelling reference intake when there is no basis at all', () => {
    assert.deepEqual(
      computeReferenceProteinFloor({
        latestWeighInKg: null,
        heightCm: null,
        biologicalSex: null,
        ...NO_STAGE,
        reproductiveStatus: 'none',
      }),
      { grams: EU_PROTEIN_REFERENCE_INTAKE_G, basis: 'labelling' },
    );
    // A height Devine refuses (below 152.4 cm) is still "no basis", not a
    // silently extrapolated one.
    assert.deepEqual(
      computeReferenceProteinFloor({
        latestWeighInKg: null,
        heightCm: 150,
        biologicalSex: 'male',
        ...NO_STAGE,
        reproductiveStatus: null,
      }),
      { grams: 50, basis: 'labelling' },
    );
  });

  it('prefers a weigh-in over height, which is the whole point of the order', () => {
    // CONTROL: this person has BOTH. The weigh-in answer (58) and the height
    // answer (62) differ, so the assertion cannot pass by accident.
    const both = computeReferenceProteinFloor({
      latestWeighInKg: 70,
      ...MALE_180,
      ...NO_STAGE,
      reproductiveStatus: null,
    });
    const heightOnly = computeReferenceProteinFloor({
      latestWeighInKg: null,
      ...MALE_180,
      ...NO_STAGE,
      reproductiveStatus: null,
    });
    assert.deepEqual(both, { grams: 58, basis: 'weigh-in' });
    assert.deepEqual(heightOnly, { grams: 62, basis: 'height' });
    assert.notEqual(both.grams, heightOnly.grams);
  });

  it('adds the no-date pregnancy and lactation figures on top of whichever basis was used', () => {
    // 70 kg x 0.83 = 58.1 g, plus the largest figure for the status: 28 or 19.
    const pregnantOnWeight = computeReferenceProteinFloor({
      latestWeighInKg: 70,
      heightCm: null,
      biologicalSex: null,
      ...NO_STAGE,
      reproductiveStatus: 'pregnant',
    });
    const lactatingOnWeight = computeReferenceProteinFloor({
      latestWeighInKg: 70,
      heightCm: null,
      biologicalSex: null,
      ...NO_STAGE,
      reproductiveStatus: 'lactating',
    });
    assert.deepEqual(pregnantOnWeight, { grams: 58 + EFSA_PREGNANCY_T3_PROTEIN_ADDITION_G, basis: 'weigh-in' });
    assert.deepEqual(lactatingOnWeight, { grams: 58 + EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G, basis: 'weigh-in' });

    // On the height basis: 62.2434 + 28 = 90.24 g.
    assert.deepEqual(
      computeReferenceProteinFloor({
        latestWeighInKg: null,
        heightCm: 180,
        biologicalSex: 'male',
        ...NO_STAGE,
        reproductiveStatus: 'pregnant',
      }),
      { grams: 90, basis: 'height' },
    );
    // On the labelling basis.
    assert.deepEqual(
      computeReferenceProteinFloor({
        latestWeighInKg: null,
        heightCm: null,
        biologicalSex: null,
        ...NO_STAGE,
        reproductiveStatus: 'lactating',
      }),
      { grams: EU_PROTEIN_REFERENCE_INTAKE_G + EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G, basis: 'labelling' },
    );
    // CONTROL: 'none' adds nothing, so the two assertions above are measuring
    // the addition and not a constant that was always there.
    assert.equal(
      computeReferenceProteinFloor({
        latestWeighInKg: 70,
        heightCm: null,
        biologicalSex: null,
        ...NO_STAGE,
        reproductiveStatus: 'none',
      }).grams,
      58,
    );
  });

  it('rounds to a whole gram, including the exact half', () => {
    // 50 kg x 0.83 = 41.5 g exactly, which must not be reported as 41.5.
    const half = computeReferenceProteinFloor({
      latestWeighInKg: 50,
      heightCm: null,
      biologicalSex: null,
      ...NO_STAGE,
      reproductiveStatus: null,
    });
    assert.equal(half.grams, 42);
    assert.equal(Number.isInteger(half.grams), true);
  });

  it('ignores a weigh-in that is not a usable number', () => {
    assert.deepEqual(
      computeReferenceProteinFloor({ latestWeighInKg: 0, ...MALE_180, ...NO_STAGE, reproductiveStatus: null }),
      {
        grams: 62,
        basis: 'height',
      },
    );
    assert.deepEqual(
      computeReferenceProteinFloor({
        latestWeighInKg: Number.NaN,
        heightCm: null,
        biologicalSex: null,
        ...NO_STAGE,
        reproductiveStatus: null,
      }),
      { grams: 50, basis: 'labelling' },
    );
  });
});

/**
 * The stage-aware half of the reference floor (M206/03).
 *
 * EFSA publishes one protein addition per trimester and two for lactation, and
 * the app can now resolve which one applies from the person's own due date or
 * birth date. What is pinned here is every stage, the day-before boundary that
 * separates the two lactation figures, and the fallback: with no date to resolve
 * from, the LARGEST figure for the status still applies, exactly as it did
 * before a date could be recorded.
 *
 * The stage arrives already resolved, as `ReproductiveStageInput`, because
 * `resolveGestation` and `resolveLactationMonths` own the calendar arithmetic
 * one module away, see `tests/unit/reproductive-stage.test.ts`.
 */
/** 70 kg x 0.83 = 58.1 g of base, so every stage figure below is 58 plus its addition. */
const BASE_G = 58;

/** The reference floor for one 70 kg person, varying nothing but the resolved stage. */
function floorGramsFor(stage: ReproductiveStageInput): number {
  return computeReferenceProteinFloor({
    ...stage,
    ...EFSA_NO_AGE,
    latestWeighInKg: 70,
    heightCm: null,
    biologicalSex: null,
  }).grams;
}

describe('computeReferenceProteinFloor across the reproductive stage', () => {
  it('applies the figure for the trimester the caller resolved', () => {
    const pregnant = { reproductiveStatus: 'pregnant', lactationMonths: null } as const;
    assert.equal(floorGramsFor({ ...pregnant, trimester: 1 }), BASE_G + EFSA_PREGNANCY_T1_PROTEIN_ADDITION_G);
    assert.equal(floorGramsFor({ ...pregnant, trimester: 2 }), BASE_G + EFSA_PREGNANCY_T2_PROTEIN_ADDITION_G);
    assert.equal(floorGramsFor({ ...pregnant, trimester: 3 }), BASE_G + EFSA_PREGNANCY_T3_PROTEIN_ADDITION_G);
    // CONTROL: the three answers are three different numbers, so the assertions
    // above cannot pass against a function that ignores the trimester.
    const everyTrimester: Trimester[] = [1, 2, 3];
    assert.equal(new Set(everyTrimester.map((trimester) => floorGramsFor({ ...pregnant, trimester }))).size, 3);
    assert.deepEqual(
      [
        EFSA_PREGNANCY_T1_PROTEIN_ADDITION_G,
        EFSA_PREGNANCY_T2_PROTEIN_ADDITION_G,
        EFSA_PREGNANCY_T3_PROTEIN_ADDITION_G,
      ],
      [1, 9, 28],
    );
  });

  it('falls back to the third-trimester figure when no due date resolved a trimester', () => {
    const noDueDate = { reproductiveStatus: 'pregnant', trimester: null, lactationMonths: null } as const;
    assert.equal(floorGramsFor(noDueDate), BASE_G + EFSA_PREGNANCY_T3_PROTEIN_ADDITION_G);
    // CONTROL: the fallback is the LARGEST figure, not simply "whatever T1 is".
    assert.notEqual(floorGramsFor(noDueDate), floorGramsFor({ ...noDueDate, trimester: 1 }));
    assert.equal(floorGramsFor(noDueDate), floorGramsFor({ ...noDueDate, trimester: 3 }));
  });

  it('splits lactation at six months, with the month before as the control', () => {
    const lactating = { reproductiveStatus: 'lactating', trimester: null } as const;
    assert.equal(
      floorGramsFor({ ...lactating, lactationMonths: 0 }),
      BASE_G + EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G,
    );
    // The last month of the first period, and the first month after it.
    assert.equal(
      floorGramsFor({ ...lactating, lactationMonths: 5 }),
      BASE_G + EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G,
    );
    assert.equal(
      floorGramsFor({ ...lactating, lactationMonths: 6 }),
      BASE_G + EFSA_LACTATION_PROTEIN_ADDITION_AFTER_6MO_G,
    );
    assert.equal(
      floorGramsFor({ ...lactating, lactationMonths: 18 }),
      BASE_G + EFSA_LACTATION_PROTEIN_ADDITION_AFTER_6MO_G,
    );
    // CONTROL: month five and month six really do answer differently.
    assert.notEqual(
      floorGramsFor({ ...lactating, lactationMonths: 5 }),
      floorGramsFor({ ...lactating, lactationMonths: 6 }),
    );
    assert.deepEqual(
      [EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G, EFSA_LACTATION_PROTEIN_ADDITION_AFTER_6MO_G],
      [19, 13],
    );
  });

  it('falls back to the first-six-months figure when no birth date resolved a month count', () => {
    const noBirthDate = { reproductiveStatus: 'lactating', trimester: null, lactationMonths: null } as const;
    assert.equal(floorGramsFor(noBirthDate), BASE_G + EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G);
    // CONTROL: the fallback is the larger of the two, not the later figure.
    assert.notEqual(floorGramsFor(noBirthDate), floorGramsFor({ ...noBirthDate, lactationMonths: 6 }));
  });

  it('ignores a resolved stage that does not belong to the status', () => {
    // A stale month count left over from a status change must not reach the
    // pregnancy branch, and a stale trimester must not reach the lactation one.
    assert.equal(
      floorGramsFor({ reproductiveStatus: 'pregnant', trimester: 2, lactationMonths: 9 }),
      BASE_G + EFSA_PREGNANCY_T2_PROTEIN_ADDITION_G,
    );
    assert.equal(
      floorGramsFor({ reproductiveStatus: 'lactating', trimester: 1, lactationMonths: 2 }),
      BASE_G + EFSA_LACTATION_PROTEIN_ADDITION_FIRST_6MO_G,
    );
    // CONTROL: 'none' still adds nothing at all, whatever the stage fields say.
    assert.equal(floorGramsFor({ reproductiveStatus: 'none', trimester: 3, lactationMonths: 1 }), BASE_G);
  });
});

/**
 * The DGE half of the reference floor (M263/04).
 *
 * Under the `dge` basis, the default, the factor comes from DGE's table by age
 * and sex, the weigh-in is capped at the weight for BMI 25 when the height is
 * known, and DGE's own pregnancy and lactation additions apply. Every figure is
 * arithmetic from https://www.dge.de/wissenschaft/referenzwerte/protein/
 * ("Stand Ableitung: 2017"). Ages are birth years against a fixed year, the way
 * the app stores them.
 */
const DGE_YEAR = 2026;

/** A DGE input for one person of a given age and sex, with a 70 kg weigh-in and nothing else on file. */
function dgePerson({
  ageYears,
  biologicalSex,
}: {
  ageYears: number | null;
  biologicalSex: BiologicalSex | null;
}): ReferenceProteinFloorInput {
  return {
    nutrientReferenceBasis: 'dge',
    birthYear: ageYears === null ? null : DGE_YEAR - ageYears,
    currentYear: DGE_YEAR,
    latestWeighInKg: 70,
    heightCm: null,
    biologicalSex,
    reproductiveStatus: null,
    trimester: null,
    lactationMonths: null,
  };
}

/** The DGE floor in grams for a 70 kg person of a given age and sex. */
function dgeGramsAt(ageYears: number | null, biologicalSex: BiologicalSex | null): number {
  return computeReferenceProteinFloor(dgePerson({ ageYears, biologicalSex })).grams;
}

describe('computeReferenceProteinFloor under the DGE basis', () => {
  it('carries the DGE table as published', () => {
    assert.deepEqual(DGE_PROTEIN_BANDS, [
      { fromAge: 13, belowAge: 15, female: 0.9, male: 0.9 },
      { fromAge: 15, belowAge: 19, female: 0.8, male: 0.9 },
      { fromAge: 19, belowAge: 65, female: 0.8, male: 0.8 },
      { fromAge: 65, belowAge: null, female: 1.0, male: 1.0 },
    ]);
    assert.equal(DGE_PROTEIN_ADULT_G_PER_KG, 0.8);
    assert.equal(DGE_NORMAL_WEIGHT_BMI_LIMIT, 25);
  });

  it('gives 0.9 g/kg to both sexes at 14, the 13 to 15 band', () => {
    // 70 kg x 0.9 = 63 g.
    assert.equal(dgeGramsAt(14, 'female'), 63);
    assert.equal(dgeGramsAt(14, 'male'), 63);
    // CONTROL: one year on, a girl drops to 0.8, so the band edge is real.
    assert.equal(dgeGramsAt(15, 'female'), 56);
  });

  it('splits 15 to 18 by sex: 0.9 for boys, 0.8 for girls', () => {
    for (const age of [15, 16, 18]) {
      assert.equal(dgeGramsAt(age, 'male'), 63, `male ${age}`);
      assert.equal(dgeGramsAt(age, 'female'), 56, `female ${age}`);
    }
  });

  it('takes the higher value between 15 and 18 when no sex is on file, because this is a floor', () => {
    assert.equal(dgeGramsAt(16, null), 63);
    // CONTROL: the lower value is really there to choose against.
    assert.notEqual(dgeGramsAt(16, null), dgeGramsAt(16, 'female'));
  });

  it('gives 0.8 g/kg from 19 to 64, for both sexes', () => {
    assert.equal(dgeGramsAt(19, 'male'), 56);
    assert.equal(dgeGramsAt(40, 'female'), 56);
    assert.equal(dgeGramsAt(64, 'male'), 56);
    // CONTROL: 18 and 19 differ for a boy, so the adult band starts at 19.
    assert.notEqual(dgeGramsAt(18, 'male'), dgeGramsAt(19, 'male'));
  });

  it('gives 1.0 g/kg from 65', () => {
    // 70 kg x 1.0 = 70 g.
    assert.equal(dgeGramsAt(65, 'female'), 70);
    assert.equal(dgeGramsAt(70, 'male'), 70);
    assert.equal(dgeGramsAt(100, null), 70);
    // CONTROL: 64 is still the adult value.
    assert.notEqual(dgeGramsAt(64, 'female'), dgeGramsAt(65, 'female'));
  });

  it('uses the adult value when no age is on file', () => {
    assert.equal(dgeGramsAt(null, 'male'), 56);
    assert.equal(dgeGramsAt(null, null), 56);
    // CONTROL: the same person at 70 gets more, so the age really is read.
    assert.notEqual(dgeGramsAt(null, null), dgeGramsAt(70, null));
  });

  it('scales by the weight at BMI 25 when the weigh-in is above it and the height is known', () => {
    const heavy = { ...dgePerson({ ageYears: 30, biologicalSex: 'male' }), latestWeighInKg: 90 };
    // 170 cm: 25 x 1.7^2 = 72.25 kg, x 0.8 = 57.8 g.
    assert.deepEqual(computeReferenceProteinFloor({ ...heavy, heightCm: 170 }), { grams: 58, basis: 'weigh-in' });
    // CONTROL: with no height there is no normal weight to cap at, so the
    // actual 90 kg counts: 90 x 0.8 = 72 g.
    assert.equal(computeReferenceProteinFloor(heavy).grams, 72);
  });

  it('does not cap a weigh-in at BMI 24.9', () => {
    // 260 cm, the tallest height the app stores, so a tenth of a BMI point is
    // worth more than a rounding step. At 70 the factor is 1.0.
    const tall = { ...dgePerson({ ageYears: 70, biologicalSex: 'male' }), heightCm: 260 };
    const atBmi249Kg = 24.9 * 2.6 * 2.6;
    // 168.324 kg x 1.0, the actual weight.
    assert.equal(computeReferenceProteinFloor({ ...tall, latestWeighInKg: atBmi249Kg }).grams, 168);
    // CONTROL: a cap at BMI 25 would have answered 25 x 2.6^2 = 169 g, and
    // above BMI 25 it does.
    assert.equal(computeReferenceProteinFloor({ ...tall, latestWeighInKg: 180 }).grams, 169);
  });

  it('applies the DGE factor to the Devine mass when there is no weigh-in', () => {
    const noWeighIn = {
      ...dgePerson({ ageYears: 30, biologicalSex: 'male' }),
      latestWeighInKg: null,
      heightCm: 180,
    };
    // 180 cm male: 74.992126 kg x 0.8 = 59.99 g.
    assert.deepEqual(computeReferenceProteinFloor(noWeighIn), { grams: 60, basis: 'height' });
    // At 70: x 1.0 = 74.99 g.
    assert.deepEqual(computeReferenceProteinFloor({ ...noWeighIn, birthYear: DGE_YEAR - 70 }), {
      grams: 75,
      basis: 'height',
    });
    // CONTROL: the EFSA basis gives the same person 62 g, so the basis is read.
    assert.equal(computeReferenceProteinFloor({ ...noWeighIn, nutrientReferenceBasis: 'efsa' }).grams, 62);
  });

  it('keeps the flat labelling figure with no factor when there is no body mass at all', () => {
    const nothing = {
      ...dgePerson({ ageYears: 70, biologicalSex: null }),
      latestWeighInKg: null,
    };
    assert.deepEqual(computeReferenceProteinFloor(nothing), { grams: EU_PROTEIN_REFERENCE_INTAKE_G, basis: 'labelling' });
  });

  it('adds the DGE pregnancy figures by trimester, with T3 when no due date resolved one', () => {
    const pregnant = {
      ...dgePerson({ ageYears: 30, biologicalSex: 'female' }),
      reproductiveStatus: 'pregnant',
    } as const;
    // Base 70 kg x 0.8 = 56 g.
    assert.equal(computeReferenceProteinFloor({ ...pregnant, trimester: 1 }).grams, 56 + DGE_PREGNANCY_T1_PROTEIN_ADDITION_G);
    assert.equal(computeReferenceProteinFloor({ ...pregnant, trimester: 2 }).grams, 56 + DGE_PREGNANCY_T2_PROTEIN_ADDITION_G);
    assert.equal(computeReferenceProteinFloor({ ...pregnant, trimester: 3 }).grams, 56 + DGE_PREGNANCY_T3_PROTEIN_ADDITION_G);
    assert.equal(computeReferenceProteinFloor({ ...pregnant, trimester: null }).grams, 56 + DGE_PREGNANCY_T3_PROTEIN_ADDITION_G);
    assert.deepEqual(
      [DGE_PREGNANCY_T1_PROTEIN_ADDITION_G, DGE_PREGNANCY_T2_PROTEIN_ADDITION_G, DGE_PREGNANCY_T3_PROTEIN_ADDITION_G],
      [0, 7, 21],
    );
    // CONTROL: the EFSA figures differ in every trimester (1, 9, 28), so these
    // are DGE's and not EFSA's on a DGE base.
    assert.notEqual(
      computeReferenceProteinFloor({ ...pregnant, trimester: 2 }).grams,
      56 + EFSA_PREGNANCY_T2_PROTEIN_ADDITION_G,
    );
  });

  it('adds one DGE lactation figure, whatever the month count', () => {
    const lactating = {
      ...dgePerson({ ageYears: 30, biologicalSex: 'female' }),
      reproductiveStatus: 'lactating',
    } as const;
    assert.equal(DGE_LACTATION_PROTEIN_ADDITION_G, 23);
    for (const lactationMonths of [null, 0, 5, 6, 18]) {
      assert.equal(computeReferenceProteinFloor({ ...lactating, lactationMonths }).grams, 56 + 23, `month ${lactationMonths}`);
    }
    // CONTROL: 'none' adds nothing.
    assert.equal(computeReferenceProteinFloor({ ...lactating, reproductiveStatus: 'none' }).grams, 56);
  });
});

describe('computeReferenceProteinFloor under the EFSA and US bases', () => {
  it('keeps 0.83 g/kg under efsa, whatever the age, and caps nothing', () => {
    const seventy = dgePerson({ ageYears: 70, biologicalSex: 'male' });
    // 70 kg x 0.83 = 58.1 g, where DGE gives this 70-year-old 70 g.
    assert.equal(computeReferenceProteinFloor({ ...seventy, nutrientReferenceBasis: 'efsa' }).grams, 58);
    assert.equal(computeReferenceProteinFloor(seventy).grams, 70);
    // 90 kg at 170 cm: 90 x 0.83 = 74.7 g, not the capped DGE figure.
    const heavy = { ...seventy, nutrientReferenceBasis: 'efsa', latestWeighInKg: 90, heightCm: 170 } as const;
    assert.equal(computeReferenceProteinFloor(heavy).grams, 75);
  });

  it('keeps the EFSA figure and additions under us, unchanged', () => {
    const us = {
      ...dgePerson({ ageYears: 16, biologicalSex: 'female' }),
      nutrientReferenceBasis: 'us',
      latestWeighInKg: 82,
    } as const;
    // 82 kg x 0.83 = 68.06 g, the figure the EFSA block pins.
    assert.equal(computeReferenceProteinFloor(us).grams, 68);
    assert.equal(
      computeReferenceProteinFloor({ ...us, reproductiveStatus: 'pregnant', trimester: 2 }).grams,
      68 + EFSA_PREGNANCY_T2_PROTEIN_ADDITION_G,
    );
    // CONTROL: the same girl under dge gets 0.8 g/kg, 65.6 g.
    assert.equal(computeReferenceProteinFloor({ ...us, nutrientReferenceBasis: 'dge' }).grams, 66);
  });
});

/**
 * The ENERGY addition (M206/03), the protein floor's sibling.
 *
 * It adjusts a calorie target the person typed in, and only when they typed
 * one; `suggestDailyKcal`, which invents a figure from scratch, is untouched by
 * it (M135's locked decision 2). Two distinctions are load-bearing and pinned
 * below: `null` for "no adjustment applies to this person" against `0` for
 * "an adjustment applies, but this milestone had no published figure for the
 * stage", which today is lactation past six months.
 */
describe('computeReferenceKcalAddition', () => {
  it('applies the figure for the trimester the caller resolved', () => {
    const pregnant = { reproductiveStatus: 'pregnant', lactationMonths: null } as const;
    assert.equal(computeReferenceKcalAddition({ ...pregnant, trimester: 1 }), EFSA_PREGNANCY_T1_KCAL_ADDITION);
    assert.equal(computeReferenceKcalAddition({ ...pregnant, trimester: 2 }), EFSA_PREGNANCY_T2_KCAL_ADDITION);
    assert.equal(computeReferenceKcalAddition({ ...pregnant, trimester: 3 }), EFSA_PREGNANCY_T3_KCAL_ADDITION);
    // CONTROL: three distinct published figures, so no branch can be a constant.
    assert.deepEqual(
      [EFSA_PREGNANCY_T1_KCAL_ADDITION, EFSA_PREGNANCY_T2_KCAL_ADDITION, EFSA_PREGNANCY_T3_KCAL_ADDITION],
      [70, 260, 500],
    );
  });

  it('falls back to the third-trimester figure with no due date on file', () => {
    const noDueDate = { reproductiveStatus: 'pregnant', trimester: null, lactationMonths: null } as const;
    assert.equal(computeReferenceKcalAddition(noDueDate), EFSA_PREGNANCY_T3_KCAL_ADDITION);
    // CONTROL: not the first-trimester figure, which is the one it would take
    // if the fallback were "the first branch that matches".
    assert.notEqual(computeReferenceKcalAddition(noDueDate), EFSA_PREGNANCY_T1_KCAL_ADDITION);
  });

  it('answers ZERO, not null, past six months of lactation, because no figure is published', () => {
    const lactating = { reproductiveStatus: 'lactating', trimester: null } as const;
    assert.equal(
      computeReferenceKcalAddition({ ...lactating, lactationMonths: 5 }),
      EFSA_LACTATION_KCAL_ADDITION_FIRST_6MO,
    );
    const afterSixMonths = computeReferenceKcalAddition({ ...lactating, lactationMonths: 6 });
    assert.equal(afterSixMonths, 0);
    // The distinction the docblock draws: 0 is "an addition applies and the
    // published figure is missing", null is "no addition applies to this
    // person at all". A caller that treats them alike loses that.
    assert.notEqual(afterSixMonths, null);
    // CONTROL: month five is not zero, so the boundary is real.
    assert.notEqual(computeReferenceKcalAddition({ ...lactating, lactationMonths: 5 }), 0);
    assert.equal(EFSA_LACTATION_KCAL_ADDITION_FIRST_6MO, 500);
  });

  it('falls back to the first-six-months figure with no birth date on file', () => {
    const lactating = { reproductiveStatus: 'lactating', trimester: null } as const;
    assert.equal(
      computeReferenceKcalAddition({ ...lactating, lactationMonths: null }),
      EFSA_LACTATION_KCAL_ADDITION_FIRST_6MO,
    );
  });

  it('answers NULL for a person who is neither pregnant nor lactating', () => {
    assert.equal(
      computeReferenceKcalAddition({ reproductiveStatus: 'none', trimester: null, lactationMonths: null }),
      null,
    );
    assert.equal(
      computeReferenceKcalAddition({ reproductiveStatus: null, trimester: null, lactationMonths: null }),
      null,
    );
    // CONTROL: null here is a refusal, not the zero the after-six-months branch
    // returns; a stage that DOES apply answers a number.
    assert.equal(
      computeReferenceKcalAddition({ reproductiveStatus: 'pregnant', trimester: 1, lactationMonths: null }),
      70,
    );
  });
});

/**
 * Which date the day view should ask for. The tag it drives is the only place
 * the app admits it used the largest figure rather than the right one.
 */
describe('selectMissingReferenceDate', () => {
  it('asks for the due date only while a pregnancy has no resolved trimester', () => {
    assert.equal(
      selectMissingReferenceDate({ reproductiveStatus: 'pregnant', trimester: null, lactationMonths: null }),
      'due-date',
    );
    // CONTROL: a resolved trimester asks for nothing.
    assert.equal(
      selectMissingReferenceDate({ reproductiveStatus: 'pregnant', trimester: 2, lactationMonths: null }),
      null,
    );
  });

  it('asks for the birth date only while lactation has no resolved month count', () => {
    assert.equal(
      selectMissingReferenceDate({ reproductiveStatus: 'lactating', trimester: null, lactationMonths: null }),
      'birth-date',
    );
    // CONTROL: a resolved month count asks for nothing.
    assert.equal(
      selectMissingReferenceDate({ reproductiveStatus: 'lactating', trimester: null, lactationMonths: 8 }),
      null,
    );
  });

  it('asks for nothing at all from a person who is neither', () => {
    assert.equal(
      selectMissingReferenceDate({ reproductiveStatus: 'none', trimester: null, lactationMonths: null }),
      null,
    );
    assert.equal(
      selectMissingReferenceDate({ reproductiveStatus: null, trimester: null, lactationMonths: null }),
      null,
    );
  });
});

/**
 * `selectLatestWeighInKg` is the one rule for "the latest weigh-in", shared by
 * the two loaders that scale a target by body mass.
 */
describe('selectLatestWeighInKg', () => {
  it('picks the newest dayKey regardless of the order rows arrive in', () => {
    const entries = [
      { dayKey: '2026-01-02', weightKg: 81 },
      { dayKey: '2026-03-09', weightKg: 78 },
      { dayKey: '2026-02-11', weightKg: 80 },
    ];
    assert.equal(selectLatestWeighInKg(entries), 78);
    // CONTROL: reversed input gives the same answer, so this is not just
    // reading the first or the last row.
    assert.equal(selectLatestWeighInKg(entries.toReversed()), 78);
  });

  it('answers null for no weigh-ins at all', () => {
    assert.equal(selectLatestWeighInKg([]), null);
  });
});
