/**
 * Pure state machine for the scan page's "arm → dispatch" flow.
 *
 * A photo pick either fires the (paid, BYOK) AI identify request immediately —
 * a camera capture is unambiguous intent — or arms a short, genuinely-free grace
 * window first, because a library pick may have been the wrong image. This app
 * never silently spends the user's provider credit, so the cancel offered during
 * the grace window is real: cancelling never dispatches. Once the request is
 * dispatched the spend is committed and no cancel is offered.
 *
 * The module is deliberately free of React, timers, and I/O so every transition
 * is unit-testable; the component supplies the actual `setTimeout` /
 * `fetcher.submit` side effects and keys them off the state below.
 */

/** Grace window (ms) between a library pick and the identify dispatch — long enough to cancel, short enough not to nag. */
export const LIBRARY_GRACE_MS = 1500;

/** Where a photo pick came from. Camera captures dispatch at once; library picks arm the grace window. */
export type PickSource = 'camera' | 'library';

/**
 * - `idle`: nothing armed. With a photo present this is the post-cancel /
 *   post-error resting state that offers the manual "Analyze" retry.
 * - `grace`: a library pick is counting down to dispatch and can still be
 *   cancelled for free.
 * - `dispatching`: the identify request is committed (spend incurred) — no
 *   cancel is offered.
 */
export type AnalyzePhase = 'idle' | 'grace' | 'dispatching';

export interface AnalyzeState {
  phase: AnalyzePhase;
  /**
   * Increments on every transition into `dispatching`. The component fires the
   * fetcher once per new id, so a retry of the same file (a fresh id) re-submits
   * while a re-render at the same id (StrictMode, unrelated state change) does not.
   */
  dispatchId: number;
  /**
   * Increments on every pick. Lets the component restart the grace timer when a
   * library pick replaces an in-progress grace window (same `phase`, new pick).
   */
  pickId: number;
}

export type AnalyzeAction =
  | { type: 'pick'; source: PickSource }
  | { type: 'graceElapsed' }
  | { type: 'cancel' }
  | { type: 'retry' }
  | { type: 'settled' }
  | { type: 'reset' };

/** The machine's start state: idle, no pick made, no dispatch issued. */
export const initialAnalyzeState: AnalyzeState = { phase: 'idle', dispatchId: 0, pickId: 0 };

/**
 * Advances the arm/dispatch machine. Pure — no timers, no I/O. Out-of-phase
 * actions (e.g. `cancel` while dispatching, `graceElapsed` while idle) return
 * the current state unchanged so a stray event can never wedge the flow or
 * double-charge the user.
 *
 * @param state - the current phase, dispatch id, and pick id.
 * @param action - the event to apply.
 * @returns the next state (the same reference when the action doesn't apply).
 */
export function analyzeReducer(state: AnalyzeState, action: AnalyzeAction): AnalyzeState {
  switch (action.type) {
    case 'pick': {
      const pickId = state.pickId + 1;
      if (action.source === 'camera') {
        return { phase: 'dispatching', dispatchId: state.dispatchId + 1, pickId };
      }
      return { phase: 'grace', dispatchId: state.dispatchId, pickId };
    }
    case 'graceElapsed':
      if (state.phase !== 'grace') return state;
      return { phase: 'dispatching', dispatchId: state.dispatchId + 1, pickId: state.pickId };
    case 'cancel':
      if (state.phase !== 'grace') return state;
      return { ...state, phase: 'idle' };
    case 'retry':
      if (state.phase !== 'idle') return state;
      return { phase: 'dispatching', dispatchId: state.dispatchId + 1, pickId: state.pickId };
    case 'settled':
      if (state.phase !== 'dispatching') return state;
      return { ...state, phase: 'idle' };
    case 'reset':
      return { ...state, phase: 'idle' };
  }
}
