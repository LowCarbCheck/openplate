/**
 * The retrieval scorer itself: the four lexical components, the two demotions, and
 * the embedding re-ranker that turns "lexical" into "hybrid".
 *
 * Each case below is a ranking that was actually WRONG at some point during
 * tuning against the committed dataset, which is why the expectations read like
 * anecdotes. That is deliberate — a weight change that looks harmless will break
 * one of these, and the failure message will name the food it broke.
 */
import { describe, expect, it } from 'vitest';
import {
  prepareDocument,
  prepareQuery,
  scoreLexical,
  scorePrepared,
  stem,
  tokenize,
} from '../../src/food-source/lexical.js';
import {
  cosineSimilarity,
  rerankByEmbedding,
  type EmbeddingReranker,
} from '../../src/food-source/embedding.js';
import { emptyMacros, type FoodCandidate } from '../../src/food-source/types.js';

function betterMatch(query: string, winner: string, loser: string): void {
  const prepared = prepareQuery(query);
  const winnerScore = scorePrepared(prepared, prepareDocument(winner)).score;
  const loserScore = scorePrepared(prepared, prepareDocument(loser)).score;
  expect(
    winnerScore,
    `"${winner}" (${winnerScore.toFixed(3)}) should beat "${loser}" (${loserScore.toFixed(3)}) for "${query}"`,
  ).toBeGreaterThan(loserScore);
}

function candidate(name: string, lexical: number): FoodCandidate {
  return {
    id: `x:${name}`,
    name,
    category: null,
    macrosPer100g: emptyMacros(),
    attribution: null,
    score: lexical,
    signals: { lexical, embedding: null },
  };
}

describe('lexical scoring', () => {
  it('normalizes, stopwords and stems', () => {
    expect(tokenize('Eggs, whole, RAW')).toEqual(['egg', 'whole', 'raw']);
    expect(stem('potatoes')).toBe('potato');
    expect(stem('berries')).toBe('berry');
    // Structural double-s survives: `glass` must not become `gla`.
    expect(stem('glass')).toBe('glass');
  });

  it('scores an exact name match at 1', () => {
    expect(scoreLexical('Cheese, cheddar', 'Cheese, cheddar').score).toBe(1);
  });

  it('prefers the row whose HEAD word names the food', () => {
    betterMatch('white rice', 'Rice, white, steamed, Chinese restaurant', 'Flour, rice, white, unenriched');
  });

  it('prefers the plain row over the padded one (brevity)', () => {
    betterMatch('broccoli', 'Broccoli, raw', 'Broccoli, leaves, raw');
  });

  it('demotes a processing form the query did not ask for', () => {
    betterMatch('potato', 'Potatoes, raw, skin', 'Potato flour');
    betterMatch('banana', 'Bananas, raw', 'Bananas, dehydrated, or banana powder');
  });

  it('stops demoting a form the query DID ask for', () => {
    betterMatch('potato flour', 'Potato flour', 'Potatoes, raw, skin');
  });

  it('demotes a composite dish for a bare-ingredient query', () => {
    betterMatch('potato', 'Potatoes, raw, skin', 'Potato pancakes');
  });

  it('demotes brand rows, including mixed-case ones like McDONALD’S', () => {
    betterMatch('french fries', 'Restaurant, family style, french fries', "McDONALD'S, french fries");
  });

  it('gives a prefix match partial credit rather than full', () => {
    betterMatch('apple', 'Apples, raw, without skin', "APPLEBEE'S, chili");
  });

  it('scores unrelated text far below the accept threshold', () => {
    const best = ['Fast food, biscuit', 'Broccoli, raw', 'Cheese, cheddar']
      .map((name) => scoreLexical('xyzzy nonsense food', name).score)
      .reduce((max, score) => Math.max(max, score));
    expect(best).toBeLessThan(0.4);
  });
});

/** A reranker that answers from a fixed table, and [0, 0, 1] for anything unlisted. */
const embedder = (vectors: Record<string, number[]>): EmbeddingReranker => ({
  async embed(inputs) {
    return inputs.map((input) => vectors[input] ?? [0, 0, 1]);
  },
});

describe('embedding rerank', () => {

  it('computes cosine similarity and refuses incomparable vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    // Different dimensionality means two different models — not a small number, no number.
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([0, 0], [1, 0])).toBeNull();
  });

  it('reorders a lexical shortlist using the semantic signal', async () => {
    const reranked = await rerankByEmbedding({
      query: 'soda',
      candidates: [candidate('soup', 0.62), candidate('cola', 0.6)],
      embedder: embedder({ soda: [1, 0], cola: [0.95, 0.05], soup: [0, 1] }),
    });

    expect(reranked[0].name).toBe('cola');
    expect(reranked[0].signals.embedding).not.toBeNull();
  });

  it('leaves candidates untouched — signal null — when no embedder is configured', async () => {
    const candidates = [candidate('a', 0.9), candidate('b', 0.5)];
    const reranked = await rerankByEmbedding({ query: 'a', candidates, embedder: null });

    expect(reranked).toBe(candidates);
    expect(reranked[0].signals.embedding).toBeNull();
  });

  it('falls back to lexical-only when the embedding runtime fails', async () => {
    const dead: EmbeddingReranker = { async embed() { return null; } };
    const candidates = [candidate('a', 0.9), candidate('b', 0.5)];

    const reranked = await rerankByEmbedding({ query: 'a', candidates, embedder: dead });

    expect(reranked.map((entry) => entry.name)).toEqual(['a', 'b']);
    expect(reranked[0].signals.embedding).toBeNull();
  });
});
