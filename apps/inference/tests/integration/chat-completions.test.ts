/**
 * Integration: one scan through the whole service, asserting the payload the
 * CLIENT will validate.
 *
 * TWO TARGETS, ONE SUITE.
 *
 *   RUNTIME_URL=http://127.0.0.1:8080 pnpm test:integration --run chat-completions
 *     → talks to a REAL model runtime (llama-server / vLLM) with a real plate
 *       photo. This is the run that proves grammar-constrained decoding, the
 *       token cap and the 896 px downscale actually behave against llama.cpp
 *       rather than against our idea of it. It also prints the measured wall
 *       latency, which is the number the hosted-tier ceiling is judged on.
 *
 *   (unset) → falls back to the in-process fake runtime, so the suite is runnable
 *       on a laptop with no model loaded and in the pre-push gate.
 *
 * The assertions are IDENTICAL either way, deliberately: what is being checked is
 * that the response validates against the vendored `PlateIdentification` contract
 * and parses the way openplate's `parsePlateIdentificationJson` parses it. A real
 * runtime additionally exercises whether the model can satisfy the grammar at
 * all — which is exactly why the same file must be pointable at one.
 *
 * With a real runtime the photo comes from `eval/images/` when that directory is
 * present (the gold set the 72.8 %-recall number was measured on); otherwise a
 * synthetic image is used, which tests the plumbing but says nothing about
 * accuracy.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BasePlateIdentificationSchema } from '../../src/contract/plate-identification.js';
import { chatRequest, makeJpeg, startTestApp, toDataUri, type TestApp } from '../support/app-harness.js';
import { startFakeRuntime, type FakeRuntime } from '../support/fake-runtime.js';

const here = dirname(fileURLToPath(import.meta.url));
const EVAL_IMAGES_DIR = resolve(here, '../../eval/images');

const liveRuntimeUrl = process.env.RUNTIME_URL?.trim();
const usingLiveRuntime = Boolean(liveRuntimeUrl);

let fake: FakeRuntime | null = null;
let app: TestApp;

/** A real plate photo from the gold set when available, else a synthetic one. */
async function loadPlatePhoto(): Promise<{ dataUri: string; source: string }> {
  if (usingLiveRuntime && existsSync(EVAL_IMAGES_DIR)) {
    const candidates = readdirSync(EVAL_IMAGES_DIR)
      .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
      .toSorted();
    if (candidates.length > 0) {
      const file = join(EVAL_IMAGES_DIR, candidates[0]);
      return { dataUri: toDataUri(readFileSync(file)), source: candidates[0] };
    }
  }
  return { dataUri: toDataUri(await makeJpeg(1280, 960)), source: 'synthetic 1280×960' };
}

beforeAll(async () => {
  if (usingLiveRuntime) {
    app = await startTestApp({
      config: { modelRuntimeUrl: liveRuntimeUrl!.replace(/\/+$/, '').replace(/\/v1$/, '') },
    });
    return;
  }
  fake = await startFakeRuntime({
    kind: 'ok',
    items: [
      { n: 'grilled chicken breast', g: 140 },
      { n: 'white rice', g: 180 },
      { n: 'side salad', g: 80 },
    ],
  });
  app = await startTestApp({ runtimeBaseUrl: fake.baseUrl });
});

afterAll(async () => {
  await app?.close();
  await fake?.close();
});

describe(`chat-completions against ${usingLiveRuntime ? 'a live model runtime' : 'the fake runtime'}`, () => {
  it('reports readiness before anything is scanned', async () => {
    const ready = await app.get('/readyz', { apiKey: null });
    if (!ready.body?.modelRuntimeReady) {
      throw new Error(
        `model runtime is not ready (${JSON.stringify(ready.body)}). With RUNTIME_URL set, start the runtime first: eval/serve/serve.sh <model>`,
      );
    }
    expect(ready.status).toBe(200);
  });

  it('returns a payload that validates against the plate schema', async () => {
    const photo = await loadPlatePhoto();
    const startedAt = performance.now();
    const response = await app.post('/v1/chat/completions', chatRequest(photo.dataUri));
    const wallMs = Math.round(performance.now() - startedAt);

    expect(response.status).toBe(200);
    const content: string = response.body.choices[0].message.content;

    // The client's own parse path: `parsePlateIdentificationJson` = strip an
    // optional fence, JSON.parse, then validate. Emitting an unfenced body is
    // our side of that contract.
    expect(content).not.toContain('```');
    const plate = BasePlateIdentificationSchema.parse(JSON.parse(content));

    for (const food of plate.foods) {
      expect(food.name.length).toBeGreaterThan(0);
      expect(food.estimatedGrams).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(food.confidence);
      // Locked decision 13: never a nutrition number off the model.
      expect(food.macrosPer100g).toBeNull();
    }
    // Names are unique after the dedup pass.
    const names = plate.foods.map((food) => food.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);

    expect(response.body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(response.body.usage.completion_tokens).toBeGreaterThan(0);

    process.stdout.write(
      `\n[integration] ${usingLiveRuntime ? 'live' : 'fake'} runtime | photo: ${photo.source} | ` +
        `wall ${wallMs} ms | ${plate.foods.length} items | ` +
        `${response.body.usage.prompt_tokens}p/${response.body.usage.completion_tokens}c tokens\n` +
        `[integration] items: ${plate.foods.map((food) => `${food.name}=${food.estimatedGrams}g`).join('; ')}\n`,
    );
  });

  it('rejects the same request without an API key', async () => {
    const photo = await loadPlatePhoto();
    const response = await app.post('/v1/chat/completions', chatRequest(photo.dataUri), { apiKey: null });
    expect(response.status).toBe(401);
  });
});
