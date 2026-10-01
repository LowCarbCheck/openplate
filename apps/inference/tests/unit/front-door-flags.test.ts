/**
 * Name flags through the real front door: fake runtime in, wire JSON out.
 *
 * The unit tier proves the table. This proves the handler calls it, after the
 * model, and that a miss reaches the wire with NO `flags` key rather than an
 * empty object or three empty lists. The client reads an absent key as "not
 * assessed" and an empty list as "assessed, nothing found"; only the first is
 * true for a food this lookup did not recognise.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatRequest, makeJpeg, startTestApp, toDataUri, type TestApp } from '../support/app-harness.js';
import {
  BasePlateIdentificationSchema,
  PlateIdentificationSchema,
  validatePlateIdentification,
} from '../../src/contract/plate-identification.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

let runtime: FakeRuntime;
let app: TestApp;

beforeEach(async () => {
  runtime = await startFakeRuntime();
  app = await startTestApp({ runtimeBaseUrl: runtime.baseUrl });
});

afterEach(async () => {
  await app.close();
  await runtime.close();
});

/** The model answers with `items`; returns the response content, the JSON text the client parses. */
async function identify(items: Array<{ n: string; g: number }>): Promise<string> {
  runtime.setScenario({ kind: 'ok', items });
  const response = await app.post('/v1/chat/completions', chatRequest(toDataUri(await makeJpeg(400, 300))));
  expect(response.status).toBe(200);
  return response.body.choices[0].message.content;
}

describe('POST /v1/chat/completions name flags', () => {
  it('flags a recognised food and leaves an unrecognised one with no flags key at all', async () => {
    const content = await identify([
      { n: 'cheddar cheese', g: 30 },
      { n: 'grilled chicken', g: 150 },
    ]);
    const [cheese, chicken] = PlateIdentificationSchema.parse(JSON.parse(content)).foods;

    expect(cheese.flags).toEqual({ pregnancy: [], allergens: ['milk'], mayContain: [] });
    expect(cheese.flagsCoverage).toBe('partial');
    // The control: the same response, one food later, carries neither key,
    // read off the wire text itself, not only off a parsed copy.
    expect('flags' in chicken).toBe(false);
    expect('flagsCoverage' in chicken).toBe(false);
    expect(content.match(/"flags":/g)).toHaveLength(1);
    expect(content.match(/"flagsCoverage":/g)).toHaveLength(1);
  });

  it('keeps the model name, grams and macros as they were', async () => {
    const content = await identify([{ n: 'brie', g: 40 }]);
    const food = PlateIdentificationSchema.parse(JSON.parse(content)).foods[0];
    expect(food.name).toBe('brie');
    expect(food.estimatedGrams).toBe(40);
    expect(food.macrosPer100g).toBeNull();
    expect(food.flags?.pregnancy).toEqual(['soft-cheese']);
  });

  it('still parses with the service contract and the client base contract', async () => {
    const content = await identify([
      { n: 'smoked salmon', g: 60 },
      { n: 'white rice', g: 180 },
    ]);
    const plate = PlateIdentificationSchema.parse(JSON.parse(content));
    expect(() => validatePlateIdentification(plate)).not.toThrow();
    // The client's own shape strips the service-side key and keeps the flags.
    const base = BasePlateIdentificationSchema.parse(JSON.parse(content));
    expect(base.foods[0].flags?.allergens).toEqual(['fish']);
    expect('flags' in base.foods[1]).toBe(false);
  });
});
