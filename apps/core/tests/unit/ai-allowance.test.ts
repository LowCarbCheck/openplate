/**
 * The AI allowance decision (2026-09-30): a live paid window, then the
 * standing free grant, then the scan trial, and the refusal for everything
 * else. Every row of the table the proxy acts on is here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiAllowanceFor, effectiveFreeDailyAiLimit, type AiAllowanceInput } from '../../src/accounts/ai-allowance.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const FUTURE = new Date('2026-11-01T00:00:00.000Z');
const PAST = new Date('2026-09-01T00:00:00.000Z');

function decide(overrides: Partial<AiAllowanceInput>): ReturnType<typeof aiAllowanceFor> {
  return aiAllowanceFor({
    dailyAiLimit: 0,
    freeDailyAiLimit: 0,
    allowanceExpiresAt: null,
    trialScans: null,
    now: NOW,
    ...overrides,
  });
}

test('a live paid window grants its own limit, above a free grant', () => {
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: FUTURE, freeDailyAiLimit: 10 }), {
    kind: 'paid',
    dailyLimit: 200,
  });
});

test('a paid period that ended falls back to the free grant, at the free limit', () => {
  // The Beta supporter who bought a plan and cancelled: the biller left 200
  // and the period's end on the row.
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: PAST, freeDailyAiLimit: 10 }), {
    kind: 'free',
    dailyLimit: 10,
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
    dailyLimit: 10,
  });
});

test('a free grant with no date is never scan gated and never ends', () => {
  assert.deepEqual(decide({ freeDailyAiLimit: 10 }), { kind: 'free', dailyLimit: 10 });
  assert.deepEqual(decide({ freeDailyAiLimit: 10, trialScans: 0, dailyAiLimit: 20 }), {
    kind: 'free',
    dailyLimit: 10,
  });
});

test('the old "no date, no trial, a limit" shape grants nothing any more', () => {
  assert.deepEqual(decide({ dailyAiLimit: 200 }), { kind: 'refused', error: 'ai-not-allowed' });
  // THE CONTROL: the same limit as a free grant is allowed.
  assert.deepEqual(decide({ freeDailyAiLimit: 200 }), { kind: 'free', dailyLimit: 200 });
});

test('a scan trial with no date is the trial, at its daily limit', () => {
  assert.deepEqual(decide({ dailyAiLimit: 20, trialScans: 10 }), { kind: 'trial', dailyLimit: 20 });
});

test('no limit of either kind is ai-not-allowed, whatever the date says', () => {
  assert.deepEqual(decide({}), { kind: 'refused', error: 'ai-not-allowed' });
  assert.deepEqual(decide({ allowanceExpiresAt: PAST }), { kind: 'refused', error: 'ai-not-allowed' });
  assert.deepEqual(decide({ allowanceExpiresAt: FUTURE }), { kind: 'refused', error: 'ai-not-allowed' });
  assert.deepEqual(decide({ trialScans: 10 }), { kind: 'refused', error: 'ai-not-allowed' });
});

test('a paid window with a limit of zero falls to the free grant', () => {
  assert.deepEqual(decide({ allowanceExpiresAt: FUTURE, freeDailyAiLimit: 5 }), { kind: 'free', dailyLimit: 5 });
});

// ── The instance's standing default (2026-10-05) ────────────────────────────

test('an account with no free limit of its own is held to the instance default', () => {
  assert.equal(effectiveFreeDailyAiLimit({ own: 0, instanceDefault: 3 }), 3);
});

test('an own free limit is never lowered or raised by the default', () => {
  assert.equal(effectiveFreeDailyAiLimit({ own: 10, instanceDefault: 3 }), 10);
  assert.equal(effectiveFreeDailyAiLimit({ own: 2, instanceDefault: 50 }), 2);
});

test('CONTROL: with no instance default the effective limit is the column, which is today', () => {
  assert.equal(effectiveFreeDailyAiLimit({ own: 0, instanceDefault: 0 }), 0);
  assert.equal(effectiveFreeDailyAiLimit({ own: 10, instanceDefault: 0 }), 10);
  // And the ladder on that number is the ladder it always was: no limit, no AI.
  assert.deepEqual(decide({ freeDailyAiLimit: effectiveFreeDailyAiLimit({ own: 0, instanceDefault: 0 }) }), {
    kind: 'refused',
    error: 'ai-not-allowed',
  });
});

test('the ladder keeps its order with a default: paid window, then the free limit, then the trial', () => {
  const standing = effectiveFreeDailyAiLimit({ own: 0, instanceDefault: 3 });
  // A live paid window still wins, at its own limit.
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: FUTURE, freeDailyAiLimit: standing }), {
    kind: 'paid',
    dailyLimit: 200,
  });
  // A paid period that ended falls to the default instead of allowance-expired.
  assert.deepEqual(decide({ dailyAiLimit: 200, allowanceExpiresAt: PAST, freeDailyAiLimit: standing }), {
    kind: 'free',
    dailyLimit: 3,
  });
  // An account with a running trial falls under the default too: the standing
  // cap replaces the trial, so the trial is never the answer.
  assert.deepEqual(decide({ dailyAiLimit: 20, trialScans: 10, freeDailyAiLimit: standing }), {
    kind: 'free',
    dailyLimit: 3,
  });
  // A brand new account, no AI of its own at all, gets the default.
  assert.deepEqual(decide({ freeDailyAiLimit: standing }), { kind: 'free', dailyLimit: 3 });
});
