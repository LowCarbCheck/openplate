/**
 * The optional semantic half of hybrid retrieval.
 *
 * WHAT IT IS: an OpenAI-compatible `/v1/embeddings` client (llama.cpp's
 * `llama-server --embedding` serves exactly this shape, as does vLLM) plus a
 * re-ranker that reorders the lexical shortlist by cosine similarity.
 *
 * WHY IT IS OPTIONAL, AND WHY THAT IS NOT A COP-OUT. Spec 04 asks for both an
 * embedding and a lexical signal contributing to ranking. Both are here — but
 * `EMBEDDING_RUNTIME_URL` is unset by default, because the default install's
 * promise is "no keys, no accounts, no network", and demanding a second model
 * runtime just to look up "banana" would break it. Absent the runtime, retrieval
 * is lexical-only and says so in the logs; present, both signals rank.
 *
 * WHY RE-RANK A SHORTLIST RATHER THAN EMBED THE CORPUS. Two reasons, one
 * practical and one honest:
 *
 *  1. 8 041 rows × 384 dimensions is ~12 MB of float32 per model — and it would
 *     be pinned to whichever embedding model happened to be running at BUILD
 *     time, silently mismatching the operator's model at RUN time. Vectors from
 *     two different models are not comparable, and nothing in a JSON file makes
 *     that mismatch visible; it would just quietly rank worse.
 *  2. Recall is the lexical scorer's job and it is good at it (a full 8 k-row
 *     scan is ~8 ms). Precision inside a plausible shortlist is what embeddings
 *     are actually better at. Re-ranking `EMBEDDING_SHORTLIST` candidates costs
 *     one embedding call for the query plus a cached one per candidate name.
 *
 * WHY THE COSINE IS NORMALIZED WITHIN THE SHORTLIST. Raw cosines from a small
 * sentence model sit in a narrow band (~0.6–0.9 for any two food names), so
 * blending a raw cosine into the score would add a near-constant and change
 * nothing. Min–max normalizing across the shortlist turns it into what it is
 * useful as: a RELATIVE preference among candidates. That also means the
 * embedding signal is meaningless for a single candidate, and the code returns it
 * unchanged in that case rather than inventing a 1.0.
 *
 * FAILURE IS ALWAYS NON-FATAL, BUT NO LONGER SILENT. A dead embedding runtime
 * degrades retrieval to lexical-only; it never fails a scan. Resolution is an
 * enhancement to a response that must ship either way. What it must NOT be is
 * invisible: a typo'd or rotated `EMBEDDING_RUNTIME_API_KEY` used to produce one
 * boot-time warning and then permanent, unobservable lexical-only retrieval. So
 * the last failure is remembered and published through `status()`, which
 * `/readyz` reports as a DEGRADED field — never as unhealthy, because
 * lexical-only is a legitimate mode and not an outage.
 */
import { z } from 'zod';
import type { JsonValue } from '../json.js';
import type { Logger } from '../logger.js';
import type { FoodCandidate } from './types.js';

/** How many lexical candidates get re-ranked. Beyond this the lexical scorer was already wrong. */
export const EMBEDDING_SHORTLIST = 24;

/** Weight of the normalized embedding signal in the final blend. Lexical keeps the majority. */
export const EMBEDDING_WEIGHT = 0.35;

/** Per-call deadline. An embedding of one short string is milliseconds on any hardware. */
const EMBEDDING_TIMEOUT_MS = 1500;

/** Bounded LRU of text → vector. Food names repeat heavily across plates and rounds. */
const MAX_CACHE_ENTRIES = 4096;

/** What `/readyz` publishes about the semantic half of retrieval. */
export interface EmbedderStatus {
  /** `false` once a call has failed and not yet succeeded again. Degraded, never unhealthy. */
  ready: boolean;
  /** Why it is degraded, e.g. `http 401`. `null` while healthy. */
  reason: string | null;
}

export interface Embedder {
  /** Vectors for each input, or `null` when the runtime is unavailable. Never throws. */
  embed(inputs: string[]): Promise<number[][] | null>;
  /** Last observed state of the runtime. Never throws, never performs I/O. */
  status(): EmbedderStatus;
}

export interface CreateEmbedderOptions {
  baseUrl: string;
  /** Model id sent to the runtime. llama-server ignores it; vLLM requires a match. */
  modelId?: string;
  /** Bearer for the runtime. Absent ⇒ no `Authorization` header is sent at all. */
  apiKey?: string | null;
  logger: Logger;
}

/**
 * One row of an OpenAI-shaped embeddings response.
 *
 * Both fields `.catch(null)` rather than failing the parse, and that is the
 * point: a row that carries something other than a vector of finite numbers is
 * reported as "a malformed embedding" further down, which is a different fact
 * (and a different log line) from "the envelope was not an embeddings
 * response". `z.number()` rejects `NaN` and `Infinity`, so a vector with a hole
 * in it never ranks anything.
 */
const EmbeddingRowSchema = z.looseObject({
  embedding: z.array(z.number()).nonempty().nullish().catch(null),
  index: z.number().nullish().catch(null),
});

const EmbeddingsResponseSchema = z.looseObject({
  data: z.array(EmbeddingRowSchema).catch([]),
});

/**
 * Cosine similarity of two vectors, or `null` when they are not comparable
 * (different dimensionality — which in practice means two different models, and
 * a number computed across that gap would be noise dressed as a signal).
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function createEmbedder(options: CreateEmbedderOptions): Embedder {
  const cache = new Map<string, number[]>();
  /** One log line per process, not one per query: a down runtime is one fact. */
  let warned = false;
  /** The observable half of the same fact. Cleared by the next successful call. */
  let failureReason: string | null = null;

  const authHeader: Record<string, string> = options.apiKey
    ? { Authorization: `Bearer ${options.apiKey}` }
    : {};

  function remember(text: string, vector: number[]): void {
    cache.delete(text);
    cache.set(text, vector);
    // Bounded: each iteration removes the oldest key, so it terminates.
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  /** Logs at most once per process, but records EVERY failure for `status()`. */
  function noteFailure(reason: string): void {
    failureReason = reason;
    if (warned) return;
    warned = true;
    options.logger.warn('Embedding runtime unavailable — retrieval is lexical-only', { reason });
  }

  return {
    async embed(inputs: string[]): Promise<number[][] | null> {
      if (inputs.length === 0) return [];

      const missing = [...new Set(inputs.filter((input) => !cache.has(input)))];
      if (missing.length > 0) {
        let response: Response;
        try {
          response = await fetch(`${options.baseUrl}/v1/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ model: options.modelId ?? 'embedding', input: missing }),
            signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
          });
        } catch (error) {
          noteFailure(error instanceof Error ? error.name : 'fetch failed');
          return null;
        }
        if (!response.ok) {
          noteFailure(`http ${response.status}`);
          return null;
        }

        let payload: JsonValue;
        try {
          // SAFETY: `response.json()` is typed `any` by the fetch lib but resolves
          // to whatever `JSON.parse` produced, which is exactly `JsonValue`. The
          // schema below is what actually establishes the shape.
          payload = (await response.json()) as JsonValue;
        } catch {
          noteFailure('response was not JSON');
          return null;
        }

        // A payload that is not an embeddings envelope at all lands here as zero
        // rows, which the length check below reports — same as before parsing.
        const parsed = EmbeddingsResponseSchema.safeParse(payload);
        const rows = parsed.success ? parsed.data.data : [];
        if (rows.length !== missing.length) {
          noteFailure('response length did not match the request');
          return null;
        }
        for (const [index, row] of rows.entries()) {
          // `index` on the row is authoritative when present — the OpenAI shape
          // does not promise response order.
          const position = row.index ?? index;
          if (row.embedding === null || row.embedding === undefined) {
            noteFailure('response carried a malformed embedding');
            return null;
          }
          const text = missing[position];
          if (text !== undefined) remember(text, row.embedding);
        }
        // A full round-trip landed: whatever was wrong (dead runtime, rotated
        // key) is no longer wrong, and `/readyz` should stop saying it is.
        failureReason = null;
      }

      const vectors: number[][] = [];
      for (const input of inputs) {
        const vector = cache.get(input);
        if (!vector) return null;
        vectors.push(vector);
      }
      return vectors;
    },

    status(): EmbedderStatus {
      return { ready: failureReason === null, reason: failureReason };
    },
  };
}

/**
 * Re-ranks a lexical shortlist by blending in a normalized embedding cosine.
 *
 * Returns the candidates UNCHANGED (embedding signal `null`) whenever the
 * embedding cannot contribute: no embedder, a runtime failure, fewer than two
 * candidates, or a degenerate cosine spread. `null` is the honest encoding of "we
 * did not measure this" — see `RetrievalSignals.embedding`.
 */
export type EmbeddingReranker = Pick<Embedder, 'embed'>;

export async function rerankByEmbedding(options: {
  query: string;
  candidates: FoodCandidate[];
  /** Only `embed` is needed here — reporting state is `/readyz`'s business, not ranking's. */
  embedder: EmbeddingReranker | null;
}): Promise<FoodCandidate[]> {
  const { query, candidates, embedder } = options;
  if (!embedder || candidates.length < 2) return candidates;

  const shortlist = candidates.slice(0, EMBEDDING_SHORTLIST);
  const vectors = await embedder.embed([query, ...shortlist.map((candidate) => candidate.name)]);
  if (!vectors || vectors.length !== shortlist.length + 1) return candidates;

  const [queryVector, ...candidateVectors] = vectors;
  const cosines: Array<number | null> = candidateVectors.map((vector) =>
    cosineSimilarity(queryVector, vector),
  );
  const measured = cosines.filter((value): value is number => value !== null);
  if (measured.length < 2) return candidates;

  const lowest = Math.min(...measured);
  const highest = Math.max(...measured);
  const spread = highest - lowest;
  if (spread <= 0) return candidates;

  const reranked = shortlist.map((candidate, index): FoodCandidate => {
    const cosine = cosines[index];
    if (cosine === null) return candidate;
    const normalized = (cosine - lowest) / spread;
    // Written out field by field rather than spread: the compiler then rejects a
    // future `FoodCandidate` field silently going missing from a re-ranked row.
    return {
      id: candidate.id,
      name: candidate.name,
      category: candidate.category,
      macrosPer100g: candidate.macrosPer100g,
      attribution: candidate.attribution,
      score: (1 - EMBEDDING_WEIGHT) * candidate.signals.lexical + EMBEDDING_WEIGHT * normalized,
      signals: { lexical: candidate.signals.lexical, embedding: normalized },
    };
  });

  return [...reranked, ...candidates.slice(EMBEDDING_SHORTLIST)].toSorted((a, b) => b.score - a.score);
}
