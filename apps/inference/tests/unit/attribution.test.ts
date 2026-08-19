/**
 * ATTRIBUTION IS A LICENCE OBLIGATION, NOT A NICETY.
 *
 * BLS 4.0 (the Bundeslebensmittelschlüssel, which backs lowcarbcheck's curated
 * corpus) is CC BY 4.0: using its figures REQUIRES crediting it at the point of
 * display. LCC already carries that credit per row through its public API's
 * `attribution` field, so this service's obligation reduces to one thing — do not
 * drop it — and the chain that must not break has four links:
 *
 *   LCC API row → FoodCandidate.attribution → response item.attribution → client
 *
 * This file walks all four. The last one is the interesting one: openplate's
 * `RawIdentifiedFoodParseSchema` has an optional `attribution` field waiting
 * (added in spec 02 precisely so 04 would not need a coordinated two-repo
 * release), so proving the string reaches `choices[0].message.content` proves it
 * reaches the client.
 *
 * The FDC assertion is the mirror image and belongs here too: a `null`
 * attribution on a public-domain row is a licence FACT, and a resolver that
 * invented a credit for CC0 data would be just as wrong as one that dropped a
 * required one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLccFoodSource } from '../../src/food-source/lcc.js';
import { createFoodSourceFromConfig } from '../../src/food-source/index.js';
import { parseConfig } from '../../src/config.js';
import { createSilentLogger } from '../../src/logger.js';
import { createNutritionResolver } from '../../src/pipeline/resolve-nutrition.js';
import {
  validatePlateIdentification,
  type PlateIdentification,
} from '../../src/contract/plate-identification.js';
import { chatRequest, makeJpeg, startTestApp, toDataUri } from '../support/app-harness.js';
import { startFakeRuntime } from '../support/fake-runtime.js';

const BLS_CREDIT =
  'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)';

const LCC_URL = 'https://lowcarbcheck.test';

/** One row in the real `/api/v1/foods/search` response shape. */
const LCC_ROW = {
  slug: 'huehnerbrust',
  locale: 'de',
  title: 'Hühnerbrust',
  canonicalName: 'chicken breast',
  origin: 'bls',
  url: null,
  imageUrl: null,
  portionSize: null,
  netCarbsPer100g: 0,
  macrosPer100g: {
    kcal: 105,
    protein: 24.3,
    fat: 0.7,
    carbs: null,
    fiber: null,
    sugars: null,
    polyols: null,
  },
  attribution: BLS_CREDIT,
};

/**
 * Intercepts only LCC traffic and leaves everything else on the real `fetch` —
 * the app-level test drives the service over a real socket, so a blanket stub
 * would break the test client rather than the code under test.
 */
type LccSearchRow = typeof LCC_ROW;

/** The `/api/v1/foods/search` envelope the stub answers with. */
interface LccSearchResponse {
  results: LccSearchRow[];
}

function stubLccFetch(payload: LccSearchResponse, status = 200): void {
  const realFetch = globalThis.fetch;
  type FetchInput = Parameters<typeof fetch>[0];
  vi.stubGlobal('fetch', async (input: FetchInput, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;
    if (!url.startsWith(LCC_URL)) return realFetch(input, init);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function plate(name: string): PlateIdentification {
  return {
    foods: [
      {
        name,
        estimatedGrams: 150,
        confidence: 'medium',
        portionHint: 'about 150 g',
        macrosPer100g: null,
      },
    ],
    notes: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attribution', () => {
  it('carries the credit from an LCC API row onto the candidate', async () => {
    stubLccFetch({ results: [LCC_ROW] });
    const source = createLccFoodSource({ apiUrl: LCC_URL });

    const [candidate] = await source.search('Hühnerbrust', { locale: 'de' });

    expect(candidate.attribution).toBe(BLS_CREDIT);
    expect(candidate.macrosPer100g.protein).toBe(24.3);
    // Unknown stays unknown even on a row that resolved.
    expect(candidate.macrosPer100g.carbs).toBeNull();
  });

  it('carries the credit onto the resolved plate item', async () => {
    stubLccFetch({ results: [LCC_ROW] });
    const resolver = createNutritionResolver({
      source: createLccFoodSource({ apiUrl: LCC_URL }),
      logger: createSilentLogger(),
    });

    const outcome = await resolver.resolve(plate('Hühnerbrust'));

    expect(outcome.plate.foods[0].provenance).toBe('corpus');
    expect(outcome.plate.foods[0].attribution).toBe(BLS_CREDIT);
  });

  it('reaches the client in the chat-completions response body', async () => {
    const runtime = await startFakeRuntime({ kind: 'ok', items: [{ n: 'Hühnerbrust', g: 150 }] });
    stubLccFetch({ results: [LCC_ROW] });

    const app = await startTestApp({
      runtimeBaseUrl: runtime.baseUrl,
      resolver: createNutritionResolver({
        source: createLccFoodSource({ apiUrl: LCC_URL }),
        logger: createSilentLogger(),
      }),
    });

    try {
      const jpeg = await makeJpeg(640, 480);
      const response = await app.post('/v1/chat/completions', chatRequest(toDataUri(jpeg)));
      expect(response.status).toBe(200);

      const content = validatePlateIdentification(JSON.parse(response.body.choices[0].message.content));
      expect(content.foods[0].attribution).toBe(BLS_CREDIT);
      expect(content.foods[0].provenance).toBe('corpus');
      expect(content.foods[0].macrosPer100g?.protein).toBe(24.3);
    } finally {
      await app.close();
      await runtime.close();
    }
  });

  it('reports null rather than inventing a credit for public-domain FDC rows', async () => {
    const source = createFoodSourceFromConfig({
      config: parseConfig({ MODEL_RUNTIME_URL: 'http://127.0.0.1:1' }),
      logger: createSilentLogger(),
    });
    const resolver = createNutritionResolver({ source: source!, logger: createSilentLogger() });

    const outcome = await resolver.resolve(plate('cheddar cheese'));

    expect(outcome.plate.foods[0].provenance).toBe('corpus');
    expect(outcome.plate.foods[0].attribution).toBeNull();
  });

  it('states its licence terms through describe() for every backend', () => {
    expect(createLccFoodSource({ apiUrl: LCC_URL }).describe().license).toMatch(/CC BY 4\.0/);
  });
});
