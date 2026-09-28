/**
 * Pure state machine for the sync-setup wizard. No React, no crypto, no fetch:
 * this file only decides which screen is showing and how it responds to an
 * event. The actual engine calls (Argon2id/HKDF/AES-GCM —
 * `app/lib/sync/engine/`) and the signup request are the imperative shell
 * around this reducer, living in `SyncSetupFlow`
 * (`#app/components/sync-setup-flow.tsx`) — the `tao-of-node-react`
 * "useReducer over chained useState" pattern: invalid combinations (e.g.
 * "generating" AND an error message) are unrepresentable because they are
 * different `kind`s, not independent booleans.
 *
 * ── WHAT M192 DELETED, AND WHY THE MACHINE IS SHORTER THAN ITS HISTORY ───
 *
 * There used to be a `show-account-card` state: the handle and the recovery
 * code on one screen, behind an un-skippable "I have saved this" tick. It was
 * table stakes for a feature that was unrecoverable by design, and every
 * safeguard around it — `isSyncSetupCeremonyActive`, `resolveSyncScreen`, the
 * reducer's refusal to complete without the tick — existed because that code
 * was shown exactly once and losing it was permanent.
 *
 * The code is now generated, wrapped, escrowed with the service and never
 * shown (M192). There is nothing left for the person to save, so there is
 * nothing to gate: setup ends when the account exists. The ceremony predicate
 * stays, and still guards `generating` — the session flips to signed-in DURING
 * that state, and a surrounding screen that swapped panels there would unmount
 * a wizard mid-flight.
 */

import type { SyncFormField } from './form-field-error';

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
 * ONE outcome and ONE field, and the field that is missing is the point: there
 * is no `recoveryCode` here, so no caller can render one. The code is created,
 * used and escrowed inside `createSyncAccount` and never crosses this
 * boundary.
 *
 * `email` is carried because the screen that follows greets the person by it —
 * it came from the invite, not from anything they typed, so it is worth
 * confirming once.
 */
export type SyncSetupOutcome = { status: 'ready'; email: string };

/**
 * A refusal from the SERVICE that the details form can show, attached to the
 * field it is about.
 *
 * Only server errors reach the reducer now. Everything the client can decide
 * for itself — an empty name, an `@`, a short or mistyped passphrase, an
 * invite that is not shaped like one — is the signup schema's business
 * (`signup-schema.ts`), and Conform renders each of those under its own field
 * without a state transition (owner request, 2026-09-02).
 */
export type SyncSetupServerError = { field: SyncFormField; message: string };

export type SyncSetupState =
  /** The one form: the password (and optionally a name). The address came from the invite. */
  | { kind: 'enter-details'; serverError: SyncSetupServerError | null }
  | { kind: 'generating' }
  | { kind: 'error'; message: string }
  | { kind: 'complete' };

export type SyncSetupAction =
  | { type: 'detailsSubmitted' }
  | { type: 'setupSucceeded' }
  /** `field` is `null` for a refusal nothing on the form can fix — that one gets the retry screen. */
  | { type: 'setupFailed'; message: string; field: SyncFormField | null }
  | { type: 'retried' };

/**
 * The state a wizard starts in.
 *
 * `resume` is the setup-COMPLETION path: the account already exists and both
 * the address and the passphrase have already been typed (on the sign-in
 * form), so there is nothing to ask for and the ceremony opens straight into
 * `generating`.
 */
export function initialSyncSetupState(options?: { resume?: boolean }): SyncSetupState {
  return options?.resume === true ? { kind: 'generating' } : INITIAL_SYNC_SETUP_STATE;
}

export const INITIAL_SYNC_SETUP_STATE: SyncSetupState = { kind: 'enter-details', serverError: null };

/**
 * Whether the wizard is mid-flight, so no surrounding screen may swap it out.
 *
 * ── The bug this exists to prevent ───────────────────────────────────────
 *
 * `createSyncAccount` opens the sync session as part of provisioning. The
 * settings route rendered `session.account === null ? <setup> : <connected>`,
 * so the instant provisioning finished — while this reducer was still moving
 * out of `generating` — the route swapped panels and unmounted the wizard
 * mid-transition. When there was still a recovery code to show, that was a
 * silent, permanent loss of the user's only backup key; now it is "the screen
 * changed under me halfway through", which is smaller and still wrong.
 *
 * Hence a PURE predicate here rather than a boolean threaded through
 * components: the rule is stated once, tested directly, and
 * `resolveSyncScreen` (`setup-screen.ts`) is the only thing allowed to act on
 * it.
 *
 * - `generating` — the session flips to signed-in DURING this state. Protected.
 * - `enter-details` — nothing shown yet, and no session exists to swap to.
 * - `error` — nothing to protect; if an account was created anyway, letting
 *   the connected panel take over is the more useful outcome than trapping
 *   the user in a wizard for an account that already exists.
 * - `complete` — handing over is correct.
 */
export function isSyncSetupCeremonyActive(state: SyncSetupState): boolean {
  return state.kind === 'generating';
}

/**
 * Advances the setup wizard. Every transition below is a deliberate,
 * exhaustive choice — an action that doesn't apply to the current `kind` is
 * a no-op (returns `state` unchanged) rather than throwing, since a stray
 * late-arriving action (e.g. a slow fetch resolving after the user already
 * hit "retry") should never crash the UI.
 */
export function syncSetupReducer(state: SyncSetupState, action: SyncSetupAction): SyncSetupState {
  if (action.type === 'detailsSubmitted' && state.kind === 'enter-details') {
    return { kind: 'generating' };
  }
  // STRAIGHT TO `complete`. There is no card between the two any more: the
  // account exists, the session is open, and the person has nothing to write
  // down.
  if (action.type === 'setupSucceeded' && state.kind === 'generating') {
    return { kind: 'complete' };
  }
  // A refusal the person can act on goes BACK TO THE FORM, under its field —
  // "that sign-in name is taken" is answered by changing the name, and a
  // dead-end screen with a retry button that would fail identically is the
  // wrong place to say so. Everything else keeps the retry screen.
  if (action.type === 'setupFailed' && state.kind === 'generating') {
    if (action.field === null) return { kind: 'error', message: action.message };
    return { kind: 'enter-details', serverError: { field: action.field, message: action.message } };
  }
  if (action.type === 'retried' && state.kind === 'error') {
    return { kind: 'enter-details', serverError: null };
  }
  return state;
}
