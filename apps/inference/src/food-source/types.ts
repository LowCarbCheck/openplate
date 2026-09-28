/**
 * The `FoodSource` boundary — one narrow interface, three real backends
 * (`fdc.ts`, `off.ts`, `lcc.ts`) plus a test fake.
 *
 * KEEP IT NARROW ON PURPOSE. Spec 04 flags the signature cascade explicitly:
 * every method added here fans out across three implementations and their fakes.
 * Three methods is the whole surface, and each one earns its place:
 *
 *  - `search`   — the only thing the resolution stage actually needs.
 *  - `getById`  — lets a caller re-fetch a candidate it already chose without
 *                 re-running retrieval (used by tests and, later, by any
 *                 "the user picked this one" flow); also the honest place for a
 *                 remote backend to hydrate a detail record.
 *  - `describe` — attribution and licence metadata. This is NOT decoration: BLS
 *                 data reaching a response without its credit is a CC BY 4.0
 *                 violation, and `requiresNetwork` is what lets an operator see
 *                 at a glance whether their install phones anybody.
 *
 * ONE HARD RULE FOR EVERY IMPLEMENTATION: a macro that the source does not know
 * is `null`. Not `0`, not omitted, not inferred from its siblings. A zero carb
 * figure is a claim about a food; a null is an admission. openplate's client
 * strips nulls back to "unknown" (`stripNullMacros`), so the honesty survives
 * end to end — but only if nothing here launders a gap into a number.
 */
import { z } from 'zod';
import type { Macros } from '../contract/plate-identification.js';
import type { JsonValue } from '../json.js';

/** Re-exported so a `FoodSource` implementation needs one import, not two. */
export type { Macros } from '../contract/plate-identification.js';

/**
 * The internal identity of the corpus-search operation, threaded through logs
 * and errors so a resolution failure is attributable to this stage.
 *
 * Historically (spec 04 as first drafted) this was to be a TOOL the vision model
 * called mid-turn. The v3 pipeline killed that: Locked decision 13 means the
 * model never emits macros, so there is no model turn left to hand a tool to and
 * resolution is a deterministic server-side stage instead (architect decision,
 * 2026-08-13). The name survives as the stage's identity because it is still the
 * same operation — candidates in, ranked matches out — just called by code with
 * a bounded refinement loop rather than by a model with a budget.
 */
export const SEARCH_FOODS = 'search_foods' as const;

/** A single corpus row, ranked against a query. */
export interface FoodCandidate {
  /** Stable, source-prefixed id (`fdc:167782`, `lcc:huhnerbrust`, `off:3017620422003`). */
  id: string;
  /** Display name as the source publishes it. */
  name: string;
  /** Source's own grouping, when it has one. Informational — never used for ranking. */
  category: string | null;
  /** Per 100 g. Every field nullable; null means unknown — see the module header. */
  macrosPer100g: Macros;
  /**
   * Licence credit that must be shown wherever this row's numbers are shown, or
   * `null` when the source carries none (USDA FDC is CC0 — no attribution).
   */
  attribution: string | null;
  /** Combined relevance, 0..1. Higher is better. Produced by `rankCandidates`. */
  score: number;
  /** Which retrieval signals produced `score`. `embedding` is null when unavailable. */
  signals: RetrievalSignals;
}

export interface RetrievalSignals {
  /** Token-set + trigram similarity, 0..1. Always present. */
  lexical: number;
  /**
   * Normalized embedding cosine, 0..1, or `null` when no embedding runtime is
   * configured or the call failed. Null is "we did not measure this", which is
   * why the field is nullable rather than defaulted to 0 — a 0 would be a claim
   * that the query and the row are semantically unrelated.
   */
  embedding: number | null;
}

export interface SearchOptions {
  /**
   * BCP-47-ish language subtag of the query (`en`, `de`, ...). Backends that
   * hold multilingual data pass it through; the English-only FDC backend uses it
   * to decide whether to apply its German alias table.
   */
  locale?: string;
  /** Maximum candidates to return. Implementations may return fewer. */
  limit?: number;
  /** Caller's deadline. Remote backends MUST honour it; local ones may ignore it. */
  signal?: AbortSignal;
}

export interface FoodSourceDescription {
  /** Stable backend key, matching the `FOOD_SOURCE` config value. */
  name: FoodSourceName;
  /** Human-readable licence of the DATA (not of this code). */
  license: string;
  /**
   * Credit string applied to every row from this source, or `null` when rows
   * carry their own (LCC) or need none (FDC/CC0).
   */
  attribution: string | null;
  /** True when a search leaves the operator's machine. Drives the self-host docs. */
  requiresNetwork: boolean;
}

export const FOOD_SOURCE_NAMES = ['fdc', 'off', 'lcc', 'none'] as const;
export type FoodSourceName = (typeof FOOD_SOURCE_NAMES)[number];

export interface FoodSource {
  /** Ranked candidates for one free-text food name. Throws on transport failure. */
  search(query: string, options?: SearchOptions): Promise<FoodCandidate[]>;
  /** One row by its `FoodCandidate.id`, or null when this source has no such row. */
  getById(id: string, options?: SearchOptions): Promise<FoodCandidate | null>;
  /** Licence/attribution metadata. Synchronous and side-effect free. */
  describe(): FoodSourceDescription;
}

/** An all-unknown macro row. The only sanctioned way to build one. */
export function emptyMacros(): Macros {
  return {
    carbs: null,
    fiber: null,
    sugars: null,
    polyols: null,
    protein: null,
    fat: null,
    kcal: null,
  };
}

/**
 * A macro field exactly as an external source can present it: any JSON value, or
 * absent. Named rather than left as `unknown` because that is the true set —
 * these values come out of `JSON.parse`, so no source can hand us a Buffer or a
 * class instance to be defensive about.
 */
export type RawMacroValue = JsonValue | undefined;

/**
 * A number, or a string spelling a number. Everything else — `null`, an empty
 * string, a boolean, an object, `NaN`, `Infinity`, a negative — is UNKNOWN and
 * leaves as `null` below.
 *
 * The union is what keeps `Number()` away from values it would silently turn
 * into a confident zero: `Number('')` and `Number([])` are both 0, and a label
 * that omits fibre has not declared zero fibre.
 */
const MacroValueSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value) && value >= 0);

/**
 * Coerces one external numeric field to `number | null`.
 *
 * The `null` returns are the point of this function: a non-finite, negative or
 * absent value from a remote API is UNKNOWN, and the tempting `Number(x) || 0`
 * would turn every one of them into a confident zero. Nothing in
 * `src/food-source` or `src/pipeline` may use `|| 0` or `?? 0` on a macro field
 * — spec 04 greps for exactly that.
 */
export function toMacroValue(raw: RawMacroValue): number | null {
  const parsed = MacroValueSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
