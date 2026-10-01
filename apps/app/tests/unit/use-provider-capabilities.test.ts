/**
 * Who is asked what an endpoint can do, and what a screen reads before and
 * after the answer (`use-provider-capabilities.ts`).
 *
 * THE PURE HALVES, because an effect never runs under a static render and this
 * repo has no DOM test library. The two facts pinned:
 *
 * 1. ONLY a provider whose registry entry publishes capabilities, with a base
 *    URL, is probed. Every other case reads full capabilities and makes no
 *    request, and each of those cases is a control against the one positive.
 * 2. Until an answer arrives for THIS endpoint the screen reads full and
 *    unsettled, and a failed or absent probe is never read as "cannot do it".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  capabilityProbeKey,
  resolveCapabilityProbeTarget,
  resolveProviderCapabilitiesState,
  useProviderCapabilities,
} from '../../app/components/add/use-provider-capabilities';
import type { EffectiveAiSettings } from '../../app/lib/ai/managed-ai-settings';
import {
  FULL_PROVIDER_CAPABILITIES,
  taskSupported,
  type ProviderCapabilities,
} from '../../app/lib/ai/provider-capabilities';
import { typedTaskFor } from '../../app/lib/intake-tasks';
import { PROVIDER_IDS, PROVIDER_REGISTRY, publishesCapabilities } from '../../app/services/vision/registry';
import type { AiProviderType } from '../../types/enums';

const BASE_URL = 'http://inference.local:8080/v1';

/** A stored BYOK row for one provider. */
function stored(overrides: {
  provider?: AiProviderType;
  model?: string;
  baseUrl?: string | null;
  apiKey?: string;
}): EffectiveAiSettings {
  return {
    source: 'stored',
    settings: {
      provider: overrides.provider ?? 'openai-compatible',
      model: overrides.model ?? 'openplate-inference',
      baseUrl: overrides.baseUrl === undefined ? BASE_URL : overrides.baseUrl,
      apiKey: overrides.apiKey ?? 'key-1',
      connectedVia: 'manual',
      updatedAt: 0,
    },
  };
}

/** A capabilities object with describe off, the shape a plate-only server sends. */
const NO_DESCRIBE: ProviderCapabilities = {
  ...FULL_PROVIDER_CAPABILITIES,
  tasks: { ...FULL_PROVIDER_CAPABILITIES.tasks, describe: false },
};

describe('who is asked', () => {
  it('probes a connected openai-compatible endpoint with its base URL, key and model', () => {
    assert.deepEqual(resolveCapabilityProbeTarget(stored({})), {
      baseUrl: BASE_URL,
      apiKey: 'key-1',
      modelId: 'openplate-inference',
    });
  });

  it('trims the base URL, and sends an empty key as an empty key', () => {
    const target = resolveCapabilityProbeTarget(stored({ baseUrl: `  ${BASE_URL}  `, apiKey: '' }));
    assert.equal(target?.baseUrl, BASE_URL);
    assert.equal(target?.apiKey, '');
  });

  it('asks nothing of a cloud vendor, even with a base URL on the row (the control)', () => {
    for (const provider of ['openrouter', 'mistral', 'anthropic'] as const) {
      assert.equal(
        resolveCapabilityProbeTarget(stored({ provider, baseUrl: BASE_URL })),
        null,
        `${provider} would be probed`,
      );
    }
  });

  it('asks nothing of the managed proxy, which is not a stored row', () => {
    const managed: EffectiveAiSettings = {
      source: 'managed',
      provider: 'managed',
      baseUrl: 'https://api.example.org/v1',
      model: 'm',
    };
    assert.equal(resolveCapabilityProbeTarget(managed), null);
  });

  it('asks nothing when there is no AI, no base URL, or no model', () => {
    assert.equal(resolveCapabilityProbeTarget(null), null);
    assert.equal(resolveCapabilityProbeTarget(stored({ baseUrl: null })), null);
    assert.equal(resolveCapabilityProbeTarget(stored({ baseUrl: '   ' })), null);
    assert.equal(resolveCapabilityProbeTarget(stored({ model: '' })), null);
  });

  it('is driven by the registry field and by nothing else', () => {
    const publishers = PROVIDER_IDS.filter((id) => PROVIDER_REGISTRY[id].publishesCapabilities);
    assert.deepEqual(publishers, ['openai-compatible']);
    assert.equal(publishesCapabilities('openai-compatible'), true);
    // The control, and an unknown provider a newer build could have written.
    assert.equal(publishesCapabilities('openrouter'), false);
    assert.equal(publishesCapabilities('a-provider-from-the-future'), false);
  });
});

describe('what a screen reads before and after the answer', () => {
  const target = { baseUrl: BASE_URL, apiKey: 'key-1', modelId: 'openplate-inference' };
  const answer = { key: capabilityProbeKey(target), capabilities: NO_DESCRIBE };

  it('reads full and settled when there is nothing to ask', () => {
    const state = resolveProviderCapabilitiesState({ target: null, answer: null });
    assert.equal(state.settled, true);
    assert.equal(state.capabilities, FULL_PROVIDER_CAPABILITIES);
  });

  it('reads full and UNSETTLED while the probe is in flight', () => {
    const state = resolveProviderCapabilitiesState({ target, answer: null });
    assert.equal(state.settled, false);
    assert.equal(taskSupported(state.capabilities, 'describe'), true, 'a probe in flight blocks a task');
  });

  it('reads the narrowed answer once it has arrived, which is the control for the two above', () => {
    const state = resolveProviderCapabilitiesState({ target, answer });
    assert.equal(state.settled, true);
    assert.equal(taskSupported(state.capabilities, 'describe'), false);
    assert.equal(taskSupported(state.capabilities, 'plateImage'), true);
  });

  it("does not read another endpoint's answer after the person changes the endpoint", () => {
    const other = { ...target, baseUrl: 'http://other.local/v1' };
    const state = resolveProviderCapabilitiesState({ target: other, answer });
    assert.equal(state.settled, false);
    assert.equal(taskSupported(state.capabilities, 'describe'), true);
  });

  it('keys an answer by endpoint and model, never by the key', () => {
    assert.equal(capabilityProbeKey(target), capabilityProbeKey({ ...target, apiKey: 'another' }));
    assert.notEqual(capabilityProbeKey(target), capabilityProbeKey({ ...target, modelId: 'other-model' }));
    assert.ok(!capabilityProbeKey(target).includes('key-1'), 'the key is in the probe identity');
  });
});

/** A component that prints what the hook returns. */
function Probe({ effective }: { effective: EffectiveAiSettings | null }) {
  const { settled, capabilities } = useProviderCapabilities(effective);
  return createElement(
    'p',
    null,
    `${settled ? 'settled' : 'waiting'}:${String(taskSupported(capabilities, 'describe'))}`,
  );
}

describe('the hook on a first render', () => {
  it('is settled at once for a provider that is not asked, and waiting for one that is', () => {
    assert.equal(
      renderToStaticMarkup(createElement(Probe, { effective: stored({ provider: 'openrouter', baseUrl: null }) })),
      '<p>settled:true</p>',
    );
    assert.equal(renderToStaticMarkup(createElement(Probe, { effective: null })), '<p>settled:true</p>');
    // The control: the asked provider is not settled on a first render, and still reads full.
    assert.equal(renderToStaticMarkup(createElement(Probe, { effective: stored({}) })), '<p>waiting:true</p>');
  });
});

describe('which task typed words become', () => {
  it('is a meal for the diary and a shelf for the pantry', () => {
    assert.equal(typedTaskFor('/add/photo'), 'describe');
    assert.equal(typedTaskFor('/pantry'), 'pantryText');
  });

  it('makes a server without describe refuse the diary and still take the pantry', () => {
    assert.equal(taskSupported(NO_DESCRIBE, typedTaskFor('/add/photo')), false);
    assert.equal(taskSupported(NO_DESCRIBE, typedTaskFor('/pantry')), true);
  });
});
