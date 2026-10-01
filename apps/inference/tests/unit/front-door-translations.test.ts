/**
 * Name translation through the real front door.
 *
 * Three promises are pinned here, each with a control that fails when the
 * promise breaks:
 *
 *  1. A request in a non-English language gets `translations` with the English
 *     `name` and the translated one, and `name` itself stays English.
 *  2. A request without a language signal, or in English, takes exactly the old
 *     path: the translation method is never called and no food has a
 *     `translations` key. Checked with a stub runtime (a call count) and with the
 *     real runtime client against the fake HTTP runtime (a request count on the
 *     wire), so "no second call" is proved on a socket, not only on a spy.
 *  3. Every way the translation can fail leaves a 200, a valid plate, the
 *     English names, and no `translations` key on ANY food.
 *
 * And one ordering rule: nutrition resolution sees the English name.
 */
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  chatRequest,
  makeJpeg,
  startTestApp,
  TEST_API_KEY,
  toDataUri,
  type TestApp,
} from '../support/app-harness.js';
import {
  PlateIdentificationSchema,
  validatePlateIdentification,
  type AppLanguage,
  type PlateIdentification,
} from '../../src/contract/plate-identification.js';
import type { ModelRuntime, RuntimeCompletion } from '../../src/pipeline/runtime-client.js';
import { createNutritionResolver, type NutritionResolver } from '../../src/pipeline/resolve-nutrition.js';
import { createSilentLogger } from '../../src/logger.js';
import { createFakeFoodSource } from '../support/fake-food-source.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

const ENGLISH_NAMES = ['grilled chicken breast', 'white rice'];
const GERMAN_NAMES = ['Gegrillte Hähnchenbrust', 'Weißer Reis'];

type TranslateNames = ModelRuntime['translateNames'];

let app: TestApp | null = null;
let fakeRuntime: FakeRuntime | null = null;

afterEach(async () => {
  await app?.close();
  await fakeRuntime?.close();
  app = null;
  fakeRuntime = null;
});

function completionFor(names: string[]): RuntimeCompletion {
  return {
    candidate: { f: names.map((n) => ({ n, g: 100 })) },
    usage: { promptTokens: 512, completionTokens: 42 },
    latencyMs: 5,
  };
}

/** A stub runtime: `identify` names `ENGLISH_NAMES`, `translateNames` is the spy under test. */
function stubRuntime(translateNames: TranslateNames): ModelRuntime {
  return {
    identify: async () => completionFor(ENGLISH_NAMES),
    isReady: async () => true,
    translateNames,
  };
}

/** A spy that answers with `GERMAN_NAMES`, whatever it is asked. */
function germanTranslator(): Mock<TranslateNames> {
  return vi.fn<TranslateNames>(async () => [...GERMAN_NAMES]);
}

async function startWith(options: {
  translateNames: TranslateNames;
  resolver?: NutritionResolver;
  translateTimeoutMs?: number;
}): Promise<TestApp> {
  app = await startTestApp({
    runtime: stubRuntime(options.translateNames),
    resolver: options.resolver ?? null,
    translateTimeoutMs: options.translateTimeoutMs,
  });
  return app;
}

/** Posts one plate photo; returns the status and the content text the client parses. */
async function scan(
  target: TestApp,
  acceptLanguage?: string,
): Promise<{ status: number; content: string }> {
  const body = chatRequest(toDataUri(await makeJpeg(400, 300)));
  const response = await target.post('/v1/chat/completions', body, { acceptLanguage });
  return { status: response.status, content: response.body?.choices?.[0]?.message?.content ?? '' };
}

/**
 * Posts with NO `Accept-Language` header at all. `fetch` cannot do that: it adds
 * `Accept-Language: *` when the caller sets none. `node:http` sends only what it
 * is given.
 */
async function scanWithoutAnyLanguageHeader(target: TestApp): Promise<{ status: number; content: string }> {
  const payload = JSON.stringify(chatRequest(toDataUri(await makeJpeg(400, 300))));
  const text = await new Promise<string>((resolve, reject) => {
    const outgoing = httpRequest(
      `${target.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (incoming) => {
        let received = '';
        incoming.setEncoding('utf8');
        incoming.on('data', (chunk: string) => {
          received += chunk;
        });
        incoming.on('end', () => resolve(`${incoming.statusCode ?? 0}\n${received}`));
      },
    );
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
  const [statusLine = '0', ...rest] = text.split('\n');
  const parsed = JSON.parse(rest.join('\n'));
  return { status: Number(statusLine), content: parsed.choices[0].message.content };
}

function parsePlate(content: string): PlateIdentification {
  return validatePlateIdentification(PlateIdentificationSchema.parse(JSON.parse(content)));
}

describe('POST /v1/chat/completions name translation', () => {
  it('adds translations with the English name and the requested language, and keeps name English', async () => {
    const translateNames = germanTranslator();
    const target = await startWith({ translateNames });

    const { status, content } = await scan(target, 'de');

    expect(status).toBe(200);
    const foods = parsePlate(content).foods;
    expect(foods.map((food) => food.name)).toEqual(ENGLISH_NAMES);
    expect(foods.map((food) => food.translations)).toEqual([
      { en: ENGLISH_NAMES[0], de: GERMAN_NAMES[0] },
      { en: ENGLISH_NAMES[1], de: GERMAN_NAMES[1] },
    ]);
    expect(translateNames).toHaveBeenCalledTimes(1);
    const [names, language] = translateNames.mock.calls[0];
    expect(names).toEqual(ENGLISH_NAMES);
    expect(language).toBe<AppLanguage>('de');
  });

  it('reads the language off a full browser header, region and weights included', async () => {
    const translateNames = germanTranslator();
    const target = await startWith({ translateNames });

    const { status } = await scan(target, 'de-DE,de;q=0.9,en;q=0.8');

    expect(status).toBe(200);
    expect(translateNames).toHaveBeenCalledTimes(1);
    expect(translateNames.mock.calls[0][1]).toBe<AppLanguage>('de');
  });

  it('trims a translated name and still sends one that equals the English name', async () => {
    const translateNames = vi.fn<TranslateNames>(async () => ['  Gegrillte Hähnchenbrust ', 'WHITE RICE']);
    const target = await startWith({ translateNames });

    const foods = parsePlate((await scan(target, 'de')).content).foods;

    expect(foods[0].translations?.de).toBe('Gegrillte Hähnchenbrust');
    expect(foods[1].translations).toEqual({ en: 'white rice', de: 'WHITE RICE' });
  });

  it('CONTROL: never calls translateNames when the request carries no Accept-Language header', async () => {
    const translateNames = germanTranslator();
    const target = await startWith({ translateNames });

    const { status, content } = await scanWithoutAnyLanguageHeader(target);

    expect(status).toBe(200);
    expect(translateNames).toHaveBeenCalledTimes(0);
    expect(content).not.toContain('"translations"');
    expect(parsePlate(content).foods.map((food) => food.name)).toEqual(ENGLISH_NAMES);
  });

  it.each([
    ['English', 'en'],
    ['an English region', 'en-US,de;q=0.5'],
    ['the wildcard fetch sends by default', '*'],
    ['a language the app does not ship', 'xx'],
  ])('CONTROL: never calls translateNames for %s', async (_label, header) => {
    const translateNames = germanTranslator();
    const target = await startWith({ translateNames });

    const { status, content } = await scan(target, header);

    expect(status).toBe(200);
    expect(translateNames).toHaveBeenCalledTimes(0);
    expect(content).not.toContain('"translations"');
  });
});

/** A promise that never settles: a runtime that took the call and went quiet. */
function neverSettles(): Promise<string[]> {
  return new Promise<string[]>(() => undefined);
}

describe('POST /v1/chat/completions name translation fails open', () => {
  it.each<[string, TranslateNames]>([
    ['the call rejects', async () => Promise.reject(new Error('runtime down'))],
    ['the list is too short', async () => ['Gegrillte Hähnchenbrust']],
    ['the list is too long', async () => [...GERMAN_NAMES, 'Extra']],
    ['one name is empty', async () => ['Gegrillte Hähnchenbrust', '   ']],
    ['one name is longer than 80 characters', async () => ['Gegrillte Hähnchenbrust', 'R'.repeat(81)]],
    ['the call hangs past the bound', () => neverSettles()],
  ])('drops every translation and keeps a valid 200 when %s', async (_label, translateNames) => {
    const target = await startWith({ translateNames, translateTimeoutMs: 50 });

    const startedAt = performance.now();
    const { status, content } = await scan(target, 'de');
    const elapsedMs = performance.now() - startedAt;

    expect(status).toBe(200);
    expect(content).not.toContain('"translations"');
    const foods = parsePlate(content).foods;
    expect(foods.map((food) => food.name)).toEqual(ENGLISH_NAMES);
    expect(foods.every((food) => !('translations' in food))).toBe(true);
    // Bounded: the hang case resolves at the 50 ms bound, not at 20 s.
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('logs a reason code and a count, never a name', async () => {
    const target = await startWith({
      translateNames: async () => ['Gegrillte Hähnchenbrust'],
      translateTimeoutMs: 50,
    });

    await scan(target, 'de');

    const dropped = target.logLines.find((line) => line.message === 'Name translation dropped');
    expect(dropped?.fields).toMatchObject({ reason: 'wrong-length', items: 2 });
    const everyLine = target.logLines.map((line) => JSON.stringify(line)).join('\n');
    for (const name of [...ENGLISH_NAMES, ...GERMAN_NAMES.slice(0, 1)]) {
      expect(everyLine).not.toContain(name);
    }
  });

  it('CONTROL: an 80-character name is still within the bound and is kept', async () => {
    const translateNames = vi.fn<TranslateNames>(async () => ['Gegrillte Hähnchenbrust', 'R'.repeat(80)]);
    const target = await startWith({ translateNames, translateTimeoutMs: 50 });

    const foods = parsePlate((await scan(target, 'de')).content).foods;

    expect(foods[1].translations?.de).toBe('R'.repeat(80));
  });
});

describe('POST /v1/chat/completions translation order', () => {
  it('hands nutrition resolution the English name, never the translated one', async () => {
    const source = createFakeFoodSource({
      rows: [{ id: 'x:1', name: 'anything', score: 0.95, macrosPer100g: { carbs: 1 } }],
    });
    const realResolver = createNutritionResolver({ source, logger: createSilentLogger() });
    const resolvedNames: string[][] = [];
    const resolverSpy: NutritionResolver = {
      describe: () => realResolver.describe(),
      resolve: async (plate) => {
        resolvedNames.push(plate.foods.map((food) => food.name));
        return realResolver.resolve(plate);
      },
    };
    const target = await startWith({ translateNames: germanTranslator(), resolver: resolverSpy });

    const foods = parsePlate((await scan(target, 'de')).content).foods;

    expect(resolvedNames).toEqual([ENGLISH_NAMES]);
    // The corpus was searched with English words only, and was searched at all.
    expect(source.calls.some((query) => /hähnchen|weiß/i.test(query))).toBe(false);
    expect(source.calls.some((query) => /chicken/i.test(query))).toBe(true);
    // Translation ran before resolution and survived it.
    expect(foods[0].translations?.de).toBe(GERMAN_NAMES[0]);
    expect(foods[0].macrosPer100g?.carbs).toBe(1);
  });
});

describe('POST /v1/chat/completions translation on the wire', () => {
  it('CONTROL: sends exactly one runtime request when the request names no language', async () => {
    fakeRuntime = await startFakeRuntime({ kind: 'ok', items: [{ n: 'grilled chicken breast', g: 140 }] });
    app = await startTestApp({ runtimeBaseUrl: fakeRuntime.baseUrl });

    const { status } = await scan(app);

    expect(status).toBe(200);
    expect(fakeRuntime.requests).toHaveLength(1);
    expect(fakeRuntime.requests[0].userPartTypes).toEqual(['image_url', 'text']);
  });

  it('sends a second, text-only request for a German request, and fails open on a bad answer', async () => {
    // The fake answers every completion with the terse plate JSON, which is not
    // an array of strings, so the translation call fails and the scan must not.
    fakeRuntime = await startFakeRuntime({ kind: 'ok', items: [{ n: 'grilled chicken breast', g: 140 }] });
    app = await startTestApp({ runtimeBaseUrl: fakeRuntime.baseUrl });

    const { status, content } = await scan(app, 'de');

    expect(status).toBe(200);
    expect(content).not.toContain('"translations"');
    expect(fakeRuntime.requests).toHaveLength(2);
    const [identifyCall, translateCall] = fakeRuntime.requests;
    expect(identifyCall.imageDataUriLength).toBeGreaterThan(0);
    expect(translateCall.imageDataUriLength).toBe(0);
    expect(translateCall.model).toBe(identifyCall.model);
    expect(translateCall.temperature).toBe(0);
    expect(translateCall.responseFormatType).toBe('json_schema');
    expect(translateCall.maxTokens).toBe(32 + 64);
  });
});
