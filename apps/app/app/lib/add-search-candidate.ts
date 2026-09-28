/**
 * The row `/add/search` lists and opens, as a type of its own.
 *
 * It lives here rather than in `add.search.tsx` because a second module needs
 * it: the add drafts (`add-drafts.ts`) keep the candidate a person had open, so
 * the portion step is still there when they come back from another method. A
 * library module importing a type out of a route file would turn the
 * dependency direction around, so the type moved down to the library and the
 * route re-exports it under the same name.
 */
import type { LocalQuickAddCandidate } from '#app/lib/local-store/local-quick-add';
import type { MatchTier } from '#app/lib/match-quality';

/**
 * A federated candidate decorated with the curated match's relevance tier
 * (defect: 10 curated results now return, up from 3, and an exact match and a
 * fuzzy typo-recovery guess must not look identical). `LocalQuickAddCandidate`
 * itself doesn't carry a raw score (it's a local-first, source-agnostic
 * shape), so the tier is computed once, at candidate-build time, from the
 * `FoodMatch.score` that's still in scope: `null` for `'recent'`/`'custom'`
 * rows, which have no relevance score to tier.
 */
export interface AddSearchCandidate extends LocalQuickAddCandidate {
  matchTier: MatchTier | null;
}
