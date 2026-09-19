/**
 * Unit tests for `#app/lib/sync/sign-out-flow`: the order a sign-out happens
 * in, and what it does when a step fails.
 *
 * The four steps are injected, so every claim the module's header makes is an
 * assertion here rather than a paragraph: the network is best effort, the lock
 * lands before the erase, the erase is opt-in and never silently defaulted,
 * and a failed erase is reported instead of resolved.
 *
 * What the dialog SAYS about an erase before anybody agrees to one is
 * `erase-notice.test.ts`'s.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runSignOut, type SignOutSteps } from '../../app/lib/sync/sign-out-flow';

interface Recorder {
  steps: SignOutSteps;
  calls: string[];
}

function recordingSteps({
  revokeFails = false,
  eraseFails = false,
}: { revokeFails?: boolean; eraseFails?: boolean } = {}): Recorder {
  const calls: string[] = [];
  return {
    calls,
    steps: {
      revokeAndCloseSession: async () => {
        calls.push('revoke');
        if (revokeFails) throw new Error('Failed to fetch');
      },
      lockDevice: () => void calls.push('lock'),
      eraseDevice: async () => {
        calls.push('erase');
        if (eraseFails) throw new Error('openplate-primary is open in another tab');
      },
      leaveTheApp: () => void calls.push('leave'),
    },
  };
}

describe('runSignOut', () => {
  it('sign out keeps the diary when erase was not chosen, which is the default', async () => {
    const recorder = recordingSteps();
    await runSignOut({ eraseDevice: false, locksDevice: true }, recorder.steps);

    assert.ok(!recorder.calls.includes('erase'), 'nothing is destroyed unless the person asked');
    assert.deepEqual(recorder.calls, ['revoke', 'lock', 'leave']);
  });

  it('erases only when asked, and locks before it does', async () => {
    const recorder = recordingSteps();
    await runSignOut({ eraseDevice: true, locksDevice: true }, recorder.steps);

    assert.deepEqual(recorder.calls, ['revoke', 'lock', 'erase', 'leave']);
    assert.ok(
      recorder.calls.indexOf('lock') < recorder.calls.indexOf('erase'),
      'a failed erase must still leave a device whose diary is closed',
    );
  });

  it('does not lock an open instance, where signing out of sync takes nothing away', async () => {
    const recorder = recordingSteps();
    await runSignOut({ eraseDevice: false, locksDevice: false }, recorder.steps);

    assert.deepEqual(recorder.calls, ['revoke', 'leave']);
  });

  it('completes an offline sign out with the server unreachable', async () => {
    // The whole point: a device with no connection still has to be able to
    // hand itself back. The token family expires on its own.
    const recorder = recordingSteps({ revokeFails: true });
    await runSignOut({ eraseDevice: true, locksDevice: true }, recorder.steps);

    assert.deepEqual(recorder.calls, ['revoke', 'lock', 'erase', 'leave']);
  });

  it('reports a failed erase instead of leaving the app as though it worked', async () => {
    const recorder = recordingSteps({ eraseFails: true });

    await assert.rejects(() => runSignOut({ eraseDevice: true, locksDevice: true }, recorder.steps), /another tab/);

    assert.ok(recorder.calls.includes('lock'), 'the device is closed even though the erase failed');
    assert.ok(!recorder.calls.includes('leave'), 'the person stays on the dialog that can tell them why');
  });
});
