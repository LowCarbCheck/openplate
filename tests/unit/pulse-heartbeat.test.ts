/**
 * The heartbeat's decision, without a timer.
 *
 * `heartbeatDue` is pure so the three rules can be pinned in milliseconds
 * rather than by sitting through a quarter of an hour: a visible, running fast
 * beats now and then every fifteen minutes, a hidden tab never beats, and a
 * SCHEDULED fast never beats because a plan is not a fast.
 *
 * The visible-and-active case is the control. A function that returned false
 * unconditionally would satisfy every "never sends" assertion here, and the
 * first two tests are what stop it.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PULSE_HEARTBEAT_MS,
  heartbeatDue,
  reportFastingHeartbeat,
  resetPulse,
  setPulseDependencies,
} from '../../app/lib/pulse';

const NOW = 1_700_000_000_000;

describe('heartbeatDue', () => {
  it('fires immediately when a fast becomes active on a visible tab', () => {
    assert.equal(heartbeatDue({ status: 'active', visible: true, lastSentMs: null, nowMs: NOW }), true);
  });

  it('fires again a quarter of an hour later, and not before', () => {
    const lastSentMs = NOW;
    assert.equal(
      heartbeatDue({ status: 'active', visible: true, lastSentMs, nowMs: NOW + PULSE_HEARTBEAT_MS - 1 }),
      false,
    );
    assert.equal(heartbeatDue({ status: 'active', visible: true, lastSentMs, nowMs: NOW + PULSE_HEARTBEAT_MS }), true);
  });

  it('never fires while the document is hidden', () => {
    assert.equal(heartbeatDue({ status: 'active', visible: false, lastSentMs: null, nowMs: NOW }), false);
    assert.equal(
      heartbeatDue({ status: 'active', visible: false, lastSentMs: NOW, nowMs: NOW + PULSE_HEARTBEAT_MS * 10 }),
      false,
    );
  });

  it('never fires for a scheduled fast, or for no fast at all', () => {
    assert.equal(heartbeatDue({ status: 'scheduled', visible: true, lastSentMs: null, nowMs: NOW }), false);
    assert.equal(heartbeatDue({ status: 'none', visible: true, lastSentMs: null, nowMs: NOW }), false);
  });

  it('stops when the fast ends', () => {
    for (const status of ['completed', 'ended-early', 'cancelled'] as const) {
      assert.equal(heartbeatDue({ status, visible: true, lastSentMs: NOW, nowMs: NOW + PULSE_HEARTBEAT_MS }), false);
    }
  });
});

describe('the heartbeat send', () => {
  beforeEach(() => resetPulse());
  afterEach(() => resetPulse());

  it('posts to the fasting path when the door is open', async () => {
    const urls: string[] = [];
    setPulseDependencies({
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response('{}', { status: 202 });
      },
      readEnabled: () => true,
      readAccount: () => ({ serverUrl: 'https://sync.example', accessToken: null }),
    });

    await reportFastingHeartbeat();

    assert.deepEqual(urls, ['https://sync.example/v1/pulse/fasting']);
  });
});
