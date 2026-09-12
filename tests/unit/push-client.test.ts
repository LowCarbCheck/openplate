/**
 * The push client's four calls (M223 spec 04).
 *
 * The server stores what it is sent, so the subscribe body is a CONTRACT and
 * is pinned field by field here rather than by serialising a subscription
 * whole. The delete is the control: turning the switch off has to send the
 * endpoint away and forget it, and a client that only ever registered would
 * pass every assertion about registering.
 *
 * ── Why a fake record and not a mocked module ────────────────────────────
 *
 * `tools/oxlint/anti-slop` forbids module mocking, and this is the better
 * seam anyway: `setPushDependencies` swaps the transport, the permission, the
 * subscribe call and the storage, so the strongest assertions below are about
 * a fetch that was NEVER called.
 *
 * ── The mutations that prove these can fail ──────────────────────────────
 *
 * Dropping the `previousEndpoint === endpoint` guard in `subscribeBody` fails
 * the re-registration case. Deleting the `fastTargetEnabled` guard in
 * `setFastWakeAt` fails the "kind off" case, which is the one that keeps a
 * screen nobody was on from arming a notification.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PUSH_PREFS,
  disablePush,
  enablePush,
  isPushDisabledByUser,
  PUSH_DISABLED_STORAGE_KEY,
  PUSH_ENDPOINT_STORAGE_KEY,
  PUSH_PREFS_STORAGE_KEY,
  fastWakeAtIso,
  resetPush,
  setFastWakeAt,
  setPushDependencies,
  subscribeBody,
  updatePushSchedule,
} from '../../app/lib/push';
import type { PushStorage } from '../../app/lib/push';

//////////////////////////////////////////////////////////////////////////////
// The fakes
//////////////////////////////////////////////////////////////////////////////

/** One JSON body as the fake transport reads it back: the scalars and nested records this client sends. */
interface RecordedBody {
  [field: string]: string | number | boolean | null | RecordedBody;
}

/** One request the client made, reduced to what a contract test can assert. */
interface RecordedCall {
  url: string;
  method: string;
  authorization: string | null;
  body: RecordedBody | null;
}

/** A storage a test can read back, standing in for `localStorage`. */
function fakeStorage(seed: Record<string, string> = {}): PushStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    entries,
    read: (key) => entries.get(key) ?? null,
    write: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}

/** The browser's own subscription shape, as `toJSON()` hands it over. */
const SUBSCRIPTION: PushSubscriptionJSON = {
  endpoint: 'https://push.example.test/aaa',
  keys: { p256dh: 'public-key-bytes', auth: 'auth-secret' },
};

/** A whole device: a recorded transport, a granted permission and a readable store. */
function installDevice({
  storage = fakeStorage(),
  permission = 'granted',
  configStatus = 200,
}: {
  storage?: PushStorage & { entries: Map<string, string> };
  permission?: NotificationPermission;
  configStatus?: number;
} = {}) {
  const calls: RecordedCall[] = [];
  let unsubscribed = false;

  setPushDependencies({
    storage,
    readAccount: () => ({ serverUrl: 'https://sync.example.test', accessToken: 'token-abc' }),
    readPermission: () => permission,
    requestPermission: async () => 'granted',
    subscribeToPush: async () => SUBSCRIPTION,
    unsubscribeFromPush: async () => {
      unsubscribed = true;
    },
    readTimeZone: () => 'Europe/Berlin',
    readLocale: () => 'de',
    fetchImpl: async (input, init) => {
      const url = String(input);
      const rawBody = init?.body;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('Authorization'),
        // SAFETY: every body this module sends is `JSON.stringify` of a record
        // it built itself; the fake never receives a stream or a FormData.
        body: rawBody === undefined ? null : (JSON.parse(String(rawBody)) as RecordedBody),
      });
      if (url.endsWith('/v1/push/config')) {
        return new Response(JSON.stringify({ publicKey: 'BPublicKeyBytes' }), { status: configStatus });
      }
      return new Response(null, { status: 204 });
    },
  });

  return { calls, storage, wasUnsubscribed: () => unsubscribed };
}

afterEach(() => {
  resetPush();
});

//////////////////////////////////////////////////////////////////////////////
// The body
//////////////////////////////////////////////////////////////////////////////

describe('the subscribe body', () => {
  const context = { timeZone: 'Europe/Berlin', locale: 'de', catchUpMinute: 480, fastTargetEnabled: true };

  it('carries the endpoint, the two keys, the zone, the language and both kinds', () => {
    assert.deepEqual(subscribeBody(SUBSCRIPTION, null, context), {
      endpoint: 'https://push.example.test/aaa',
      keys: { p256dh: 'public-key-bytes', auth: 'auth-secret' },
      timeZone: 'Europe/Berlin',
      locale: 'de',
      catchUpMinute: 480,
      fastTargetEnabled: true,
    });
  });

  it('mints no identifier of its own: the endpoint is the name', () => {
    const body = subscribeBody(SUBSCRIPTION, null, context);
    const keys = Object.keys(body);
    assert.equal(
      keys.some((key) => /id$|uuid|token/i.test(key)),
      false,
      keys.join(','),
    );
  });

  it('names the endpoint it supersedes when this device held a different one', () => {
    const body = subscribeBody(SUBSCRIPTION, 'https://push.example.test/older', context);
    assert.equal(body.replaces, 'https://push.example.test/older');
  });

  it('the control: re-registering the same endpoint supersedes nothing', () => {
    assert.equal('replaces' in subscribeBody(SUBSCRIPTION, SUBSCRIPTION.endpoint ?? null, context), false);
    assert.equal('replaces' in subscribeBody(SUBSCRIPTION, null, context), false);
  });

  it('carries a null minute when the daily catch-up is unticked', () => {
    const body = subscribeBody(SUBSCRIPTION, null, { ...context, catchUpMinute: null });
    assert.equal(body.catchUpMinute, null);
  });
});

//////////////////////////////////////////////////////////////////////////////
// Turning it on and off
//////////////////////////////////////////////////////////////////////////////

describe('turning push on', () => {
  it('reads the key, then PUTs the subscription with the default kinds', async () => {
    const device = installDevice();

    await enablePush(DEFAULT_PUSH_PREFS);

    assert.deepEqual(
      device.calls.map((call) => `${call.method} ${call.url}`),
      [
        'GET https://sync.example.test/v1/push/config',
        'PUT https://sync.example.test/v1/push/subscriptions',
      ],
    );
    const put = device.calls[1];
    assert.equal(put?.authorization, 'Bearer token-abc');
    assert.deepEqual(put?.body, {
      endpoint: 'https://push.example.test/aaa',
      keys: { p256dh: 'public-key-bytes', auth: 'auth-secret' },
      timeZone: 'Europe/Berlin',
      locale: 'de',
      catchUpMinute: 480,
      fastTargetEnabled: true,
    });
  });

  it('remembers the endpoint and the kinds, and clears the earlier refusal', async () => {
    const device = installDevice({ storage: fakeStorage({ [PUSH_DISABLED_STORAGE_KEY]: '1' }) });

    await enablePush(DEFAULT_PUSH_PREFS);

    assert.equal(device.storage.entries.get(PUSH_ENDPOINT_STORAGE_KEY), 'https://push.example.test/aaa');
    assert.equal(isPushDisabledByUser(), false);
    assert.deepEqual(JSON.parse(device.storage.entries.get(PUSH_PREFS_STORAGE_KEY) ?? 'null'), DEFAULT_PUSH_PREFS);
  });

  it('supersedes the endpoint this device registered last time', async () => {
    const device = installDevice({
      storage: fakeStorage({ [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/older' }),
    });

    await enablePush(DEFAULT_PUSH_PREFS);

    assert.equal(device.calls[1]?.body?.replaces, 'https://push.example.test/older');
  });

  it('gives up before the permission prompt on an instance with no key', async () => {
    const device = installDevice({ configStatus: 404, permission: 'default' });

    await assert.rejects(() => enablePush(DEFAULT_PUSH_PREFS), /server-off/);

    assert.deepEqual(
      device.calls.map((call) => call.method),
      ['GET'],
    );
  });
});

describe('turning push off', () => {
  it('deletes the remembered endpoint, drops the browser subscription and remembers the answer', async () => {
    const device = installDevice({
      storage: fakeStorage({ [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/aaa' }),
    });

    await disablePush();

    assert.deepEqual(
      device.calls.map((call) => `${call.method} ${call.url}`),
      ['DELETE https://sync.example.test/v1/push/subscriptions'],
    );
    assert.deepEqual(device.calls[0]?.body, { endpoint: 'https://push.example.test/aaa' });
    assert.equal(device.storage.entries.has(PUSH_ENDPOINT_STORAGE_KEY), false);
    assert.equal(isPushDisabledByUser(), true);
    assert.equal(device.wasUnsubscribed(), true);
  });

  it('still remembers the answer on a device that never registered, and calls nothing', async () => {
    const device = installDevice();

    await disablePush();

    assert.deepEqual(device.calls, []);
    assert.equal(isPushDisabledByUser(), true);
  });
});

//////////////////////////////////////////////////////////////////////////////
// Changing what arrives
//////////////////////////////////////////////////////////////////////////////

describe('changing the schedule', () => {
  it('PATCHes the endpoint with the new minute rather than re-subscribing', async () => {
    const device = installDevice({
      storage: fakeStorage({ [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/aaa' }),
    });

    await updatePushSchedule({ catchUpMinute: 390, fastTargetEnabled: false });

    assert.deepEqual(
      device.calls.map((call) => call.method),
      ['PATCH'],
    );
    assert.deepEqual(device.calls[0]?.body, {
      endpoint: 'https://push.example.test/aaa',
      timeZone: 'Europe/Berlin',
      locale: 'de',
      catchUpMinute: 390,
      fastTargetEnabled: false,
    });
  });
});

//////////////////////////////////////////////////////////////////////////////
// The fast target one shot
//////////////////////////////////////////////////////////////////////////////

describe('the fast wake instant', () => {
  it('is the start plus the target, as ISO', () => {
    const startedAt = Date.UTC(2026, 8, 12, 20, 0, 0);
    assert.equal(
      fastWakeAtIso({ startedAt, plannedStartAt: null, targetDurationMs: 16 * 3600_000, endedAt: null }),
      '2026-09-13T12:00:00.000Z',
    );
  });

  it('falls back to the planned start for a fast that has not begun', () => {
    const plannedStartAt = Date.UTC(2026, 8, 12, 20, 0, 0);
    assert.equal(
      fastWakeAtIso({ startedAt: null, plannedStartAt, targetDurationMs: 3600_000, endedAt: null }),
      '2026-09-12T21:00:00.000Z',
    );
  });

  it('is null for an ended fast and for no fast at all', () => {
    assert.equal(fastWakeAtIso(null), null);
    assert.equal(
      fastWakeAtIso({ startedAt: 1, plannedStartAt: null, targetDurationMs: 10, endedAt: 2 }),
      null,
    );
  });

  it('PATCHes only the wake instant, leaving every other field alone', async () => {
    const device = installDevice({
      storage: fakeStorage({
        [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/aaa',
        [PUSH_PREFS_STORAGE_KEY]: JSON.stringify(DEFAULT_PUSH_PREFS),
      }),
    });

    await setFastWakeAt('2026-09-13T12:00:00.000Z');

    assert.deepEqual(device.calls[0]?.body, {
      endpoint: 'https://push.example.test/aaa',
      wakeAt: '2026-09-13T12:00:00.000Z',
    });
  });

  it('clears the one shot with an explicit null when no fast is open', async () => {
    const device = installDevice({
      storage: fakeStorage({
        [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/aaa',
        [PUSH_PREFS_STORAGE_KEY]: JSON.stringify(DEFAULT_PUSH_PREFS),
      }),
    });

    await setFastWakeAt(null);

    assert.deepEqual(device.calls[0]?.body, { endpoint: 'https://push.example.test/aaa', wakeAt: null });
  });

  it('THE CONTROL: sends nothing at all when the fast target kind is off', async () => {
    const device = installDevice({
      storage: fakeStorage({
        [PUSH_ENDPOINT_STORAGE_KEY]: 'https://push.example.test/aaa',
        [PUSH_PREFS_STORAGE_KEY]: JSON.stringify({ catchUpMinute: 480, fastTargetEnabled: false }),
      }),
    });

    await setFastWakeAt('2026-09-13T12:00:00.000Z');

    assert.deepEqual(device.calls, []);
  });

  it('sends nothing on a device that never registered', async () => {
    const device = installDevice();

    await setFastWakeAt('2026-09-13T12:00:00.000Z');

    assert.deepEqual(device.calls, []);
  });
});
