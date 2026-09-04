/**
 * A torn join heals on the next push.
 *
 * A gateway join writes TWO rows: the device's AI settings, and the account's
 * connection record. They live in two different IndexedDB databases — the
 * settings store is deliberately separate so that a tracker backup can never
 * carry a provider credential — so the pair cannot be written in one
 * transaction, and there is a real window in which the first lands and the
 * second does not.
 *
 * Where that leaves the person: this device works, and their SECOND device
 * keeps asking them to connect to a provider they already joined, forever,
 * because the account's record of the join never existed.
 *
 * So the sync read path derives the missing record from the settings row. That
 * is what is pinned here, together with the three cases where deriving would be
 * wrong: a hand-typed key, a preset, and a device that deliberately left the
 * gateway.
 *
 * And one case where the repair is skipped instead: the settings store is read
 * with a PEEK, so a push never waits on that second database. The last suite
 * pins that, because awaiting it stalls every push on a device that has not
 * opened the AI store yet.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveGatewayConnectionFromSettings, GATEWAY_API_PREFIX } from '../../app/lib/gateway-invite';
import { createAiStore, createPrimaryStore } from '../../app/lib/local-store/store';
import { putLocalAiSettings } from '../../app/lib/local-store/ai-settings';
import { putLocalGatewayConnection } from '../../app/lib/local-store/primary-store';
import { readLocalSnapshot } from '../../app/lib/sync/local-store-bridge';
import type { LocalAiSettings } from '../../app/lib/local-store/ai-settings';

const GATEWAY_URL = 'https://gateway.household.example';
const MEMBER_TOKEN = 'gm_live-member-token';
const JOINED_AT = 1_700_000_000_000;

function gatewaySettings(overrides: Partial<LocalAiSettings> = {}): LocalAiSettings {
  return {
    provider: 'openai-compatible',
    model: 'google/gemini-3.7-flash',
    baseUrl: `${GATEWAY_URL}${GATEWAY_API_PREFIX}`,
    apiKey: MEMBER_TOKEN,
    connectedVia: 'invite',
    auditEnabled: true,
    updatedAt: JOINED_AT,
    ...overrides,
  };
}

describe('deriveGatewayConnectionFromSettings', () => {
  it('reconstructs the account record from an invite-joined settings row', () => {
    assert.deepEqual(deriveGatewayConnectionFromSettings(gatewaySettings()), {
      status: 'connected',
      gatewayUrl: GATEWAY_URL,
      memberToken: MEMBER_TOKEN,
      model: 'google/gemini-3.7-flash',
      auditEnabled: true,
      // The join's own instant, not a fresh clock: a newer stamp would beat a
      // connection another device wrote later and legitimately.
      connectedAt: JOINED_AT,
      updatedAt: JOINED_AT,
    });
  });

  it('derives nothing from a key its owner pasted, or took from this instance', () => {
    for (const connectedVia of ['manual', 'oauth', 'preset'] as const) {
      assert.equal(
        deriveGatewayConnectionFromSettings(gatewaySettings({ connectedVia })),
        null,
        `${connectedVia} is not a gateway the ACCOUNT has any business recording`,
      );
    }
  });

  it('derives nothing when the base URL is not a gateway address', () => {
    assert.equal(deriveGatewayConnectionFromSettings(gatewaySettings({ baseUrl: null })), null);
    assert.equal(deriveGatewayConnectionFromSettings(gatewaySettings({ baseUrl: 'https://api.example/x' })), null);
    // A row whose whole base URL IS the prefix names no gateway at all.
    assert.equal(deriveGatewayConnectionFromSettings(gatewaySettings({ baseUrl: GATEWAY_API_PREFIX })), null);
  });

  it('derives nothing from no settings at all', () => {
    assert.equal(deriveGatewayConnectionFromSettings(null), null);
  });
});

describe('the push snapshot, when the join was torn', () => {
  it('carries a derived connection when only the settings row was written', async () => {
    const store = createPrimaryStore();
    const aiStore = createAiStore();
    // Exactly the state a failed second write leaves: settings, no connection.
    await putLocalAiSettings(gatewaySettings(), { store: aiStore });

    const snapshot = await readLocalSnapshot({ store, aiStore });

    assert.ok(snapshot.gatewayConnection != null, 'the account must not stay behind the device');
    assert.equal(snapshot.gatewayConnection.status, 'connected');
    assert.equal(snapshot.gatewayConnection.gatewayUrl, GATEWAY_URL);
    assert.equal(snapshot.gatewayConnection.memberToken, MEMBER_TOKEN);
  });

  it('carries nothing when the device has no gateway settings either', async () => {
    const snapshot = await readLocalSnapshot({ store: createPrimaryStore(), aiStore: createAiStore() });
    assert.equal(snapshot.gatewayConnection, null);
  });

  it('leaves a stored record alone rather than deriving over it', async () => {
    const store = createPrimaryStore();
    const aiStore = createAiStore();
    await putLocalAiSettings(gatewaySettings(), { store: aiStore });
    await putLocalGatewayConnection(
      {
        status: 'connected',
        gatewayUrl: 'https://other.example',
        memberToken: 'gm_stored',
        model: null,
        auditEnabled: false,
        connectedAt: JOINED_AT + 1,
        updatedAt: JOINED_AT + 1,
      },
      { store },
    );

    const snapshot = await readLocalSnapshot({ store, aiStore });
    assert.equal(
      snapshot.gatewayConnection?.status === 'connected' && snapshot.gatewayConnection.memberToken,
      'gm_stored',
    );
  });

  it('never resurrects a gateway the person disconnected from', async () => {
    // The tombstone is the record of a deliberate act. Deriving from a settings
    // row that has not been cleared yet would undo it on the next push.
    const store = createPrimaryStore();
    const aiStore = createAiStore();
    await putLocalAiSettings(gatewaySettings(), { store: aiStore });
    await putLocalGatewayConnection({ status: 'disconnected', updatedAt: JOINED_AT + 1 }, { store });

    const snapshot = await readLocalSnapshot({ store, aiStore });
    assert.equal(snapshot.gatewayConnection?.status, 'disconnected');
  });
});

describe('the push, when the AI store was never opened', () => {
  it('finishes without waiting for a second IndexedDB database', async () => {
    // No `aiStore` is injected and nothing in this process has ever resolved
    // `getAiStore()`, so the settings peek must answer "not loaded" straight
    // away. Awaiting the load instead is what stalled every sync push in the
    // integration tier: the AI database never finishes loading in a harness
    // that does not open it, and the push never returns.
    //
    // The primary store IS injected, because a push genuinely does read it and
    // this test is about the OTHER database.
    const snapshot = await withTimeout(readLocalSnapshot({ store: createPrimaryStore() }), 2000);

    assert.notEqual(snapshot, TIMED_OUT, 'the push must not block on the AI store');
    assert.equal(snapshot !== TIMED_OUT && snapshot.gatewayConnection, null);
  });
});

const TIMED_OUT = Symbol('timed out');

/** Resolves to `TIMED_OUT` rather than hanging, so a stall FAILS instead of killing the run. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}
