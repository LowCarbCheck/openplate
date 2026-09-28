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

/** How long a stored choice is honoured: seven days, in milliseconds. */
export const INTENDED_PLAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The part of `Storage` this module uses, so a test hands in a plain object. */
export interface IntendedPlanStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** The stored record: the plan key and the epoch milliseconds it arrived at. */
const storedIntentSchema = z.object({
  plan: z.enum(PLAN_KEYS),
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

/** The stored record for a plan that arrived at `now`. */
export function encodeIntendedPlan({ plan, now }: { plan: PlanKey; now: number }): string {
  return JSON.stringify({ plan, at: now });
}

/**
 * The plan a stored record names, or `null` when there is none, it does not
 * decode, or it is seven days old or older.
 */
export function decodeIntendedPlan({ raw, now }: { raw: string | null; now: number }): PlanKey | null {
  if (raw === null) return null;
  const stored = parseStoredIntent(raw);
  if (stored === null) return null;
  if (now - stored.at >= INTENDED_PLAN_TTL_MS) return null;
  return stored.plan;
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
 * The stored choice, or `null`. A record that no longer counts (expired, or
 * unreadable) is removed on the way, so it cannot come back.
 */
export function readIntendedPlan({
  now = Date.now(),
  storage = deviceStorage(),
}: IntentShellInput = {}): PlanKey | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(INTENDED_PLAN_STORAGE_KEY);
    const plan = decodeIntendedPlan({ raw, now });
    if (plan === null && raw !== null) storage.removeItem(INTENDED_PLAN_STORAGE_KEY);
    return plan;
  } catch {
    return null;
  }
}

/** Stores a choice with the time it arrived. Never throws: a full or blocked storage keeps nothing. */
export function rememberIntendedPlan({
  plan,
  now = Date.now(),
  storage = deviceStorage(),
}: IntentShellInput & { plan: PlanKey }): void {
  if (storage === null) return;
  try {
    storage.setItem(INTENDED_PLAN_STORAGE_KEY, encodeIntendedPlan({ plan, now }));
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
 */
export function captureIntendedPlan({
  search,
  hash,
  now = Date.now(),
  storage = deviceStorage(),
}: IntentShellInput & { search: string; hash: string }): PlanKey | null {
  const fromAddress = planParamOf({ search, hash });
  if (fromAddress === null) return readIntendedPlan({ now, storage });
  rememberIntendedPlan({ plan: fromAddress, now, storage });
  return fromAddress;
}
