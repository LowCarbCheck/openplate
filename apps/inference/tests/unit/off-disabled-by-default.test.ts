/**
 * OpenFoodFacts stays off unless an operator explicitly turns it on, and nothing
 * OFF-derived exists in this repo.
 *
 * WHY THIS IS A TEST AND NOT A CONVENTION. The 2026-07-15 ODbL decision (M116)
 * deferred OFF because share-alike risk outweighed its value for generic plate
 * identification. The mitigation that makes the connector admissible at all is
 * that we never hold the data: the operator fetches it at their own runtime,
 * knowingly. "Disabled by default" is therefore a licence boundary, and a licence
 * boundary that only lives in a comment is one refactor from being crossed.
 *
 * The `fetch` guard is the sharp end: it fails if merely SELECTING a backend, or
 * booting with the default config, causes any outbound request at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig, DEFAULT_FOOD_SOURCE } from '../../src/config.js';
import { createFoodSourceFromConfig } from '../../src/food-source/index.js';
import { createSilentLogger } from '../../src/logger.js';
import { z } from 'zod';

/** Only the id is read here: an OFF barcode would not carry the `fdc:` prefix. */
const FdcDatasetIdsSchema = z.object({
  foods: z.array(z.object({ id: z.string() })),
});

const REPO_ROOT = new URL('../..', import.meta.url).pathname;

afterEach(() => {
  vi.unstubAllGlobals();
});

function configFrom(env: Record<string, string>) {
  return parseConfig({ MODEL_RUNTIME_URL: 'http://127.0.0.1:1', ...env });
}

describe('off-disabled-by-default', () => {
  it('does not select the OFF backend without explicit configuration', () => {
    expect(DEFAULT_FOOD_SOURCE).not.toBe('off');
    expect(configFrom({}).foodSource).toBe('fdc');
  });

  it('builds a non-network source on the default config', () => {
    const source = createFoodSourceFromConfig({
      config: configFrom({}),
      logger: createSilentLogger(),
    });

    expect(source?.describe().requiresNetwork).toBe(false);
    expect(source?.describe().name).toBe('fdc');
  });

  it('selects OFF only when FOOD_SOURCE=off is set, and says ODbL when it does', () => {
    const source = createFoodSourceFromConfig({
      config: configFrom({ FOOD_SOURCE: 'off' }),
      logger: createSilentLogger(),
    });

    expect(source?.describe().name).toBe('off');
    expect(source?.describe().requiresNetwork).toBe(true);
    expect(source?.describe().license).toMatch(/ODbL/i);
  });

  it('issues no outbound request while selecting the default backend', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('the default install must not make network calls');
    });
    vi.stubGlobal('fetch', fetchSpy);

    createFoodSourceFromConfig({ config: configFrom({}), logger: createSilentLogger() });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ships no OpenFoodFacts- or BLS-derived data file', () => {
    /** Data extensions only: source files mentioning either name are documentation. */
    const dataFile = /\.(json|csv|sqlite|db|ndjson|parquet)$/i;
    const forbidden = /(openfoodfacts|off-products|\bbls\b)/i;
    const skip = new Set(['node_modules', '.git', 'dist', 'eval']);
    const offenders: string[] = [];

    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        if (skip.has(entry)) continue;
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (dataFile.test(entry) && forbidden.test(entry)) offenders.push(path);
      }
    };
    walk(REPO_ROOT);

    expect(offenders).toEqual([]);
  });

  it('does not carry OFF product rows inside the committed FDC dataset', () => {
    const dataset = FdcDatasetIdsSchema.parse(
      JSON.parse(readFileSync(join(REPO_ROOT, 'data/fdc-foods.json'), 'utf8')),
    );

    // Every id is USDA-prefixed: a mixed-in OFF barcode would show up here.
    expect(dataset.foods.every((food) => food.id.startsWith('fdc:'))).toBe(true);
  });
});
