/**
 * The recovery flow's pure state machine.
 *
 * It replaced `reset-flow.ts`, whose whole subject was an UNSKIPPABLE fork —
 * "do you have your recovery code?" — because the mailed reset behind it
 * restored login while leaving every synced byte undecryptable. M181 deleted
 * that endpoint, so the fork is gone and what these tests defend instead is
 * the smaller property that remains: one definition of "may this be
 * submitted", enforced by the reducer as well as by the button, and no
 * transition that can strand the user on a screen with no way back.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canSubmitRecovery, INITIAL_RECOVERY_FLOW_STATE, recoveryFlowReducer } from '../../app/lib/sync/recovery-flow';
import type { RecoveryFlowState } from '../../app/lib/sync/recovery-flow';

describe('recoveryFlowReducer', () => {
  it('starts on the form', () => {
    assert.deepEqual(INITIAL_RECOVERY_FLOW_STATE, { kind: 'entering' });
  });

  it('submitted moves to submitting', () => {
    assert.deepEqual(recoveryFlowReducer(INITIAL_RECOVERY_FLOW_STATE, { type: 'submitted' }), { kind: 'submitting' });
  });

  // What the three FIELDS must contain is the recovery schema's business now
  // (`recovery-schema.ts`), rendered by Conform under each field — so this
  // machine no longer has a client-side rejection to hold (owner request,
  // 2026-09-02). The service's own `401` still gets its own screen below.

  it('failed carries the message, and retrying returns to a CLEAN form', () => {
    const submitting: RecoveryFlowState = { kind: 'submitting' };
    const failed = recoveryFlowReducer(submitting, { type: 'failed', message: 'that did not work' });
    assert.deepEqual(failed, { kind: 'failed', message: 'that did not work' });
    assert.deepEqual(recoveryFlowReducer(failed, { type: 'retried' }), { kind: 'entering' });
  });

  it('succeeded completes', () => {
    assert.deepEqual(recoveryFlowReducer({ kind: 'submitting' }, { type: 'succeeded' }), { kind: 'complete' });
  });

  // The same belt-and-braces `setup-flow.ts` uses: the button is disabled, and
  // the reducer refuses anyway, so a stray or replayed dispatch cannot start a
  // second rotation while the first is in flight.
  it('a second submit while one is in flight is a no-op, not a second rotation', () => {
    const submitting: RecoveryFlowState = { kind: 'submitting' };
    assert.equal(canSubmitRecovery(submitting), false);
    assert.deepEqual(recoveryFlowReducer(submitting, { type: 'submitted' }), submitting);
  });

  it('a completed recovery cannot be re-submitted either', () => {
    const complete: RecoveryFlowState = { kind: 'complete' };
    assert.equal(canSubmitRecovery(complete), false);
    assert.deepEqual(recoveryFlowReducer(complete, { type: 'submitted' }), complete);
  });

  it('ignores an action that does not apply to the current state (no-op, no throw)', () => {
    // A late-arriving result must never crash a screen the user has moved on
    // from — the rule every flow reducer in this feature follows.
    const complete: RecoveryFlowState = { kind: 'complete' };
    assert.deepEqual(recoveryFlowReducer(complete, { type: 'failed', message: 'late' }), complete);
    assert.deepEqual(recoveryFlowReducer(INITIAL_RECOVERY_FLOW_STATE, { type: 'succeeded' }), { kind: 'entering' });
  });

  it('every failure is re-enterable: there is no dead end in this machine', () => {
    // Recovery is the LAST door. A state with no transition out of it would
    // mean a user who mistyped their code had to reload the app to try again.
    const states: RecoveryFlowState[] = [{ kind: 'entering' }, { kind: 'failed', message: 'x' }];
    for (const state of states) {
      const recovered =
        state.kind === 'failed' ?
          recoveryFlowReducer(state, { type: 'retried' })
        : recoveryFlowReducer(state, { type: 'submitted' });
      assert.notDeepEqual(recovered, state, `${state.kind} must have a way forward`);
    }
  });
});
