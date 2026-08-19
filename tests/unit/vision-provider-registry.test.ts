/**
 * Unit tests for `#app/services/vision/registry` — the single per-provider
 * definition table (M130/01). Two things are worth defending here:
 *
 * 1. EXHAUSTIVENESS. The compiler already enforces it
 *    (`Record<AiProviderType, …>` plus `PROVIDER_IDS`' `never` assertion);
 *    these tests cover what types can't — that the tuple and the record agree
 *    at runtime, and that every entry is actually filled in rather than
 *    type-satisfying but empty.
 * 2. THE ROLLBACK CRASH. A device's BYOK settings are an opaque JSON blob
 *    with no schema behind it, so an instance rolled back one image can read
 *    a provider it has never heard of. `getProviderDefinition` must answer
 *    `undefined` — never throw, and never hand back a prototype member.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AiProviderType } from '../../types/enums';
import {
  PROVIDER_IDS,
  PROVIDER_REGISTRY,
  getProviderDefinition,
  getProvidersByPlacement,
  supportsOauthPkce,
} from '../../app/services/vision/registry';

const ADAPTERS = new Set(['openai-compatible', 'anthropic']);
const PLACEMENTS = new Set(['primary', 'advanced']);
const AUTH_METHODS = new Set(['manual', 'oauth-pkce']);

describe('PROVIDER_REGISTRY — exhaustiveness', () => {
  it('has exactly one entry per PROVIDER_ID, and no id the record does not define', () => {
    assert.deepStrictEqual(Object.keys(PROVIDER_REGISTRY).toSorted(), PROVIDER_IDS.toSorted());
  });

  it('keys every entry by its own id', () => {
    for (const id of PROVIDER_IDS) {
      assert.strictEqual(PROVIDER_REGISTRY[id].id, id, `${id} is filed under the wrong key`);
    }
  });

  it('fills in every provider — no entry is type-satisfying but empty', () => {
    for (const id of PROVIDER_IDS) {
      const definition = PROVIDER_REGISTRY[id];
      assert.ok(definition.labelKey.length > 0, `${id} has no labelKey`);
      assert.ok(definition.authMethods.length > 0, `${id} supports no auth method`);
      for (const method of definition.authMethods) {
        assert.ok(AUTH_METHODS.has(method), `${id} has an unknown auth method: ${method}`);
      }
      assert.ok(ADAPTERS.has(definition.adapter), `${id} has an unknown adapter: ${definition.adapter}`);
      assert.ok(PLACEMENTS.has(definition.placement), `${id} has an unknown placement: ${definition.placement}`);
      // `null` is meaningful (user-supplied endpoint); an empty string is not.
      assert.notStrictEqual(definition.baseUrl, '', `${id} has a blank baseUrl`);
      assert.notStrictEqual(definition.keyConsoleUrl, '', `${id} has a blank keyConsoleUrl`);
    }
  });

  it('gives every provider a usable verification strategy', () => {
    for (const id of PROVIDER_IDS) {
      const { verification, baseUrl } = PROVIDER_REGISTRY[id];
      if (verification.kind === 'absolute-url') {
        assert.ok(verification.url.startsWith('https://'), `${id} verifies against a non-https URL`);
        continue;
      }
      assert.ok(verification.path.startsWith('/'), `${id}'s verification path is not root-relative`);
      // A path-based strategy needs a base URL from somewhere — either the
      // definition's own, or (when `null`) the user's, which both callers demand.
      assert.ok(baseUrl === null || baseUrl.startsWith('http'), `${id} cannot compose a verification URL`);
    }
  });
});

describe('PROVIDER_REGISTRY — per-provider shape', () => {
  it('verifies OpenRouter against /auth/key, never /models (which 200s on a bad key)', () => {
    const { verification } = PROVIDER_REGISTRY.openrouter;
    assert.strictEqual(verification.kind, 'base-url-path');
    assert.strictEqual(verification.kind === 'base-url-path' && verification.path, '/auth/key');
  });

  it('attaches OpenRouter attribution headers via a call-time function, not a frozen object', () => {
    const definition = PROVIDER_REGISTRY.openrouter;
    assert.notStrictEqual(definition.extraHeaders, undefined);
    assert.strictEqual(definition.extraHeaders?.()['X-Title'], 'openplate');
  });

  it('leaves the self-hosted endpoint without a base URL — the user supplies it', () => {
    assert.strictEqual(PROVIDER_REGISTRY['openai-compatible'].baseUrl, null);
    assert.strictEqual(PROVIDER_REGISTRY['openai-compatible'].keyConsoleUrl, null);
  });

  it('points Mistral at its own fixed endpoint, manual-key only, verified against /models', () => {
    const definition = PROVIDER_REGISTRY.mistral;
    assert.strictEqual(definition.baseUrl, 'https://api.mistral.ai/v1');
    assert.deepStrictEqual([...definition.authMethods], ['manual']);
    // Unlike OpenRouter's, Mistral's /v1/models 401s on a bad or missing key
    // (live-probed 2026-08-04), so it IS a real key check.
    assert.strictEqual(definition.verification.kind, 'base-url-path');
    assert.strictEqual(definition.verification.kind === 'base-url-path' && definition.verification.path, '/models');
    assert.strictEqual(definition.extraHeaders, undefined);
  });

  it('attaches no extra headers to the providers that do not want them', () => {
    assert.strictEqual(PROVIDER_REGISTRY['openai-compatible'].extraHeaders, undefined);
    assert.strictEqual(PROVIDER_REGISTRY.anthropic.extraHeaders, undefined);
  });

  it('reuses the openai-compatible adapter for OpenRouter, Mistral and the self-hosted endpoint', () => {
    assert.strictEqual(PROVIDER_REGISTRY.openrouter.adapter, 'openai-compatible');
    assert.strictEqual(PROVIDER_REGISTRY.mistral.adapter, 'openai-compatible');
    assert.strictEqual(PROVIDER_REGISTRY['openai-compatible'].adapter, 'openai-compatible');
    assert.strictEqual(PROVIDER_REGISTRY.anthropic.adapter, 'anthropic');
  });
});

describe('getProviderDefinition', () => {
  it('resolves every known provider', () => {
    for (const id of PROVIDER_IDS) {
      assert.strictEqual(getProviderDefinition(id), PROVIDER_REGISTRY[id]);
    }
  });

  it('returns undefined for an unknown provider instead of throwing — the rollback crash', () => {
    // A settings row written by a NEWER build, read after a rollback: the
    // whole reason this helper exists rather than a raw index. ('mistral' was
    // the stand-in until M130/04 made it real — any id this build has not
    // shipped yet does the same job.)
    assert.strictEqual(getProviderDefinition('some-provider-from-the-future'), undefined);
    assert.strictEqual(getProviderDefinition(''), undefined);
    assert.strictEqual(getProviderDefinition('{"garbage": true}'), undefined);
  });

  it('does not hand back a prototype member for a garbage provider name', () => {
    // A plain `PROVIDER_REGISTRY[provider]` would return a Function here, and
    // the caller's truthiness check would sail straight past it.
    assert.strictEqual(getProviderDefinition('toString'), undefined);
    assert.strictEqual(getProviderDefinition('constructor'), undefined);
    assert.strictEqual(getProviderDefinition('__proto__'), undefined);
  });
});

describe('getProvidersByPlacement', () => {
  it('splits the registry into the primary and advanced groups, losing nobody', () => {
    const primary = getProvidersByPlacement('primary');
    const advanced = getProvidersByPlacement('advanced');
    assert.strictEqual(primary.length + advanced.length, PROVIDER_IDS.length);
    assert.deepStrictEqual(
      [...primary, ...advanced].map((definition) => definition.id).toSorted(),
      PROVIDER_IDS.toSorted(),
    );
  });

  it('keeps OpenRouter and Mistral primary and the rest behind Advanced', () => {
    assert.deepStrictEqual(
      getProvidersByPlacement('primary').map((definition) => definition.id),
      ['openrouter', 'mistral'],
    );
    assert.deepStrictEqual(
      getProvidersByPlacement('advanced').map((definition) => definition.id),
      ['openai-compatible', 'anthropic'],
    );
  });
});

describe('supportsOauthPkce', () => {
  it('is true only for a provider whose authMethods include oauth-pkce', () => {
    for (const id of PROVIDER_IDS satisfies readonly AiProviderType[]) {
      assert.strictEqual(supportsOauthPkce(id), PROVIDER_REGISTRY[id].authMethods.includes('oauth-pkce'));
    }
    assert.strictEqual(supportsOauthPkce('openrouter'), true);
    assert.strictEqual(supportsOauthPkce('anthropic'), false);
  });
});
