/**
 * Unit tests for the migration-gate device-stamp (`migration-gate.ts`).
 *
 * The stamp's original caller — `_personal.tsx`'s server-side migration gate —
 * is gone with the account system (M128 spec 03), so nothing in the app reads
 * it today; see that module's doc comment for why it is kept anyway. These
 * tests pin the primitive's behaviour (pure skip decision + store round-trip)
 * so it stays trustworthy for the next caller rather than quietly rotting.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearMigrationGateStamp,
  getMigrationGateClearedFor,
  setMigrationGateClearedFor,
  shouldSkipMigrationGateCheck,
} from '../../app/lib/local-store/migration-gate';
import { ANONYMOUS_USER_ID, createPrimaryStore } from '../../app/lib/local-store/store';

describe('shouldSkipMigrationGateCheck', () => {
  it('skips the server check once a stamp is present, regardless of its value', () => {
    assert.equal(shouldSkipMigrationGateCheck({ clearedForUserId: 1 }), true);
    assert.equal(shouldSkipMigrationGateCheck({ clearedForUserId: 42 }), true);
  });

  // The ANONYMOUS_USER_ID sentinel is the only owner id the app mints now
  // (M128 spec 03) — a stamp carrying it must read as "skip" exactly like the
  // real account ids older builds stamped.
  it('skips the check for the ANONYMOUS_USER_ID sentinel stamp too', () => {
    assert.equal(shouldSkipMigrationGateCheck({ clearedForUserId: ANONYMOUS_USER_ID }), true);
  });

  it('does NOT skip when no stamp exists yet', () => {
    assert.equal(shouldSkipMigrationGateCheck({ clearedForUserId: null }), false);
  });

  // This function deliberately checks only non-null, not WHICH owner the
  // stamp belongs to (see its doc comment) — a stamp left by an older,
  // signed-in build still reads as "skip". That was a real shared-device
  // hazard when accounts existed and the call site had to clear the stamp on
  // every login; with one owner per device it is simply the behaviour.
  it('documents that a stamp carrying a stale owner id still reads as skip', () => {
    assert.equal(shouldSkipMigrationGateCheck({ clearedForUserId: 1 }), true);
  });
});

describe('migration-gate store shell (real in-memory TinyBase store)', () => {
  it('reads null before anything is stamped', async () => {
    const store = createPrimaryStore();
    assert.equal(await getMigrationGateClearedFor({ store }), null);
  });

  it('round-trips a stamped userId', async () => {
    const store = createPrimaryStore();
    await setMigrationGateClearedFor(7, { store });
    assert.equal(await getMigrationGateClearedFor({ store }), 7);
  });

  it('a later stamp overwrites an earlier one', async () => {
    const store = createPrimaryStore();
    await setMigrationGateClearedFor(7, { store });
    await setMigrationGateClearedFor(9, { store });
    assert.equal(await getMigrationGateClearedFor({ store }), 9);
  });

  it('clearMigrationGateStamp removes the stamp', async () => {
    const store = createPrimaryStore();
    await setMigrationGateClearedFor(7, { store });
    await clearMigrationGateStamp({ store });
    assert.equal(await getMigrationGateClearedFor({ store }), null);
  });

  it('clearing an already-empty stamp is a harmless no-op', async () => {
    const store = createPrimaryStore();
    await clearMigrationGateStamp({ store });
    assert.equal(await getMigrationGateClearedFor({ store }), null);
  });

  // Clear-then-check is the sequence any future caller needs to be able to
  // rely on: after a clear, the gate is genuinely un-skipped again.
  it('a cleared stamp makes the next check un-skipped', async () => {
    const store = createPrimaryStore();
    await setMigrationGateClearedFor(1, { store });
    await clearMigrationGateStamp({ store });
    const clearedForUserId = await getMigrationGateClearedFor({ store });
    assert.equal(clearedForUserId, null);
    assert.equal(shouldSkipMigrationGateCheck({ clearedForUserId }), false);
  });
});
