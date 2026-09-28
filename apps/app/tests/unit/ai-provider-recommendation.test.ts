/**
 * Unit tests for `#app/models/ai-provider-recommendation` — the locale-aware
 * provider recommendation (M130/04).
 *
 * The load-bearing property is what this helper is ALLOWED to influence: tab
 * order and a badge, nothing else. The "presentation only" half of that is
 * enforced by the module graph (no storage/dispatch module imports it) and by
 * the spec's grep; what is asserted here is the mapping itself, and that both
 * providers survive the reordering — a language must never make a provider
 * disappear.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { providersForDisplay, recommendedProviderFor } from '../../app/models/ai-provider-recommendation';
import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { getProvidersByPlacement } from '../../app/services/vision/registry';

describe('recommendedProviderFor', () => {
  it('recommends Mistral on a German UI', () => {
    assert.strictEqual(recommendedProviderFor('de'), 'mistral');
  });

  it('recommends OpenRouter on an English UI', () => {
    assert.strictEqual(recommendedProviderFor('en'), 'openrouter');
  });

  it('reads the base subtag, so a regional German tag lands on the same answer', () => {
    // i18next hands back whatever the detector resolved — 'de-AT', 'de-CH',
    // 'en-GB' are all live possibilities.
    assert.strictEqual(recommendedProviderFor('de-AT'), 'mistral');
    assert.strictEqual(recommendedProviderFor('DE'), 'mistral');
    assert.strictEqual(recommendedProviderFor('en-GB'), 'openrouter');
  });

  it('falls back to OpenRouter for a language the app does not ship', () => {
    assert.strictEqual(recommendedProviderFor('fr'), 'openrouter');
    assert.strictEqual(recommendedProviderFor(''), 'openrouter');
  });

  it('answers with a real provider for every shipped language', () => {
    const primary = new Set(getProvidersByPlacement('primary').map((definition) => definition.id));
    for (const language of SUPPORTED_LANGUAGES) {
      assert.ok(primary.has(recommendedProviderFor(language)), `${language} recommends a non-primary provider`);
    }
  });
});

describe('providersForDisplay', () => {
  it('puts the language’s recommendation first', () => {
    assert.strictEqual(providersForDisplay({ placement: 'primary', language: 'de' })[0]?.id, 'mistral');
    assert.strictEqual(providersForDisplay({ placement: 'primary', language: 'en' })[0]?.id, 'openrouter');
  });

  it('reorders without ever dropping or duplicating a provider', () => {
    const registryOrder = getProvidersByPlacement('primary').map((definition) => definition.id);
    for (const language of SUPPORTED_LANGUAGES) {
      const shown = providersForDisplay({ placement: 'primary', language }).map((definition) => definition.id);
      assert.deepStrictEqual(shown.toSorted(), registryOrder.toSorted(), `${language} changed the provider set`);
    }
  });

  it('leaves the advanced group in registry order — nothing there is ever recommended', () => {
    const registryOrder = getProvidersByPlacement('advanced').map((definition) => definition.id);
    for (const language of SUPPORTED_LANGUAGES) {
      assert.deepStrictEqual(
        providersForDisplay({ placement: 'advanced', language }).map((definition) => definition.id),
        registryOrder,
      );
    }
  });
});
