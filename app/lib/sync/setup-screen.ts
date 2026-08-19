/**
 * Which screen `/settings/sync` shows — as a pure function, because getting it
 * wrong cost a user their only recovery code.
 *
 * ── Why this is not just a ternary in the route ──────────────────────────
 *
 * It WAS a ternary in the route:
 *
 *     session.account === null ? <SignedOutPanel/> : <ConnectedPanel/>
 *
 * which reads as obviously correct and is not, because `createSyncAccount`
 * opens the session as a side effect of provisioning. The moment the key
 * records landed, `session.account` became non-null, the route re-rendered,
 * and the entire setup subtree — including the wizard that was one dispatch
 * away from displaying the recovery code — was unmounted. The code is shown
 * exactly once; nobody ever saw it.
 *
 * Nothing about that is visible from either side in isolation. The session
 * store is right, the wizard is right, and the wizard's own tests pass because
 * they render it standalone where no session flips underneath it. Only the
 * COMPOSITION is wrong, so the composition is what gets a name, a rule, and a
 * test (`tests/unit/sync-setup-screen.test.ts`).
 */

export type SyncScreen = 'setup' | 'connected';

export interface SyncScreenInput {
  /** Whether a sync session is currently open. Flips to `true` DURING provisioning, not after the user is done. */
  hasAccount: boolean;
  /** Whether the setup wizard still owes the user something (`isSyncSetupCeremonyActive`). */
  isCeremonyActive: boolean;
}

/**
 * THE RULE: an active ceremony wins over an open session, always.
 *
 * A session appearing mid-ceremony is the NORMAL case, not an edge case —
 * provisioning is what creates it. So "signed in" cannot be the thing that
 * decides this screen while the wizard is mid-flight. The connected panel is
 * only ever reachable once the wizard has released it, which the wizard does
 * exclusively after the user ticks "I've saved this recovery code" (see
 * `setup-flow.ts`'s reducer — `complete` is unreachable without it).
 */
export function resolveSyncScreen({ hasAccount, isCeremonyActive }: SyncScreenInput): SyncScreen {
  if (isCeremonyActive) return 'setup';
  return hasAccount ? 'connected' : 'setup';
}
