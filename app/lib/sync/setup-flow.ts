/**
 * Pure state machine for the sync-setup wizard (M117/08 item 5) — the
 * passphrase-entry -> recovery-code-display -> confirm-saved dance the
 * design/counsel review called table stakes for a paid, unrecoverable-by-
 * design feature. No React, no crypto, no fetch: this file only decides
 * which screen is showing and how it responds to an event. The actual
 * engine calls (Argon2id/HKDF/AES-GCM — `app/lib/sync/engine/`) and the
 * key-record PUT requests are the imperative shell around this reducer,
 * living in `SyncSetupFlow`
 * (`#app/components/sync-setup-flow.tsx`) — mirrors the `tao-of-node-react`
 * "useReducer over chained useState" pattern: invalid combinations (e.g.
 * "generating" AND an error message) are unrepresentable because they're
 * different `kind`s, not independent booleans.
 */

/** Minimum passphrase length (M117/08) — a sync passphrase protects data with no server-side recovery, so it's held to a higher floor than a login password. */
export const MIN_SYNC_PASSPHRASE_LENGTH = 12;

/**
 * A translation lookup, threaded in as a parameter (M129/05).
 *
 * This module must stay pure and importable from `node:test`, so it never
 * imports the i18next singleton — the caller (a React component) passes its
 * own `t` down.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * Validates a candidate sync passphrase.
 *
 * @param passphrase - the raw, untrimmed passphrase input.
 * @param t - translation lookup for the rejection message.
 * @returns an error message when invalid, or `null` when the passphrase is acceptable.
 */
export function validateSyncPassphrase(passphrase: string, t: Translate): string | null {
  if (passphrase.trim().length < MIN_SYNC_PASSPHRASE_LENGTH) {
    return t('sync.setup.passphraseTooShort', { min: MIN_SYNC_PASSPHRASE_LENGTH });
  }
  return null;
}

/**
 * What a provisioning attempt can END in — the contract between the ceremony
 * and whatever is doing the actual work (`sync-actions.ts`).
 *
 * `awaiting-email-verification` is a DESIGNED outcome, not a failure. On an
 * instance running with `REQUIRE_EMAIL_VERIFICATION`, `POST /v1/auth/signup`
 * creates the account and deliberately withholds the session until the address
 * is confirmed. Treating that as an error (which is what this used to do) put
 * a red message in front of a user whose account had just been created
 * correctly, and left them with no route forward: signing up again answers
 * `409`, and signing in lands on an account with no key records.
 *
 * There is no recovery code in that branch ON PURPOSE. Key records need an
 * authenticated session to write, so nothing was generated and nothing was
 * kept — the ceremony happens later, on the sign-in that follows verification.
 */
export type SyncSetupOutcome =
  | { status: 'ready'; recoveryCode: string }
  | { status: 'awaiting-email-verification'; email: string };

export type SyncSetupState =
  | { kind: 'enter-passphrase'; error: string | null }
  | { kind: 'generating' }
  | { kind: 'show-recovery-code'; recoveryCode: string; hasConfirmedSaved: boolean }
  | { kind: 'awaiting-email-verification'; email: string }
  | { kind: 'error'; message: string }
  | { kind: 'complete' };

export type SyncSetupAction =
  | { type: 'passphraseRejected'; message: string }
  | { type: 'passphraseSubmitted' }
  | { type: 'setupSucceeded'; recoveryCode: string }
  | { type: 'verificationRequired'; email: string }
  | { type: 'setupFailed'; message: string }
  | { type: 'confirmSavedToggled'; checked: boolean }
  | { type: 'finishRequested' }
  | { type: 'retried' };

/**
 * The state a wizard starts in.
 *
 * `resume` is the setup-COMPLETION path: the account already exists and the
 * passphrase has already been typed (on the sign-in form), so there is nothing
 * to ask for and the ceremony opens straight into `generating`. Everything
 * after that — the recovery-code display and its un-skippable acknowledgment —
 * is the same ceremony as first-time setup, because a code produced by a
 * repair is exactly as unrecoverable as one produced by a signup.
 */
export function initialSyncSetupState(options?: { resume?: boolean }): SyncSetupState {
  return options?.resume === true ? { kind: 'generating' } : INITIAL_SYNC_SETUP_STATE;
}

export const INITIAL_SYNC_SETUP_STATE: SyncSetupState = { kind: 'enter-passphrase', error: null };

/**
 * Whether the wizard is holding something the user MUST still see, so no
 * surrounding screen may swap it out.
 *
 * ── The bug this exists to prevent ───────────────────────────────────────
 *
 * `createSyncAccount` opens the sync session as part of provisioning. The
 * settings route rendered `session.account === null ? <setup> : <connected>`,
 * so the instant provisioning finished — while this reducer was still moving
 * from `generating` to `show-recovery-code` — the route swapped panels and
 * unmounted the wizard mid-transition. The recovery code was generated,
 * written to the server, and never displayed. It is shown exactly once and is
 * the only data-preserving recovery path there is, so that is a silent,
 * permanent loss of the user's only backup key.
 *
 * Both halves were individually correct; the composition was not. Hence a
 * PURE predicate here rather than a boolean threaded through components: the
 * rule is stated once, tested directly, and `resolveSyncScreen`
 * (`setup-screen.ts`) is the only thing allowed to act on it.
 *
 * - `generating` — the session flips to signed-in DURING this state. Protected.
 * - `show-recovery-code` — the one and only display of the code. Protected.
 * - `enter-passphrase` — nothing shown yet, and no session exists to swap to.
 * - `awaiting-email-verification` — no session was opened (that is the whole
 *   meaning of the state) and no key material exists, so there is nothing a
 *   connected panel could replace. Not protected.
 * - `error` — nothing to protect; if an account was created anyway, letting
 *   the connected panel take over is the more useful outcome than trapping
 *   the user in a wizard for an account that already exists.
 * - `complete` — the user has acknowledged. Handing over is correct.
 */
export function isSyncSetupCeremonyActive(state: SyncSetupState): boolean {
  return state.kind === 'generating' || state.kind === 'show-recovery-code';
}

/**
 * Advances the setup wizard. Every transition below is a deliberate,
 * exhaustive choice — an action that doesn't apply to the current `kind` is
 * a no-op (returns `state` unchanged) rather than throwing, since a stray
 * late-arriving action (e.g. a slow fetch resolving after the user already
 * hit "retry") should never crash the UI.
 */
export function syncSetupReducer(state: SyncSetupState, action: SyncSetupAction): SyncSetupState {
  if (action.type === 'passphraseRejected' && state.kind === 'enter-passphrase') {
    return { kind: 'enter-passphrase', error: action.message };
  }
  if (action.type === 'passphraseSubmitted' && state.kind === 'enter-passphrase') {
    return { kind: 'generating' };
  }
  if (action.type === 'setupSucceeded' && state.kind === 'generating') {
    return { kind: 'show-recovery-code', recoveryCode: action.recoveryCode, hasConfirmedSaved: false };
  }
  if (action.type === 'verificationRequired' && state.kind === 'generating') {
    return { kind: 'awaiting-email-verification', email: action.email };
  }
  if (action.type === 'setupFailed' && state.kind === 'generating') {
    return { kind: 'error', message: action.message };
  }
  if (action.type === 'confirmSavedToggled' && state.kind === 'show-recovery-code') {
    return { ...state, hasConfirmedSaved: action.checked };
  }
  // The confirm-saved dance (D5 / counsel End User review): setup can only
  // complete once the user has explicitly acknowledged they saved the
  // recovery code — the button that dispatches this is disabled until then,
  // but the reducer re-checks so a forged/replayed action can't skip it either.
  if (action.type === 'finishRequested' && state.kind === 'show-recovery-code' && state.hasConfirmedSaved) {
    return { kind: 'complete' };
  }
  if (action.type === 'retried' && state.kind === 'error') {
    return { kind: 'enter-passphrase', error: null };
  }
  return state;
}
