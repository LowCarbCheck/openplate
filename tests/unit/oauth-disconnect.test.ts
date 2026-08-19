/**
 * Unit tests for the M127/03 disconnect flow: the "Disconnect" action in
 * `settings.ai.tsx` is UI wiring (a `ConfirmAction` → `clientAction` →
 * `deleteLocalAiSettings` chain) over the same local-store primitive already
 * covered generally in `local-store-ai.test.ts` — this file exercises that
 * primitive specifically as "disconnect" (an OAuth-connected OpenRouter
 * session in particular, since that's the path this spec's copy targets),
 * confirming it clears every BYOK field at once (provider, model, key, base
 * URL) rather than leaving a partial row behind. Real in-memory TinyBase
 * store via the injectable `{ store }` option, same seam as the other
 * local-store tests — no IndexedDB involved.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAiStore } from '../../app/lib/local-store/store';
import { deleteLocalAiSettings, getLocalAiSettings, putLocalAiSettings } from '../../app/lib/local-store/ai-settings';
import type { LocalAiSettings } from '../../app/lib/local-store/ai-settings';

function oauthConnectedSettings(): LocalAiSettings {
  return {
    provider: 'openrouter',
    model: 'google/gemini-3.5-flash-lite',
    baseUrl: null,
    apiKey: 'sk-or-v1-oauth-issued-test-key',
    connectedVia: 'oauth',
    updatedAt: Date.parse('2026-08-03T12:00:00Z'),
  };
}

describe('disconnect (M127/03)', () => {
  it('disconnect clears the provider, model, and key, returning to the not-connected state', async () => {
    const store = createAiStore();
    await putLocalAiSettings(oauthConnectedSettings(), { store });
    assert.ok(await getLocalAiSettings({ store }), 'sanity check: settings were actually saved first');

    await deleteLocalAiSettings({ store });

    assert.equal(await getLocalAiSettings({ store }), null);
  });

  it('disconnect is idempotent — calling it again with nothing connected is a no-op, not a throw', async () => {
    const store = createAiStore();

    await assert.doesNotReject(deleteLocalAiSettings({ store }));
    assert.equal(await getLocalAiSettings({ store }), null);
  });

  it('a fresh connect after disconnect never resurrects the previous key', async () => {
    const store = createAiStore();
    await putLocalAiSettings(oauthConnectedSettings(), { store });
    await deleteLocalAiSettings({ store });

    const reconnected = await putLocalAiSettings(
      { ...oauthConnectedSettings(), apiKey: 'sk-or-v1-brand-new-key', updatedAt: Date.parse('2026-08-03T13:00:00Z') },
      { store },
    );

    assert.equal(reconnected.apiKey, 'sk-or-v1-brand-new-key');
    assert.equal((await getLocalAiSettings({ store }))?.apiKey, 'sk-or-v1-brand-new-key');
  });
});
