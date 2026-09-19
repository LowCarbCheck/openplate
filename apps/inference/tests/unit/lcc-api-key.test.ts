/**
 * LCC_API_KEY, the optional bearer sent to the LCC deployment.
 *
 * THE BEARER IS ASSERTED ON THE WIRE, not on the outcome, same discipline as
 * `runtime-upstream-auth.test.ts`: a test that only checked `response.ok` would
 * pass against a build that sent the header unconditionally, or one that never
 * sent it at all. Every assertion below reads the header the fake LCC endpoint
 * RECEIVED.
 *
 * The absent-key cases are the control: they must fail if the implementation
 * sent the header regardless of configuration. That control was run by hand
 * once (send the header unconditionally, watch these two go red, then revert)
 * rather than being encoded as a test, because there is no way to assert "this
 * assertion is capable of failing" from inside the suite itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { createFoodSourceFromConfig } from '../../src/food-source/index.js';
import { createLccFoodSource } from '../../src/food-source/lcc.js';
import { createCapturingLogger } from '../../src/logger.js';

const LCC_URL = 'https://lowcarbcheck.test';
const BASE = { MODEL_RUNTIME_URL: 'http://127.0.0.1:8080' };

/** An obvious fake, never a real key. */
const FAKE_KEY = 'lcc_live_TESTKEY1234567890';

/** One row in the real `/api/v1/foods/search` response shape. */
const LCC_ROW = {
  slug: 'apple',
  locale: 'en',
  title: 'Apple',
  canonicalName: 'apple',
  origin: 'curated',
  macrosPer100g: {
    kcal: 52,
    protein: 0.3,
    fat: 0.2,
    carbs: 14,
    fiber: 2.4,
    sugars: 10,
    polyols: null,
  },
  attribution: null,
};

interface CapturedLccRequest {
  url: string;
  authorization: string | null;
}

/**
 * Intercepts only LCC traffic and leaves everything else on the real `fetch`,
 * same seam as `attribution.test.ts`'s `stubLccFetch`. This one records the
 * `Authorization` header of every request rather than ignoring it: the header
 * IS what these tests are about, not the response body.
 */
function stubLccFetch(options: { status?: number; body?: unknown } = {}): CapturedLccRequest[] {
  const captured: CapturedLccRequest[] = [];
  const realFetch = globalThis.fetch;
  type FetchInput = Parameters<typeof fetch>[0];
  vi.stubGlobal('fetch', async (input: FetchInput, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;
    if (!url.startsWith(LCC_URL)) return realFetch(input, init);
    captured.push({ url, authorization: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify(options.body ?? { results: [LCC_ROW] }), {
      status: options.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LCC_API_KEY on the wire', () => {
  it('sends the bearer on search when a key is configured', async () => {
    const captured = stubLccFetch();
    const source = createLccFoodSource({ apiUrl: LCC_URL, apiKey: FAKE_KEY });

    await source.search('apple');

    expect(captured).toHaveLength(1);
    expect(captured[0].authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  it('sends the bearer on getById when a key is configured', async () => {
    const captured = stubLccFetch({ body: LCC_ROW });
    const source = createLccFoodSource({ apiUrl: LCC_URL, apiKey: FAKE_KEY });

    await source.getById('lcc:apple');

    expect(captured).toHaveLength(1);
    expect(captured[0].authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  it('sends no Authorization header at all when the option is absent (control)', async () => {
    const captured = stubLccFetch();
    const source = createLccFoodSource({ apiUrl: LCC_URL });

    await source.search('apple');

    expect(captured).toHaveLength(1);
    expect(captured[0].authorization).toBeNull();
  });

  it('sends no Authorization header at all when the key is explicitly null (control)', async () => {
    const captured = stubLccFetch();
    const source = createLccFoodSource({ apiUrl: LCC_URL, apiKey: null });

    await source.search('apple');

    expect(captured).toHaveLength(1);
    expect(captured[0].authorization).toBeNull();
  });
});

describe('LCC_API_KEY config parsing', () => {
  it('is null when the variable is absent', () => {
    expect(parseConfig({ ...BASE }).lccApiKey).toBeNull();
  });

  it('treats a blank value as unset, not as the empty string', () => {
    expect(parseConfig({ ...BASE, LCC_API_KEY: '   ' }).lccApiKey).toBeNull();
  });

  it('carries the value through when set', () => {
    expect(parseConfig({ ...BASE, LCC_API_KEY: FAKE_KEY }).lccApiKey).toBe(FAKE_KEY);
  });
});

describe('a rejected key never surfaces', () => {
  it('keeps the key out of both the thrown error and everything the logger recorded', async () => {
    stubLccFetch({ status: 401, body: { error: 'invalid key' } });
    const { logger, lines } = createCapturingLogger();
    const config = parseConfig({
      ...BASE,
      FOOD_SOURCE: 'lcc',
      LCC_API_URL: LCC_URL,
      LCC_API_KEY: FAKE_KEY,
    });
    const source = createFoodSourceFromConfig({ config, logger });
    if (!source) throw new Error('expected an LCC food source');

    let threw = false;
    let message = '';
    try {
      await source.search('apple');
    } catch (error) {
      threw = true;
      message = error instanceof Error ? error.message : String(error);
    }

    expect(threw).toBe(true);
    expect(message).not.toContain(FAKE_KEY);
    expect(JSON.stringify(lines)).not.toContain(FAKE_KEY);
  });
});
