/**
 * WHICH FEATURES AN ACCOUNT MAY USE, as one pure answer (M2/05, ADR-0024).
 *
 * The core can hold a list of FEATURE LABELS per account, written by the biller
 * (`AccountView.capabilities`, the EFFECTIVE list). This module is where the app
 * turns that list into a yes or a no. It knows four feature words and nothing
 * else: no tier name, no price, no plan key. What a tier is called and what it
 * costs arrive from the biller as data (`plans-wire.ts`) and are displayed, never
 * compiled in.
 *
 * ── FAIL OPEN, ALWAYS ────────────────────────────────────────────────────
 *
 * {@link canUseFeature} answers `true` unless it has positive proof of a closed
 * door. The order is the whole policy:
 *
 * 1. A person on their OWN AI key never meets a gate: their requests do not go
 *    through the core's proxy, so there is nothing to sell them.
 * 2. An instance that sells no plans (`hasPlansDoor` false: every self-hosted
 *    and beta instance) is open.
 * 3. A list that is `null` or absent is open. `null` is how the core says
 *    "everything is allowed" and also what the app reads before the account
 *    view has landed and from a core older than the field.
 * 4. Otherwise the feature is open only when the list names it.
 *
 * A GATE HERE IS A DOOR, NOT A LOCK. A person who edits the client gets past it.
 * What costs money is enforced by the core's AI proxy, which refuses a request
 * that carries a feature label the account lacks (`403 capability-required`).
 */
import { z } from 'zod';

/**
 * The feature words, in the order the plan page lists them. A feature is a
 * thing a person can name, never a tier. `voice` and `chat` have a gate and no
 * screen yet: the microphone and the chat entry are built later (M2/07), and
 * this list is what gives them a door.
 */
export const FEATURE_LABELS = ['fasting', 'pantry', 'voice', 'chat'] as const;

export type FeatureLabel = (typeof FEATURE_LABELS)[number];

/** Is this word one of the features this build knows? */
export function isFeatureLabel(value: string): value is FeatureLabel {
  return FEATURE_LABELS.some((label) => label === value);
}

/**
 * The request header that names the feature an AI request is made for, so the
 * core's proxy can refuse it for an account that lacks it. Sent ONLY on the
 * managed credential, like `X-Intake-Id`: a custom header to a provider the
 * person configured would fail that provider's CORS preflight.
 */
export const FEATURE_HEADER = 'X-Openplate-Feature';

/** The `error` code the proxy answers a closed feature with, on a `403`. */
export const CAPABILITY_REQUIRED_CODE = 'capability-required';

/** A list of feature labels as the wire carries it: every entry a string. */
const capabilityListSchema = z.array(z.string());

/**
 * Reads a capability list off the wire.
 *
 * AN ABSENT KEY, A `null` AND ANYTHING THAT IS NOT A LIST OF STRINGS ALL READ
 * `null`, which means "everything is allowed". The field is younger than the
 * client that reads it, and a hostile or newer server must never be able to
 * close a door by sending nonsense.
 *
 * @param wire - `AccountView.capabilities` or `InstanceDescriptor.defaultCapabilities`.
 */
export function decodeCapabilities(wire: unknown): string[] | null {
  const parsed = capabilityListSchema.safeParse(wire);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether a feature is open for this account. See the module header for the
 * order; the truth table is `tests/unit/capabilities.test.ts`.
 *
 * @param input.feature - the feature word.
 * @param input.hasPlansDoor - `hasPlansDoor(instance)`: whether this instance
 *   sells plans at all. `false` while the descriptor is unread.
 * @param input.capabilities - the account's effective list, or `null`/absent.
 * @param input.isOwnKey - `true` for an AI feature on the person's own key.
 */
export function canUseFeature({
  feature,
  hasPlansDoor,
  capabilities,
  isOwnKey = false,
}: {
  feature: FeatureLabel;
  hasPlansDoor: boolean;
  capabilities: readonly string[] | null | undefined;
  isOwnKey?: boolean;
}): boolean {
  if (isOwnKey) return true;
  if (!hasPlansDoor) return true;
  if (capabilities === null || capabilities === undefined) return true;
  return capabilities.includes(feature);
}
