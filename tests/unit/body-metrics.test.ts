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
  computeBmrKcal,
  computeTdeeKcal,
  deriveAgeYears,
  hasAnyBodyMetric,
  hasBodyMetricsErrors,
  normalizeBodyMetrics,
  parseBiologicalSex,
  parseBirthYear,
  parseHeightCm,
  parseReproductiveStatus,
  readBodyMetrics,
  resolveAgeBandForBirthYear,
  resolveRdaAgeBand,
  suggestDailyKcal,
  validateBodyMetricsForm,
  bodyMetricsFormKey,
  type BodyMetrics,
} from '../../app/models/body-metrics';

const CURRENT_YEAR = 2026;

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
  it('drops a reproductive status when the sex it applies to is not set', () => {
    const normalized = normalizeBodyMetrics({
      heightCm: 170,
      birthYear: 1990,
      biologicalSex: null,
      reproductiveStatus: 'pregnant',
    });
    assert.equal(normalized.reproductiveStatus, null);
    assert.equal(normalized.heightCm, 170);
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
      { currentYear: CURRENT_YEAR },
    );
    assert.equal(hasBodyMetricsErrors(submission), false);
    assert.deepEqual(submission.values, EMPTY_BODY_METRICS);
  });

  it('reports a filled-in field that cannot be read, instead of silently clearing it', () => {
    const submission = validateBodyMetricsForm(
      { heightCm: 'about six foot', birthYear: '85', biologicalSex: 'female', reproductiveStatus: 'none' },
      { currentYear: CURRENT_YEAR },
    );
    assert.equal(hasBodyMetricsErrors(submission), true);
    assert.equal(submission.errors.heightCm, BODY_HEIGHT_INVALID_KEY);
    assert.equal(submission.errors.birthYear, BODY_BIRTH_YEAR_INVALID_KEY);
  });

  it('applies the sex invariant to what it returns', () => {
    const submission = validateBodyMetricsForm(
      { heightCm: '170', birthYear: '1990', biologicalSex: 'male', reproductiveStatus: 'pregnant' },
      { currentYear: CURRENT_YEAR },
    );
    assert.equal(hasBodyMetricsErrors(submission), false);
    assert.equal(submission.values.reproductiveStatus, null);
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
