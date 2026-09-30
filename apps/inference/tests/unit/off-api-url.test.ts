/**
 * OFF_API_URL, the OpenFoodFacts host the `off` backend asks.
 *
 * THE URL IS ASSERTED ON THE WIRE, the discipline of `lcc-api-key.test.ts`: a
 * test that only read `config.offApiUrl` would pass against a factory that
 * ignored it and kept its own hard-coded host, which is exactly what shipped
 * before this variable existed (`createOffFoodSource()` was called with no
 * options). Every assertion below reads the URL the stubbed `fetch` RECEIVED.
 *
 * The unset case is the control: it must see the public host, so the
 * configured case cannot pass by accident.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OFF_API_URL, parseConfig } from '../../src/config.js';
import { createFoodSourceFromConfig } from '../../src/food-source/index.js';
import { createSilentLogger } from '../../src/logger.js';

const BASE = { MODEL_RUNTIME_URL: 'http://127.0.0.1:8080' };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs one OFF search and returns every URL `fetch` was called with. */
async function requestedUrls(env: Record<string, string>): Promise<string[]> {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify({ products: [] }), { status: 200 }));
    }),
  );
  const source = createFoodSourceFromConfig({
    config: parseConfig({ ...BASE, FOOD_SOURCE: 'off', ...env }),
    logger: createSilentLogger(),
  });
  await source?.search('apple');
  return urls;
}

describe('OFF_API_URL', () => {
  it('defaults to the public OpenFoodFacts host', () => {
    expect(DEFAULT_OFF_API_URL).toBe('https://world.openfoodfacts.org');
    expect(parseConfig(BASE).offApiUrl).toBe(DEFAULT_OFF_API_URL);
  });

  it('drops trailing slashes, and treats a blank value as unset', () => {
    expect(parseConfig({ ...BASE, OFF_API_URL: 'https://fr.openfoodfacts.org/' }).offApiUrl).toBe(
      'https://fr.openfoodfacts.org',
    );
    expect(parseConfig({ ...BASE, OFF_API_URL: '  ' }).offApiUrl).toBe(DEFAULT_OFF_API_URL);
  });

  it('refuses a value that is not an http(s) URL at boot', () => {
    expect(() => parseConfig({ ...BASE, OFF_API_URL: 'fr.openfoodfacts.org' })).toThrow(/OFF_API_URL/);
  });

  it('sends the search to the configured host', async () => {
    const urls = await requestedUrls({ OFF_API_URL: 'https://off.example.test' });
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0] ?? '').origin).toBe('https://off.example.test');
  });

  it('sends the search to the public host when unset (the control)', async () => {
    const urls = await requestedUrls({});
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0] ?? '').origin).toBe('https://world.openfoodfacts.org');
  });
});
