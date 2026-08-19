/**
 * The passphrase-reset fork — a pure state machine, and the most important
 * twenty lines of UX logic in this feature.
 *
 * ── The problem it exists to prevent ──────────────────────────────────────
 *
 * `POST /v1/auth/reset` restores LOGIN. It cannot restore DATA: the server
 * never held a key, so a reset submitted without a re-wrapped DEK produces a
 * perfectly working account whose existing blob is permanently undecryptable.
 * Nothing about the flow LOOKS destructive — the user forgot a passphrase,
 * clicked a link in an email, typed a new one, and landed on a working, empty
 * app. `PROTOCOL.md` §5.14 requires a conforming client to say so, in those
 * terms, BEFORE the user commits.
 *
 * ── Why a machine rather than a paragraph ─────────────────────────────────
 *
 * Counsel's ruling (M128, blocking): prose above a form does not count. A
 * warning that a determined-to-get-back-in user can scroll past is a warning
 * that will be scrolled past — that is what "I just want my app back" does to
 * reading comprehension. So the fork is UNSKIPPABLE and structural: from
 * `asking`, the ONLY transitions out are answering yes or no, and the "no"
 * branch cannot reach `ready` until `acknowledgedDataLoss` is explicitly true.
 * The component's buttons enforce this, and the reducer enforces it again, so
 * a stray dispatch cannot skip it either — the same belt-and-braces the setup
 * flow's "I've saved it" checkbox already uses.
 *
 * It mirrors `setup-flow.ts` in shape on purpose: same `kind`-discriminated
 * union, same "unknown action for this state is a no-op, never a throw", so a
 * late-arriving async result cannot crash a screen the user has moved on from.
 */

/** Every screen the reset flow can be on. Invalid combinations are unrepresentable — they are different `kind`s. */
export type ResetFlowState =
  /** The fork. No way past it except answering. */
  | { kind: 'asking' }
  /**
   * "Yes, I have my recovery code" — the data-preserving branch. The code
   * unwraps the DEK, which is re-wrapped under the new passphrase, so the
   * diary survives the reset intact.
   */
  | { kind: 'with-recovery-code'; error: string | null }
  /**
   * "No, I don't" — the destructive branch. `acknowledgedDataLoss` gates
   * everything downstream, and starts false every single time this branch is
   * entered (including after backing out and returning).
   */
  | { kind: 'without-recovery-code'; acknowledgedDataLoss: boolean; error: string | null }
  | { kind: 'submitting' }
  | { kind: 'failed'; message: string; hadRecoveryCode: boolean }
  /** Done. `dataPreserved` is what the confirmation screen tells the truth with. */
  | { kind: 'complete'; dataPreserved: boolean };

export type ResetFlowAction =
  | { type: 'answeredHasRecoveryCode' }
  | { type: 'answeredNoRecoveryCode' }
  | { type: 'dataLossAcknowledged'; acknowledged: boolean }
  | { type: 'backToFork' }
  | { type: 'submitted' }
  | { type: 'failed'; message: string; hadRecoveryCode: boolean }
  | { type: 'succeeded'; dataPreserved: boolean }
  | { type: 'rejected'; message: string };

export const INITIAL_RESET_FLOW_STATE: ResetFlowState = { kind: 'asking' };

/**
 * Whether the flow may submit from `state`.
 *
 * Exported and used by BOTH the reducer and the component's disabled state, so
 * "can this be submitted" has exactly one definition. Two definitions is how a
 * button ends up enabled on a screen the reducer would refuse.
 */
export function canSubmitReset(state: ResetFlowState): boolean {
  if (state.kind === 'with-recovery-code') return true;
  if (state.kind === 'without-recovery-code') return state.acknowledgedDataLoss;
  return false;
}

/** True only on the branch where the user still holds their recovery code — i.e. where data survives. */
export function resetPreservesData(state: ResetFlowState): boolean {
  return state.kind === 'with-recovery-code';
}

export function resetFlowReducer(state: ResetFlowState, action: ResetFlowAction): ResetFlowState {
  if (action.type === 'answeredHasRecoveryCode' && state.kind === 'asking') {
    return { kind: 'with-recovery-code', error: null };
  }
  if (action.type === 'answeredNoRecoveryCode' && state.kind === 'asking') {
    // `acknowledgedDataLoss` deliberately restarts at false on every entry to
    // this branch — including a re-entry after backing out — so the
    // acknowledgment is never inherited from an earlier pass through it.
    return { kind: 'without-recovery-code', acknowledgedDataLoss: false, error: null };
  }
  if (action.type === 'dataLossAcknowledged' && state.kind === 'without-recovery-code') {
    return { ...state, acknowledgedDataLoss: action.acknowledged };
  }
  if (action.type === 'backToFork' && (state.kind === 'with-recovery-code' || state.kind === 'without-recovery-code')) {
    return { kind: 'asking' };
  }
  if (action.type === 'rejected' && (state.kind === 'with-recovery-code' || state.kind === 'without-recovery-code')) {
    return { ...state, error: action.message };
  }
  if (action.type === 'submitted' && canSubmitReset(state)) {
    return { kind: 'submitting' };
  }
  if (action.type === 'failed' && state.kind === 'submitting') {
    return { kind: 'failed', message: action.message, hadRecoveryCode: action.hadRecoveryCode };
  }
  if (action.type === 'succeeded' && state.kind === 'submitting') {
    return { kind: 'complete', dataPreserved: action.dataPreserved };
  }
  if (action.type === 'backToFork' && (state.kind === 'failed' || state.kind === 'asking')) {
    return { kind: 'asking' };
  }
  return state;
}
