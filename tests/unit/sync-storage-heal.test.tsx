/**
 * THE HEAL IS SILENT IN MECHANISM AND LOUD IN REPORTING (M224).
 *
 * The withholding itself is invisible by design: the push simply carries no
 * deletes, the pull hands the account's copy back, and the device repopulates
 * through the ordinary path. That is right, because a person whose data came
 * back should not have to do anything.
 *
 * It is also exactly how this defect survived. A device that silently empties
 * itself and silently fills itself again looks perfectly healthy while doing
 * both. So the notice is a separate, testable statement, and this file is the
 * three halves of it: the COUNT (which rows actually came back), the pure
 * DECISION, and the sentence a person reads.
 *
 * The fourth part is WHOSE restore it is. The notice outlives the cycle that
 * made it, and `openSyncVault` opens a new session over a live one without
 * closing it, so a shared device could show one person the other's restore
 * count.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { resolveStorageHealNotice } from '../../app/lib/sync/storage-heal';
import type { Tombstone } from '../../app/lib/sync/engine/merge/types';
import { SyncRestoredNotice } from '../../app/components/sync-status';
import type { StorageHealNotice } from '../../app/lib/sync/storage-heal';
import { countRestoredEntities, SYNC_ENTITY_TYPES } from '../../app/lib/sync/snapshot-sync';
import { FASTS_TABLE, SAVED_MEALS_TABLE } from '../../app/lib/local-store/schema';
import type { LocalFast, LocalFoodLog } from '../../app/lib/local-store/schema';
import type { SealedPrivateStore, SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';
import { getSyncSessionSnapshot, openSyncSession, updateSyncSession, type SyncVault } from '../../app/lib/sync/sync-session';
import type { SyncAuthClient } from '../../app/lib/sync/engine/client/auth-client';
import { withI18n } from './trends-i18n-harness';

const T = Date.parse('2026-09-12T08:00:00Z');

function tombstone(entityId: string): Tombstone {
  return { entityId, entityType: 'foodLog', lamport: 2, deviceId: 'device-1' };
}

function render(notice: StorageHealNotice): string {
  return renderToStaticMarkup(withI18n(createElement(SyncRestoredNotice, { notice })));
}

describe('resolveStorageHealNotice', () => {
  it('says nothing at all when nothing came back', () => {
    assert.deepEqual(resolveStorageHealNotice({ restoredCount: 0, accountId: 1 }), { kind: 'none' });
  });

  it('counts the entries that actually came back, and names the account', () => {
    assert.deepEqual(resolveStorageHealNotice({ restoredCount: 2, accountId: 7 }), {
      kind: 'restored',
      entryCount: 2,
      accountId: 7,
    });
  });

  // THE LIE THIS CLOSES (M225). When the pull finds no blob, `mergeSnapshots`
  // never runs, the withheld entities do not come back, and they drop out of
  // the baseline on the next commit. The notice still said "your entries were
  // restored from your account". Count withheld tombstones instead of restored
  // rows and this line goes red.
  it('claims no restore when nothing came back', () => {
    assert.deepEqual(resolveStorageHealNotice({ restoredCount: 0, accountId: 1 }), { kind: 'none' });
  });

  // THE SECOND PRODUCER (M227). A refused pass-through table restores rows and
  // withholds no tombstone at all, because `fasts` and `savedMeals` are not
  // merged and mint none. The old `withheld.length === 0` early return here
  // therefore said nothing to the person whose list had just been handed back.
  // Put that early return back and this line goes red.
  it('still speaks when the restore came from a refused list rather than a withheld delete', () => {
    assert.deepEqual(resolveStorageHealNotice({ restoredCount: 3, accountId: 4 }), {
      kind: 'restored',
      entryCount: 3,
      accountId: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// The count: which rows the apply actually wrote that this device could not
// vouch for
// ---------------------------------------------------------------------------

function fast(id: string): LocalFast {
  return {
    id,
    protocolId: '16:8',
    targetDurationMs: 57_600_000,
    plannedStartAt: null,
    startedAt: T,
    endedAt: null,
    createdAt: T,
  };
}

function foodLog(id: string): LocalFoodLog {
  return {
    id,
    name: 'Bread',
    quantityGrams: 50,
    macros: { carbs: 25, fiber: 2, sugars: 1, polyols: 0, protein: 4, fat: 1, kcal: 130 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-09-12',
    loggedAt: T,
    createdAt: T,
    logBatchId: null,
  };
}

const SEALED_COMPARTMENT: SealedPrivateStore = {
  ciphertext: 'sealed',
  cdkWrapPassphrase: 'wrap-passphrase',
  cdkWrapRecovery: 'wrap-recovery',
};

function snapshot(overrides: Partial<SyncedSnapshot> = {}): SyncedSnapshot {
  return {
    foods: [],
    foodLogs: [],
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    fastingSettings: null,
    privateStore: null,
    ...overrides,
  };
}

describe('countRestoredEntities', () => {
  it('counts a withheld delete whose row is back in the agreed payload', () => {
    const count = countRestoredEntities({
      withheld: [tombstone('a')],
      merged: snapshot({ foodLogs: [foodLog('a')] }),
      local: snapshot(),
      refused: [],
    });
    assert.equal(count, 1, 'a row the apply wrote back is a restore');
  });

  // THE COMPARTMENT IS NEVER A RESTORE (M227). A HELD seal pushes the account's
  // own bytes back to it unchanged and writes NOTHING to this device, so
  // "2 entries were restored" would be a sentence about a row that does not
  // exist. It stays in `withheld` so the cycle cannot be called clean and so
  // the heal log names the type, and it stops there.
  //
  // THE CONTROL: drop the `privateStore` exclusion from `countRestoredEntities`
  // and this is 1, because the compartment IS live in the agreed payload, which
  // is exactly what made the old count say so.
  it('never counts a held compartment, even though it is live in the payload', () => {
    const count = countRestoredEntities({
      withheld: [{ entityId: 'me', entityType: SYNC_ENTITY_TYPES.privateStore, lamport: 3, deviceId: 'device-1' }],
      merged: snapshot({ privateStore: SEALED_COMPARTMENT }),
      local: snapshot({ privateStore: SEALED_COMPARTMENT }),
      refused: [],
    });
    assert.equal(count, 0, 'held bytes were reported to somebody as restored entries');
  });

  // THE SECOND SOURCE. A refused table replaces this device's list with the
  // account's, and every id only the account had is a row the apply wrote.
  // There is no tombstone anywhere to see it by.
  //
  // THE CONTROL: count only withheld tombstones, as the old implementation did,
  // and this is 0 while three fasts land on the device.
  it('counts the rows a refused pass-through list adopted from the account', () => {
    const count = countRestoredEntities({
      withheld: [],
      merged: snapshot({ fasts: [fast('one'), fast('two'), fast('three')] }),
      local: snapshot({ fasts: [] }),
      refused: [FASTS_TABLE],
    });
    assert.equal(count, 3, 'three fasts came back and nobody was told');
  });

  // THE MIGRATION CYCLE, which is the common case for the refused branch and
  // must stay silent. A baseline written before the pass-through ids were kept
  // can account for nothing, so BOTH tables are refused exactly once on every
  // device in the fleet. A healthy device's lists are already the account's, so
  // nothing is adopted, the count is zero, and no notice is drawn.
  it('says nothing on the migration cycle, where every table is refused and the lists match', () => {
    const lists = { fasts: [fast('one'), fast('two')] };
    const count = countRestoredEntities({
      withheld: [],
      merged: snapshot(lists),
      local: snapshot(lists),
      refused: [FASTS_TABLE, SAVED_MEALS_TABLE],
    });
    assert.equal(count, 0, 'a healthy device was told its own fasts had been restored');
    assert.deepEqual(resolveStorageHealNotice({ restoredCount: count, accountId: 1 }), { kind: 'none' });
  });
});

// ---------------------------------------------------------------------------
// Whose restore it is
// ---------------------------------------------------------------------------

/**
 * A vault with the three fields `openSyncSession` reads.
 *
 * The DEK, the HTTP clients and the compartment session are deliberately absent
 * rather than faked: no claim here opens a blob, and a fixture that built key
 * material would be describing a session this file never runs.
 */
function vaultFor(accountId: number): SyncVault {
  const authClient: Pick<SyncAuthClient, 'getSession'> = { getSession: () => null };
  // SAFETY: `openSyncSession` reads `accountId`, `email` and
  // `authClient.getSession()` and nothing else; every other member of
  // `SyncVault` is untouched on this path.
  return { accountId, email: `person-${accountId}@example.com`, authClient } as SyncVault;
}

const RESTORED_FOR_ACCOUNT_ONE: StorageHealNotice = { kind: 'restored', entryCount: 2, accountId: 1 };

describe('a restore notice belongs to the account whose data came back', () => {
  // THE HOLE (M227). `closeSyncSession` publishes SIGNED_OUT, which clears the
  // notice, but `openSyncVault` opens OVER a live vault without ever closing
  // it. Signing in as somebody else on a shared device therefore inherited the
  // previous person's sentence, and it is a sentence about their diary.
  //
  // THE CONTROL: drop the account comparison from `openSyncSession` and the
  // middle assertion reads `{ kind: 'restored', entryCount: 2, accountId: 1 }`
  // on account 2's screen.
  it('is dropped when another account opens a session, and kept when its own does', () => {
    updateSyncSession({ storageHealNotice: RESTORED_FOR_ACCOUNT_ONE });
    openSyncSession(vaultFor(2), { lastSyncedAt: null });
    assert.deepEqual(
      getSyncSessionSnapshot().storageHealNotice,
      { kind: 'none' },
      'the second person was told about the first one’s restore',
    );

    updateSyncSession({ storageHealNotice: RESTORED_FOR_ACCOUNT_ONE });
    openSyncSession(vaultFor(1), { lastSyncedAt: null });
    assert.deepEqual(
      getSyncSessionSnapshot().storageHealNotice,
      RESTORED_FOR_ACCOUNT_ONE,
      'the one sentence the app had to say was forgotten on the sign-in that follows an eviction',
    );
  });
});

describe('the sync status surface', () => {
  it('tells the person their copy was restored, in words, not a code', () => {
    const markup = render({ kind: 'restored', entryCount: 2, accountId: 1 });
    // The RENDERED sentence, from the real bundle. Pinning the key instead
    // would pass against a key nobody translated.
    assert.ok(markup.includes('This device lost its local copy'), 'the restore notice was not drawn');
    assert.ok(markup.includes('Nothing was deleted.'), 'the reassurance was not drawn');
  });

  it('THE CONTROL: draws nothing of the sort on an ordinary healthy sync', () => {
    const markup = render({ kind: 'none' });
    assert.ok(!markup.includes('This device lost its local copy'), 'a healthy device was told it lost its data');
  });
});
