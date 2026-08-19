/**
 * THE CAP IS THE TEST. Spec 04: "Refinement cap has a test that fails if the loop
 * is unbounded." Every assertion here is written so that removing the bound makes
 * it fail rather than merely look different — an assertion like "issues at least
 * one query" would pass against an infinite loop.
 *
 * The fake corpus deliberately returns candidates that ALWAYS miss the accept
 * threshold, which is the only input under which an unbounded rewrite loop would
 * actually run away.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCEPT_SCORE,
  buildQueryPlan,
  MAX_REFINEMENT_ROUNDS,
  searchFoods,
} from '../../src/food-source/search-foods.js';
import { createFakeFoodSource } from '../support/fake-food-source.js';

describe('refinement-bound', () => {
  it('caps the round count at two by construction', () => {
    expect(MAX_REFINEMENT_ROUNDS).toBe(2);
  });

  it('never plans more than MAX_REFINEMENT_ROUNDS + 1 queries, however long the name', () => {
    const absurd =
      'lightly grilled free-range organic chicken breast fillet slices with fresh herbs and a small side portion of mashed sweet potato';
    const plan = buildQueryPlan(absurd);
    expect(plan.length).toBeLessThanOrEqual(MAX_REFINEMENT_ROUNDS + 1);
  });

  it('issues at most three searches when every round misses', async () => {
    const source = createFakeFoodSource({
      // Below ACCEPT_SCORE on purpose: an accepted candidate would stop the loop
      // early and hide an unbounded implementation.
      rows: [{ id: 'x:1', name: 'something else entirely', score: 0.1 }],
    });

    const result = await searchFoods({ source, name: 'grilled chicken breast with herbs' });

    expect(result.accepted).toBeNull();
    expect(source.calls.length).toBeLessThanOrEqual(MAX_REFINEMENT_ROUNDS + 1);
    expect(result.queries).toEqual(source.calls);
  });

  it('stops at the FIRST round that clears the threshold', async () => {
    const source = createFakeFoodSource({
      rows: [{ id: 'x:1', name: 'chicken breast', score: 0.9 }],
    });

    const result = await searchFoods({ source, name: 'grilled chicken breast' });

    expect(result.accepted?.id).toBe('x:1');
    expect(source.calls).toEqual(['grilled chicken breast']);
  });

  it('does not re-issue an identical query when a refinement changes nothing', async () => {
    const source = createFakeFoodSource({ rows: [{ id: 'x:1', name: 'nope', score: 0.1 }] });

    // A single bare noun has no serving modifiers to strip and no second token to
    // reduce to, so rounds 1 and 2 would both re-issue round 0's query.
    await searchFoods({ source, name: 'broccoli' });

    expect(source.calls).toEqual(['broccoli']);
  });

  it('keeps the best sub-threshold candidate for diagnostics without returning it', async () => {
    const source = createFakeFoodSource({
      rows: [{ id: 'x:1', name: 'near miss', score: ACCEPT_SCORE - 0.05 }],
    });

    const result = await searchFoods({ source, name: 'sliced near miss portion' });

    expect(result.accepted).toBeNull();
    expect(result.best?.score).toBeCloseTo(ACCEPT_SCORE - 0.05);
  });
});
