/**
 * The Conform/Zod schema behind the body-metrics card (M135). What is worth
 * pinning here is the boundary the pure parsers deliberately don't express:
 * blank means "declined" and passes, a field the person FILLED IN that can't be
 * read fails with copy, and the failure is attributed to the RIGHT field — that
 * attribution is what `getInputProps` turns into `aria-invalid` on the input the
 * person is actually looking at.
 *
 * What this file cannot cover is the stale-error bug itself: `shouldRevalidate:
 * 'onInput'` is Conform runtime behaviour against a live DOM, so it takes a
 * browser to observe. Schema-level tests would pass either way.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { makeBodyMetricsSchema } from '../../app/lib/body-metrics-schema';
import {
  BODY_DUE_DATE_PAST_KEY,
  BODY_DUE_DATE_RANGE_KEY,
  BODY_START_DATE_FUTURE_KEY,
  MAX_WEEKS_UNTIL_DUE_DATE,
} from '../../app/models/body-metrics';
import { shiftDate } from '../../app/lib/user-days';

const CURRENT_YEAR = 2026;

/** Fixed clock for the two date fields, so the suite reads the same next year. */
const TODAY = new Date('2026-09-09T00:00:00.000Z');
const TODAY_KEY = '2026-09-09';

/**
 * Identity translator: assertions read the KEY, so this stays language-proof.
 * The interpolation parameter is appended rather than dropped, so a message
 * that stopped carrying the week ceiling would fail here.
 */
const t = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) =>
  params?.weeks === undefined ? key : `${key}:${String(params.weeks)}`;

const schema = makeBodyMetricsSchema(t, { currentYear: CURRENT_YEAR, today: TODAY });

describe('makeBodyMetricsSchema', () => {
  it('accepts an entirely blank form as "declined everything"', () => {
    const result = schema.safeParse({
      heightCm: '',
      birthYear: '',
      biologicalSex: '',
      reproductiveStatus: '',
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.data, {
      heightCm: null,
      birthYear: null,
      biologicalSex: null,
      reproductiveStatus: null,
      pregnancyDueDate: null,
      lactationStartDate: null,
    });
  });

  it('treats absent fields the same as blank ones', () => {
    const result = schema.safeParse({});
    assert.equal(result.success, true);
    assert.equal(result.data?.heightCm, null);
    assert.equal(result.data?.biologicalSex, null);
  });

  it('parses a filled-in form', () => {
    const result = schema.safeParse({
      heightCm: '178',
      birthYear: '1990',
      biologicalSex: 'female',
      reproductiveStatus: 'none',
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.heightCm, 178);
    assert.equal(result.data?.birthYear, 1990);
    assert.equal(result.data?.biologicalSex, 'female');
  });

  it('rejects an implausible height against the height field, with its own message', () => {
    const result = schema.safeParse({ heightCm: '400', birthYear: '', biologicalSex: '', reproductiveStatus: '' });
    assert.equal(result.success, false);
    const issues = result.error?.issues ?? [];
    assert.equal(issues.length, 1);
    assert.deepEqual(issues[0]?.path, ['heightCm']);
    assert.equal(issues[0]?.message, 'bodyMetrics.errors.height');
  });

  it('rejects a birth year outside the covered age range, against the birth-year field', () => {
    const result = schema.safeParse({ heightCm: '', birthYear: '85', biologicalSex: '', reproductiveStatus: '' });
    assert.equal(result.success, false);
    const issues = result.error?.issues ?? [];
    assert.equal(issues.length, 1);
    assert.deepEqual(issues[0]?.path, ['birthYear']);
    assert.equal(issues[0]?.message, 'bodyMetrics.errors.birthYear');
  });

  it('reports both text fields at once so neither correction hides the other', () => {
    const result = schema.safeParse({
      heightCm: 'about six foot',
      birthYear: '85',
      biologicalSex: 'female',
      reproductiveStatus: 'none',
    });
    assert.equal(result.success, false);
    const paths = (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
    assert.deepEqual(paths.toSorted(), ['birthYear', 'heightCm']);
  });

  it('reads an unrecognised radio value as "no answer" rather than an error', () => {
    const result = schema.safeParse({
      heightCm: '',
      birthYear: '',
      biologicalSex: 'nonsense',
      reproductiveStatus: 'nonsense',
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.biologicalSex, null);
    assert.equal(result.data?.reproductiveStatus, null);
  });
});

describe('makeBodyMetricsSchema, the two reproductive dates', () => {
  it('passes a blank due date as null', () => {
    const result = schema.safeParse({ reproductiveStatus: 'pregnant', pregnancyDueDate: '' });
    assert.equal(result.success, true);
    assert.equal(result.data?.pregnancyDueDate, null);
  });

  it('accepts a due date at the ceiling and rejects the week beyond it, against its own field', () => {
    const atCeiling = shiftDate(TODAY_KEY, MAX_WEEKS_UNTIL_DUE_DATE * 7);
    const accepted = schema.safeParse({ reproductiveStatus: 'pregnant', pregnancyDueDate: atCeiling });
    assert.equal(accepted.success, true);
    assert.equal(accepted.data?.pregnancyDueDate, atCeiling);

    const rejected = schema.safeParse({
      reproductiveStatus: 'pregnant',
      pregnancyDueDate: shiftDate(TODAY_KEY, (MAX_WEEKS_UNTIL_DUE_DATE + 1) * 7),
    });
    assert.equal(rejected.success, false);
    const issues = rejected.error?.issues ?? [];
    assert.deepEqual(issues.map((issue) => issue.path.join('.')), ['pregnancyDueDate']);
    assert.equal(issues[0]?.message, `${BODY_DUE_DATE_RANGE_KEY}:${MAX_WEEKS_UNTIL_DUE_DATE}`);
  });

  it('gives a due date that has already passed its own sentence', () => {
    const result = schema.safeParse({ reproductiveStatus: 'pregnant', pregnancyDueDate: shiftDate(TODAY_KEY, -1) });
    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.message, `${BODY_DUE_DATE_PAST_KEY}:${MAX_WEEKS_UNTIL_DUE_DATE}`);
  });

  it('rejects a birth date in the future and keeps one in the past', () => {
    const rejected = schema.safeParse({ reproductiveStatus: 'lactating', lactationStartDate: shiftDate(TODAY_KEY, 1) });
    assert.equal(rejected.success, false);
    assert.deepEqual(rejected.error?.issues.map((issue) => issue.path.join('.')), ['lactationStartDate']);
    assert.equal(rejected.error?.issues[0]?.message, `${BODY_START_DATE_FUTURE_KEY}:${MAX_WEEKS_UNTIL_DUE_DATE}`);

    const accepted = schema.safeParse({
      reproductiveStatus: 'lactating',
      lactationStartDate: shiftDate(TODAY_KEY, -30),
    });
    assert.equal(accepted.success, true);
    assert.equal(accepted.data?.lactationStartDate, shiftDate(TODAY_KEY, -30));
  });
});
