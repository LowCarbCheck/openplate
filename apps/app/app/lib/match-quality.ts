/**
 * Match-quality tiering for curated LowCarbCheck food matches. The resolver
 * returns up to three score-ranked matches per identified food; this pure
 * module turns a relevance score into a trust tier so the confirm UI can tell
 * a confident match ("Chicken breast" → "Chicken breast, raw") from a shaky one
 * ("whole fish" → "Wheat whole grain, raw") instead of presenting every top
 * match with equal confidence.
 *
 * Pure — unit-tested without React. The score bands live only here.
 */

/**
 * Score at or above which a match is presented confidently by default.
 *
 * Calibrated against LCC's own lexical-tier score bands
 * (`apps/remix-lcc/app/lib/food-api/matcher.ts`, read 2026-07-28) — `score`
 * here is LCC's documented "pure relevance" figure, ALWAYS the original
 * unbiased score (LCC's per-origin ranking bias affects result ORDER only,
 * never the number a caller sees — see that file's `rankWithBias` doc). LCC's
 * exact/prefix tier floors at 0.875; the next tier down (token-prefix)
 * ceilings at 0.825. This threshold sits in the 0.05-wide gap between them,
 * so it cleanly separates the two tiers with margin on both sides. The OLD
 * threshold (0.8) sat INSIDE the token-prefix band, so a same-relevance-class
 * "eggs"/"cheese"/"bread"/"rice"/"yogurt" search — which real production data
 * shows clustering entirely in the 0.88-0.95 prefix band — read as 100%
 * "strong", conveying no distinction at all.
 */
const STRONG_MATCH_MIN_SCORE = 0.85;
/**
 * Score at or above which a match is a plausible (but hedged) suggestion.
 *
 * Also calibrated against the real bands: LCC's substring tier floors at 0.6,
 * strictly above the token-overlap tier's ceiling (0.55) — this threshold
 * sits in that gap, separating "likely" (substring and token-prefix hits)
 * from "weak" (token-overlap and typo-tolerant fuzzy hits, which cap at 0.35
 * and can never reach this floor).
 */
const LIKELY_MATCH_MIN_SCORE = 0.58;

/** Trust tier for a single curated match, derived from its relevance score. */
export type MatchTier = 'strong' | 'likely' | 'weak';

/**
 * Classifies a relevance score (0..1) into a trust tier.
 *
 * @param score - the match's relevance score.
 * @returns `'strong'` (≥ 0.85), `'likely'` (≥ 0.58), otherwise `'weak'`.
 */
export function matchTier(score: number): MatchTier {
  if (score >= STRONG_MATCH_MIN_SCORE) return 'strong';
  if (score >= LIKELY_MATCH_MIN_SCORE) return 'likely';
  return 'weak';
}

/**
 * Whether a tier is trustworthy enough to surface the match card by default
 * (rather than hiding it behind the "See other matches" disclosure).
 *
 * @param tier - the match tier.
 * @returns `true` for `'strong'`/`'likely'`, `false` for `'weak'`.
 */
export function isConfidentTier(tier: MatchTier): boolean {
  return tier === 'strong' || tier === 'likely';
}

/** Human-facing tier label for the subtle trust chip (never shows the raw score). */
export const matchTierLabel = {
  strong: 'Strong match',
  likely: 'Possible match',
  weak: 'Rough match',
} satisfies Record<MatchTier, string>;

/** Zinc pill classes per tier — subtle, neutral, tiered by text weight (DESIGN.md §6). */
export const matchTierChipClass = {
  strong: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300',
  likely: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
  weak: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400',
} satisfies Record<MatchTier, string>;
