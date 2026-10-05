/**
 * THE PLAN A PERSON CHOSE BEFORE THEY HAD AN ACCOUNT (2026-09-28).
 *
 * The funnel starts on openplate.de. Its pricing page links to
 * `/sign-up?plan=yearly` (or `monthly`), and the mailed join link then carries
 * `&plan=yearly` too. Between that click and the order page stand a sign-up
 * form, a letter, a password and perhaps a first diary day, so the choice has
 * to outlive several document loads and one mail app. This module is where it
 * is kept.
 *
 * ── Where the choice comes from, in order ────────────────────────────────
 *
 * 1. The `plan` parameter of the address being opened: the query string of
 *    `/sign-up`, and on `/join` also the fragment, because the core appends
 *    `&plan=` to a link whose fields ride after the `#`.
 * 2. What an earlier address left in `localStorage`, for at most seven days.
 *
 * A parameter that arrives is WRITTEN, with the time it arrived, so the next
 * screen can read it without the address. A parameter that names anything but
 * `monthly` or `yearly` is ignored, never an error, and it does not erase what
 * an earlier, valid link left.
 *
 * ── The tier rides with the plan (M2/06) ─────────────────────────────────
 *
 * Once the biller sells tiers, the pricing page links to
 * `/sign-up?tier=<id>&plan=<monthly|yearly>`. The tier is kept in the same
 * record, the same way, and under the same rules, with three differences:
 *
 * - It is a LABEL, not a key from a short list. No tier name is compiled into
 *   this app, so the only check here is the shape of an id
 *   ({@link TIER_ID_PATTERN}). Whether the offer lists the tier as sold is the
 *   plan page's question, asked of the offer it reads (`linkedTierIdOf`).
 * - It is stored only with a plan that arrived in the same address. A tier
 *   with no valid plan next to it is ignored, like any other parameter this
 *   module does not understand.
 * - The sign-up request carries the tier beside the plan, and the core puts
 *   `&tier=<id>` into the mailed join link after `&plan=` ({@link tierToSendWith}
 *   is the app's half of that). That link goes through the SAME capture as the
 *   plan, so a mail opened on another device keeps the tier too. A link from a
 *   core that predates the tier names a plan and no tier; such an address keeps
 *   the stored tier when it is that mailed link and the stored plan is the
 *   same one ({@link captureIntendedPlan}, `isMailedLink`). A mail opened on
 *   another device then loses the tier, as it loses everything stored here,
 *   and the plan page shows its tier list as it always did.
 *
 * ── A choice, never a pick made for somebody ─────────────────────────────
 *
 * The order page preselects the plan named here, the same way it preselects a
 * plan named by `?plan=` (M245/04): the person pressed a button that said
 * "yearly" on the pricing page, so the page they land on says so too. Nothing
 * here picks a plan the person did not name, and nothing ticks a consent.
 *
 * ── It is cleared once an order goes through ─────────────────────────────
 *
 * `plans-session.ts` hands {@link clearIntendedPlan} to the plan client, which
 * calls it when the biller accepts an order. An expired choice is removed when
 * it is read.
 *
 * The decisions are pure and take the time and the storage as arguments, so
 * every rule above is tested without a browser (`intended-plan.test.ts`).
 */
import { z } from 'zod';

import { PLAN_KEYS, type PlanKey } from '#app/lib/sync/engine/client/plans-wire';

/** The `localStorage` key. Versioned, so a later change of the stored record can start clean. */
export const INTENDED_PLAN_STORAGE_KEY = 'openplate:intended-plan:v1';

/** The name of the parameter in a link, on `/sign-up` and on `/join`. */
export const PLAN_PARAM = 'plan';

/** The name of the tier parameter, beside {@link PLAN_PARAM}. */
export const TIER_PARAM = 'tier';

/**
 * What a tier id looks like: a lowercase label of one to 32 characters, a
 * letter first, then letters, digits and hyphens. The biller's ids are labels
 * of this kind. The pattern is the whole check, so no tier name lives here.
 */
export const TIER_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** {@link TIER_ID_PATTERN} as a schema, so the stored record and a parameter are judged by one rule. */
const TIER_ID_SCHEMA = z.string().regex(TIER_ID_PATTERN);

/** How long a stored choice is honoured: seven days, in milliseconds. */
export const INTENDED_PLAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The part of `Storage` this module uses, so a test hands in a plain object. */
export interface IntendedPlanStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** The stored record: the plan key, the tier id if the link had one, and the epoch milliseconds it arrived at. */
const storedIntentSchema = z.object({
  plan: z.enum(PLAN_KEYS),
  /** Absent for a choice with no tier. A value that is not a label is dropped, and the plan stays. */
  tier: TIER_ID_SCHEMA.optional().catch(undefined),
  at: z.number(),
});

type StoredIntent = z.infer<typeof storedIntentSchema>;

/** The stored record, or `null` for a value that is not one: not JSON, or JSON of another kind. */
function parseStoredIntent(raw: string): StoredIntent | null {
  try {
    const decoded = storedIntentSchema.safeParse(JSON.parse(raw));
    return decoded.success ? decoded.data : null;
  } catch {
    // Not JSON at all: a value another build, or a person in the console, left.
    return null;
  }
}

/** The two valid keys as a set, for the one lookup of an arbitrary string. */
const PLAN_KEY_SET: ReadonlySet<string | null | undefined> = new Set<string | null | undefined>(PLAN_KEYS);

/** Whether a raw value names one of the two plans. */
function isPlanKey(value: string | null | undefined): value is PlanKey {
  return PLAN_KEY_SET.has(value);
}

/**
 * The plan a raw parameter value names, or `null` for anything else.
 *
 * Exact match only: `Yearly`, ` yearly` and `weekly` are all `null`, because a
 * link this app did not write is not one to guess about.
 */
export function readPlanKey(value: string | null | undefined): PlanKey | null {
  return isPlanKey(value) ? value : null;
}

/**
 * The plan an address names, from its query string first and its fragment
 * second, or `null`.
 *
 * @param input.search - `location.search`, with or without the leading `?`.
 * @param input.hash - `location.hash`, with or without the leading `#`. Pass
 *   `''` on a route whose fragment means nothing.
 */
export function planParamOf({ search, hash }: { search: string; hash: string }): PlanKey | null {
  const fromQuery = readPlanKey(new URLSearchParams(search).get(PLAN_PARAM));
  if (fromQuery !== null) return fromQuery;
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return readPlanKey(new URLSearchParams(fragment).get(PLAN_PARAM));
}

/**
 * The tier id a raw parameter value is, or `null` for anything else.
 *
 * Exact match of {@link TIER_ID_PATTERN}: `Alpha`, ` alpha` and `a_b` are all
 * `null`. Whether the biller sells it is not decided here.
 */
export function readTierId(value: string | null | undefined): string | null {
  const parsed = TIER_ID_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The tier an address names, from its query string first and its fragment second, or `null`. */
export function tierParamOf({ search, hash }: { search: string; hash: string }): string | null {
  const fromQuery = readTierId(new URLSearchParams(search).get(TIER_PARAM));
  if (fromQuery !== null) return fromQuery;
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return readTierId(new URLSearchParams(fragment).get(TIER_PARAM));
}

/**
 * The tier a sign-up request may carry: the tier, only beside a plan that is
 * itself sent. A tier with no plan is the same unusable thing here as it is in
 * storage, so it is left out rather than sent for the core to carry into a
 * link nobody reads it from.
 */
export function tierToSendWith({ plan, tier }: { plan: PlanKey | null; tier: string | null }): string | null {
  return plan === null ? null : tier;
}

/** The stored record for a plan, and the tier beside it if any, that arrived at `now`. */
export function encodeIntendedPlan({
  plan,
  tier = null,
  now,
}: {
  plan: PlanKey;
  tier?: string | null;
  now: number;
}): string {
  return JSON.stringify(tier === null ? { plan, at: now } : { plan, tier, at: now });
}

/** The stored record, or `null` when there is none, it does not decode, or it is seven days old or older. */
function decodeIntent({ raw, now }: { raw: string | null; now: number }): StoredIntent | null {
  if (raw === null) return null;
  const stored = parseStoredIntent(raw);
  if (stored === null) return null;
  if (now - stored.at >= INTENDED_PLAN_TTL_MS) return null;
  return stored;
}

/**
 * The plan a stored record names, or `null` when there is none, it does not
 * decode, or it is seven days old or older.
 */
export function decodeIntendedPlan({ raw, now }: { raw: string | null; now: number }): PlanKey | null {
  return decodeIntent({ raw, now })?.plan ?? null;
}

/** The tier a stored record names, or `null`: none was stored, or the record does not count (see {@link decodeIntendedPlan}). */
export function decodeIntendedTier({ raw, now }: { raw: string | null; now: number }): string | null {
  return decodeIntent({ raw, now })?.tier ?? null;
}

/**
 * The device's `localStorage`, or `null` where there is none: the server, or
 * a browser that refuses access to it (a sandboxed frame throws on the read).
 */
export function deviceStorage(): IntendedPlanStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The inputs every shell function below shares. */
interface IntentShellInput {
  now?: number;
  storage?: IntendedPlanStorage | null;
}

/**
 * The stored record, or `null`. A record that no longer counts (expired, or
 * unreadable) is removed on the way, so it cannot come back.
 */
function readIntent({ now = Date.now(), storage = deviceStorage() }: IntentShellInput = {}): StoredIntent | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(INTENDED_PLAN_STORAGE_KEY);
    const intent = decodeIntent({ raw, now });
    if (intent === null && raw !== null) storage.removeItem(INTENDED_PLAN_STORAGE_KEY);
    return intent;
  } catch {
    return null;
  }
}

/** The stored plan, or `null`. See {@link readIntent} for what is removed on the way. */
export function readIntendedPlan(input: IntentShellInput = {}): PlanKey | null {
  return readIntent(input)?.plan ?? null;
}

/** The stored tier id, or `null`: no choice, no tier beside it, or a record that no longer counts. */
export function readIntendedTier(input: IntentShellInput = {}): string | null {
  return readIntent(input)?.tier ?? null;
}

/** Stores a choice with the time it arrived. Never throws: a full or blocked storage keeps nothing. */
export function rememberIntendedPlan({
  plan,
  tier = null,
  now = Date.now(),
  storage = deviceStorage(),
}: IntentShellInput & { plan: PlanKey; tier?: string | null }): void {
  if (storage === null) return;
  try {
    storage.setItem(INTENDED_PLAN_STORAGE_KEY, encodeIntendedPlan({ plan, tier, now }));
  } catch {
    // Private mode or a full quota. The address still carries the plan on
    // this page; only a later page loses it.
  }
}

/** Forgets the choice. Called once an order goes through. Never throws. */
export function clearIntendedPlan({ storage = deviceStorage() }: Pick<IntentShellInput, 'storage'> = {}): void {
  if (storage === null) return;
  try {
    storage.removeItem(INTENDED_PLAN_STORAGE_KEY);
  } catch {
    // Nothing to do: a storage that refuses the removal refused the write too.
  }
}

/**
 * Reads the choice for the page being opened: the address first, storage
 * second. A plan the address names is stored before it is returned, so the
 * next screen finds it without the address.
 *
 * @param input.search - `location.search` of the page.
 * @param input.hash - `location.hash`, on `/join`; `''` elsewhere.
 * @param input.isMailedLink - `true` on `/join`, whose address is the link the
 *   core mailed: it echoes the plan and, from a core that knows tiers, the
 *   tier. A link with no tier (an older core) keeps a stored tier of the same
 *   plan. On `/sign-up` the address is the choice, and a link with
 *   no tier replaces a tier an older link left.
 */
export function captureIntendedPlan({
  search,
  hash,
  isMailedLink = false,
  now = Date.now(),
  storage = deviceStorage(),
}: IntentShellInput & { search: string; hash: string; isMailedLink?: boolean }): PlanKey | null {
  const fromAddress = planParamOf({ search, hash });
  if (fromAddress === null) return readIntendedPlan({ now, storage });
  const addressTier = tierParamOf({ search, hash });
  const stored = addressTier === null && isMailedLink ? readIntent({ now, storage }) : null;
  const tier = addressTier ?? (stored?.plan === fromAddress ? (stored.tier ?? null) : null);
  rememberIntendedPlan({ plan: fromAddress, tier, now, storage });
  return fromAddress;
}
