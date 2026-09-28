/**
 * The default backend is the bundled USDA FDC dataset — not lowcarbcheck.
 *
 * This reverses spec 04's original design, and the reversal is the requirement
 * (spec 04, OPEN TASK 2026-08-12): LCC-as-default would force an API key on a
 * self-hoster, put OUR uptime inside somebody else's local install, and leak our
 * BLS-derived licensing posture into a path we hand out. So the default must be a
 * corpus we are allowed to redistribute, and the only one of the three that is, is
 * the public-domain USDA extract.
 *
 * The `lccApiUrl` assertion is deliberate: the config value exists and has a
 * sensible default, and NOTHING contacts it unless `FOOD_SOURCE=lcc`. A default
 * that merely "usually" avoids the network is not the guarantee.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { DEFAULT_FDC_DATASET_PATH, DEFAULT_FOOD_SOURCE, parseConfig } from '../../src/config.js';
import { createFoodSourceFromConfig } from '../../src/food-source/index.js';
import { createSilentLogger } from '../../src/logger.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function configFrom(env: Record<string, string> = {}) {
  return parseConfig({ MODEL_RUNTIME_URL: 'http://127.0.0.1:1', ...env });
}

describe('default-food-source-is-fdc', () => {
  it('defaults FOOD_SOURCE to fdc', () => {
    expect(DEFAULT_FOOD_SOURCE).toBe('fdc');
    expect(configFrom().foodSource).toBe('fdc');
    expect(configFrom().fdcDatasetPath).toBe(DEFAULT_FDC_DATASET_PATH);
  });

  it('builds an offline, keyless, attribution-free source by default', () => {
    const description = createFoodSourceFromConfig({
      config: configFrom(),
      logger: createSilentLogger(),
    })?.describe();

    expect(description?.name).toBe('fdc');
    expect(description?.requiresNetwork).toBe(false);
    // CC0 — a licence FACT, not a forgotten field. See `fdc.ts`.
    expect(description?.attribution).toBeNull();
    expect(description?.license).toMatch(/CC0|public domain/i);
  });

  it('resolves a real food from the committed dataset with no configuration at all', async () => {
    const source = createFoodSourceFromConfig({
      config: configFrom(),
      logger: createSilentLogger(),
    });

    const candidates = await source!.search('cheddar cheese');

    expect(candidates[0].name.toLowerCase()).toContain('cheddar');
    expect(candidates[0].macrosPer100g.fat).toBeGreaterThan(0);
    expect(candidates[0].id.startsWith('fdc:')).toBe(true);
  });

  it('never touches LCC on the default config even though a default URL exists', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('the default backend must not call lowcarbcheck');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const config = configFrom();
    expect(config.lccApiUrl).toBe('https://lowcarbcheck.org');

    const source = createFoodSourceFromConfig({ config, logger: createSilentLogger() });
    await source!.search('banana');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('selects the LCC connector only on explicit opt-in, and marks it remote', () => {
    const description = createFoodSourceFromConfig({
      config: configFrom({ FOOD_SOURCE: 'lcc' }),
      logger: createSilentLogger(),
    })?.describe();

    expect(description?.name).toBe('lcc');
    expect(description?.requiresNetwork).toBe(true);
    expect(description?.license).toMatch(/BLS/);
  });

  it('disables resolution loudly rather than crashing when the dataset is missing', () => {
    const logs: string[] = [];
    const logger = {
      ...createSilentLogger(),
      error: (message: string) => logs.push(message),
    };

    const source = createFoodSourceFromConfig({
      config: configFrom({ FDC_DATASET_PATH: './data/does-not-exist.json' }),
      logger,
    });

    expect(source).toBeNull();
    expect(logs.join(' ')).toMatch(/DISABLED/);
  });

  it('skips the stage entirely on FOOD_SOURCE=none', () => {
    expect(
      createFoodSourceFromConfig({
        config: configFrom({ FOOD_SOURCE: 'none' }),
        logger: createSilentLogger(),
      }),
    ).toBeNull();
  });
});
