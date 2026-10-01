/**
 * The app language on the scan request, as `Accept-Language`.
 *
 * A self-hosted openplate-inference service names foods in the language this
 * header carries, one language per request. Only the `openai-compatible`
 * provider sends it: every other provider gets the request it got before,
 * and the Anthropic adapter never sends it. A stub records what `fetch` was
 * given, through `createVisionProvider`, so the registry flag and the adapter
 * are both on the path under test.
 *
 * Every assertion has a control: the same call with another provider, another
 * adapter, or a task that carries no language.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createVisionProvider } from '../../app/services/vision/index';
import { APP_LANGUAGE_HEADER } from '../../app/services/vision/openai-compatible';
import { RECIPE_PROPOSAL_TASK, photoIntakeTask, textIntakeTask } from '../../app/services/vision/task';
import type { AiProviderType } from '../../types/enums';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Records the headers of every request and answers each with an empty chat completion. */
function stubFetch(): Headers[] {
  const sent: Headers[] = [];
  const impl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sent.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
  };
  // SAFETY: `impl` has the (input, init) => Promise<Response> call signature the adapters use;
  // the only extra member on Node's `fetch` type is `preconnect`, which they never call.
  globalThis.fetch = impl as typeof fetch;
  return sent;
}

const IMAGE = { base64: 'AAAA', mimeType: 'image/png' } as const;

/** One photo scan in `language` through `provider`; the parse outcome is not this file's subject. */
async function scanWith(provider: AiProviderType, language: 'de' | 'fr'): Promise<Headers | undefined> {
  const sent = stubFetch();
  const vision = createVisionProvider({
    provider,
    model: 'some-model',
    baseUrl: 'https://inference.example/v1',
    credential: { apiKey: 'sk-x' },
  });
  await vision.runScan({ task: photoIntakeTask(language), image: IMAGE }).catch(() => undefined);
  assert.equal(sent.length, 1, `expected one request for ${provider}`);
  return sent[0];
}

describe('Accept-Language on the scan request', () => {
  it('the openai-compatible provider sends the app language, de', async () => {
    const headers = await scanWith('openai-compatible', 'de');
    assert.equal(headers?.get(APP_LANGUAGE_HEADER), 'de');
  });

  it('follows the task language, fr, so the value is not a constant (the control on the value)', async () => {
    const headers = await scanWith('openai-compatible', 'fr');
    assert.equal(headers?.get(APP_LANGUAGE_HEADER), 'fr');
  });

  it('a text intake carries it too', async () => {
    const sent = stubFetch();
    const vision = createVisionProvider({
      provider: 'openai-compatible',
      model: 'some-model',
      baseUrl: 'https://inference.example/v1',
      credential: { apiKey: 'sk-x' },
    });
    await vision.runTextIntake({ task: textIntakeTask('de'), text: 'two eggs' }).catch(() => undefined);
    assert.equal(sent[0]?.get(APP_LANGUAGE_HEADER), 'de');
  });

  it('the same adapter for OpenRouter, Mistral and the managed proxy sends none (the control on the provider)', async () => {
    for (const provider of ['openrouter', 'mistral'] as const) {
      const headers = await scanWith(provider, 'de');
      assert.equal(headers?.has(APP_LANGUAGE_HEADER), false, provider);
    }
    const sent = stubFetch();
    const managed = createVisionProvider({
      provider: 'managed',
      model: 'some-model',
      baseUrl: 'https://sync.example/v1',
      credential: { getBearer: async () => 'access', refreshBearer: async () => null, intakeId: 'intake-id-0123456789' },
    });
    await managed.runScan({ task: photoIntakeTask('de'), image: IMAGE }).catch(() => undefined);
    assert.equal(sent[0]?.has(APP_LANGUAGE_HEADER), false);
  });

  it('the Anthropic adapter sends none (the control on the adapter)', async () => {
    const headers = await scanWith('anthropic', 'de');
    assert.equal(headers?.has(APP_LANGUAGE_HEADER), false);
  });

  it('a task built without a language sends none, the recipe task', async () => {
    const sent = stubFetch();
    const vision = createVisionProvider({
      provider: 'openai-compatible',
      model: 'some-model',
      baseUrl: 'https://inference.example/v1',
      credential: { apiKey: 'sk-x' },
    });
    await vision.runTextIntake({ task: RECIPE_PROPOSAL_TASK, text: 'the pantry block' }).catch(() => undefined);
    assert.equal(sent[0]?.has(APP_LANGUAGE_HEADER), false);
  });
});
