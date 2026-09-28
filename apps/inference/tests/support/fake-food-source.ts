/**
 * The `FoodSource` test fake — the third implementation spec 04 asks for, kept in
 * `tests/support/` alongside `fake-runtime.ts` rather than in `src/`, which is
 * this repo's existing convention for a test double of a production boundary.
 *
 * It exists to make the two behaviours that matter cheaply provable without a
 * dataset or a network:
 *  - a corpus that ANSWERS (with scores the caller controls), and
 *  - a corpus that is DOWN (every call throws), which is the fail-open case.
 *
 * It also COUNTS its calls, which is how the refinement-cap test proves the loop
 * is bounded: a fake that always misses would spin forever against an unbounded
 * implementation, and `calls.length` is the assertion that it does not.
 */
import {
  emptyMacros,
  type FoodCandidate,
  type FoodSource,
  type FoodSourceDescription,
  type Macros,
  type SearchOptions,
} from '../../src/food-source/index.js';

export interface FakeRow {
  id: string;
  name: string;
  /** Score returned for this row regardless of the query — the point of a fake. */
  score: number;
  macrosPer100g?: Partial<Macros>;
  attribution?: string | null;
}

export interface FakeFoodSourceOptions {
  rows?: FakeRow[];
  /** When set, every `search`/`getById` rejects with this message (corpus outage). */
  failWith?: string;
  describeAs?: Partial<FoodSourceDescription>;
  /** Milliseconds to stall before answering — for the budget/timeout tests. */
  delayMs?: number;
}

export interface FakeFoodSource extends FoodSource {
  /** Every query passed to `search`, in order. */
  readonly calls: string[];
}

function toMacros(partial: Partial<Macros> | undefined): Macros {
  return { ...emptyMacros(), ...partial };
}

export function createFakeFoodSource(options: FakeFoodSourceOptions = {}): FakeFoodSource {
  const calls: string[] = [];
  const rows = options.rows ?? [];
  const description: FoodSourceDescription = {
    name: 'fdc',
    license: 'test fixture',
    attribution: null,
    requiresNetwork: false,
    ...options.describeAs,
  };

  function candidates(): FoodCandidate[] {
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        category: null,
        macrosPer100g: toMacros(row.macrosPer100g),
        attribution: row.attribution ?? description.attribution,
        score: row.score,
        signals: { lexical: row.score, embedding: null },
      }))
      .toSorted((a, b) => b.score - a.score);
  }

  async function stall(signal: AbortSignal | undefined): Promise<void> {
    if (!options.delayMs) return;
    await new Promise<void>((resolveDelay, rejectDelay) => {
      const timer = setTimeout(resolveDelay, options.delayMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        rejectDelay(new Error('aborted'));
      });
    });
  }

  return {
    calls,
    describe: () => description,
    async search(query: string, searchOptions: SearchOptions = {}): Promise<FoodCandidate[]> {
      calls.push(query);
      await stall(searchOptions.signal);
      if (options.failWith) throw new Error(options.failWith);
      return candidates();
    },
    async getById(id: string): Promise<FoodCandidate | null> {
      if (options.failWith) throw new Error(options.failWith);
      return candidates().find((candidate) => candidate.id === id) ?? null;
    },
  };
}
