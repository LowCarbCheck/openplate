/**
 * The `/api/food-micronutrients` contract, as it crosses from this server to
 * this browser (the micronutrient backfill, 2026-10-13).
 *
 * A MODULE OF ITS OWN for the reason `wire.ts` gives: the route
 * (`app/routes/api.food-micronutrients.ts`) and the device's backfill job
 * (`#app/lib/micronutrient-backfill-client`) read ONE definition, and the
 * browser bundle never pulls in the server's cache or its key just to name a
 * field.
 *
 * ── FOUR ANSWERS PER SLUG, AND THEY ARE NOT INTERCHANGEABLE ──────────────
 *
 * - `filled`: LowCarbCheck knows the food and has at least one block. The
 *   block is mapped through the SAME schema and mapping the search path uses
 *   (`toMicronutrientsPer100g`), so a backfilled food reads exactly like one
 *   logged today.
 * - `no-data`: LowCarbCheck knows the food and has no block for it. A real,
 *   checked answer, and a final one.
 * - `not-found`: no LowCarbCheck locale knows this slug. Also final.
 * - `unknown`: the lookup failed (an upstream error, a refusal, a timeout, a
 *   body that did not parse, the daily cap reached mid-batch). NEVER a fake
 *   `no-data`: the device counts it as one attempt and asks again later.
 *
 * Nothing secret crosses: a slug, and the figures LowCarbCheck publishes for it.
 */
import { z } from 'zod';
import { micronutrientsPer100gSchema, type MicronutrientsPer100g } from '#app/lib/micronutrients';

/** At most this many distinct slugs are answered per request; the rest of a longer list is ignored. */
export const MAX_SLUGS_PER_REQUEST = 20;

/** A longer slug is no LowCarbCheck slug, and is answered `not-found` without a call. */
export const MAX_SLUG_LENGTH = 200;

/**
 * The characters a slug may hold before it is put into an upstream URL path.
 *
 * Letters, digits, `-` and `_`, starting with a letter or digit. LowCarbCheck's
 * own slugs are lowercase words joined by hyphens; the wider set only keeps a
 * slug from a future importer from being refused. What it excludes is the
 * point: no `.`, so `..` can never walk the path to another endpoint under
 * this instance's key, and no `/`, `?` or `#`.
 */
const LOOKUPABLE_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

/**
 * Whether a slug can be asked about at all.
 *
 * @param slug - a slug as the device sent it.
 * @returns false for anything LowCarbCheck could never hold, which the route answers `not-found` without a call.
 */
export function isLookupableSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && LOOKUPABLE_SLUG.test(slug);
}

/** What the route knows about one slug. See the module header for what each kind promises. */
export type SlugMicronutrientsOutcome =
  | { kind: 'filled'; micronutrientsPer100g: MicronutrientsPer100g }
  | { kind: 'no-data' }
  | { kind: 'not-found' }
  | { kind: 'unknown' };

/** One slug and its outcome. A list rather than a record keyed by slug, so no slug can collide with an object key. */
export interface SlugMicronutrientsAnswer {
  slug: string;
  outcome: SlugMicronutrientsOutcome;
}

/** The route's success body: one answer per distinct slug it accepted, in the order they were sent. */
export interface FoodMicronutrientsResponseBody {
  results: SlugMicronutrientsAnswer[];
}

/** The body of a `429`, from the per-address limiter or the daily cap: nothing was asked, try again after the pause. */
export interface FoodMicronutrientsThrottledBody {
  throttled: true;
  retryAfterMs: number;
}

const outcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('filled'), micronutrientsPer100g: micronutrientsPer100gSchema }),
  z.object({ kind: z.literal('no-data') }),
  z.object({ kind: z.literal('not-found') }),
  z.object({ kind: z.literal('unknown') }),
]);

/**
 * The success body as the device reads it, validated rather than trusted: a
 * server on another build may drift, and a figure that does not parse must not
 * reach the diary.
 */
export const foodMicronutrientsResponseSchema = z.object({
  results: z.array(z.object({ slug: z.string(), outcome: outcomeSchema })),
});

/** A request body carrying a `slugs` list; each element is checked one by one. */
const requestSchema = z.object({ slugs: z.array(z.unknown()) });

/**
 * The distinct, non-empty slugs a request names, at most {@link MAX_SLUGS_PER_REQUEST}.
 *
 * @param body - the parsed JSON body.
 * @returns the slugs in the order sent, duplicates and blanks dropped, or `null` when the body names no list at all.
 */
export function parseRequestedSlugs(body: z.infer<ReturnType<typeof z.json>>): string[] | null {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return null;
  const slugs: string[] = [];
  for (const candidate of parsed.data.slugs) {
    const slug = z.string().trim().min(1).safeParse(candidate);
    if (!slug.success || slugs.includes(slug.data)) continue;
    slugs.push(slug.data);
    if (slugs.length === MAX_SLUGS_PER_REQUEST) break;
  }
  return slugs;
}
