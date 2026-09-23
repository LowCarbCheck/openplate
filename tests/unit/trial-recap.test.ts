/**
 * The trial recap's count (M250/05): meals logged with AI inside the trial,
 * from the food logs this device already holds.
 *
 * Every exclusion below is paired with the row that differs from it in one
 * field and IS counted, so a count that ignored the rule would fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { PlanStanding } from '../../app/lib/plans/plan-standing';
import { countTrialAiMeals, trialRecapWindow, type RecapLog, type TrialWindow } from '../../app/lib/plans/trial-recap';

const CREATED_AT = '2026-09-01T10:00:00.000Z';
const ENDS_AT = '2026-09-15T10:00:00.000Z';
const WINDOW: TrialWindow = { startsAtMs: Date.parse(CREATED_AT), endsAtMs: Date.parse(ENDS_AT) };
const INSIDE = Date.parse('2026-09-05T12:00:00.000Z');

let nextId = 1;
/** One food log, an AI intake inside the window unless the test says otherwise. */
function log(overrides: Partial<RecapLog> = {}): RecapLog {
  nextId += 1;
  return { id: `log-${nextId}`, source: 'plate_ai', createdAt: INSIDE, logBatchId: null, ...overrides };
}

function count(logs: RecapLog[]): number {
  return countTrialAiMeals({ logs, window: WINDOW });
}

describe('the meals counted', () => {
  it('counts an AI intake inside the trial', () => {
    assert.equal(count([log()]), 1);
  });

  it('ignores a meal logged by hand, and counts its AI twin', () => {
    assert.equal(count([log({ source: 'manual' })]), 0);
    assert.equal(count([log({ source: 'manual' }), log()]), 1);
  });

  it('counts the rows of one intake as one meal, and rows with no batch one each', () => {
    const plate = [log({ logBatchId: 'plate-1' }), log({ logBatchId: 'plate-1' }), log({ logBatchId: 'plate-1' })];
    assert.equal(count(plate), 1);
    assert.equal(count([...plate, log({ logBatchId: 'plate-2' })]), 2);
    assert.equal(count([log(), log()]), 2);
  });

  it('never merges a batch id with a row id that happens to be the same string', () => {
    assert.equal(count([log({ id: 'same' }), log({ logBatchId: 'same' })]), 2);
  });

  it('counts from the first instant of the trial and stops before its end', () => {
    assert.equal(count([log({ createdAt: WINDOW.startsAtMs })]), 1);
    assert.equal(count([log({ createdAt: WINDOW.startsAtMs - 1 })]), 0);
    assert.equal(count([log({ createdAt: WINDOW.endsAtMs - 1 })]), 1);
    assert.equal(count([log({ createdAt: WINDOW.endsAtMs })]), 0);
  });
});

describe('the trial window', () => {
  const trial: PlanStanding = { kind: 'trial', endsAt: ENDS_AT, daysLeft: 3 };

  it('runs from the account creation to the end of a running trial, or of one that ended', () => {
    assert.deepEqual(trialRecapWindow({ standing: trial, accountCreatedAt: CREATED_AT }), WINDOW);
    assert.deepEqual(
      trialRecapWindow({ standing: { kind: 'trial-ended', endedAt: ENDS_AT }, accountCreatedAt: CREATED_AT }),
      WINDOW,
    );
  });

  it('does not exist without a creation date, without an end date, or for anybody not in a trial', () => {
    assert.equal(trialRecapWindow({ standing: trial, accountCreatedAt: null }), null);
    assert.equal(trialRecapWindow({ standing: trial, accountCreatedAt: undefined }), null);
    assert.equal(trialRecapWindow({ standing: trial, accountCreatedAt: 'not a date' }), null);
    assert.equal(
      trialRecapWindow({ standing: { kind: 'trial-ended', endedAt: null }, accountCreatedAt: CREATED_AT }),
      null,
    );
    const subscribed: PlanStanding = {
      kind: 'subscribed',
      planKey: 'monthly',
      interval: 'month',
      periodEnd: ENDS_AT,
      renews: true,
      isPastDue: false,
    };
    for (const standing of [subscribed, { kind: 'lapsed' }, { kind: 'no-plans' }] satisfies PlanStanding[]) {
      assert.equal(trialRecapWindow({ standing, accountCreatedAt: CREATED_AT }), null, standing.kind);
    }
  });

  it('does not exist when the account was created after the trial ended', () => {
    assert.equal(trialRecapWindow({ standing: trial, accountCreatedAt: '2026-09-20T00:00:00.000Z' }), null);
  });
});
