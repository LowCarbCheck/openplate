/**
 * The push availability state machine (M223 spec 04).
 *
 * The page states the reason BEFORE it offers a switch, so this is the one
 * piece of push that has to be right on a device nobody here owns: an iPhone
 * in Safari, a browser on plain http, an instance with no VAPID key. All five
 * answers are decided by `pushAvailability`, which takes every fact as data,
 * so all five are checked here without a phone.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * Every case below is one field away from a READY environment, and `ready`
 * itself is asserted first. A machine that always answered `'unsupported'`,
 * which is the failure this ordering invites, fails that first test.
 *
 * ── The mutation that proves these can fail ──────────────────────────────
 *
 * Moving the `needs-install` line below the `permission === 'denied'` line in
 * `pushAvailability` leaves every test here green except the iPhone one, which
 * is why the iPhone case asserts both halves: not installed is
 * `needs-install`, installed is `ready`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pushAvailability } from '../../app/lib/push';
import type { PushEnvironment } from '../../app/lib/push';

/** A desktop browser on https, talking to an instance that sends push. Every case is one field off this. */
const READY: PushEnvironment = {
  secureContext: true,
  hasServiceWorker: true,
  hasPushManager: true,
  isIos: false,
  isStandalone: false,
  permission: 'default',
  instancePush: true,
};

/** READY with one fact changed, so every assertion below names exactly what it is about. */
function environmentWith(changed: Partial<PushEnvironment>): PushEnvironment {
  return { ...READY, ...changed };
}

describe('push availability', () => {
  it('the control: a supported browser on a push-sending instance is ready', () => {
    assert.equal(pushAvailability(READY), 'ready');
  });

  it('calls a browser with no service worker, no PushManager or no secure context unsupported', () => {
    assert.equal(pushAvailability(environmentWith({ hasServiceWorker: false })), 'unsupported');
    assert.equal(pushAvailability(environmentWith({ hasPushManager: false })), 'unsupported');
    assert.equal(pushAvailability(environmentWith({ secureContext: false })), 'unsupported');
  });

  it('unsupported beats everything else, including a refusal', () => {
    assert.equal(
      pushAvailability(
        environmentWith({ secureContext: false, permission: 'denied', instancePush: false, isIos: true }),
      ),
      'unsupported',
    );
  });

  it('sends an iPhone in Safari to the install step, and an installed iPhone to the switch', () => {
    assert.equal(pushAvailability(environmentWith({ isIos: true, isStandalone: false })), 'needs-install');
    // THE CONTROL for the line above: the only difference is the home screen.
    assert.equal(pushAvailability(environmentWith({ isIos: true, isStandalone: true })), 'ready');
  });

  it('a refusal beats the instance and the switch', () => {
    assert.equal(pushAvailability(environmentWith({ permission: 'denied' })), 'blocked');
    assert.equal(pushAvailability(environmentWith({ permission: 'denied', instancePush: false })), 'blocked');
  });

  it('a granted permission is not a state of its own: it just leaves the switch', () => {
    assert.equal(pushAvailability(environmentWith({ permission: 'granted' })), 'ready');
  });

  it('an instance that sends nothing says so, last of the four reasons', () => {
    assert.equal(pushAvailability(environmentWith({ instancePush: false })), 'server-off');
  });

  it('reads a non-installed iPhone as needing the install even when the instance is off', () => {
    // The ORDER is the claim: the install step is more fundamental than the
    // instance, because on iOS nothing at all arrives without it.
    assert.equal(
      pushAvailability(environmentWith({ isIos: true, isStandalone: false, instancePush: false })),
      'needs-install',
    );
  });
});
