/**
 * The passphrase-reset fork.
 *
 * This is the gate counsel made blocking, so it is tested as a gate rather
 * than as a state machine: the assertions below are mostly about what CANNOT
 * happen. A reset without a recovery code destroys the account's synced data
 * permanently, and nothing about the flow looks destructive from the outside —
 * so the only defence is that the user cannot get through it without saying,
 * in as many words, that they understand.
 *
 * `canSubmitReset` is shared by the reducer and by the component's disabled
 * state, which is why it is asserted directly here: two definitions of "may
 * this be submitted" is exactly how a button ends up enabled on a screen the
 * reducer would refuse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSubmitReset,
  INITIAL_RESET_FLOW_STATE,
  resetFlowReducer,
  resetPreservesData,
  type ResetFlowState,
} from '../../app/lib/sync/reset-flow';

/** Folds a sequence of actions over the reducer, starting from the initial state. */
function run(...actions: Parameters<typeof resetFlowReducer>[1][]): ResetFlowState {
  return actions.reduce(resetFlowReducer, INITIAL_RESET_FLOW_STATE);
}

test('the flow starts on the fork, and the fork cannot be submitted from', () => {
  assert.equal(INITIAL_RESET_FLOW_STATE.kind, 'asking');
  assert.equal(canSubmitReset(INITIAL_RESET_FLOW_STATE), false);
});

test('the fork cannot be skipped — no action other than answering leaves it', () => {
  for (const action of [
    { type: 'submitted' } as const,
    { type: 'dataLossAcknowledged', acknowledged: true } as const,
    { type: 'succeeded', dataPreserved: true } as const,
    { type: 'failed', message: 'x', hadRecoveryCode: false } as const,
  ]) {
    assert.equal(run(action).kind, 'asking', `${action.type} must not move past the fork`);
  }
});

test('the "no recovery code" branch cannot be submitted until the data loss is acknowledged', () => {
  const chosen = run({ type: 'answeredNoRecoveryCode' });
  assert.equal(chosen.kind, 'without-recovery-code');
  assert.equal(canSubmitReset(chosen), false);

  // A submit attempted before the acknowledgment is a no-op, not a transition.
  assert.equal(resetFlowReducer(chosen, { type: 'submitted' }).kind, 'without-recovery-code');

  const acknowledged = resetFlowReducer(chosen, { type: 'dataLossAcknowledged', acknowledged: true });
  assert.equal(canSubmitReset(acknowledged), true);
  assert.equal(resetFlowReducer(acknowledged, { type: 'submitted' }).kind, 'submitting');
});

test('un-ticking the acknowledgment closes the gate again', () => {
  const state = run(
    { type: 'answeredNoRecoveryCode' },
    { type: 'dataLossAcknowledged', acknowledged: true },
    { type: 'dataLossAcknowledged', acknowledged: false },
  );

  assert.equal(canSubmitReset(state), false);
  assert.equal(resetFlowReducer(state, { type: 'submitted' }).kind, 'without-recovery-code');
});

test('backing out and returning does NOT carry the acknowledgment over', () => {
  const state = run(
    { type: 'answeredNoRecoveryCode' },
    { type: 'dataLossAcknowledged', acknowledged: true },
    { type: 'backToFork' },
    { type: 'answeredNoRecoveryCode' },
  );

  assert.deepEqual(state, { kind: 'without-recovery-code', acknowledgedDataLoss: false, error: null });
  assert.equal(canSubmitReset(state), false);
});

test('the "I have my recovery code" branch needs no acknowledgment — nothing is being destroyed', () => {
  const state = run({ type: 'answeredHasRecoveryCode' });

  assert.equal(canSubmitReset(state), true);
  assert.equal(resetPreservesData(state), true);
});

test('only the recovery-code branch is reported as data-preserving', () => {
  assert.equal(resetPreservesData(run({ type: 'answeredNoRecoveryCode' })), false);
  assert.equal(resetPreservesData(INITIAL_RESET_FLOW_STATE), false);
  assert.equal(resetPreservesData({ kind: 'complete', dataPreserved: true }), false);
});

test('the completion screen carries whether data survived, so it cannot congratulate falsely', () => {
  const preserved = run(
    { type: 'answeredHasRecoveryCode' },
    { type: 'submitted' },
    { type: 'succeeded', dataPreserved: true },
  );
  assert.deepEqual(preserved, { kind: 'complete', dataPreserved: true });

  const destroyed = run(
    { type: 'answeredNoRecoveryCode' },
    { type: 'dataLossAcknowledged', acknowledged: true },
    { type: 'submitted' },
    { type: 'succeeded', dataPreserved: false },
  );
  assert.deepEqual(destroyed, { kind: 'complete', dataPreserved: false });
});

test('a failure returns to the fork rather than stranding the user mid-flow', () => {
  const failed = run(
    { type: 'answeredHasRecoveryCode' },
    { type: 'submitted' },
    { type: 'failed', message: 'that code does not open this account', hadRecoveryCode: true },
  );
  assert.equal(failed.kind, 'failed');

  assert.equal(resetFlowReducer(failed, { type: 'backToFork' }).kind, 'asking');
});

test('a late-arriving action for a state that has moved on is ignored, never a crash', () => {
  const complete = run(
    { type: 'answeredHasRecoveryCode' },
    { type: 'submitted' },
    { type: 'succeeded', dataPreserved: true },
  );

  // e.g. a slow request resolving after the user already saw the result.
  assert.deepEqual(resetFlowReducer(complete, { type: 'failed', message: 'late', hadRecoveryCode: true }), complete);
  assert.deepEqual(resetFlowReducer(complete, { type: 'submitted' }), complete);
});

test('a validation error keeps the user on their chosen branch', () => {
  const rejected = run({ type: 'answeredHasRecoveryCode' }, { type: 'rejected', message: 'too short' });

  assert.deepEqual(rejected, { kind: 'with-recovery-code', error: 'too short' });
  assert.equal(canSubmitReset(rejected), true, 'a length complaint must not close the branch');
});
