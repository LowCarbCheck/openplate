/**
 * A default install resolves macros with NO network at all.
 *
 * This is spec 04's headline success criterion for the default backend: no API
 * key, no account, no outbound call — to lowcarbcheck, to USDA, to us, to anyone.
 * The test enforces it the only way that means anything: `fetch` is stubbed to
 * THROW for the whole suite, so any network access anywhere in the resolution path
 * fails the run rather than quietly working on a developer machine that happens to
 * be online.
 *
 * It also measures per-plate resolution latency, because spec 04's latency-budget
 * checklist item wants a real number rather than a claim, and `eval/BASELINE.md`
 * quotes what this prints.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { createFoodSourceFromConfig } from '../../src/food-source/index.js';
import { createSilentLogger } from '../../src/logger.js';
import { createNutritionResolver } from '../../src/pipeline/resolve-nutrition.js';
import type { PlateIdentification } from '../../src/contract/plate-identification.js';

/** A realistic eight-item plate — the worst case the total budget is sized for. */
const PLATE_ITEMS = [
  'grilled chicken breast',
  'white rice',
  'broccoli',
  'cheddar cheese',
  'olive oil',
  'greek yogurt',
  'banana',
  'whole wheat bread',
];

function plateOf(names: string[]): PlateIdentification {
  return {
    foods: names.map((name) => ({
      name,
      estimatedGrams: 120,
      confidence: 'medium' as const,
      portionHint: 'about 120 g',
      macrosPer100g: null,
    })),
    notes: null,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('offline: the default resolution path must not use the network');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('offline-resolution', () => {
  it('resolves a full plate from the committed dataset with fetch unusable', async () => {
    const source = createFoodSourceFromConfig({
      config: parseConfig({ MODEL_RUNTIME_URL: 'http://127.0.0.1:1' }),
      logger: createSilentLogger(),
    });
    expect(source).not.toBeNull();

    const resolver = createNutritionResolver({ source: source!, logger: createSilentLogger() });
    const outcome = await resolver.resolve(plateOf(PLATE_ITEMS));

    // Most of a normal plate must resolve, or the accept threshold is mis-tuned.
    expect(outcome.stats.resolved).toBeGreaterThanOrEqual(6);
    expect(outcome.stats.failed).toBe(0);

    for (const food of outcome.plate.foods) {
      if (food.macrosPer100g === null) continue;
      expect(food.provenance).toBe('corpus');
      // At least one real number per resolved item — an all-null "match" would be
      // a successful-looking resolution carrying no information.
      const values = Object.values(food.macrosPer100g).filter((value) => value !== null);
      expect(values.length).toBeGreaterThan(0);
    }
  });

  it('resolves a whole plate well inside the total budget', async () => {
    const source = createFoodSourceFromConfig({
      config: parseConfig({ MODEL_RUNTIME_URL: 'http://127.0.0.1:1' }),
      logger: createSilentLogger(),
    });
    const resolver = createNutritionResolver({ source: source!, logger: createSilentLogger() });

    const outcome = await resolver.resolve(plateOf(PLATE_ITEMS));

    // Reported so the number in eval/BASELINE.md has a source. Local lookups are
    // pure CPU over ~8 k prepared rows, so this is milliseconds, not seconds.
    process.stdout.write(
      `\n[offline-resolution] ${PLATE_ITEMS.length} items resolved in ` +
        `${outcome.stats.durationMs.toFixed(1)} ms (${outcome.stats.queries} corpus queries)\n`,
    );
    expect(outcome.stats.durationMs).toBeLessThan(1000);
  });

  it('needs no API key: the dataset is the only input', async () => {
    const config = parseConfig({ MODEL_RUNTIME_URL: 'http://127.0.0.1:1' });
    const source = createFoodSourceFromConfig({ config, logger: createSilentLogger() });

    const candidates = await source!.search('broccoli');

    expect(candidates[0].name.toLowerCase()).toContain('broccoli');
    expect(candidates[0].attribution).toBeNull();
  });
});
