/**
 * M187/02: what a synced gateway connection may do to a device's AI settings.
 *
 * The rule is conservative in one direction only — a connection issued to the
 * person may fill an empty device or refresh a row that came from a gateway,
 * and may NEVER touch a key its owner pasted, connected by OAuth, or took from
 * this instance's preset. The manual case is the one that would hurt: a person
 * who set up their own OpenRouter key on the laptop must not lose it because
 * the phone joined a household gateway.
 *
 * All four cases the spec names are here, plus the ordering question the
 * tombstone exists for.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decideGatewayConnectionApply, pickNewerGatewayConnection } from '../../app/lib/sync/gateway-connection-apply';
import { buildGatewayAiSettings } from '../../app/lib/gateway-invite';
import type { ConnectedGatewayConnection } from '../../app/lib/local-store/schema';
import type { LocalAiSettings } from '../../app/lib/local-store/ai-settings';

const CONNECTED_AT = 1_756_000_000_000;

const connection: ConnectedGatewayConnection = {
  status: 'connected',
  gatewayUrl: 'https://gateway.household.example',
  memberToken: 'gm_member-token',
  model: 'google/gemini-3.7-flash',
  auditEnabled: true,
  connectedAt: CONNECTED_AT,
  updatedAt: CONNECTED_AT,
};

/** A row of a given provenance. Only `connectedVia` decides anything, so the rest is deliberately unremarkable. */
function settingsRow(connectedVia: LocalAiSettings['connectedVia']): LocalAiSettings {
  return {
    provider: 'openrouter',
    model: 'google/gemini-3.5-flash-lite',
    baseUrl: null,
    apiKey: 'sk-or-v1-typed-by-hand',
    connectedVia,
    updatedAt: CONNECTED_AT - 10_000,
  };
}

describe('applying a synced gateway connection', () => {
  it('case 1: writes it on a device that has no AI settings row', () => {
    const decision = decideGatewayConnectionApply({ connection, settings: null });

    assert.equal(decision.action, 'write');
    assert.equal(decision.action === 'write' ? decision.settings.apiKey : null, 'gm_member-token');
    assert.equal(decision.action === 'write' ? decision.settings.connectedVia : null, 'invite');
  });

  it("case 1: the row it writes is byte-identical to the redeeming device's", () => {
    const decision = decideGatewayConnectionApply({ connection, settings: null });

    // The point of one construction site: a second device must end up with
    // the row `/join` wrote, not a lookalike with a defaulted model.
    assert.deepEqual(
      decision.action === 'write' ? decision.settings : null,
      buildGatewayAiSettings({
        gatewayUrl: connection.gatewayUrl,
        redeemed: {
          memberId: 'member-1',
          memberToken: connection.memberToken,
          gateway: { name: 'Household', model: connection.model, auditEnabled: connection.auditEnabled },
        },
        now: CONNECTED_AT,
      }),
    );
  });

  it('case 2: overwrites an invite row, which is how a refreshed token lands', () => {
    const decision = decideGatewayConnectionApply({ connection, settings: settingsRow('invite') });

    assert.equal(decision.action, 'write');
    assert.equal(decision.action === 'write' ? decision.settings.apiKey : null, 'gm_member-token');
  });

  it('case 2: does nothing when the invite row already says exactly this', () => {
    const first = decideGatewayConnectionApply({ connection, settings: null });
    assert.equal(first.action, 'write');

    const again = decideGatewayConnectionApply({
      connection,
      settings: first.action === 'write' ? first.settings : null,
    });

    // Not cosmetic: this is what keeps every sync cycle from rewriting an
    // unchanged settings row.
    assert.equal(again.action, 'none');
  });

  it('case 3: never touches a manual row', () => {
    const manual = settingsRow('manual');

    assert.equal(decideGatewayConnectionApply({ connection, settings: manual }).action, 'none');
    assert.equal(
      decideGatewayConnectionApply({ connection: { status: 'disconnected', updatedAt: Date.now() }, settings: manual })
        .action,
      'none',
      'a disconnect elsewhere cleared a key its owner pasted here',
    );
  });

  it('case 3: never touches an oauth or preset row either', () => {
    for (const via of ['oauth', 'preset'] as const) {
      assert.equal(decideGatewayConnectionApply({ connection, settings: settingsRow(via) }).action, 'none');
    }
  });

  it('case 4: a tombstone clears an invite row', () => {
    const decision = decideGatewayConnectionApply({
      connection: { status: 'disconnected', updatedAt: CONNECTED_AT + 1 },
      settings: settingsRow('invite'),
    });

    assert.equal(decision.action, 'clear');
  });

  it('case 4: a tombstone on a device that has no row is a no-op', () => {
    const decision = decideGatewayConnectionApply({
      connection: { status: 'disconnected', updatedAt: CONNECTED_AT + 1 },
      settings: null,
    });

    assert.equal(decision.action, 'none');
  });

  it('leaves a device alone when the account knows of no connection at all', () => {
    assert.equal(decideGatewayConnectionApply({ connection: null, settings: null }).action, 'none');
    assert.equal(decideGatewayConnectionApply({ connection: null, settings: settingsRow('invite') }).action, 'none');
  });
});

describe('picking between two records of the connection', () => {
  it('takes the newer stamp, in both directions', () => {
    const older = { ...connection, updatedAt: CONNECTED_AT };
    const newer = { ...connection, memberToken: 'gm_refreshed', updatedAt: CONNECTED_AT + 5_000 };

    assert.deepEqual(pickNewerGatewayConnection({ synced: newer, local: older }), newer);
    assert.deepEqual(pickNewerGatewayConnection({ synced: older, local: newer }), newer);
  });

  it('lets a newer tombstone beat a connection, which is the whole reason it is stamped', () => {
    const tombstone = { status: 'disconnected', updatedAt: CONNECTED_AT + 5_000 } as const;

    assert.deepEqual(pickNewerGatewayConnection({ synced: tombstone, local: connection }), tombstone);
  });

  it('does not let an OLDER connection resurrect a disconnect', () => {
    const tombstone = { status: 'disconnected', updatedAt: CONNECTED_AT + 5_000 } as const;

    assert.deepEqual(pickNewerGatewayConnection({ synced: connection, local: tombstone }), tombstone);
  });

  it('takes whichever side exists when the other has never had one', () => {
    assert.deepEqual(pickNewerGatewayConnection({ synced: connection, local: null }), connection);
    assert.deepEqual(pickNewerGatewayConnection({ synced: null, local: connection }), connection);
    assert.equal(pickNewerGatewayConnection({ synced: null, local: null }), null);
  });
});
