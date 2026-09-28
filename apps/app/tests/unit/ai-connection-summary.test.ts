/**
 * Unit tests for `deriveAiConnectionSummary` — the one derivation behind BOTH
 * the settings hub's AI row and the header avatar menu's AI shortcut.
 *
 * Pure-function assertions only: the React hook around it just wraps a device
 * read and `t()`, and the thing worth pinning is the degradation — an unknown
 * provider id must read as "not connected", never throw mid-render.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveAiConnectionSummary } from '../../app/hooks/use-ai-connection-summary';
import type { LocalAiSettings } from '../../app/lib/local-store/ai-settings';
import { MODEL_CATALOG } from '../../app/services/vision/catalog';
import { getProviderDefinition } from '../../app/services/vision/registry';

function settings(overrides: Partial<LocalAiSettings> = {}): LocalAiSettings {
  return {
    provider: 'openrouter',
    model: 'some/model',
    baseUrl: null,
    apiKey: 'sk-not-a-real-key',
    connectedVia: 'manual',
    updatedAt: 0,
    ...overrides,
  };
}

describe('deriveAiConnectionSummary', () => {
  it('reports a connected provider by its registry label key, never a literal', () => {
    const summary = deriveAiConnectionSummary(settings());

    assert.equal(summary.status, 'connected');
    assert.equal(
      summary.status === 'connected' ? summary.providerLabelKey : null,
      getProviderDefinition('openrouter')?.labelKey,
    );
  });

  it('names a catalogued model by its display label, and an uncatalogued one by its raw id', () => {
    const catalogued = MODEL_CATALOG.openrouter[0];
    assert.ok(catalogued !== undefined, 'the openrouter catalog must list at least one model');

    const known = deriveAiConnectionSummary(settings({ model: catalogued.id }));
    assert.equal(known.status === 'connected' ? known.model : null, catalogued.label);

    // A custom base URL / unlisted model must still read as connected — the id
    // is shown as-is rather than a label being fabricated for it.
    const unlisted = deriveAiConnectionSummary(settings({ model: 'vendor/unlisted-model' }));
    assert.equal(unlisted.status === 'connected' ? unlisted.model : null, 'vendor/unlisted-model');
  });

  it('degrades an unknown provider id to not-connected instead of throwing', () => {
    // A settings row written by a newer image, then rolled back. The cast is
    // the point of the test: the value exists on disk, so the runtime has to
    // survive it even though the type says it cannot happen.
    // SAFETY: deliberately fabricating an out-of-union provider id — the whole point of this
    // test is that a value the type says cannot exist (a newer build's setting, read back after
    // a rollback) is handled at runtime rather than crashing.
    const rolledBack = settings({ provider: 'provider-from-the-future' as LocalAiSettings['provider'] });

    assert.deepEqual(deriveAiConnectionSummary(rolledBack), { status: 'not-connected' });
  });

  it('reads no settings at all as not-connected', () => {
    assert.deepEqual(deriveAiConnectionSummary(null), { status: 'not-connected' });
  });

  it('reports the in-flight device read as loading, so no row flashes a wrong value', () => {
    assert.deepEqual(deriveAiConnectionSummary(undefined), { status: 'loading' });
  });
});
