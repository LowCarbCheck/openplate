/**
 * The deadline on the sign-out dialog's device read (`unsent-read-deadline.ts`).
 *
 * The defect was a read that never settles keeping the erase box disabled for
 * good. Two rules are worth a row each: a read that has not answered by the
 * deadline counts as one that failed (the allowed direction: it over-warns), and
 * a read that HAS answered is never rewritten, before the deadline or after it.
 * The timer is exercised with a real deadline of a few milliseconds and with a
 * fake scheduler, so nothing here waits five seconds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { UnsentRead } from '../../app/lib/sync/erase-notice';
import { resolveEraseNotice } from '../../app/lib/sync/erase-notice';
import {
  UNSENT_READ_DEADLINE_MS,
  applyUnsentReadDeadline,
  startUnsentReadDeadline,
  type ScheduleDeadline,
} from '../../app/lib/sync/unsent-read-deadline';

const DONE: UnsentRead = {
  status: 'done',
  unsent: { changes: 0, reports: 0, hasUnsentSavedMeals: false, hasOwnerPrivateRows: false },
};

describe('what a read counts as once the deadline may have passed', () => {
  it('turns a read that has not answered into a failed one after the deadline', () => {
    assert.deepEqual(applyUnsentReadDeadline({ read: { status: 'pending' }, hasDeadlinePassed: true }), {
      status: 'failed',
    });
  });

  it('CONTROL: leaves it pending before the deadline', () => {
    assert.deepEqual(applyUnsentReadDeadline({ read: { status: 'pending' }, hasDeadlinePassed: false }), {
      status: 'pending',
    });
  });

  it('CONTROL: never rewrites a finished read, even after the deadline', () => {
    assert.equal(applyUnsentReadDeadline({ read: DONE, hasDeadlinePassed: true }), DONE);
  });

  it('keeps a failed read failed', () => {
    assert.deepEqual(applyUnsentReadDeadline({ read: { status: 'failed' }, hasDeadlinePassed: true }), {
      status: 'failed',
    });
  });

  it('ends in the could-not-check line and never in the all-clear, so the erase box is freed', () => {
    const past = applyUnsentReadDeadline({ read: { status: 'pending' }, hasDeadlinePassed: true });
    assert.deepEqual(resolveEraseNotice({ read: past, isSyncing: false, hasSession: true }), [{ kind: 'unchecked' }]);
    // CONTROL: before the deadline the same inputs say "checking", which is what disables the box.
    const before = applyUnsentReadDeadline({ read: { status: 'pending' }, hasDeadlinePassed: false });
    assert.deepEqual(resolveEraseNotice({ read: before, isSyncing: false, hasSession: true }), [{ kind: 'checking' }]);
  });
});

describe('the timer', () => {
  it('is five seconds in the app', () => {
    assert.equal(UNSENT_READ_DEADLINE_MS, 5_000);
  });

  it('calls back once after a real, short deadline', async () => {
    let calls = 0;
    startUnsentReadDeadline({ deadlineMs: 5, onElapsed: () => (calls += 1) });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls, 1);
  });

  it('CONTROL: does not call back when cancelled first', async () => {
    let calls = 0;
    const cancel = startUnsentReadDeadline({ deadlineMs: 5, onElapsed: () => (calls += 1) });
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls, 0);
  });

  it('hands the deadline to the scheduler it is given, and cancels through it', () => {
    const seen: number[] = [];
    let cancelled = false;
    const schedule: ScheduleDeadline = (_callback, ms) => {
      seen.push(ms);
      return () => {
        cancelled = true;
      };
    };
    const cancel = startUnsentReadDeadline({ deadlineMs: 1234, onElapsed: () => undefined, schedule });
    assert.deepEqual(seen, [1234]);
    assert.equal(cancelled, false);
    cancel();
    assert.equal(cancelled, true);
  });
});
