/**
 * Unit tests for the header device menu's two pure helpers:
 *
 * - `deriveSyncMenuState` — which of several simultaneously-true sync facts
 *   the one-line menu row reports, and the AGENTS.md rule that an instance
 *   without a sync server must show NO sync UI at all.
 * - `relativeTimeParts` — which unit a gap gets told in, before any wording.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveSyncMenuState } from '../../app/lib/sync/sync-menu-state';
import type { SyncSessionSnapshot } from '../../app/lib/sync/sync-session';
import { formatRelativeTime, relativeTimeParts } from '../../app/lib/relative-time';

function session(overrides: Partial<SyncSessionSnapshot> = {}): SyncSessionSnapshot {
  return {
    account: { id: 1, handle: 'k7m2q3xr9t' },
    phase: 'idle',
    lastSyncedAt: null,
    hasPendingChanges: false,
    error: null,
    ...overrides,
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('deriveSyncMenuState', () => {
  it('hides sync entirely on an instance with no sync server — even with a live session', () => {
    // The AGENTS.md rule: unset SYNC_SERVER_URL means no sync UI anywhere. A
    // session can't exist in that case, but the gate must not depend on that.
    assert.deepEqual(deriveSyncMenuState({ hasSyncServer: false, session: session() }), { status: 'hidden' });
  });

  it('offers set-up when sync is available but this device has no account', () => {
    assert.deepEqual(deriveSyncMenuState({ hasSyncServer: true, session: session({ account: null }) }), {
      status: 'not-set-up',
    });
  });

  it('reports a completed cycle with its timestamp', () => {
    assert.deepEqual(
      deriveSyncMenuState({ hasSyncServer: true, session: session({ lastSyncedAt: 1_700_000_000_000 }) }),
      {
        status: 'synced',
        lastSyncedAt: 1_700_000_000_000,
      },
    );
  });

  it('distinguishes a connected device that has never completed a cycle', () => {
    assert.deepEqual(deriveSyncMenuState({ hasSyncServer: true, session: session({ lastSyncedAt: null }) }), {
      status: 'never-synced',
    });
  });

  it('reports pending changes rather than a stale "synced" time', () => {
    // "Synced 5 min ago" would be literally true and actively misleading while
    // this device holds edits the server has not seen.
    assert.deepEqual(
      deriveSyncMenuState({
        hasSyncServer: true,
        session: session({ lastSyncedAt: 1_700_000_000_000, hasPendingChanges: true }),
      }),
      { status: 'pending' },
    );
  });

  it('lets an error outrank every other state', () => {
    assert.deepEqual(
      deriveSyncMenuState({
        hasSyncServer: true,
        session: session({
          lastSyncedAt: 1_700_000_000_000,
          hasPendingChanges: true,
          phase: 'syncing',
          error: { reason: 'offline', message: 'network unreachable' },
        }),
      }),
      { status: 'error', reason: 'offline' },
    );
  });

  it('reports a running cycle ahead of pending changes', () => {
    assert.deepEqual(
      deriveSyncMenuState({ hasSyncServer: true, session: session({ phase: 'syncing', hasPendingChanges: true }) }),
      { status: 'syncing' },
    );
  });
});

describe('relativeTimeParts', () => {
  const now = 1_700_000_000_000;

  it('calls anything under a minute "now" rather than counting seconds', () => {
    // A seconds count in an open menu would tick visibly out of date without
    // ever mattering.
    assert.deepEqual(relativeTimeParts({ from: now - 30_000, now }), { value: 0, unit: 'second' });
  });

  it('picks the largest unit the gap clears', () => {
    assert.deepEqual(relativeTimeParts({ from: now - 5 * MINUTE_MS, now }), { value: -5, unit: 'minute' });
    assert.deepEqual(relativeTimeParts({ from: now - 3 * HOUR_MS, now }), { value: -3, unit: 'hour' });
    assert.deepEqual(relativeTimeParts({ from: now - DAY_MS, now }), { value: -1, unit: 'day' });
    assert.deepEqual(relativeTimeParts({ from: now - 10 * DAY_MS, now }), { value: -1, unit: 'week' });
    assert.deepEqual(relativeTimeParts({ from: now - 90 * DAY_MS, now }), { value: -3, unit: 'month' });
    assert.deepEqual(relativeTimeParts({ from: now - 400 * DAY_MS, now }), { value: -1, unit: 'year' });
  });

  it('treats a future timestamp as now — a disagreeing clock is not time travel', () => {
    assert.deepEqual(relativeTimeParts({ from: now + 3 * HOUR_MS, now }), { value: 0, unit: 'second' });
  });
});

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000;

  it('says "yesterday", not "1 day ago" — numeric: auto is what makes it read like language', () => {
    assert.equal(formatRelativeTime({ from: now - DAY_MS, now, locale: 'en' }), 'yesterday');
    assert.equal(formatRelativeTime({ from: now - DAY_MS, now, locale: 'de' }), 'gestern');
  });

  it('translates without a hand-written German table', () => {
    assert.match(formatRelativeTime({ from: now - 5 * MINUTE_MS, now, locale: 'de' }), /5/);
    assert.match(formatRelativeTime({ from: now - 5 * MINUTE_MS, now, locale: 'en' }), /5/);
  });
});
