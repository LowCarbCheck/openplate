/**
 * The account a sign-out names, when the session is already closed
 * (ADR-0023, thread C's follow-up P8).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `defaultSignOutSteps` works the signing-out account out from the open
 * session when it builds the steps. A press builds them anew, and after a
 * failed erase the session is closed, so a retry named nobody: its lock step
 * wrote no owner and its erase step was told no account. The dialog reads the
 * account once when it opens and hands it over as `owner`.
 *
 * ── Why the storage cannot list its keys ─────────────────────────────────
 *
 * The erase takes every `openplate.sync.state.v1:*` key it can LIST, which is
 * all of them on a browser, so on `localStorage` a null account is covered for.
 * A storage with no `key()` and no `length` lists nothing, so only the key of
 * the account the erase was TOLD about goes. That is what makes the owner
 * observable here: the passed account's baseline goes and another account's
 * stays.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * The same closed session with NO owner passed leaves the first account's
 * baseline in place and locks nobody by name, so a pair of steps that ignored
 * its input would pass the first test and fail the second.
 */
import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { DiaryEraseDeps } from '../../app/lib/sync/account-switch';
import { defaultSignOutSteps, ownerOfSession } from '../../app/lib/sync/sign-out-flow';
import { closeSyncSession, getSyncSessionSnapshot } from '../../app/lib/sync/sync-session';
import { readDeviceLock, syncBaselineStorageKey, type KeyValueStorage } from '../../app/lib/sync/sync-state';

const OWNER = { accountId: 7, email: 'anna@example.org' };

/** A storage with no `key()` and no `length`: it can be read and written but not listed. */
function unlistableStorage(initial: Record<string, string>): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Two accounts' baselines on a device that cannot list them, and a delete that always succeeds. */
function deviceWithTwoBaselines(): DiaryEraseDeps {
  return {
    storage: unlistableStorage({
      [syncBaselineStorageKey(OWNER.accountId)]: '{}',
      [syncBaselineStorageKey(12)]: '{}',
    }),
    deleteDatabase: async () => undefined,
    stopStores: async () => undefined,
  };
}

beforeEach(() => {
  closeSyncSession();
});

after(() => {
  closeSyncSession();
});

describe('defaultSignOutSteps with a closed session', () => {
  it('has no session to read, so the cases below are not covered for by an open one', () => {
    assert.equal(getSyncSessionSnapshot().account, null);
  });

  it('hands a passed owner to the lock step, which names that account', () => {
    const deps = deviceWithTwoBaselines();
    const steps = defaultSignOutSteps({ owner: OWNER, deps });
    steps.lockDevice();
    assert.deepEqual(readDeviceLock(deps.storage), { kind: 'locked', owner: OWNER });
  });

  it('hands a passed owner to the erase step, which takes that account baseline and the lock', async () => {
    const deps = deviceWithTwoBaselines();
    const steps = defaultSignOutSteps({ owner: OWNER, deps });
    steps.lockDevice();
    await steps.eraseDevice();
    assert.equal(deps.storage.getItem(syncBaselineStorageKey(OWNER.accountId)), null, 'the owner baseline stayed');
    assert.notEqual(
      deps.storage.getItem(syncBaselineStorageKey(12)),
      null,
      'the erase took a baseline it was not told about, so it proves nothing about the owner',
    );
    assert.deepEqual(readDeviceLock(deps.storage), { kind: 'unlocked' }, 'the lock outlived a finished erase');
  });

  it('CONTROL: with no owner passed and no session, the lock names nobody and the erase takes no baseline', async () => {
    const deps = deviceWithTwoBaselines();
    const steps = defaultSignOutSteps({ deps });
    steps.lockDevice();
    assert.deepEqual(readDeviceLock(deps.storage), { kind: 'locked', owner: null });
    await steps.eraseDevice();
    assert.notEqual(deps.storage.getItem(syncBaselineStorageKey(OWNER.accountId)), null);
  });

  it('keeps the owner it was given for every press, as a retry builds its steps again', async () => {
    const deps = deviceWithTwoBaselines();
    let failures = 1;
    const failingOnce: DiaryEraseDeps = {
      storage: deps.storage,
      stopStores: async () => undefined,
      deleteDatabase: async () => {
        if (failures-- > 0) throw new Error('the diary is open in another tab');
      },
    };
    await assert.rejects(() => {
      const first = defaultSignOutSteps({ owner: OWNER, deps: failingOnce });
      first.lockDevice();
      return first.eraseDevice();
    });
    assert.deepEqual(readDeviceLock(deps.storage), { kind: 'locked', owner: OWNER }, 'a failed erase lifted the lock');

    // THE RETRY: new steps, the session still closed, the same owner handed in.
    const retry = defaultSignOutSteps({ owner: OWNER, deps: failingOnce });
    retry.lockDevice();
    assert.deepEqual(readDeviceLock(deps.storage), { kind: 'locked', owner: OWNER });
    await retry.eraseDevice();
    assert.deepEqual(readDeviceLock(deps.storage), { kind: 'unlocked' });
  });
});

describe('ownerOfSession', () => {
  it('names the account by id and address', () => {
    const account = {
      id: 7,
      email: 'anna@example.org',
      displayName: null,
      role: null,
      dailyAiLimit: null,
      aiUsedToday: null,
      allowanceExpiresAt: null,
      invitesLeft: null,
    } satisfies NonNullable<ReturnType<typeof getSyncSessionSnapshot>['account']>;
    assert.deepEqual(ownerOfSession(account), OWNER);
  });

  it('CONTROL: a closed session names nobody', () => {
    assert.equal(ownerOfSession(null), null);
  });
});

/** Every `defaultSignOutSteps({ ... })` call in a source, as the text between its braces. */
function stepCalls(source: string): string[] {
  return [...source.matchAll(/defaultSignOutSteps\(\{([^}]*)\}\)/g)].map((match) => match[1] ?? '');
}

describe('the dialog hands the owner to the sign-out', () => {
  it('builds its steps with the owner it read when it opened, on every press', () => {
    const body = readFileSync(new URL('../../app/components/sign-out-dialog-body.tsx', import.meta.url), 'utf8');
    const calls = stepCalls(body);
    assert.equal(calls.length, 1, 'the dialog builds its steps in one place');
    assert.match(calls[0] ?? '', /\bowner\b/);
  });

  it('CONTROL: the scan reports a call that passes no owner, and one that does', () => {
    assert.doesNotMatch(stepCalls('defaultSignOutSteps({ destination: "/welcome" })')[0] ?? '', /\bowner\b/);
    assert.match(stepCalls('defaultSignOutSteps({ destination: "/welcome", owner })')[0] ?? '', /\bowner\b/);
  });
});
