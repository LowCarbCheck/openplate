/**
 * M187/02: the gateway connection travels between the account's own devices
 * and appears in NO backup export.
 *
 * The two halves are asserted together on purpose, because either one alone
 * passes for the wrong reason. "The export carries no member token" is
 * satisfied by a feature that was never built; "the snapshot carries one" says
 * nothing about what leaves the device in a file. So this file proves both
 * over the same store: the SYNC read path attaches the connection, and the
 * EXPORT path — reading the very same primary store — does not.
 *
 * Modelled on `oauth-backup-exclusion.test.ts`, which does the same job one
 * store over for a BYOK key. The difference is that this credential lives in
 * the primary store rather than the separate AI database, so the exclusion is
 * a decision `backup.ts` makes rather than a property of where the row sits —
 * which is exactly why it needs a test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { exportBackup, serializeBackup } from '../../app/lib/local-store/backup';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { putLocalFoodLog, putLocalGatewayConnection } from '../../app/lib/local-store/primary-store';
import { readLocalSnapshot } from '../../app/lib/sync/local-store-bridge';
import { SNAPSHOT_KEY_REGIONS } from '../../app/lib/sync/snapshot-partition';

/** The credential itself. Distinctive enough that finding it in a JSON string means something. */
const MEMBER_TOKEN = 'gm_live-member-token-do-not-export';

/** The gateway address, hunted beside the token: it names who runs the endpoint, which is a fact about the person too. */
const GATEWAY_URL = 'https://gateway.household.example';

async function storeWithAGatewayAndADiary() {
  const store = createPrimaryStore();
  await putLocalGatewayConnection(
    {
      status: 'connected',
      gatewayUrl: GATEWAY_URL,
      memberToken: MEMBER_TOKEN,
      model: 'google/gemini-3.7-flash',
      auditEnabled: true,
      connectedAt: 1_756_000_000_000,
      updatedAt: 1_756_000_000_000,
    },
    { store },
  );
  // Real health data beside it, so this is not a vacuous "empty export" pass.
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
      dayKey: '2026-09-03',
      loggedAt: 2_000,
      createdAt: 2_000,
      logBatchId: null,
      portion: null,
    },
    { store },
  );
  return store;
}

describe('a backup export and the gateway member token', () => {
  it('carries the diary and no memberToken, from a store that holds one', async () => {
    const store = await storeWithAGatewayAndADiary();

    const envelope = await exportBackup({ store });
    const json = serializeBackup(envelope);

    assert.ok(!json.includes(MEMBER_TOKEN), 'the gateway member token leaked into the backup export');
    assert.ok(!json.includes(GATEWAY_URL), 'the gateway address leaked into the backup export');
    assert.ok(!json.includes('memberToken'), 'the export carries a memberToken field');
    assert.ok(!('gatewayConnection' in envelope.data), 'the export shape has a gatewayConnection key at all');
    assert.equal(envelope.data.foodLogs.length, 1, 'sanity check: the export did capture real health data');
  });

  it('is not vacuous: the same store syncs the token, in the owner-private region', async () => {
    const store = await storeWithAGatewayAndADiary();

    const snapshot = await readLocalSnapshot({ store });

    assert.equal(snapshot.gatewayConnection?.status, 'connected');
    assert.equal(
      snapshot.gatewayConnection?.status === 'connected' ? snapshot.gatewayConnection.memberToken : null,
      MEMBER_TOKEN,
      'the sync read path dropped the connection, which would make the exclusion above meaningless',
    );
    // And it travels SEALED. A key classified `shared` would ride in the
    // clear inside every clinician's blob.
    assert.equal(SNAPSHOT_KEY_REGIONS.gatewayConnection, 'owner-private');
  });
});
