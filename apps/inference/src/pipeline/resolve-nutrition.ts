/**
 * The nutrition-resolution stage: runs AFTER `mapTerseToPlate`, fills in the
 * macros the model is forbidden to guess, and is the ONLY path by which a macro
 * reaches a client.
 *
 * WHY IT IS DETERMINISTIC AND SERVER-SIDE. Locked decision 13 pins the model's
 * `macrosPer100g` to `null` — the grammar cannot even express a macro field —
 * because a carb number guessed from pixels is the single number a user acts on
 * and the one a small vision model is least able to produce. So the model names
 * foods and estimates grams; this stage looks up what those foods are made of.
 * There is no model turn in the loop (architect decision, 2026-08-13): retrieval
 * is `search_foods` called by code with a bounded query plan, not a tool offered
 * to a model with a budget.
 *
 * FAIL OPEN, AND ON THIS PIPELINE THAT MEANS FAIL TO NULL. Corpus down, no match,
 * low-confidence match, budget exhausted — the item keeps `macrosPer100g: null`
 * and the response is still valid. There is no model estimate to fall back to, so
 * the old "keep the VLM's own macros" escape has become "keep the honest absence".
 * A fabricated number is worse than a gap in every direction that matters: the
 * client already renders a gap as unknown (`stripNullMacros`), and it would render
 * a wrong number as a fact.
 *
 * PROVENANCE IS OMITTED, NOT SET TO `'model'`, ON A MISS. The contract's
 * `provenance` enum still carries `'model'` for the cloud-provider case, but on
 * this pipeline a macro can only ever come from the corpus, so `'model'` would be
 * a claim about a number that does not exist. Absent means "nothing resolved this
 * item", which is the truth, and it keeps a miss byte-identical to the pre-spec-04
 * response shape.
 *
 * TWO BOUNDS, BOTH REAL. A local FDC lookup is ~8 ms and a remote connector is a
 * network round trip, so:
 *  - `PER_LOOKUP_TIMEOUT_MS` stops one slow item from eating the plate's budget;
 *  - `TOTAL_BUDGET_MS` stops eight items from adding up to a visible delay.
 * Items run in PARALLEL under a shared deadline. Whatever resolves inside the
 * budget is kept; whatever does not stays null. Both bounds are aborts, not
 * retries — a corpus that is slow now will not be fast in 50 ms.
 */
import type { Logger } from '../logger.js';
import { searchFoods } from '../food-source/search-foods.js';
import type { Embedder } from '../food-source/embedding.js';
import { SEARCH_FOODS, type FoodSource, type FoodSourceDescription } from '../food-source/types.js';
import type { IdentifiedFood, PlateIdentification } from '../contract/plate-identification.js';

/**
 * Total wall-clock budget for resolving a whole plate. ~2 s is generous next to a
 * 25–110 s vision call and tight enough that a hung remote backend cannot become
 * the thing the user waits for.
 */
export const TOTAL_BUDGET_MS = 2000;

/** Per-item deadline. Local lookups finish in single-digit ms; this is for the remote ones. */
export const PER_LOOKUP_TIMEOUT_MS = 1200;

/**
 * The value written to `provenance` when a corpus row supplied the macros. A
 * literal rather than an import so the one place that makes this claim is the one
 * place that knows it is true.
 */
const CORPUS_PROVENANCE = 'corpus' as const;

export interface ResolutionStats {
  /** Backend that ran, for logs. */
  source: string;
  /** Items we attempted (every item with a usable name). */
  attempted: number;
  /** Items whose macros came from the corpus. */
  resolved: number;
  /** Items left null because the source threw. Distinguishes "outage" from "no match". */
  failed: number;
  /** Total queries issued across all items — the refinement cap's observable effect. */
  queries: number;
  durationMs: number;
}

export interface ResolutionOutcome {
  plate: PlateIdentification;
  stats: ResolutionStats;
}

export interface NutritionResolver {
  resolve(plate: PlateIdentification): Promise<ResolutionOutcome>;
  describe(): FoodSourceDescription;
}

export interface CreateNutritionResolverOptions {
  source: FoodSource;
  embedder?: Embedder | null;
  logger: Logger;
  totalBudgetMs?: number;
  perLookupTimeoutMs?: number;
  /** Test seam for threshold tuning. Defaults to `search-foods.ts`'s `ACCEPT_SCORE`. */
  acceptScore?: number;
}

/**
 * Combines the caller's overall deadline with a per-item one. `AbortSignal.any`
 * rather than a single timeout because the two bounds answer different questions
 * and collapsing them would let a plate of eight items spend eight per-item
 * timeouts in sequence.
 */
function lookupSignal(deadline: AbortSignal, perLookupTimeoutMs: number): AbortSignal {
  return AbortSignal.any([deadline, AbortSignal.timeout(perLookupTimeoutMs)]);
}

export function createNutritionResolver(options: CreateNutritionResolverOptions): NutritionResolver {
  const totalBudgetMs = options.totalBudgetMs ?? TOTAL_BUDGET_MS;
  const perLookupTimeoutMs = options.perLookupTimeoutMs ?? PER_LOOKUP_TIMEOUT_MS;
  const description = options.source.describe();

  return {
    describe: () => description,

    async resolve(plate: PlateIdentification): Promise<ResolutionOutcome> {
      const startedAt = performance.now();
      const deadline = AbortSignal.timeout(totalBudgetMs);
      let resolved = 0;
      let failed = 0;
      let queries = 0;

      const foods = await Promise.all(
        plate.foods.map(async (food): Promise<IdentifiedFood> => {
          if (food.name.trim().length === 0) return food;
          try {
            const outcome = await searchFoods({
              source: options.source,
              name: food.name,
              embedder: options.embedder ?? null,
              acceptScore: options.acceptScore,
              signal: lookupSignal(deadline, perLookupTimeoutMs),
            });
            queries += outcome.queries.length;
            if (!outcome.accepted) return food;
            resolved += 1;
            return {
              ...food,
              macrosPer100g: outcome.accepted.macrosPer100g,
              provenance: CORPUS_PROVENANCE,
              attribution: outcome.accepted.attribution,
            };
          } catch {
            // The source threw: outage, timeout, malformed response. Counted so a
            // dead backend is visible in the logs, then dropped — the response
            // must still ship. The error is NOT logged per item; one plate against
            // a down corpus would otherwise emit eight identical lines.
            failed += 1;
            return food;
          }
        }),
      );

      const stats: ResolutionStats = {
        source: description.name,
        attempted: plate.foods.length,
        resolved,
        failed,
        queries,
        durationMs: performance.now() - startedAt,
      };

      if (failed > 0) {
        options.logger.warn('Nutrition resolution partially failed — items kept null macros', {
          stage: SEARCH_FOODS,
          source: stats.source,
          failed: stats.failed,
          attempted: stats.attempted,
        });
      }

      return { plate: { ...plate, foods }, stats };
    },
  };
}
