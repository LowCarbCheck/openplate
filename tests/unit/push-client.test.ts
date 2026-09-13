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
 * screen nobody was on from arming a notification. Collapsing `dismissed`
 * back into `blocked` fails the answer cases, and awaiting the key before the
 * prompt leaves the ordering case waiting for a prompt that never comes.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PUSH_PREFS,
  decodePublicKey,
  disablePush,
  enablePush,
  isPushDisabledByUser,
  isSubscriptionForKey,
  PUSH_DISABLED_STORAGE_KEY,
  PUSH_ENDPOINT_STORAGE_KEY,
  PUSH_PREFS_STORAGE_KEY,
  PushSetupError,
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
  answer = 'granted',
  configStatus = 200,
  putStatus = 204,
}: {
  storage?: PushStorage & { entries: Map<string, string> };
  permission?: NotificationPermission;
  /** What the prompt resolves with, for the three answers a browser can give. */
  answer?: NotificationPermission;
  configStatus?: number;
  putStatus?: number;
} = {}) {
  const calls: RecordedCall[] = [];
  let unsubscribed = false;

  setPushDependencies({
    storage,
    readAccount: () => ({ serverUrl: 'https://sync.example.test', accessToken: 'token-abc' }),
    readPermission: () => permission,
    requestPermission: async () => answer,
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
      if (init?.method === 'PUT') return new Response(null, { status: putStatus });
      return new Response(null, { status: 204 });
    },
  });

  return { calls, storage, wasUnsubscribed: () => unsubscribed };
}

afterEach(() => {
  resetPush();
});

/**
 * Why an attempt gave up, as a plain string a test can compare.
 *
 * The refusal is read in a `catch` rather than in an `assert.rejects`
 * predicate, so nothing here takes an unparsed parameter. The two sentinels
 * make the negative cases readable: a failure that is not a
 * {@link PushSetupError} and an attempt that did not fail at all are both
 * reported rather than passing quietly.
 *
 * @param run - the attempt.
 * @returns the reason, `'other-error'`, or `'no-error'`.
 */
async function reasonOf(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (caught) {
    return caught instanceof PushSetupError ? caught.reason : 'other-error';
  }
  return 'no-error';
}

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

//////////////////////////////////////////////////////////////////////////////
// What the three permission answers mean
//////////////////////////////////////////////////////////////////////////////

describe('the answer to the prompt', () => {
  it('a closed question is `dismissed`, because asking again is allowed', async () => {
    installDevice({ permission: 'default', answer: 'default' });

    assert.equal(await reasonOf(() => enablePush(DEFAULT_PUSH_PREFS)), 'dismissed');
  });

  it('THE CONTROL: an actual refusal is `blocked`, which a person undoes in browser settings', async () => {
    installDevice({ permission: 'default', answer: 'denied' });

    assert.equal(await reasonOf(() => enablePush(DEFAULT_PUSH_PREFS)), 'blocked');
  });

  it('a granted question registers, so neither reason above is the only outcome', async () => {
    const device = installDevice({ permission: 'default', answer: 'granted' });

    await enablePush(DEFAULT_PUSH_PREFS);

    assert.deepEqual(
      device.calls.map((call) => call.method),
      ['GET', 'PUT'],
    );
  });
});

//////////////////////////////////////////////////////////////////////////////
// The prompt is inside the click
//////////////////////////////////////////////////////////////////////////////

/** How long the prompt is waited for before the ordering case gives up and says so. */
const PROMPT_DEADLINE_MS = 2000;

/**
 * A promise the test releases by hand.
 *
 * The resolver is held on a record rather than in a bare `let`, because the
 * assignment happens inside the executor and the compiler cannot see it.
 */
interface Gate {
  release: (() => void) | null;
}

describe('the order of the prompt and the key', () => {
  it('asks while the config fetch is still in flight, so the activation is not spent on a network read', async () => {
    const order: string[] = [];
    // Held in records rather than in bare `let`s: the assignment happens inside
    // the executor, which the compiler cannot see, so a plain binding would
    // still read as `null` at the call sites below.
    const configGate: Gate = { release: null };
    const configArrived = new Promise<void>((resolve) => {
      configGate.release = resolve;
    });
    const promptGate: Gate = { release: null };
    const prompted = new Promise<void>((resolve) => {
      promptGate.release = resolve;
    });
    let isConfigPending = false;
    let wasConfigPendingAtPrompt: boolean | null = null;

    setPushDependencies({
      storage: fakeStorage(),
      readAccount: () => ({ serverUrl: 'https://sync.example.test', accessToken: 'token-abc' }),
      readPermission: () => 'default',
      requestPermission: async () => {
        wasConfigPendingAtPrompt = isConfigPending;
        order.push('prompt');
        promptGate.release?.();
        return 'granted';
      },
      subscribeToPush: async () => SUBSCRIPTION,
      unsubscribeFromPush: async () => undefined,
      readTimeZone: () => 'Europe/Berlin',
      readLocale: () => 'de',
      fetchImpl: async (input, init) => {
        const url = String(input);
        order.push(`${init?.method ?? 'GET'} ${url}`);
        if (!url.endsWith('/v1/push/config')) return new Response(null, { status: 204 });
        isConfigPending = true;
        await configArrived;
        isConfigPending = false;
        return new Response(JSON.stringify({ publicKey: 'BPublicKeyBytes' }), { status: 200 });
      },
    });

    const pending = enablePush(DEFAULT_PUSH_PREFS);
    // Bounded, so a client that awaits the key first FAILS here with a
    // sentence instead of waiting for a prompt that is never reached.
    let deadline: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      prompted,
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () => reject(new Error('the prompt was never asked while the key was still in flight')),
          PROMPT_DEADLINE_MS,
        );
      }),
    ]);
    clearTimeout(deadline);

    assert.equal(wasConfigPendingAtPrompt, true);
    assert.deepEqual(order, ['GET https://sync.example.test/v1/push/config', 'prompt']);

    // THE CONTROL: the key is still read and still needed. Releasing it sends
    // the PUT, so the prompt was moved ahead of the fetch rather than the
    // fetch being dropped.
    configGate.release?.();
    await pending;
    assert.deepEqual(order, [
      'GET https://sync.example.test/v1/push/config',
      'prompt',
      'PUT https://sync.example.test/v1/push/subscriptions',
    ]);
  });
});

//////////////////////////////////////////////////////////////////////////////
// A refusal about who is asking
//////////////////////////////////////////////////////////////////////////////

describe('an ended session', () => {
  it('reads a 401 on the config as `signed-out`, not as an instance with push off', async () => {
    installDevice({ configStatus: 401 });

    assert.equal(await reasonOf(() => enablePush(DEFAULT_PUSH_PREFS)), 'signed-out');
  });

  it('THE CONTROL: a 500 on the config is still `server-off`', async () => {
    installDevice({ configStatus: 500 });

    assert.equal(await reasonOf(() => enablePush(DEFAULT_PUSH_PREFS)), 'server-off');
  });

  it('THE OTHER CONTROL: a 403 is `server-off` too, because signing in again changes nothing', async () => {
    installDevice({ configStatus: 403 });

    assert.equal(await reasonOf(() => enablePush(DEFAULT_PUSH_PREFS)), 'server-off');
  });

  it('reads a 401 on the registration as `signed-out` too', async () => {
    installDevice({ putStatus: 401 });

    assert.equal(await reasonOf(() => enablePush(DEFAULT_PUSH_PREFS)), 'signed-out');
  });

  it('THE CONTROL: a 500 on the registration is a plain failure, not a reason with a sentence', async () => {
    installDevice({ putStatus: 500 });

    assert.equal(await reasonOf(() => enablePush(DEFAULT_PUSH_PREFS)), 'other-error');
  });

  it('THE OTHER CONTROL: a 403 on the registration is a plain failure too, not an ended session', async () => {
    installDevice({ putStatus: 403 });

    assert.equal(await reasonOf(() => enablePush(DEFAULT_PUSH_PREFS)), 'other-error');
  });
});

//////////////////////////////////////////////////////////////////////////////
// A subscription left over from another key
//////////////////////////////////////////////////////////////////////////////

describe('matching a browser subscription against the instance key', () => {
  it('says yes to the same bytes', () => {
    const bytes = decodePublicKey('BPublicKeyBytes');
    assert.equal(isSubscriptionForKey(bytes.buffer, 'BPublicKeyBytes'), true);
  });

  it('THE CONTROL: says no to another instance\'s key, which would receive nothing', () => {
    const bytes = decodePublicKey('BAnotherKeyEntirely');
    assert.equal(isSubscriptionForKey(bytes.buffer, 'BPublicKeyBytes'), false);
  });

  it('says no when the browser holds no key at all', () => {
    assert.equal(isSubscriptionForKey(null, 'BPublicKeyBytes'), false);
  });
});
