/**
 * Explicit consent to the processing of health data (Art. 9(2)(a) GDPR).
 *
 * WHY THIS SERVICE ASKS AT ALL. It stores a diary it cannot read, and on a
 * self-hosted instance that is the whole story. A hosted instance is
 * different: its operator holds the escrowed recovery code (ADR-0005), so the
 * operator can open the diary, and the diary is health data (foods, weight,
 * fasting). The privacy notice of a hosted instance therefore names explicit
 * consent as the legal basis, and a basis the operator cannot show is not one.
 *
 * WHAT THIS MODULE DECIDES, AND NOTHING ELSE. Whether a submitted consent
 * matches the version the instance asks for, and how a stored consent reads
 * on the wire. The instance's version comes from `HEALTH_CONSENT_VERSION`
 * (`config.ts`); where it is enforced is `auth-handlers.ts`.
 *
 * `null` EVERYWHERE MEANS "THIS INSTANCE ASKS FOR NONE". That is the default,
 * and what a self-hoster keeps: an instance whose operator is the person has
 * nobody to ask.
 */
import { asObject, asString, type JsonValue } from '../lib/json.js';
import type { HealthConsentView, InstanceHealthConsent } from '../protocol.js';

/**
 * The ONE refusal every consent check answers with, on account creation and
 * on the prompt route alike: the field is missing, is not an object, carries
 * no string `version`, or names a version this instance does not ask for.
 *
 * MACHINE-SHAPED, like `invite-invalid`. A client branches on it to show its
 * checkbox again, and renders its own words for it.
 */
export const HEALTH_CONSENT_REQUIRED = 'health-consent-required';

/**
 * What `HEALTH_CONSENT_VERSION` may hold: 1 to 32 letters, digits, dots,
 * underscores and hyphens. A date such as `2026-09-28` is the intended shape.
 *
 * NARROW ON PURPOSE. The value is published on `/health`, stored on every
 * account and compared byte for byte with what a client echoes back, so a
 * space, a quote or a character that normalises differently would be a
 * consent nobody can ever match.
 */
const HEALTH_CONSENT_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

/** Whether a string is a version this service would accept as `HEALTH_CONSENT_VERSION`. */
export function isHealthConsentVersion(value: string): boolean {
  return HEALTH_CONSENT_VERSION_PATTERN.test(value);
}

/**
 * A consent on record: the version agreed to, and the instant this server
 * recorded it. The instant is the server's clock, never a client's claim.
 */
export interface HealthConsentRecord {
  version: string;
  at: Date;
}

/**
 * Whether `submitted` is `{"version": "<the instance's version>"}`.
 *
 * EXACT, BYTE FOR BYTE. No trim, no case fold: the client echoes back the
 * string `/health` published, and anything else is a consent to a wording
 * this instance is not asking about, which is no consent at all.
 */
export function matchesHealthConsent(input: {
  policy: InstanceHealthConsent;
  submitted: JsonValue | undefined;
}): boolean {
  const version = asString(asObject(input.submitted)?.version);
  return version !== null && version === input.policy.version;
}

/** A stored consent as the wire carries it, see `AccountView.healthConsent`. */
export function healthConsentView(record: HealthConsentRecord | null): HealthConsentView | null {
  if (record === null) return null;
  return { version: record.version, at: record.at.toISOString() };
}

/**
 * The two nullable columns, read back as one value or none.
 *
 * BOTH OR NEITHER, and the schema's check constraint guarantees it
 * (`db/schema.ts`). A half-set pair is therefore unreachable; it reads as no
 * consent rather than as half of one, which errs toward asking again.
 */
export function healthConsentFromColumns(input: {
  version: string | null;
  at: Date | null;
}): HealthConsentRecord | null {
  if (input.version === null || input.at === null) return null;
  return { version: input.version, at: input.at };
}
