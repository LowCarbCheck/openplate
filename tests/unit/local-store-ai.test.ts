/**
 * Unit tests for the M117/02 client-side BYOK local-store modules
 * (`ai-settings.ts` / `ai-usage-log.ts`). Both are exercised against a real
 * in-memory TinyBase store (no IndexedDB persister) via the injectable
 * `{ store }` option — same seam as `primary-store.ts`'s tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AI_ENTITY_CELL, AI_SETTINGS_ROW_ID, AI_SETTINGS_TABLE, createAiStore } from '../../app/lib/local-store/store';
import { deleteLocalAiSettings, getLocalAiSettings, putLocalAiSettings } from '../../app/lib/local-store/ai-settings';
import type { LocalAiSettings } from '../../app/lib/local-store/ai-settings';
import {
  computeLocalMonthlyAiUsage,
  getLocalMonthlyAiUsage,
  listLocalAiUsageEvents,
  recordLocalAiUsageEvent,
} from '../../app/lib/local-store/ai-usage-log';
import type { LocalAiUsageEvent } from '../../app/lib/local-store/ai-usage-log';
import type { Store } from 'tinybase';

function settings(overrides: Partial<LocalAiSettings> = {}): LocalAiSettings {
  return {
    provider: 'openrouter',
    model: 'google/gemini-3.1-flash-lite',
    baseUrl: null,
    apiKey: 'sk-or-v1-test',
    connectedVia: 'manual',
    updatedAt: Date.parse('2026-07-15T12:00:00Z'),
    ...overrides,
  };
}

describe('local-store AI settings', () => {
  it('returns null when never configured', async () => {
    const store = createAiStore();
    assert.equal(await getLocalAiSettings({ store }), null);
  });

  it('round-trips a saved settings row losslessly', async () => {
    const store = createAiStore();
    const saved = settings();
    await putLocalAiSettings(saved, { store });
    assert.deepEqual(await getLocalAiSettings({ store }), saved);
  });

  it('overwrites the singleton row on a second save (only one config per device)', async () => {
    const store = createAiStore();
    await putLocalAiSettings(settings({ provider: 'anthropic', model: 'claude-sonnet-5' }), { store });
    await putLocalAiSettings(settings({ provider: 'openrouter', model: 'openai/gpt-5.4-mini' }), { store });

    const current = await getLocalAiSettings({ store });
    assert.equal(current?.provider, 'openrouter');
    assert.equal(current?.model, 'openai/gpt-5.4-mini');
  });

  it('clears the row on disconnect', async () => {
    const store = createAiStore();
    await putLocalAiSettings(settings(), { store });
    await deleteLocalAiSettings({ store });
    assert.equal(await getLocalAiSettings({ store }), null);
  });

  it('accepts an injected store so callers never touch IndexedDB in tests', async () => {
    const store = createAiStore();
    await putLocalAiSettings(settings(), { store });
    assert.ok(await getLocalAiSettings({ store }));
  });

  it('defaults connectedVia to "manual" for a row saved before that field existed', async () => {
    const store = createAiStore();
    const { connectedVia: _omit, ...preConnectedViaRow } = settings();
    // Simulate a pre-existing row by writing the raw JSON blob directly,
    // bypassing `putLocalAiSettings`'s `LocalAiSettings` type (which now
    // requires the field) — this is the exact shape an old row has on disk.
    store.setRow(AI_SETTINGS_TABLE, AI_SETTINGS_ROW_ID, { [AI_ENTITY_CELL]: JSON.stringify(preConnectedViaRow) });

    const loaded = await getLocalAiSettings({ store });
    assert.equal(loaded?.connectedVia, 'manual');
  });
});

function usageInput(overrides: Partial<Omit<LocalAiUsageEvent, 'id'>> = {}): Omit<LocalAiUsageEvent, 'id'> {
  return {
    provider: 'openrouter',
    model: 'google/gemini-3.1-flash-lite',
    inputTokens: 500,
    outputTokens: 200,
    estimatedCostUsd: 0.0004,
    outcome: 'identified',
    createdAt: Date.parse('2026-07-15T12:00:00Z'),
    ...overrides,
  };
}

describe('local-store AI usage log', () => {
  it('records an event and reads it back with a generated id', async () => {
    const store = createAiStore();
    await recordLocalAiUsageEvent(usageInput(), { store });

    const events = await listLocalAiUsageEvents({ store });
    assert.equal(events.length, 1);
    assert.ok((events[0]?.id.length ?? 0) > 0, 'the event must be stored under a generated id');
    assert.equal(events[0]?.outcome, 'identified');
  });

  it('never throws on a store failure (fail-open bookkeeping)', async () => {
    const brokenStore: Pick<Store, 'setRow' | 'getRowIds'> = {
      setRow: () => {
        throw new Error('IndexedDB quota exceeded');
      },
      getRowIds: () => [],
    };
    // SAFETY: the bookkeeping path touches only `setRow` and `getRowIds`, both
    // of which this stub supplies with TinyBase's own signatures.
    await assert.doesNotReject(recordLocalAiUsageEvent(usageInput(), { store: brokenStore as Store }));
  });

  it('lists events oldest first', async () => {
    const store = createAiStore();
    await recordLocalAiUsageEvent(usageInput({ createdAt: Date.parse('2026-07-15T12:00:00Z') }), { store });
    await recordLocalAiUsageEvent(usageInput({ createdAt: Date.parse('2026-07-10T12:00:00Z') }), { store });

    const events = await listLocalAiUsageEvents({ store });
    assert.deepEqual(
      events.map((event) => event.createdAt),
      [Date.parse('2026-07-10T12:00:00Z'), Date.parse('2026-07-15T12:00:00Z')],
    );
  });

  it('caps the log so it never grows unbounded — oldest events are dropped first', async () => {
    const store = createAiStore();
    const MAX_LOCAL_USAGE_EVENTS = 1000;
    const overflowCount = 5;
    for (let index = 0; index < MAX_LOCAL_USAGE_EVENTS + overflowCount; index += 1) {
      await recordLocalAiUsageEvent(usageInput({ createdAt: index }), { store });
    }

    const events = await listLocalAiUsageEvents({ store });
    assert.equal(events.length, MAX_LOCAL_USAGE_EVENTS);
    // The oldest `overflowCount` timestamps (0..4) must have been evicted first.
    assert.equal(events[0]?.createdAt, overflowCount);
  });
});

describe('computeLocalMonthlyAiUsage', () => {
  it('sums only events inside the UTC month window', () => {
    const inMonth = { ...usageInput(), id: 'a', createdAt: Date.parse('2026-07-15T12:00:00Z') };
    const lastMonth = { ...usageInput(), id: 'b', createdAt: Date.parse('2026-06-30T23:59:59Z') };
    const nextMonth = { ...usageInput(), id: 'c', createdAt: Date.parse('2026-08-01T00:00:00Z') };

    const usage = computeLocalMonthlyAiUsage([inMonth, lastMonth, nextMonth], new Date('2026-07-20T00:00:00Z'));

    assert.equal(usage.scanCount, 1);
    assert.equal(usage.totalCostUsd, inMonth.estimatedCostUsd);
  });

  it('counts unknown-cost scans separately without letting them fabricate a cost', () => {
    const known = { ...usageInput(), id: 'a', estimatedCostUsd: 0.001 };
    const unknown = { ...usageInput(), id: 'b', estimatedCostUsd: null };

    const usage = computeLocalMonthlyAiUsage([known, unknown], new Date('2026-07-20T00:00:00Z'));

    assert.equal(usage.scanCount, 2);
    assert.equal(usage.totalCostUsd, 0.001);
    assert.equal(usage.unknownCostCount, 1);
  });

  it('sums token counts, treating a missing usage as zero (never fabricated as a real reading)', () => {
    const withUsage = { ...usageInput(), id: 'a', inputTokens: 500, outputTokens: 200 };
    const withoutUsage = { ...usageInput(), id: 'b', inputTokens: null, outputTokens: null };

    const usage = computeLocalMonthlyAiUsage([withUsage, withoutUsage], new Date('2026-07-20T00:00:00Z'));

    assert.equal(usage.inputTokens, 500);
    assert.equal(usage.outputTokens, 200);
  });

  it('returns a zeroed summary for an empty log', () => {
    const usage = computeLocalMonthlyAiUsage([], new Date('2026-07-20T00:00:00Z'));
    assert.deepEqual(usage, { scanCount: 0, totalCostUsd: 0, unknownCostCount: 0, inputTokens: 0, outputTokens: 0 });
  });

  it('excludes a zero-token attempt (e.g. a rejected key or a network failure) from scanCount, cost, and unknownCostCount — nothing was billed', () => {
    const billed = { ...usageInput(), id: 'a', estimatedCostUsd: 0.001 };
    // Mirrors what `scan.tsx`'s `recordAttempt` writes for an auth/network/
    // rate-limit failure: no usage was ever reported by the provider, so
    // tokens and cost are all null — this attempt never ran a model.
    const unbilled: LocalAiUsageEvent = {
      ...usageInput(),
      id: 'b',
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      outcome: 'error',
    };

    const usage = computeLocalMonthlyAiUsage([billed, unbilled], new Date('2026-07-20T00:00:00Z'));

    assert.equal(usage.scanCount, 1);
    assert.equal(usage.totalCostUsd, 0.001);
    assert.equal(usage.unknownCostCount, 0);
    assert.equal(usage.inputTokens, billed.inputTokens);
    assert.equal(usage.outputTokens, billed.outputTokens);
  });
});

describe('getLocalMonthlyAiUsage', () => {
  it('reads events from the store and aggregates the current month', async () => {
    const store = createAiStore();
    await recordLocalAiUsageEvent(usageInput({ createdAt: Date.parse('2026-07-15T12:00:00Z') }), { store });
    await recordLocalAiUsageEvent(usageInput({ createdAt: Date.parse('2026-06-01T12:00:00Z') }), { store });

    const usage = await getLocalMonthlyAiUsage(new Date('2026-07-20T00:00:00Z'), { store });
    assert.equal(usage.scanCount, 1);
  });
});
