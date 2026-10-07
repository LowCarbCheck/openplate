/**
 * The AI allowance decision (2026-09-30): a live paid window, then the
 * standing free grant, then the scan trial, and the refusal for everything
 * else. Every row of the table the proxy acts on is here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiAllowanceFor, effectiveFreeAiLimit, type AiAllowanceInput } from '../../src/accounts/ai-allowance.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const FUTURE = new Date('2026-11-01T00:00:00.000Z');
const PAST = new Date('2026-09-01T00:00:00.000Z');

/**
 * The decision with today's defaults: a daily paid window, no free grant. A
 * bare `freeDailyAiLimit` is a free grant per day, the shape every case before
 * the week (2026-10-07) was written in.
 */
function decide(
  overrides: Partial<Omit<AiAllowanceInput, 'freeAiLimit'>> & {
    freeDailyAiLimit?: number;
    freeAiLimit?: AiAllowanceInput['freeAiLimit'];
  },
): ReturnType<typeof aiAllowanceFor> {
  const { freeDailyAiLimit, freeAiLimit, ...rest } = overrides;
  return aiAllowanceFor({
    dailyAiLimit: 0,
    aiLimitPeriod: 'day',
    allowanceExpiresAt: null,
    trialScans: null,
    now: NOW,
    ...rest,
    freeAiLimit: freeAiLimit ?? { limit: freeDailyAiLimit ?? 0, period: 'day' },
  });
}

/** The free limit an account with `own` is held to on an instance whose default is `instanceDefault` per day. */
function freeDaily(input: { own: number; instanceDefault: number }): number {
  return effectiveFreeAiLimit({ own: input.own, instanceDefault: { limit: input.instanceDefault, period: 'day' } })
    .limit;
}

test('a live paid window grants its own limit, above a free grant', () => {
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: FUTURE, freeDailyAiLimit: 10 }), {
    kind: 'paid',
    limit: 200,
    period: 'day',
  });
});

test('a paid period that ended falls back to the free grant, at the free limit', () => {
  // The Beta supporter who bought a plan and cancelled: the biller left 200
  // and the period's end on the row.
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: PAST, freeDailyAiLimit: 10 }), {
    kind: 'free',
    limit: 10,
    period: 'day',
  });
  // THE CONTROL: the same row with no free grant is refused as expired.
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: PAST }), {
    kind: 'refused',
    error: 'allowance-expired',
  });
});

test('the boundary instant of a paid window has ended', () => {
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: NOW, freeDailyAiLimit: 10 }), {
    kind: 'free',
    limit: 10,
    period: 'day',
  });
});

test('a free grant with no date is never scan gated and never ends', () => {
  assert.deepEqual(decide({ freeDailyAiLimit: 10 }), { kind: 'free', limit: 10, period: 'day' });
  assert.deepEqual(decide({ freeDailyAiLimit: 10, trialScans: 0, dailyAiLimit: 20 }), {
    kind: 'free',
    limit: 10,
    period: 'day',
  });
});

test('the old "no date, no trial, a limit" shape grants nothing any more', () => {
  assert.deepEqual(decide({ dailyAiLimit: 200 }), { kind: 'refused', error: 'ai-not-allowed' });
  // THE CONTROL: the same limit as a free grant is allowed.
  assert.deepEqual(decide({ freeDailyAiLimit: 200 }), { kind: 'free', limit: 200, period: 'day' });
});

test('a scan trial with no date is the trial, at its daily limit', () => {
  assert.deepEqual(decide({ dailyAiLimit: 20, trialScans: 10 }), { kind: 'trial', limit: 20, period: 'day' });
});

test('no limit of either kind is ai-not-allowed, whatever the date says', () => {
  assert.deepEqual(decide({}), { kind: 'refused', error: 'ai-not-allowed' });
  assert.deepEqual(decide({ allowanceExpiresAt: PAST }), { kind: 'refused', error: 'ai-not-allowed' });
  assert.deepEqual(decide({ allowanceExpiresAt: FUTURE }), { kind: 'refused', error: 'ai-not-allowed' });
  assert.deepEqual(decide({ trialScans: 10 }), { kind: 'refused', error: 'ai-not-allowed' });
});

test('a paid window with a limit of zero falls to the free grant', () => {
  assert.deepEqual(decide({ allowanceExpiresAt: FUTURE, freeDailyAiLimit: 5 }), {
    kind: 'free',
    limit: 5,
    period: 'day',
  });
});

// ── The instance's standing default (2026-10-05) ────────────────────────────

test('an account with no free limit of its own is held to the instance default', () => {
  assert.equal(freeDaily({ own: 0, instanceDefault: 3 }), 3);
});

test('an own free limit is never lowered or raised by the default', () => {
  assert.equal(freeDaily({ own: 10, instanceDefault: 3 }), 10);
  assert.equal(freeDaily({ own: 2, instanceDefault: 50 }), 2);
});

test('CONTROL: with no instance default the effective limit is the column, which is today', () => {
  assert.equal(freeDaily({ own: 0, instanceDefault: 0 }), 0);
  assert.equal(freeDaily({ own: 10, instanceDefault: 0 }), 10);
  // And the ladder on that number is the ladder it always was: no limit, no AI.
  assert.deepEqual(decide({ freeDailyAiLimit: freeDaily({ own: 0, instanceDefault: 0 }) }), {
    kind: 'refused',
    error: 'ai-not-allowed',
  });
});

test('the ladder keeps its order with a default: paid window, then the free limit, then the trial', () => {
  const standing = freeDaily({ own: 0, instanceDefault: 3 });
  // A live paid window still wins, at its own limit.
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: FUTURE, freeDailyAiLimit: standing }), {
    kind: 'paid',
    limit: 200,
    period: 'day',
  });
  // A paid period that ended falls to the default instead of allowance-expired.
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: PAST, freeDailyAiLimit: standing }), {
    kind: 'free',
    limit: 3,
    period: 'day',
  });
  // An account with a running trial falls under the default too: the standing
  // cap replaces the trial, so the trial is never the answer.
  assert.deepEqual(decide({ dailyAiLimit: 20, trialScans: 10, freeDailyAiLimit: standing }), {
    kind: 'free',
    limit: 3,
    period: 'day',
  });
  // A brand new account, no AI of its own at all, gets the default.
  assert.deepEqual(decide({ freeDailyAiLimit: standing }), { kind: 'free', limit: 3, period: 'day' });
});

// ── The window of each grant (2026-10-07) ───────────────────────────────────

test('a paid window counts in the period the account holds', () => {
  assert.deepEqual(decide({ dailyAiLimit: 20, aiLimitPeriod: 'week', allowanceExpiresAt: FUTURE }), {
    kind: 'paid',
    limit: 20,
    period: 'week',
  });
  // THE CONTROL, the subscriber of the old plan: the same window with the
  // period every existing account holds stays per day.
  assert.deepEqual(decide({ dailyAiLimit: 25, aiLimitPeriod: 'day', allowanceExpiresAt: FUTURE }), {
    kind: 'paid',
    limit: 25,
    period: 'day',
  });
});

test('a weekly instance default gives a weekly free grant, and an own free limit stays daily above it', () => {
  const weekly = { limit: 10, period: 'week' } as const;
  // An account with no free limit of its own: the weekly default.
  assert.deepEqual(effectiveFreeAiLimit({ own: 0, instanceDefault: weekly }), weekly);
  assert.deepEqual(decide({ freeAiLimit: effectiveFreeAiLimit({ own: 0, instanceDefault: weekly }) }), {
    kind: 'free',
    limit: 10,
    period: 'week',
  });
  // THE CONTROL, a Beta supporter: ten a day of their own stay ten a day.
  assert.deepEqual(effectiveFreeAiLimit({ own: 10, instanceDefault: weekly }), { limit: 10, period: 'day' });
  assert.deepEqual(decide({ freeAiLimit: effectiveFreeAiLimit({ own: 10, instanceDefault: weekly }) }), {
    kind: 'free',
    limit: 10,
    period: 'day',
  });
});

test('a weekly paid window that ended falls to the free grant in the free grant own window', () => {
  assert.deepEqual(
    decide({
      dailyAiLimit: 40,
      aiLimitPeriod: 'week',
      allowanceExpiresAt: PAST,
      freeAiLimit: { limit: 10, period: 'day' },
    }),
    { kind: 'free', limit: 10, period: 'day' },
  );
});

test('the scan trial is per day even when the period column says week', () => {
  assert.deepEqual(decide({ dailyAiLimit: 20, aiLimitPeriod: 'week', trialScans: 10 }), {
    kind: 'trial',
    limit: 20,
    period: 'day',
  });
});

// ── The paid floor (2026-10-07) ─────────────────────────────────────────────

test('buying a plan never lowers the allowance: a Beta supporter on Basic keeps 10 a day, 70 a week over 20', () => {
  const betaSupporter = effectiveFreeAiLimit({ own: 10, instanceDefault: { limit: 10, period: 'week' } });
  assert.deepEqual(
    decide({ dailyAiLimit: 20, aiLimitPeriod: 'week', allowanceExpiresAt: FUTURE, freeAiLimit: betaSupporter }),
    { kind: 'free', limit: 10, period: 'day' },
  );
  // Plus, 40 a week, is still less than 70: the same answer.
  assert.deepEqual(
    decide({ dailyAiLimit: 40, aiLimitPeriod: 'week', allowanceExpiresAt: FUTURE, freeAiLimit: betaSupporter }),
    { kind: 'free', limit: 10, period: 'day' },
  );
  // THE CONTROL: Max, 100 a week, is more than 70, so the plan counts.
  assert.deepEqual(
    decide({ dailyAiLimit: 100, aiLimitPeriod: 'week', allowanceExpiresAt: FUTURE, freeAiLimit: betaSupporter }),
    { kind: 'paid', limit: 100, period: 'week' },
  );
});

test('the paid floor compares per week, keeps the paid grant on a tie, and leaves a person without a free grant on the plan', () => {
  // 10 a week against 10 a week: a tie is the plan.
  assert.deepEqual(
    decide({
      dailyAiLimit: 10,
      aiLimitPeriod: 'week',
      allowanceExpiresAt: FUTURE,
      freeAiLimit: { limit: 10, period: 'week' },
    }),
    { kind: 'paid', limit: 10, period: 'week' },
  );
  // 3 a day (21 a week) against 20 a week: the free day grant is larger.
  assert.deepEqual(
    decide({
      dailyAiLimit: 20,
      aiLimitPeriod: 'week',
      allowanceExpiresAt: FUTURE,
      freeAiLimit: { limit: 3, period: 'day' },
    }),
    { kind: 'free', limit: 3, period: 'day' },
  );
  // THE CONTROL: the free default of the managed instance, 10 a week, never beats Basic.
  assert.deepEqual(
    decide({
      dailyAiLimit: 20,
      aiLimitPeriod: 'week',
      allowanceExpiresAt: FUTURE,
      freeAiLimit: { limit: 10, period: 'week' },
    }),
    { kind: 'paid', limit: 20, period: 'week' },
  );
  // The old daily plan, 25 a day, over a Beta supporter's 10 a day: the plan.
  assert.deepEqual(decide({ dailyAiLimit: 25, allowanceExpiresAt: FUTURE, freeDailyAiLimit: 10 }), {
    kind: 'paid',
    limit: 25,
    period: 'day',
  });
});
