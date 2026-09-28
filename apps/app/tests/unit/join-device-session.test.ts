/**
 * `#app/lib/join-device-session`: what `/join` does about the session this
 * device already holds (2026-09-27 install rehearsal).
 *
 * The rule under test: a saved value never blocks a new invitation unless it
 * is a live session for somebody else on this app's own server. Each verdict
 * has its neighbour beside it, so a change that collapsed two of them fails.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { judgeDeviceSession } from '../../app/lib/join-device-session';

const APP_SERVER = 'https://sync.example';
const INVITED = 'new@example.com';

describe('judgeDeviceSession', () => {
  it('lets the invitation through when the device holds no session', () => {
    assert.deepEqual(judgeDeviceSession({ session: null, configuredSyncUrl: APP_SERVER, invitedEmail: INVITED }), {
      kind: 'none',
    });
  });

  it('calls a session saved for another server stale, whoever it belongs to', () => {
    for (const email of ['someone@example.com', INVITED]) {
      assert.deepEqual(
        judgeDeviceSession({
          session: { email, serverUrl: 'http://localhost:3001' },
          configuredSyncUrl: APP_SERVER,
          invitedEmail: INVITED,
        }),
        { kind: 'stale' },
      );
    }
  });

  it('compares the server as the resume does, exactly, so a trailing slash is another server', () => {
    assert.deepEqual(
      judgeDeviceSession({
        session: { email: 'someone@example.com', serverUrl: `${APP_SERVER}/` },
        configuredSyncUrl: APP_SERVER,
        invitedEmail: INVITED,
      }),
      { kind: 'stale' },
    );
  });

  it('names who is signed in when it is somebody else on this server', () => {
    assert.deepEqual(
      judgeDeviceSession({
        session: { email: 'someone@example.com', serverUrl: APP_SERVER },
        configuredSyncUrl: APP_SERVER,
        invitedEmail: INVITED,
      }),
      { kind: 'other-account', signedInAs: 'someone@example.com' },
    );
  });

  it('lets the invited address through, in any case and with stray spaces', () => {
    assert.deepEqual(
      judgeDeviceSession({
        session: { email: ' New@Example.COM ', serverUrl: APP_SERVER },
        configuredSyncUrl: APP_SERVER,
        invitedEmail: INVITED,
      }),
      { kind: 'same-account' },
    );
  });
});
