/**
 * Regression test for M127/02: an OAuth-provisioned OpenRouter key must be
 * exactly as absent from the device's backup export as a manually-pasted
 * one — both live only in the separate BYOK settings store
 * (`#app/lib/local-store/ai-settings`), never the primary health-data store
 * `backup.ts` exports (see that module's own header doc for why they're
 * split). This exercises the actual export path end to end (not just a type
 * check) so a future change that accidentally merges the two stores would
 * fail this test, not just slip past a type signature.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from 'tinybase';

import { putLocalAiSettings } from '../../app/lib/local-store/ai-settings';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup, serializeBackup } from '../../app/lib/local-store/backup';
import { putLocalFoodLog } from '../../app/lib/local-store/primary-store';

describe('backup export excludes BYOK AI settings', () => {
  it('never includes an OAuth-provisioned API key, even when one is saved in the (separate) AI settings store', async () => {
    // A key shaped exactly like what the OAuth callback route saves —
    // `putLocalAiSettings` doesn't distinguish HOW a key was obtained, so this
    // is indistinguishable from a real OAuth-issued key at the storage layer.
    const aiStore = createStore();
    await putLocalAiSettings(
      {
        provider: 'openrouter',
        model: 'google/gemini-3.5-flash-lite',
        baseUrl: null,
        apiKey: 'sk-or-v1-oauth-issued-do-not-leak',
        connectedVia: 'oauth',
        updatedAt: Date.now(),
      },
      { store: aiStore },
    );

    // Meanwhile the PRIMARY store (what backup.ts actually reads) has real
    // health data, so this isn't a vacuous "empty export" pass.
    const primaryStore = createPrimaryStore();
    await putLocalFoodLog(
      {
        id: 'log-1',
        name: 'Acerola',
        quantityGrams: 50,
        macros: { carbs: 5.5, fiber: null, sugars: null, polyols: null, protein: 0.2, fat: 0.15, kcal: 16 },
        mealType: 'snack',
        source: 'manual',
        aiEstimated: false,
        curatedSource: null,
        foodId: null,
        dayKey: '2026-07-14',
        loggedAt: 2_000,
        createdAt: 2_000,
        logBatchId: null,
        portion: null,
      },
      { store: primaryStore },
    );

    const envelope = await exportBackup({ store: primaryStore });
    const json = serializeBackup(envelope);

    assert.ok(!json.includes('sk-or-v1-oauth-issued-do-not-leak'), 'the API key leaked into the backup export');
    assert.ok(!json.includes('openrouter'), 'the provider name leaked into the backup export');
    assert.ok(!('provider' in envelope.data), 'the envelope data shape has no provider/apiKey fields at all');
    assert.equal(envelope.data.foodLogs.length, 1, 'sanity check: the export did capture real health data');
  });
});
