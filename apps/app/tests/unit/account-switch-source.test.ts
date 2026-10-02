/**
 * Where a session may open and where the device lock may lift, read off the
 * source (ADR-0022).
 *
 * The guard in `openSyncVault` holds for every flow only while every session
 * opens THROUGH it, and the lock protects a held diary only while nothing but
 * an erase or the owner's own sign-in removes it. Both are properties of where
 * calls are written, so they are checked where calls are written:
 *
 *  - `openSyncSession(` is called only by `session-cache.ts` (it is defined in
 *    `sync-session.ts`), so no flow can publish a session past the guard;
 *  - `clearDeviceLockAfterErase` is referenced only by `account-switch.ts`
 *    (defined in `sync-state.ts`), so the lock lifts for an erase only after
 *    the erase;
 *  - `releaseDeviceLockForOwner` is referenced only by `sync-session.ts`;
 *  - the lock's key is spelled only in `sync-state.ts`, so nothing removes it
 *    by name around the two functions above;
 *  - the guard is the FIRST statement of `openSyncVault`, and the recovery
 *    asks the lock before it rotates anything.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * Each scan first proves it finds what it is allowed to find (the definition
 * and the one permitted caller), so an empty result is not a scanner that read
 * nothing. And the predicate itself is run over a planted file that breaks the
 * rule, which it must report.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP_DIR = join(APP_ROOT, 'app');

/** Every TypeScript source under `app/`, as `[path relative to the app root, contents]`. */
function readAppSources(): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      files.push([relative(APP_ROOT, path), readFileSync(path, 'utf8')]);
    }
  };
  walk(APP_DIR);
  return files;
}

/** The source with its comments blanked out, so a mention in prose is not a call. */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The files whose code (not comments) matches `pattern`. */
function filesMatching(sources: ReadonlyArray<[string, string]>, pattern: RegExp): string[] {
  return sources
    .filter(([, source]) => pattern.test(withoutComments(source)))
    .map(([path]) => path)
    .toSorted();
}

const SOURCES = readAppSources();

describe('who may open a session', () => {
  const CALL = /\bopenSyncSession\(/;

  test('openSyncSession( is written only where it is defined and in session-cache.ts', () => {
    assert.deepEqual(filesMatching(SOURCES, CALL), ['app/lib/sync/session-cache.ts', 'app/lib/sync/sync-session.ts']);
  });

  test('CONTROL: the predicate reports a planted caller, and ignores a mention in a comment', () => {
    const planted: Array<[string, string]> = [
      ['app/routes/planted.tsx', 'openSyncSession(vault, { lastSyncedAt: null });'],
      ['app/routes/prose.tsx', '// see openSyncSession(vault) for why\n/* openSyncSession(x) */'],
    ];
    assert.deepEqual(filesMatching(planted, CALL), ['app/routes/planted.tsx']);
  });
});

describe('who may lift the lock', () => {
  test('clearDeviceLockAfterErase is referenced only by sync-state.ts and account-switch.ts', () => {
    assert.deepEqual(filesMatching(SOURCES, /\bclearDeviceLockAfterErase\b/), [
      'app/lib/sync/account-switch.ts',
      'app/lib/sync/sync-state.ts',
    ]);
  });

  test('releaseDeviceLockForOwner is referenced only by sync-state.ts and sync-session.ts', () => {
    assert.deepEqual(filesMatching(SOURCES, /\breleaseDeviceLockForOwner\b/), [
      'app/lib/sync/sync-session.ts',
      'app/lib/sync/sync-state.ts',
    ]);
  });

  test('the lock key is spelled only in sync-state.ts, and removed there only inside the two lifting functions', () => {
    assert.deepEqual(filesMatching(SOURCES, /openplate\.device-locked/), ['app/lib/sync/sync-state.ts']);
    const state = withoutComments(SOURCES.find(([path]) => path === 'app/lib/sync/sync-state.ts')?.[1] ?? '');
    const removals = [...state.matchAll(/removeItem\(DEVICE_LOCK_KEY\)/g)].map((match) => match.index);
    assert.equal(removals.length, 2, 'a third place removes the lock');
    const owners = removals.map((index) => {
      const before = state.slice(0, index);
      return before.slice(before.lastIndexOf('export function ')).match(/export function (\w+)/)?.[1];
    });
    assert.deepEqual(owners.toSorted(), ['clearDeviceLockAfterErase', 'releaseDeviceLockForOwner']);
  });

  test('CONTROL: the key scan reports the literal in a planted file, and ignores it in a comment', () => {
    const planted: Array<[string, string]> = [
      ['app/hooks/planted.ts', "const KEY = 'openplate.device-locked';"],
      [
        'app/hooks/prose.ts',
        '// the key openplate.device-locked is spelled in sync-state.ts\n/* openplate.device-locked */',
      ],
    ];
    assert.deepEqual(filesMatching(planted, /openplate\.device-locked/), ['app/hooks/planted.ts']);
  });

  test('CONTROL: the reference scan reports a planted caller', () => {
    const planted: Array<[string, string]> = [['app/routes/planted.tsx', 'clearDeviceLockAfterErase();']];
    assert.deepEqual(filesMatching(planted, /\bclearDeviceLockAfterErase\b/), ['app/routes/planted.tsx']);
  });
});

describe('the guard comes first', () => {
  const sessionCache = withoutComments(SOURCES.find(([path]) => path === 'app/lib/sync/session-cache.ts')?.[1] ?? '');
  const actions = withoutComments(SOURCES.find(([path]) => path === 'app/lib/sync/sync-actions.ts')?.[1] ?? '');

  test('the first statement of openSyncVault asks the lock', () => {
    assert.match(sessionCache, /export function openSyncVault\([\s\S]*?\): SyncVault \{\s*assertDeviceMayOpen\(/);
  });

  test('the recovery asks the lock after the recover and before the consent, the key read and the rotation', () => {
    const body = actions.slice(actions.indexOf('export async function recoverSyncAccount('));
    const recover = body.indexOf('authClient.recover(');
    const asked = body.indexOf('decideDeviceOpen(');
    const consent = body.indexOf('settleHealthConsent(');
    const records = body.indexOf('listKeyRecords(');
    const rotate = body.indexOf('authClient.recoverRotate(');
    assert.ok(recover > 0 && asked > recover, 'the lock is not asked after the recover');
    assert.ok(asked < consent && asked < records && asked < rotate, 'the lock is asked too late');
  });

  test('the sign-in asks by address before the handshake, and by id before the key records', () => {
    const body = actions.slice(actions.indexOf('export async function signInToSync('));
    const byAddress = body.indexOf('isDeviceHeldFromEmail(');
    const handshake = body.indexOf('requireCompatibleService(');
    const login = body.indexOf('authClient.login(');
    const byId = body.indexOf('decideDeviceOpen(');
    const records = body.indexOf('listKeyRecords(');
    assert.ok(byAddress > 0 && byAddress < handshake, 'the address is asked after a request was made');
    assert.ok(byId > login && byId < records, 'the id is not asked between the login and the key records');
  });
});
