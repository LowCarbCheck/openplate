/**
 * `search_foods` — one identified food name in, one accepted corpus row or
 * nothing out, with a HARD BOUND on how many times it will try.
 *
 * This is the module spec 04's refinement-cap requirements land on. The original
 * design handed `search_foods` to the vision model as a tool and capped the
 * model's refinement turns at two. The v3 pipeline removed the model turn
 * entirely (Locked decision 13 — the model never emits macros, so there is
 * nothing left for it to refine), so the cap now governs THIS stage's own
 * re-query logic, which is where the same runaway risk actually lives: eight
 * plate items × an unbounded query-rewrite loop is how a 3-second scan becomes a
 * 90-second scan.
 *
 * THE QUERY PLAN, and why each round exists. Rounds are generated up front, not
 * decided adaptively, so the worst case is visible in the code rather than
 * emergent:
 *
 *   round 0  the name as identified                  "grilled chicken breast with herbs"
 *   round 1  minus preparation / cut / vessel words   "chicken breast herbs"
 *   round 2  the single most discriminating token     "chicken"
 *
 * Round 1 exists because the corpus names foods, not servings: "fillet", "slice",
 * "bowl" and "portion" appear on plates and never in USDA descriptions, and
 * "salmon fillet" scores 0.41 while "salmon" scores 0.75. Round 2 exists for
 * multi-word names whose head noun is the only thing the corpus knows ("black
 * coffee" → "coffee"). Both stop early: the loop returns the moment a round
 * clears the threshold, so the common case is one query.
 *
 * ONE ACCEPT THRESHOLD FOR EVERY ROUND, deliberately. Escalating the threshold
 * for later rounds was the first draft, and it rejected legitimate round-1
 * rescues; keeping the query plan conservative is the better control. The number
 * is calibrated against the committed FDC dataset (see `eval/BASELINE.md`): clear
 * matches land 0.75–0.97, semantic near-misses ("caesar salad" → "Salad dressing,
 * caesar") land in the low 0.6s, and unrelated junk lands under 0.5.
 *
 * BELOW THRESHOLD MEANS NOTHING IS RETURNED. Not the best guess, not a lower-
 * confidence flag — nothing, and the item's macros stay `null`. On the v3 pipeline
 * there is no model estimate to fall back to, so a bad accept is not "slightly
 * worse data", it is a fabricated number a person will eat by.
 */
import { rerankByEmbedding, type Embedder } from './embedding.js';
import { tokenize } from './lexical.js';
import type { FoodCandidate, FoodSource, SearchOptions } from './types.js';

/**
 * Hard cap on re-queries after the initial one. Spec 04 requirement, enforced by
 * `buildQueryPlan` returning at most `MAX_REFINEMENT_ROUNDS + 1` queries and
 * covered by `tests/unit/refinement-bound.test.ts`.
 */
export const MAX_REFINEMENT_ROUNDS = 2;

/** Minimum combined score for a candidate to be accepted. See the module header. */
export const ACCEPT_SCORE = 0.68;

/** Candidates requested per round. Enough for the embedding re-ranker to have something to do. */
const CANDIDATES_PER_ROUND = 24;

/**
 * Words that describe how a food was PREPARED, CUT or SERVED rather than which
 * food it is. Dropped in round 1 because the corpus indexes foods: a plate says
 * "grilled chicken fillet", USDA says "Chicken, breast, meat only, cooked".
 *
 * Cooking words are included even though the corpus does carry some of them
 * ("cooked", "grilled"), because keeping them costs coverage on every row that
 * omits them, and round 0 already tried the version that keeps them.
 */
const SERVING_MODIFIERS = new Set([
  'grilled',
  'fried',
  'roasted',
  'roast',
  'baked',
  'steamed',
  'boiled',
  'cooked',
  'raw',
  'fresh',
  'homemade',
  'toasted',
  'seared',
  'sauteed',
  'poached',
  'scrambled',
  'breaded',
  'smoked',
  'fillet',
  'filet',
  'slice',
  'sliced',
  'piece',
  'pieces',
  'portion',
  'serving',
  'half',
  'whole',
  'small',
  'medium',
  'large',
  'bowl',
  'plate',
  'cup',
  'glass',
  'side',
  'mixed',
  'assorted',
  'chopped',
  'diced',
  'shredded',
  'grated',
  'mashed',
]);

export interface SearchFoodsResult {
  /** The accepted row, or `null` — see the module header on why there is no third state. */
  accepted: FoodCandidate | null;
  /**
   * Best candidate seen across all rounds even when it failed the threshold.
   * Diagnostics only: it is never returned to a client, and its score is what a
   * threshold change would be re-tuned against.
   */
  best: FoodCandidate | null;
  /** Queries actually issued, in order. Length is bounded by `MAX_REFINEMENT_ROUNDS + 1`. */
  queries: string[];
}

/** Strips parenthesised asides, which are almost always the model explaining itself. */
function stripAsides(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ');
}

/**
 * Round 1: the name minus serving/preparation words. Returns `null` when that
 * would remove everything or change nothing (in which case the round is skipped
 * rather than spent re-issuing an identical query).
 */
function simplify(name: string): string | null {
  const kept = tokenize(stripAsides(name)).filter((token) => !SERVING_MODIFIERS.has(token));
  if (kept.length === 0) return null;
  return kept.join(' ');
}

/** Round 2: the longest remaining content token — a crude but effective "head noun". */
function headToken(name: string): string | null {
  const tokens = tokenize(stripAsides(name)).filter((token) => !SERVING_MODIFIERS.has(token));
  if (tokens.length < 2) return null;
  return tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
}

/**
 * The full query plan for one item name, deduplicated and capped.
 *
 * Exported because the cap is a REQUIREMENT, not an implementation detail: the
 * test asserts on this function directly so an unbounded rewrite added later
 * fails a test rather than a code review.
 */
export function buildQueryPlan(name: string): string[] {
  const plan: string[] = [];
  const push = (candidate: string | null): void => {
    const trimmed = candidate?.trim();
    if (!trimmed || plan.includes(trimmed)) return;
    if (plan.length > MAX_REFINEMENT_ROUNDS) return;
    plan.push(trimmed);
  };

  push(name);
  push(simplify(name));
  push(headToken(name));
  return plan;
}

export interface SearchFoodsOptions extends SearchOptions {
  source: FoodSource;
  /** The identified food name, verbatim from the pipeline. */
  name: string;
  embedder?: Embedder | null;
  /** Override for tests and tuning. Defaults to `ACCEPT_SCORE`. */
  acceptScore?: number;
}

/**
 * Runs the bounded query plan against one `FoodSource`.
 *
 * Transport errors PROPAGATE. Fail-open is a policy decision about a whole plate
 * and it belongs to the resolution stage (`pipeline/resolve-nutrition.ts`), which
 * knows whether an item is one of eight or the only one; swallowing the error
 * here would deny it that choice and make a dead corpus indistinguishable from a
 * corpus that simply has no match.
 */
export async function searchFoods(options: SearchFoodsOptions): Promise<SearchFoodsResult> {
  const { source, name, embedder = null, acceptScore = ACCEPT_SCORE } = options;
  const queries = buildQueryPlan(name);
  const issued: string[] = [];
  let best: FoodCandidate | null = null;

  for (const query of queries) {
    issued.push(query);
    const raw = await source.search(query, {
      locale: options.locale,
      limit: options.limit ?? CANDIDATES_PER_ROUND,
      signal: options.signal,
    });
    const ranked = await rerankByEmbedding({ query, candidates: raw, embedder });
    const top = ranked[0];
    if (!top) continue;
    if (!best || top.score > best.score) best = top;
    if (top.score >= acceptScore) {
      return { accepted: top, best, queries: issued };
    }
  }

  return { accepted: null, best, queries: issued };
}
