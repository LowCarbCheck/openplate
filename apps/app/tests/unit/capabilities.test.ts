/**
 * Which features an account may use (M2/05, ADR-0024).
 *
 * `canUseFeature` is the whole client policy, so its truth table is pinned in
 * full: every row below is one combination of the four inputs, and the rows
 * that must be OPEN (the fail-open ones) outnumber the one row that closes.
 * The vision half pins the request header and the refusal that go with it.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canUseFeature,
  decodeCapabilities,
  FEATURE_HEADER,
  FEATURE_LABELS,
  isFeatureLabel,
} from '../../app/lib/plans/capabilities';
import { classifyVisionHttpFailure, VisionProviderFailure } from '../../app/services/vision/failure-cause';
import { createOpenAiCompatibleProvider } from '../../app/services/vision/openai-compatible';
import {
  pantryPhotoTask,
  pantryTextTask,
  photoIntakeTask,
  RECIPE_PROPOSAL_TASK,
  textIntakeTask,
} from '../../app/services/vision/task';

describe('canUseFeature', () => {
  // [hasPlansDoor, capabilities, isOwnKey, expected, why]
  const rows: readonly [boolean, readonly string[] | null | undefined, boolean, boolean, string][] = [
    [true, ['fasting'], false, false, 'the one closing row: a door, a list, the feature missing from it'],
    [true, ['pantry'], false, true, 'the list names the feature'],
    [true, ['fasting', 'pantry'], false, true, 'the list names it among others'],
    [true, [], false, false, 'an empty list is a plan with no features, not "everything"'],
    [true, null, false, true, 'null is everything'],
    [true, undefined, false, true, 'absent is everything (a core older than the field)'],
    [false, ['fasting'], false, true, 'no plans door: nothing is sold, nothing is gated'],
    [false, [], false, true, 'no plans door beats an empty list'],
    [true, ['fasting'], true, true, 'a person on their own key is never gated'],
    [true, [], true, true, 'own key beats an empty list'],
    [false, null, true, true, 'every fail-open reason at once'],
  ];
  for (const [hasPlansDoor, capabilities, isOwnKey, expected, why] of rows) {
    it(`pantry, door ${hasPlansDoor}, list ${JSON.stringify(capabilities)}, own key ${isOwnKey}: ${expected ? 'open' : 'closed'} (${why})`, () => {
      assert.equal(canUseFeature({ feature: 'pantry', hasPlansDoor, capabilities, isOwnKey }), expected);
    });
  }

  it('closes each of the four features on its own, and no other', () => {
    for (const feature of FEATURE_LABELS) {
      const others = FEATURE_LABELS.filter((label) => label !== feature);
      assert.equal(canUseFeature({ feature, hasPlansDoor: true, capabilities: others }), false, `${feature} closed`);
      assert.equal(canUseFeature({ feature, hasPlansDoor: true, capabilities: [feature] }), true, `${feature} open`);
    }
  });

  it('knows the four feature words and rejects anything else', () => {
    assert.deepEqual([...FEATURE_LABELS], ['fasting', 'pantry', 'voice', 'chat']);
    assert.equal(isFeatureLabel('pantry'), true);
    assert.equal(isFeatureLabel('Pantry'), false);
    assert.equal(isFeatureLabel('recipes'), false);
  });
});

describe('decodeCapabilities', () => {
  it('reads a list of strings', () => {
    assert.deepEqual(decodeCapabilities(['fasting', 'pantry']), ['fasting', 'pantry']);
    assert.deepEqual(decodeCapabilities([]), []);
  });

  it('reads null and an absent key as null, which is "everything"', () => {
    assert.equal(decodeCapabilities(null), null);
    assert.equal(decodeCapabilities(undefined), null);
  });

  it('reads a server that breaks the type as null too, never as a closed door', () => {
    // `JSON.parse` is how nonsense really arrives, and it is the one call that
    // hands a typed parameter a value the type forbids.
    for (const body of ['"fasting"', '[1,2]', '{"fasting":true}', '["fasting",3]']) {
      assert.equal(decodeCapabilities(JSON.parse(body)), null, body);
    }
  });
});

// ---------------------------------------------------------------------------
// The request header and the refusal
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Records the headers of every request, answering each with a 2xx the adapter parses. */
function stubFetch(): Headers[] {
  const sent: Headers[] = [];
  // SAFETY: the adapter only calls `fetch(input, init)`; Node's `preconnect` is never used.
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers));
    const content = JSON.stringify({ items: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return sent;
}

const MANAGED = { getBearer: async () => 'a', refreshBearer: async () => 'b', intakeId: 'intake-0123456789abcdef' };
const BYOK = { apiKey: 'sk-x' };
const IMAGE = { base64: 'AAAA', mimeType: 'image/png' } as const;

describe('X-Openplate-Feature', () => {
  it('is pantry on the three pantry tasks, and absent on the diary tasks', () => {
    assert.equal(pantryPhotoTask('en').feature, 'pantry');
    assert.equal(pantryTextTask('en').feature, 'pantry');
    assert.equal(RECIPE_PROPOSAL_TASK.feature, 'pantry');
    // THE CONTROL: the diary's tasks are in every plan and name no feature.
    assert.equal(photoIntakeTask('en').feature, undefined);
    assert.equal(textIntakeTask('en').feature, undefined);
  });

  it('is sent to the managed proxy for a pantry scan', async () => {
    const sent = stubFetch();
    const provider = createOpenAiCompatibleProvider({ credential: MANAGED, model: 'm', baseUrl: 'https://core.example/v1' });
    await provider.runScan({ task: pantryPhotoTask('en'), image: IMAGE }).catch(() => undefined);
    assert.equal(sent[0]?.get(FEATURE_HEADER), 'pantry');
  });

  it('is not sent for a diary scan on the same managed credential', async () => {
    const sent = stubFetch();
    const provider = createOpenAiCompatibleProvider({ credential: MANAGED, model: 'm', baseUrl: 'https://core.example/v1' });
    await provider.runScan({ task: photoIntakeTask('en'), image: IMAGE }).catch(() => undefined);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.has(FEATURE_HEADER), false);
  });

  it('is never sent to a provider the person configured, even for a pantry scan', async () => {
    const sent = stubFetch();
    const provider = createOpenAiCompatibleProvider({ credential: BYOK, model: 'm', baseUrl: 'https://ai.example/v1' });
    await provider.runScan({ task: pantryPhotoTask('en'), image: IMAGE }).catch(() => undefined);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.has(FEATURE_HEADER), false);
  });
});

/** A `403` with the JSON body a test names. */
function forbidden(body: { error?: string; capability?: string }): Response {
  return new Response(JSON.stringify(body), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

describe('403 capability-required', () => {
  const refusal = forbidden;

  it('is its own cause and carries the label the proxy named', async () => {
    const classification = await classifyVisionHttpFailure(refusal({ error: 'capability-required', capability: 'pantry' }));
    assert.equal(classification.cause, 'capability-required');
    assert.equal(classification.capability, 'pantry');
  });

  it('survives a refusal that names no feature', async () => {
    const classification = await classifyVisionHttpFailure(refusal({ error: 'capability-required' }));
    assert.equal(classification.cause, 'capability-required');
    assert.equal(classification.capability, undefined);
  });

  it('control: the other two 403 markers and a bare 403 are unchanged', async () => {
    assert.equal((await classifyVisionHttpFailure(refusal({ error: 'ai-not-allowed' }))).cause, 'ai-not-allowed');
    assert.equal((await classifyVisionHttpFailure(refusal({ error: 'account-suspended' }))).cause, 'account-suspended');
    assert.equal((await classifyVisionHttpFailure(refusal({}))).cause, 'auth');
  });

  it('reaches the failure object as `capability`, and is null on every other cause', () => {
    const closed = new VisionProviderFailure('capability-required', 'x', { capability: 'pantry' });
    assert.equal(closed.capability, 'pantry');
    assert.equal(new VisionProviderFailure('auth', 'x').capability, null);
  });
});
