/**
 * WHICH AI THIS DEVICE USES, decided in one place (M192).
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * On a MANAGED instance, a signed-in account with an allowance scans through
 * its own server: `${SYNC_SERVER_URL}/v1`, the model the instance advertises
 * in `/health`, and the account's access token as the bearer. On an OPEN
 * instance, the device's own BYOK row. Anything else is `null`, which every
 * caller renders as "AI is not set up".
 *
 * ── Derived, never stored, and that is the whole point ───────────────────
 *
 * Nothing here is written to `openplate-ai`. The previous shape did write: a
 * gateway join saved an ordinary settings row carrying a member token, and the
 * row then had to be kept in step with the account across devices, synced
 * inside the owner-private compartment, reconciled on drift, and cleared on a
 * disconnect. Four mechanisms existed to keep one derived fact consistent, and
 * M187/02's drift reconciliation existed because they did not.
 *
 * A derived value cannot drift. Sign in and the AI works on every device at
 * once; sign out and it stops; an admin lowers the allowance to zero and the
 * next screen reads it. No row, no migration, no reconciliation.
 *
 * ── Pure, and why the bearer is not in here ──────────────────────────────
 *
 * {@link resolveEffectiveAiSettings} takes everything it reads as arguments so
 * the rule can be tested without a session, a store or a network. The bearer
 * is a live credential out of the vault, so it lives in
 * {@link managedAiCredential} below — the impure half, one function, obvious
 * at the call site.
 */
import type { LocalAiSettings } from '#app/lib/local-store';
import type { SyncSessionSnapshot } from '#app/lib/sync/sync-session';
import { getSyncVault } from '#app/lib/sync/sync-session';
import type { OpenAiCompatibleCredential } from '#app/services/vision/openai-compatible';

/** The API namespace the instance's AI proxy is mounted under, appended to `SYNC_SERVER_URL`. */
export const MANAGED_AI_API_PREFIX = '/v1';

/** What this instance is, and what it says about its own AI — the facts the rule reads. */
export interface ManagedInstanceFacts {
  /** `PublicConfig.managed`. */
  managed: boolean;
  /** `PublicConfig.syncServerUrl`. `null` on an instance with no sync at all. */
  syncServerUrl: string | null;
  /**
   * `instance.ai.model` from `/health`, or `null` — for an instance with no
   * upstream key, for one that names no model, and for a handshake this client
   * has not read yet.
   */
  model: string | null;
}

/** The instance's own AI, authenticated by the session. Nothing here is persisted. */
export interface ManagedAiSettings {
  source: 'managed';
  /** Always `'managed'` — the registry entry whose endpoint and bearer both come from elsewhere. */
  provider: 'managed';
  /** `${SYNC_SERVER_URL}/v1`. The adapter appends `/chat/completions` itself. */
  baseUrl: string;
  /**
   * The model the instance advertises, or `null` when it advertises none.
   *
   * NULLABLE ON PURPOSE, and no caller may paper over it. The proxy passes the
   * request body through untouched, so a scan needs a real model id; an
   * instance that has an upstream key but names no model is a misconfiguration
   * its operator has to fix. `createVisionProvider` requires a `string`, which
   * is what forces every caller to face the `null` rather than send `''`.
   */
  model: string | null;
}

/** The device's own BYOK row, on an instance that has no AI of its own. */
export interface StoredAiSettings {
  source: 'stored';
  settings: LocalAiSettings;
}

export type EffectiveAiSettings = ManagedAiSettings | StoredAiSettings;

/**
 * THE RULE. Pure, total, and the only place it is written down.
 *
 * `null` means "this device cannot scan", and the three ways to get there are
 * deliberately not distinguished here — they are distinguished by the SCREEN,
 * which knows whether to say "sign in", "ask your administrator" or "connect a
 * provider". Returning a reason from this function would put that copy
 * decision in a pure module and force every caller to re-map it.
 *
 * BYOK IS REFUSED ON A MANAGED INSTANCE, even when a row exists. Such a row is
 * a leftover from before the instance was managed, or from a device that was
 * once on an open one, and honouring it would send somebody's plate photos to
 * a provider their organization did not choose while the organization's own
 * allowance sat unused.
 */
export function resolveEffectiveAiSettings({
  instance,
  session,
  storedSettings,
}: {
  instance: ManagedInstanceFacts;
  session: SyncSessionSnapshot;
  storedSettings: LocalAiSettings | null;
}): EffectiveAiSettings | null {
  if (!instance.managed) {
    return storedSettings === null ? null : { source: 'stored', settings: storedSettings };
  }
  // A managed instance without a server address cannot boot (`isManagedInstance`
  // throws), so this branch is the belt to that braces — and it is `null`
  // rather than a throw because a screen must not crash on a configuration it
  // did not make.
  if (instance.syncServerUrl === null) return null;
  const account = session.account;
  if (account === null) return null;
  // AN ALLOWANCE OF ZERO IS THE DEFAULT for a new account, not an error state:
  // an admin decides who gets AI and how much. So "signed in, no AI" is an
  // ordinary standing, and the screen for it says "ask your administrator"
  // rather than "something went wrong".
  if (account.dailyAiLimit <= 0) return null;
  return {
    source: 'managed',
    provider: 'managed',
    baseUrl: `${instance.syncServerUrl}${MANAGED_AI_API_PREFIX}`,
    model: instance.model,
  };
}

/**
 * The bearer for a managed scan — the impure half.
 *
 * `getBearer` reads the CURRENT access token every time rather than closing
 * over one, because a scan can be started minutes after the settings were
 * resolved and the token in between may have rotated. `refreshBearer` spends
 * the refresh token, and is only ever called after a 401
 * (`openai-compatible.ts`) — never speculatively, because a refresh token is
 * single-use and two callers spending one look exactly like a stolen token.
 *
 * Both answer `null` when there is no session, which the adapter sends as no
 * `Authorization` header at all: the server then answers its own 401, and the
 * truth ("you are not signed in") reaches the screen instead of a malformed
 * credential.
 */
export function managedAiCredential(): OpenAiCompatibleCredential {
  return {
    getBearer: async () => getSyncVault()?.authClient.getAccessToken() ?? null,
    refreshBearer: async () => (await getSyncVault()?.authClient.refreshAccessToken()) ?? null,
  };
}
