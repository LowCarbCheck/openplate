/**
 * FAIL-OPEN, v3 EDITION. Spec 04 was drafted when the vision model still emitted
 * its own macros, so fail-open meant "keep the model's estimate". Locked decision
 * 13 removed that number entirely, so on this pipeline failing open means the
 * item's macros stay `null` — never a fabricated figure, never `0`.
 *
 * These tests assert the whole ladder of ways resolution can fail, and that each
 * one produces a VALID response rather than an error:
 *   corpus throws · corpus times out · corpus has no good match · resolution off.
 *
 * The `0` assertions matter as much as the `null` ones. `macrosPer100g: null` and
 * `{carbs: 0, ...}` are both "no data" to a careless reader and wildly different to
 * a user: the client renders the first as unknown and the second as a food with no
 * carbohydrates in it.
 */
import { describe, expect, it } from 'vitest';
import { createNutritionResolver } from '../../src/pipeline/resolve-nutrition.js';
import { createSilentLogger } from '../../src/logger.js';
import type { PlateIdentification } from '../../src/contract/plate-identification.js';
import { validatePlateIdentification } from '../../src/contract/plate-identification.js';
import { createFakeFoodSource } from '../support/fake-food-source.js';

function plate(...names: string[]): PlateIdentification {
  return {
    foods: names.map((name) => ({
      name,
      estimatedGrams: 100,
      confidence: 'medium' as const,
      portionHint: 'about 100 g',
      macrosPer100g: null,
    })),
    notes: null,
  };
}

describe('fail-open', () => {
  it('returns a valid plate with null macros when the corpus is down', async () => {
    const resolver = createNutritionResolver({
      source: createFakeFoodSource({ failWith: 'ECONNREFUSED' }),
      logger: createSilentLogger(),
    });

    const outcome = await resolver.resolve(plate('chicken breast', 'white rice'));

    expect(() => validatePlateIdentification(outcome.plate)).not.toThrow();
    for (const food of outcome.plate.foods) {
      expect(food.macrosPer100g).toBeNull();
      // Omitted, not 'model': there is no model macro on this pipeline to attribute.
      expect(food.provenance).toBeUndefined();
      expect(food.attribution).toBeUndefined();
    }
    expect(outcome.stats.failed).toBe(2);
    expect(outcome.stats.resolved).toBe(0);
  });

  it('never coerces an unknown macro to zero', async () => {
    const resolver = createNutritionResolver({
      source: createFakeFoodSource({ failWith: 'corpus exploded' }),
      logger: createSilentLogger(),
    });

    const outcome = await resolver.resolve(plate('anything'));

    expect(JSON.stringify(outcome.plate)).not.toContain('"carbs":0');
    expect(outcome.plate.foods[0].macrosPer100g).not.toEqual(
      expect.objectContaining({ carbs: 0 }),
    );
  });

  it('keeps macros null when the best candidate is below the accept threshold', async () => {
    const resolver = createNutritionResolver({
      source: createFakeFoodSource({
        rows: [{ id: 'x:1', name: 'not really it', score: 0.4, macrosPer100g: { carbs: 42 } }],
      }),
      logger: createSilentLogger(),
    });

    const outcome = await resolver.resolve(plate('mystery item'));

    expect(outcome.plate.foods[0].macrosPer100g).toBeNull();
    expect(outcome.stats.resolved).toBe(0);
    // A low-confidence match is NOT a transport failure and must not read as one.
    expect(outcome.stats.failed).toBe(0);
  });

  it('resolves the items it can when only some fail', async () => {
    const resolver = createNutritionResolver({
      source: createFakeFoodSource({
        rows: [{ id: 'x:1', name: 'anything', score: 0.95, macrosPer100g: { carbs: 12, kcal: 90 } }],
      }),
      logger: createSilentLogger(),
    });

    const outcome = await resolver.resolve(plate('apple', ''));

    expect(outcome.plate.foods[0].macrosPer100g?.carbs).toBe(12);
    // The blank-named item is skipped rather than queried — and stays null.
    expect(outcome.plate.foods[1].macrosPer100g).toBeNull();
  });

  it('abandons a stalled corpus at the budget instead of hanging the scan', async () => {
    const resolver = createNutritionResolver({
      source: createFakeFoodSource({
        delayMs: 5000,
        rows: [{ id: 'x:1', name: 'slow', score: 0.99 }],
      }),
      logger: createSilentLogger(),
      totalBudgetMs: 120,
      perLookupTimeoutMs: 80,
    });

    const startedAt = performance.now();
    const outcome = await resolver.resolve(plate('slow food'));
    const elapsed = performance.now() - startedAt;

    expect(outcome.plate.foods[0].macrosPer100g).toBeNull();
    expect(outcome.stats.failed).toBe(1);
    expect(elapsed).toBeLessThan(2000);
  });

  it('leaves the plate untouched when a resolved row itself has unknown fields', async () => {
    const resolver = createNutritionResolver({
      source: createFakeFoodSource({
        // A real USDA row: carbs known, fibre not measured.
        rows: [{ id: 'x:1', name: 'butter', score: 0.99, macrosPer100g: { fat: 81, kcal: 717 } }],
      }),
      logger: createSilentLogger(),
    });

    const outcome = await resolver.resolve(plate('butter'));
    const macros = outcome.plate.foods[0].macrosPer100g;

    expect(macros?.fat).toBe(81);
    expect(macros?.fiber).toBeNull();
    expect(macros?.carbs).toBeNull();
  });
});
