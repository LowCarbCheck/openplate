/**
 * Unit tests for `#app/lib/diary-empty-state` — the pure decision behind the
 * diary's three kind empty states.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveDiaryEmptyState } from '../../app/lib/diary-empty-state';

const GAP = 3;

describe('resolveDiaryEmptyState', () => {
  it('is first-ever when the user has never logged anything', () => {
    assert.strictEqual(
      resolveDiaryEmptyState({ hasAnyLogs: false, isToday: true, daysSinceLastLog: null, gapThresholdDays: GAP }),
      'first-ever',
    );
  });

  it('first-ever wins even on a past day', () => {
    assert.strictEqual(
      resolveDiaryEmptyState({ hasAnyLogs: false, isToday: false, daysSinceLastLog: null, gapThresholdDays: GAP }),
      'first-ever',
    );
  });

  it('is returning-after-gap on today when the last log is at least the threshold ago', () => {
    assert.strictEqual(
      resolveDiaryEmptyState({ hasAnyLogs: true, isToday: true, daysSinceLastLog: 3, gapThresholdDays: GAP }),
      'returning-after-gap',
    );
    assert.strictEqual(
      resolveDiaryEmptyState({ hasAnyLogs: true, isToday: true, daysSinceLastLog: 10, gapThresholdDays: GAP }),
      'returning-after-gap',
    );
  });

  it('is ordinary on today when the last log is within the threshold', () => {
    assert.strictEqual(
      resolveDiaryEmptyState({ hasAnyLogs: true, isToday: true, daysSinceLastLog: 2, gapThresholdDays: GAP }),
      'ordinary',
    );
  });

  it('never shows returning-after-gap on a past day (that state is for today)', () => {
    assert.strictEqual(
      resolveDiaryEmptyState({ hasAnyLogs: true, isToday: false, daysSinceLastLog: 10, gapThresholdDays: GAP }),
      'ordinary',
    );
  });

  it('is ordinary when today has a recent gap value of null (only older-than-window handled by the loader)', () => {
    assert.strictEqual(
      resolveDiaryEmptyState({ hasAnyLogs: true, isToday: true, daysSinceLastLog: null, gapThresholdDays: GAP }),
      'ordinary',
    );
  });
});
