/**
 * The daily cap on LowCarbCheck calls (2026-09-30 security fix): the pure
 * count, its day boundary, and the variable that sizes it. The route that
 * reserves against it is covered in `api-food-matches-managed.test.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDailyCallBudget,
  DailyCallLimitExceededError,
  msUntilNextUtcDay,
} from '../../app/lib/food-db-daily-budget';
import { DEFAULT_FOOD_DB_DAILY_CALL_LIMIT, parseFoodDbDailyCallLimit } from '../../app/config';

const NOON = Date.parse('2026-09-30T12:00:00.000Z');
const NEXT_MIDNIGHT = Date.parse('2026-10-01T00:00:00.000Z');

/** The refusal `action` throws; fails the test when it throws nothing or something else. */
function refusalOf(action: () => void): DailyCallLimitExceededError {
  try {
    action();
  } catch (error) {
    if (error instanceof DailyCallLimitExceededError) return error;
    throw error;
  }
  throw new Error('expected the budget to refuse');
}

describe('createDailyCallBudget', () => {
  it('reserves up to the limit and refuses the call that would pass it', () => {
    const budget = createDailyCallBudget({ limit: 5 });
    budget.reserve({ calls: 3, now: NOON });
    budget.reserve({ calls: 2, now: NOON });
    assert.throws(() => budget.reserve({ calls: 1, now: NOON }), DailyCallLimitExceededError);
    assert.equal(budget.usedOn(NOON), 5);
  });

  it('refuses a request that would pass the limit without reserving any of it', () => {
    const budget = createDailyCallBudget({ limit: 5 });
    budget.reserve({ calls: 3, now: NOON });
    assert.throws(() => budget.reserve({ calls: 3, now: NOON }), DailyCallLimitExceededError);
    assert.equal(budget.usedOn(NOON), 3, 'a refused request reserves nothing');
    budget.reserve({ calls: 2, now: NOON });
  });

  it('starts again at midnight UTC, and a refusal says how long until then', () => {
    const budget = createDailyCallBudget({ limit: 1 });
    budget.reserve({ calls: 1, now: NOON });
    assert.equal(refusalOf(() => budget.reserve({ calls: 1, now: NOON })).retryAfterMs, NEXT_MIDNIGHT - NOON);
    budget.reserve({ calls: 1, now: NEXT_MIDNIGHT });
    assert.equal(budget.usedOn(NEXT_MIDNIGHT), 1);
  });

  it('counts zero calls as nothing', () => {
    const budget = createDailyCallBudget({ limit: 1 });
    budget.reserve({ calls: 1, now: NOON });
    budget.reserve({ calls: 0, now: NOON });
    assert.equal(budget.usedOn(NOON), 1);
  });

  it('msUntilNextUtcDay is a full day at midnight and one millisecond just before it', () => {
    assert.equal(msUntilNextUtcDay(NEXT_MIDNIGHT), 24 * 60 * 60 * 1000);
    assert.equal(msUntilNextUtcDay(NEXT_MIDNIGHT - 1), 1);
  });
});

describe('FOOD_DB_DAILY_CALL_LIMIT', () => {
  it('defaults to a free key month, 100,000 over 31 days rounded down', () => {
    assert.equal(parseFoodDbDailyCallLimit(undefined), DEFAULT_FOOD_DB_DAILY_CALL_LIMIT);
    assert.equal(parseFoodDbDailyCallLimit('  '), DEFAULT_FOOD_DB_DAILY_CALL_LIMIT);
    assert.ok(DEFAULT_FOOD_DB_DAILY_CALL_LIMIT * 31 <= 100_000);
  });

  it('reads a positive whole number', () => {
    assert.equal(parseFoodDbDailyCallLimit(' 250 '), 250);
  });

  it('stops the boot on zero, a negative, a fraction or a word', () => {
    for (const raw of ['0', '-5', '2.5', 'lots', '1e3']) {
      assert.throws(() => parseFoodDbDailyCallLimit(raw), /FOOD_DB_DAILY_CALL_LIMIT/, raw);
    }
  });
});
