/**
 * Guards the D9 privacy invariant on the sync telemetry allowlist: these are
 * event NAMES only, and they must stay content-free.
 *
 * Ported from the deleted `sync-hook-noop.test.ts` (M128 spec 01 removed the
 * composition-seam probe that file existed to test, but the telemetry
 * assertion it also carried is still load-bearing — a dimension or value
 * quietly attached to one of these events re-enters legal review scope).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_TELEMETRY_EVENTS } from '../../app/lib/sync/telemetry';

test('SYNC_TELEMETRY_EVENTS is a non-empty, content-free event-name allowlist', () => {
  assert.ok(SYNC_TELEMETRY_EVENTS.length > 0);
  for (const eventName of SYNC_TELEMETRY_EVENTS) {
    assert.match(eventName, /^[a-z][a-z0-9_]*$/);
  }
});

test('the allowlist has no duplicate entries', () => {
  assert.equal(new Set(SYNC_TELEMETRY_EVENTS).size, SYNC_TELEMETRY_EVENTS.length);
});
