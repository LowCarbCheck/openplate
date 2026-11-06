/**
 * The reminder emails, on the client side of the wire (2026-11).
 *
 * Four things are pinned here, and each has a CONTROL that makes its assertion
 * able to fail:
 *
 * 1. The handshake and the account read `false` for everything but a real
 *    `true`, so an older core never draws a box or a switch.
 * 2. The settings switch is drawn for an account that already has the
 *    reminders on, even when the instance has switched the feature off, so a
 *    person can always withdraw.
 * 3. The signup body carries `activityMail` and `language` ONLY where the
 *    instance offers the feature, and `true` only for a ticked box.
 * 4. The admin client sends only the key it was given, reads an older core's
 *    `404` as "no section", and reads the test's `429` as a value.
 */
import { describe, it } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';

import { AdminClient, type AdminTransport } from '../../app/lib/admin/admin-client';
import {
  ACTIVITY_MAIL_DAY_BOUNDS,
  ACTIVITY_MAIL_TEST_KIND,
  activityMailStatsSchema,
  instanceSettingsResponseSchema,
} from '../../app/lib/admin/admin-wire';
import {
  parseActivityMailDays,
  readActivityMailDrafts,
  type ActivityMailKindDraft,
} from '../../app/lib/admin/settings-schema';
import { decodeActivityMail, isActivityMailControlShown } from '../../app/lib/sync/activity-mail';
import { SyncAuthClient, type AuthorizedMethod } from '../../app/lib/sync/engine/client/auth-client';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import { readHandshakeInstance, type JsonValue } from '../../app/lib/sync/engine/protocol';

const BASE = { protocolVersion: 2, envelopeVersion: 1, serviceVersion: '0.40.0' };
const INSTANCE = { name: 'openplate', language: 'en', mail: true, ai: null };

describe('instance.activityMail on /health', () => {
  it('reads true as an instance that sends reminders', () => {
    const offering = { ...BASE, instance: { ...INSTANCE, activityMail: true } };
    assert.equal(readHandshakeInstance(offering)?.activityMail, true);
  });

  it('reads false, and a missing key, as no reminders', () => {
    assert.equal(
      readHandshakeInstance({ ...BASE, instance: { ...INSTANCE, activityMail: false } })?.activityMail,
      false,
    );
    assert.equal(readHandshakeInstance({ ...BASE, instance: INSTANCE })?.activityMail, false, 'an older core');
  });

  it('drops a nonsense value without failing the descriptor', () => {
    for (const activityMail of ['yes', 1, null, {}]) {
      const broken = { ...BASE, instance: { ...INSTANCE, ai: { model: 'x' }, activityMail } };
      assert.equal(readHandshakeInstance(broken)?.activityMail, false, JSON.stringify(activityMail));
      assert.deepEqual(readHandshakeInstance(broken)?.ai, { model: 'x' });
    }
  });
});

describe('the account answer', () => {
  it('is on only for a real true', () => {
    assert.equal(decodeActivityMail(true), true);
    assert.equal(decodeActivityMail(false), false);
    assert.equal(decodeActivityMail(undefined), false, 'an older core');
    assert.equal(decodeActivityMail(null), false);
  });
});

describe('when the settings switch is drawn', () => {
  const cases: ReadonlyArray<{
    hasAccount: boolean;
    instanceOffers: boolean;
    accountOptedIn: boolean;
    shown: boolean;
  }> = [
    { hasAccount: true, instanceOffers: true, accountOptedIn: false, shown: true },
    { hasAccount: true, instanceOffers: false, accountOptedIn: true, shown: true },
    { hasAccount: true, instanceOffers: true, accountOptedIn: true, shown: true },
    // THE CONTROL: neither says yes, and nothing is drawn.
    { hasAccount: true, instanceOffers: false, accountOptedIn: false, shown: false },
    { hasAccount: false, instanceOffers: true, accountOptedIn: false, shown: false },
  ];
  for (const { shown, ...input } of cases) {
    it(`${JSON.stringify(input)} is ${shown ? 'shown' : 'hidden'}`, () => {
      assert.equal(isActivityMailControlShown(input), shown);
    });
  }
});

const SALT = 'AQIDBAUGBwgJCgsMDQ4PEA==';
const KDF = { salt: SALT, params: { memorySizeKib: 8, iterations: 1, parallelism: 1 } };

/** The two reminder keys of a request body, and whether each was there at all. */
const reminderBodySchema = z.looseObject({ activityMail: z.boolean().optional(), language: z.string().optional() });

/** One request the recording fetch saw. `body` is `null` for a request with none. */
interface RecordedCall {
  url: string;
  method: string;
  body: z.infer<typeof reminderBodySchema> | null;
}

/** A fetch that records every request and answers a signup, or an account PATCH, with an account. */
function recordingFetch() {
  const calls: RecordedCall[] = [];
  const account = {
    id: 1,
    email: 'anna@example.org',
    displayName: null,
    role: 'member',
    dailyAiLimit: 0,
    aiUsedToday: 0,
    allowanceExpiresAt: null,
    suspendedAt: null,
    invitesLeft: 5,
    createdAt: '2026-11-01T10:00:00.000Z',
  };
  const tokens = {
    accessToken: 'a1',
    accessTokenExpiresAt: '2026-11-01T10:15:00.000Z',
    refreshToken: 'r1',
    refreshTokenExpiresAt: '2026-12-01T10:00:00.000Z',
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const raw = init?.body;
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: raw === undefined || raw === null ? null : reminderBodySchema.parse(JSON.parse(String(raw))),
    });
    const answer =
      String(input).endsWith('/signup') ? { account, tokens } : { account: { ...account, activityMail: true } };
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

async function signup(input: {
  fetchImpl: typeof fetch;
  activityMail?: { isOptedIn: boolean; language: 'en' | 'de' } | null;
}): Promise<void> {
  const client = new SyncAuthClient({ baseUrl: 'https://core.example', fetchImpl: input.fetchImpl });
  await client.signup({
    inviteToken: 'si_TESTTOKENONLY',
    authHash: 'AAAA',
    kdfDescriptor: KDF,
    recoveryAuthHash: 'BBBB',
    recoveryCode: 'ABCDE-FGHJK',
    keyRecords: [],
    healthConsent: null,
    activityMail: input.activityMail,
  });
}

describe('the signup body', () => {
  it('carries activityMail true and the language for a ticked box', async () => {
    const { fetchImpl, calls } = recordingFetch();
    await signup({ fetchImpl, activityMail: { isOptedIn: true, language: 'de' } });
    assert.equal(calls[0]?.body?.activityMail, true);
    assert.equal(calls[0]?.body?.language, 'de');
  });

  it('carries false, never true, for an unticked box on an instance that offers the feature', async () => {
    const { fetchImpl, calls } = recordingFetch();
    await signup({ fetchImpl, activityMail: { isOptedIn: false, language: 'en' } });
    assert.equal(calls[0]?.body?.activityMail, false);
    assert.equal(calls[0]?.body?.language, 'en');
  });

  it('leaves both keys out where the instance offers nothing, so the body is what it always was', async () => {
    for (const activityMail of [null, undefined]) {
      const { fetchImpl, calls } = recordingFetch();
      await signup({ fetchImpl, activityMail });
      assert.ok(calls[0]?.body !== null && calls[0]?.body !== undefined, 'the signup carried no body');
      assert.equal('activityMail' in calls[0].body, false);
      assert.equal('language' in calls[0].body, false);
    }
  });
});

describe('the account PATCH', () => {
  it('sends the choice and the language and nothing else, and adopts the view', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const client = new SyncAuthClient({ baseUrl: 'https://core.example', fetchImpl });
    client.restoreSession({
      account: { id: 1, email: 'anna@example.org' },
      tokens: {
        accessToken: 'a1',
        accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
        refreshToken: 'r1',
        refreshTokenExpiresAt: '2999-01-01T00:00:00.000Z',
      },
    });
    const view = await client.patchActivityMail({ activityMail: true, language: 'fr' });
    assert.deepEqual(calls[0]?.body, { activityMail: true, language: 'fr' });
    assert.equal(calls[0]?.method, 'PATCH');
    assert.equal(view.activityMail, true);
    assert.equal(client.getSession()?.account.activityMail, true);
  });

  it('sends the choice alone when turning reminders off, because the core refuses a language beside false', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const client = new SyncAuthClient({ baseUrl: 'https://core.example', fetchImpl });
    client.restoreSession({
      account: { id: 1, email: 'anna@example.org' },
      tokens: {
        accessToken: 'a1',
        accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
        refreshToken: 'r1',
        refreshTokenExpiresAt: '2999-01-01T00:00:00.000Z',
      },
    });
    await client.patchActivityMail({ activityMail: false, language: 'fr' });
    assert.deepEqual(calls[0]?.body, { activityMail: false });
    // The control: the on body of the same call still names the language, so the off case above
    // cannot pass by a client that never sends one.
    await client.patchActivityMail({ activityMail: true, language: 'fr' });
    assert.deepEqual(calls[1]?.body, { activityMail: true, language: 'fr' });
  });
});

describe('requestAsAccount on a 202 with no body', () => {
  it('reads it as accepted, and a 202 with a body is still read', async () => {
    const answers = [new Response('', { status: 202 }), new Response('{"ok":true}', { status: 202 })];
    const fetchImpl: typeof fetch = async () => answers.shift() ?? new Response('', { status: 500 });
    const client = new SyncAuthClient({ baseUrl: 'https://core.example', fetchImpl });
    client.restoreSession({
      account: { id: 1, email: 'anna@example.org' },
      tokens: {
        accessToken: 'a1',
        accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
        refreshToken: 'r1',
        refreshTokenExpiresAt: '2999-01-01T00:00:00.000Z',
      },
    });
    assert.equal(await client.requestAsAccount({ path: '/v1/admin/x', method: 'POST' }), null);
    assert.deepEqual(await client.requestAsAccount({ path: '/v1/admin/x', method: 'POST' }), { ok: true });
  });
});

interface Recorded {
  path: string;
  method: AuthorizedMethod;
  body: JsonValue | undefined;
}

function transportAnswering(input: { answer: JsonValue | Error; recorded: Recorded[] }): AdminTransport {
  return {
    async requestAsAccount(request: { path: string; method: AuthorizedMethod; body?: JsonValue }): Promise<JsonValue> {
      input.recorded.push({ path: request.path, method: request.method, body: request.body });
      if (input.answer instanceof Error) throw input.answer;
      return input.answer;
    },
    requestBytesAsAccount(): Promise<never> {
      throw new Error('no bytes here');
    },
  };
}

const SETTINGS = { firstScan: { enabled: true, days: 7 }, quiet: { enabled: false, days: 30 } };

describe('the admin client', () => {
  it('sends only the reminder block when only it was given', async () => {
    const recorded: Recorded[] = [];
    const client = new AdminClient({
      transport: transportAnswering({
        answer: { settings: { nutrientReferenceBasis: 'dge', activityMail: SETTINGS } },
        recorded,
      }),
    });
    const outcome = await client.patchSettings({ activityMail: SETTINGS });
    assert.deepEqual(recorded, [{ path: '/v1/admin/settings', method: 'PATCH', body: { activityMail: SETTINGS } }]);
    assert.deepEqual(outcome, { status: 'ok', value: { nutrientReferenceBasis: 'dge', activityMail: SETTINGS } });
  });

  it('reads an older core 404 as "no reminder section", and any other failure as a throw', async () => {
    const recorded: Recorded[] = [];
    const older = new AdminClient({
      transport: transportAnswering({
        answer: new SyncRequestError({ kind: 'not-found', status: 404, message: 'no' }),
        recorded,
      }),
    });
    assert.deepEqual(await older.readSettings(), { status: 'ok', value: null });
    assert.deepEqual(await older.activityMailStats(), { status: 'ok', value: null });

    // THE CONTROL: a server error must not be read as "an older core".
    const broken = new AdminClient({
      transport: transportAnswering({
        answer: new SyncRequestError({ kind: 'server', status: 500, message: 'x' }),
        recorded,
      }),
    });
    await assert.rejects(() => broken.readSettings());
    await assert.rejects(() => broken.activityMailStats());
  });

  it('asks for a test by the wire name of the kind, and reads 429 as a value', async () => {
    const recorded: Recorded[] = [];
    const accepted = new AdminClient({ transport: transportAnswering({ answer: null, recorded }) });
    assert.deepEqual(await accepted.sendActivityMailTest({ kind: 'firstScan' }), { status: 'ok', value: 'sent' });
    await accepted.sendActivityMailTest({ kind: 'quiet' });
    assert.deepEqual(
      recorded.map((request) => request.body),
      [{ kind: 'first-scan' }, { kind: 'quiet' }],
    );

    const throttled = new AdminClient({
      transport: transportAnswering({
        answer: new SyncRequestError({ kind: 'throttled', status: 429, message: 'slow' }),
        recorded,
      }),
    });
    assert.deepEqual(await throttled.sendActivityMailTest({ kind: 'quiet' }), { status: 'ok', value: 'throttled' });

    // THE CONTROL: a 500 is not a rate limit.
    const broken = new AdminClient({
      transport: transportAnswering({
        answer: new SyncRequestError({ kind: 'server', status: 500, message: 'x' }),
        recorded,
      }),
    });
    await assert.rejects(() => broken.sendActivityMailTest({ kind: 'quiet' }));
  });
});

describe('the wire pins', () => {
  it('transcribes the day bounds and the test names', () => {
    assert.deepEqual(ACTIVITY_MAIL_DAY_BOUNDS, { firstScan: { min: 3, max: 30 }, quiet: { min: 7, max: 60 } });
    assert.deepEqual(ACTIVITY_MAIL_TEST_KIND, { firstScan: 'first-scan', quiet: 'quiet' });
  });

  it('parses the stats and a settings answer that carries only the reminders', () => {
    const stats = { optedIn: 4, firstScan: { sent: 3, cameBack: 1 }, quiet: { sent: 2, cameBack: 0 } };
    assert.deepEqual(activityMailStatsSchema.parse(stats), stats);
    assert.deepEqual(
      instanceSettingsResponseSchema.parse({ settings: { activityMail: SETTINGS } }).settings.activityMail,
      SETTINGS,
    );
  });
});

describe('the day count', () => {
  it('accepts the bounds and everything between them', () => {
    assert.equal(parseActivityMailDays({ kind: 'firstScan', raw: '3' }), 3);
    assert.equal(parseActivityMailDays({ kind: 'firstScan', raw: '30' }), 30);
    assert.equal(parseActivityMailDays({ kind: 'quiet', raw: ' 7 ' }), 7);
    assert.equal(parseActivityMailDays({ kind: 'quiet', raw: '60' }), 60);
  });

  it('refuses one step outside each bound, a fraction, an exponent, text and nothing', () => {
    for (const [kind, raw] of [
      ['firstScan', '2'],
      ['firstScan', '31'],
      ['quiet', '6'],
      ['quiet', '61'],
      ['quiet', '7.5'],
      ['quiet', '1e1'],
      ['quiet', 'abc'],
      ['quiet', ''],
      ['quiet', '-9'],
    ] as const) {
      assert.equal(parseActivityMailDays({ kind, raw }), null, `${kind} ${raw}`);
    }
  });

  it('refuses the whole draft when either box is wrong, so one good box never saves alone', () => {
    const good = {
      firstScan: { enabled: true, days: '7' },
      quiet: { enabled: false, days: '30' },
    } satisfies Record<'firstScan' | 'quiet', ActivityMailKindDraft>;
    assert.deepEqual(readActivityMailDrafts(good), SETTINGS);
    assert.equal(readActivityMailDrafts({ ...good, quiet: { enabled: false, days: '5' } }), null);
    assert.equal(readActivityMailDrafts({ ...good, firstScan: { enabled: true, days: '' } }), null);
  });
});
