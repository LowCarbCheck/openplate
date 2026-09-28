/**
 * EXPLICIT CONSENT TO HEALTH DATA, as the app reads it (2026-09-28).
 *
 * The privacy notice of a hosted instance names Art. 9(2)(a) GDPR, explicit
 * consent, as the legal basis for the diary, because its operator holds the
 * escrowed recovery code that can open it (`openplate-core` `PROTOCOL.md`
 * §3.1, §5.15.1). The core asks for the consent and records it; this module
 * reads what it says in three places:
 *
 * - `instance.healthConsent` on `/health`: the version an instance asks for,
 *   or `null` when it asks for none.
 * - `AccountView.healthConsent`: the version an account agreed to, or `null`.
 * - `400 health-consent-required`: the one refusal of both consent paths.
 *
 * ── An older core, and a broken value, read as "no consent" ─────────────
 *
 * `AccountView` is cast, not parsed, by the auth client, so this is the
 * boundary where its new field is checked, the way `trial-scans.ts` checks
 * `trialScans`. A missing key, a `null` and a malformed value all answer
 * `null`. On the instance side the handshake decoder already answers `null`
 * for all three (`protocol.ts`).
 */
import { z } from 'zod';

import { SyncRequestError } from '#app/lib/sync/engine/client/sync-error';
import { HEALTH_CONSENT_REQUIRED, type HealthConsentWire } from '#app/lib/sync/engine/client/auth-wire';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';

/** A consent on record: the version of the wording agreed to, and the service's instant. */
export interface HealthConsent {
  version: string;
  at: string;
}

const healthConsentSchema = z
  .object({ version: z.string().min(1), at: z.string().min(1) })
  .nullable()
  .catch(null);

/**
 * The account's consent on record, or `null` for none.
 *
 * @param wire - `AccountView.healthConsent` as it arrived, which an older core omits.
 */
export function decodeHealthConsent(wire: HealthConsentWire | null | undefined): HealthConsent | null {
  if (wire === undefined) return null;
  const parsed = healthConsentSchema.parse(wire);
  return parsed === null ? null : { version: parsed.version, at: parsed.at };
}

/**
 * The version this instance asks every account to agree to, or `null` when it
 * asks for none, or when nothing is known about the instance yet.
 *
 * @param instance - the handshake's descriptor, or `null` while unread.
 */
export function requiredHealthConsentVersion(instance: InstanceDescriptor | null): string | null {
  return instance?.healthConsent?.version ?? null;
}

/**
 * Whether a failure is the service refusing a consent: missing, or for a
 * version it no longer asks for. The caller reads the handshake again and
 * shows the box again.
 *
 * @param cause - anything a consent path threw.
 */
export function isHealthConsentRefusal(cause: unknown): boolean {
  return cause instanceof SyncRequestError && cause.status === 400 && cause.code === HEALTH_CONSENT_REQUIRED;
}

/**
 * Whether a failure is the consent route answering that it does not exist,
 * which is how an instance that asks for no consent answers it.
 *
 * @param cause - anything the consent route threw.
 */
export function isHealthConsentRouteAbsent(cause: unknown): boolean {
  return cause instanceof SyncRequestError && cause.kind === 'not-found';
}
