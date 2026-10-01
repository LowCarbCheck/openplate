/**
 * What an OpenAI-compatible endpoint says it can do (`GET {baseUrl}/models`).
 *
 * Two facts are pinned. A `capabilities` object narrows what the app offers,
 * and EVERYTHING ELSE reads as full: no object, no key, an unknown value, a
 * model that is not listed, and every way the probe can fail. A probe must
 * never block a task, so the failure cases are as important as the parse.
 *
 * Every assertion has a control that makes it fail: the same answer with the
 * narrowing kept against the same answer without it, the matching model
 * against a neighbour, a 200 that is cached against a failure that is not.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FULL_PROVIDER_CAPABILITIES,
  PROVIDER_TASKS,
  clearProviderCapabilitiesCache,
  describeMissing,
  fetchProviderCapabilities,
  parseProviderCapabilities,
  taskSupported,
} from '../../app/lib/ai/provider-capabilities';
import type { ProviderCapabilities } from '../../app/lib/ai/provider-capabilities';
import type { UnvalidatedProviderJson } from '../../app/services/vision/schema';

afterEach(() => {
  clearProviderCapabilitiesCache();
});

const MODEL = 'openplate-inference';

/** A full capabilities object with describe switched off. */
const NO_DESCRIBE = {
  tasks: { plateImage: true, describe: false, pantryImage: true, pantryText: true, recipes: true },
  flags: 'partial',
  translations: 'request-language',
  labels: false,
};

/** A `/models` body whose one entry carries `capabilities` when given some. */
function modelsBody(capabilities?: UnvalidatedProviderJson, id: string = MODEL): UnvalidatedProviderJson {
  const entry = { id, object: 'model', created: 0, owned_by: 'openplate' };
  return { object: 'list', data: [capabilities === undefined ? entry : { ...entry, capabilities }] };
}

/** A round trip through JSON, so the parse is handed exactly what `response.json()` yields. */
function asJson(value: UnvalidatedProviderJson): UnvalidatedProviderJson {
  return JSON.parse(JSON.stringify(value));
}

describe('parseProviderCapabilities', () => {
  it('reads describe: false off the model entry', () => {
    const capabilities = parseProviderCapabilities(asJson(modelsBody(NO_DESCRIBE)), MODEL);
    assert.equal(taskSupported(capabilities, 'describe'), false);
    // The narrowing is per task, not a switch for the whole entry.
    assert.equal(taskSupported(capabilities, 'plateImage'), true);
    assert.equal(capabilities.flags, 'partial');
    assert.equal(capabilities.translations, 'request-language');
    assert.equal(capabilities.labels, false);
  });

  it('reads the same entry WITHOUT capabilities as full, every task supported (the control)', () => {
    const capabilities = parseProviderCapabilities(asJson(modelsBody()), MODEL);
    for (const task of PROVIDER_TASKS) assert.equal(taskSupported(capabilities, task), true, task);
    assert.deepEqual(capabilities, FULL_PROVIDER_CAPABILITIES);
  });

  it('does not throw on an unknown flags value and falls back to complete; a known value is kept (the control)', () => {
    const weird = parseProviderCapabilities(asJson(modelsBody({ ...NO_DESCRIBE, flags: 'weird' })), MODEL);
    assert.equal(weird.flags, 'complete');
    // The rest of the object survives the one unknown value.
    assert.equal(taskSupported(weird, 'describe'), false);
    assert.equal(weird.translations, 'request-language');

    const known = parseProviderCapabilities(asJson(modelsBody({ ...NO_DESCRIBE, flags: 'none' })), MODEL);
    assert.equal(known.flags, 'none');
  });

  it('fills every missing key with its full value', () => {
    const partial = parseProviderCapabilities(asJson(modelsBody({ tasks: { recipes: false } })), MODEL);
    assert.equal(taskSupported(partial, 'recipes'), false);
    assert.equal(taskSupported(partial, 'describe'), true);
    assert.equal(partial.flags, 'complete');
    assert.equal(partial.translations, 'all');
    assert.equal(partial.labels, true);
  });

  it('does not match a different model id in the list; the configured id does match (the control)', () => {
    const body = asJson(modelsBody(NO_DESCRIBE, 'some-other-model'));
    assert.deepEqual(parseProviderCapabilities(body, MODEL), FULL_PROVIDER_CAPABILITIES);
    assert.equal(taskSupported(parseProviderCapabilities(body, 'some-other-model'), 'describe'), false);
  });

  it('finds the model among others, past an entry that is not a model entry', () => {
    const body = asJson({
      object: 'list',
      data: ['not-an-entry', { id: 'neighbour', capabilities: { labels: true } }, { id: MODEL, capabilities: NO_DESCRIBE }],
    });
    assert.equal(taskSupported(parseProviderCapabilities(body, MODEL), 'describe'), false);
  });

  it('reads a body that is not a models list as full', () => {
    assert.deepEqual(parseProviderCapabilities(asJson({ error: 'nope' }), MODEL), FULL_PROVIDER_CAPABILITIES);
    assert.deepEqual(parseProviderCapabilities(null, MODEL), FULL_PROVIDER_CAPABILITIES);
    assert.deepEqual(parseProviderCapabilities('text', MODEL), FULL_PROVIDER_CAPABILITIES);
  });
});

describe('describeMissing', () => {
  it('lists nothing for full capabilities', () => {
    assert.deepEqual(describeMissing(FULL_PROVIDER_CAPABILITIES), []);
  });

  it('lists the task ids, then flags, translations and labels, for an endpoint short on each', () => {
    const capabilities = parseProviderCapabilities(asJson(modelsBody(NO_DESCRIBE)), MODEL);
    assert.deepEqual(describeMissing(capabilities), ['describe', 'flags', 'translations', 'labels']);
  });
});

/** What one probe request carried. */
interface Sent {
  url: string;
  headers: Headers;
}

/** A fake `fetch`, and the requests it has been given so far. */
interface FakeFetch {
  fetchImpl: typeof fetch;
  sent: Sent[];
}

/** A fake `fetch` that records each request and answers with `answer()`. */
function fakeFetch(answer: () => Promise<Response>): FakeFetch {
  const sent: Sent[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(input), headers: new Headers(init?.headers) });
    return answer();
  };
  // SAFETY: `impl` has the (input, init) => Promise<Response> call signature the probe uses;
  // the only extra member on Node's `fetch` type is `preconnect`, which the probe never calls.
  return { fetchImpl: impl as typeof fetch, sent };
}

function jsonResponse(body: UnvalidatedProviderJson, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const BASE_URL = 'https://inference.example/v1';

/** One probe against `BASE_URL` with the fake and a short timeout. */
function probe(fetchImpl: typeof fetch, timeoutMs = 50): Promise<ProviderCapabilities> {
  return fetchProviderCapabilities({ baseUrl: BASE_URL, apiKey: 'sk-local', modelId: MODEL, fetchImpl, timeoutMs });
}

describe('fetchProviderCapabilities', () => {
  it('a 200 with capabilities gives the parsed value, from the base URL plus /models, with the bearer key', async () => {
    const { fetchImpl, sent } = fakeFetch(async () => jsonResponse(modelsBody(NO_DESCRIBE)));
    const capabilities = await probe(fetchImpl);
    assert.equal(taskSupported(capabilities, 'describe'), false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.url, `${BASE_URL}/models`);
    assert.equal(sent[0]?.headers.get('Authorization'), 'Bearer sk-local');
  });

  it('a rejecting fetch gives the full default', async () => {
    const { fetchImpl } = fakeFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    assert.deepEqual(await probe(fetchImpl), FULL_PROVIDER_CAPABILITIES);
  });

  it('a 500 gives the full default, even when its body carries capabilities', async () => {
    const { fetchImpl } = fakeFetch(async () => jsonResponse(modelsBody(NO_DESCRIBE), 500));
    assert.deepEqual(await probe(fetchImpl), FULL_PROVIDER_CAPABILITIES);
  });

  it('a 200 whose body is not JSON gives the full default', async () => {
    const { fetchImpl } = fakeFetch(async () => new Response('<html>not json</html>', { status: 200 }));
    assert.deepEqual(await probe(fetchImpl), FULL_PROVIDER_CAPABILITIES);
  });

  it('a fetch that never resolves gives the full default once the timeout passes', async () => {
    // Ignores its signal on purpose: the deadline must hold without the fetch's help.
    const { fetchImpl } = fakeFetch(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    assert.deepEqual(await probe(fetchImpl, 30), FULL_PROVIDER_CAPABILITIES);
    assert.ok(Date.now() - started < 2000, 'the probe waited far past its timeout');
  });

  it('a missing base URL gives the full default and sends nothing', async () => {
    const { fetchImpl, sent } = fakeFetch(async () => jsonResponse(modelsBody(NO_DESCRIBE)));
    const capabilities = await fetchProviderCapabilities({ baseUrl: ' ', apiKey: '', modelId: MODEL, fetchImpl });
    assert.deepEqual(capabilities, FULL_PROVIDER_CAPABILITIES);
    assert.equal(sent.length, 0);
  });

  it('asks once per session: a second call is answered from the cache', async () => {
    const { fetchImpl, sent } = fakeFetch(async () => jsonResponse(modelsBody(NO_DESCRIBE)));
    await probe(fetchImpl);
    const second = await probe(fetchImpl);
    assert.equal(sent.length, 1);
    assert.equal(taskSupported(second, 'describe'), false);

    // CONTROL: another model on the same endpoint is its own question.
    await fetchProviderCapabilities({ baseUrl: BASE_URL, apiKey: 'sk-local', modelId: 'other', fetchImpl });
    assert.equal(sent.length, 2);
  });

  it('does not cache a failure: the next call asks again', async () => {
    let calls = 0;
    const { fetchImpl, sent } = fakeFetch(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 503) : jsonResponse(modelsBody(NO_DESCRIBE));
    });
    assert.deepEqual(await probe(fetchImpl), FULL_PROVIDER_CAPABILITIES);
    assert.equal(taskSupported(await probe(fetchImpl), 'describe'), false);
    assert.equal(sent.length, 2);
  });
});
