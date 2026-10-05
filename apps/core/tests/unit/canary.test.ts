/**
 * `core-api canary` (`scripts/sync-api/canary.ts`): the photograph it builds,
 * the signup body it sends, and the order it does things in.
 *
 * THE PHOTOGRAPH IS CHECKED WITH THE SAME SEARCHER THE PHOTO PATH GUARD USES
 * (`tests/integration/leak-search.ts`), so "the marker is findable" means what
 * it means there: in base64, URL-safe base64, hex and as 12-byte windows at all
 * three alignments. A second marker is the control, so a searcher that finds
 * everything cannot pass.
 *
 * THE FLOW IS RUN AGAINST A STUB `fetch` that plays the service, so each test
 * can make one step fail and read what the canary did next: revoke the invite,
 * delete the account, or leave it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';
import { AdminClient, CliError } from '../../scripts/sync-api/client.js';
import {
  buildCanaryPng,
  buildScanBody,
  buildSignupBody,
  CANARY_DAILY_AI_LIMIT,
  decodeCanaryInstance,
  inviteTokenFrom,
  makeMarker,
  MARKER_BYTES,
  runCanary,
  type CanaryReport,
} from '../../scripts/sync-api/canary.js';
import type { MintedInviteView } from '../../scripts/sync-api/views.js';
import { parseRecoveryCode } from '../../src/accounts/auth-input.js';
import { markerWindowForms, WINDOW_BYTES } from '../../src/lib/marker-forms.js';
import type { JsonValue } from '../../src/lib/json.js';
import { createLeakSearcher } from '../integration/leak-search.js';

// ── The marker and the photograph ──────────────────────────────────────────

test('a marker is 16 random bytes with no zero byte, and no two are alike', () => {
  const first = makeMarker();
  assert.equal(first.length, MARKER_BYTES);
  assert.equal(first.includes(0), false);
  assert.notDeepEqual(first, makeMarker());
  for (let draw = 1; draw <= 200; draw += 1) assert.equal(makeMarker().includes(0), false);
});

/** The chunks of a PNG, with their types and whether the CRC on the wire is right. */
function readChunks(png: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const chunks: { type: string; data: Buffer; crcOk: boolean }[] = [];
  let at = 8;
  for (let guard = 1; guard <= 20 && at < png.length; guard += 1) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('latin1');
    const data = png.subarray(at + 8, at + 8 + length);
    const crc = png.readUInt32BE(at + 8 + length);
    chunks.push({ type, data, crcOk: crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) === crc });
    at += 12 + length;
  }
  return chunks;
}

function offsetsOf(haystack: Buffer, needle: Buffer): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) found.push(at);
  return found;
}

test('the canary photograph is a valid small PNG: signature, four chunks in order, every checksum right', () => {
  const png = buildCanaryPng(makeMarker());
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = readChunks(png);
  assert.deepEqual(
    chunks.map((chunk) => chunk.type),
    ['IHDR', 'tEXt', 'IDAT', 'IEND'],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.crcOk),
    [true, true, true, true],
  );
  assert.ok(png.length < 600, `a small picture, got ${png.length} bytes`);
  // The pixels inflate to the rows the header promises: 4 rows of 1 filter byte and 33 pixels.
  const idat = chunks.find((chunk) => chunk.type === 'IDAT');
  assert.equal(inflateSync(idat?.data ?? Buffer.alloc(0)).length, 4 * 34);
});

test('the marker is in the tEXt chunk and in the pixel data, at all three alignments in the file', () => {
  const marker = makeMarker();
  const png = buildCanaryPng(marker);
  const chunks = readChunks(png);

  const text = chunks.find((chunk) => chunk.type === 'tEXt');
  assert.deepEqual(text?.data, Buffer.concat([Buffer.from('Comment'), Buffer.from([0]), marker]));

  const pixels = inflateSync(chunks.find((chunk) => chunk.type === 'IDAT')?.data ?? Buffer.alloc(0));
  assert.equal(offsetsOf(pixels, marker).length, 3, 'the marker is in three rows of pixels');

  // Four copies in the file as it travels: the stored zlib blocks leave the pixels as they are.
  const inFile = offsetsOf(png, marker);
  assert.equal(inFile.length, 4);
  assert.equal(new Set(inFile.map((offset) => offset % 3)).size, 3, 'all three base64 alignments occur');
});

test('the shared searcher finds the canary marker in the request body, in every form, and not another marker', () => {
  const marker = makeMarker();
  const png = buildCanaryPng(marker);
  const body = JSON.stringify(buildScanBody({ model: 'm', png }));
  const searcher = createLeakSearcher({ image: png, marker });

  const found = searcher.find([{ source: 'the scan body', text: body }]);
  assert.ok(found.length > 0, 'the searcher did not find the canary photograph in the scan body');
  assert.ok(
    found.some((entry) => entry.includes('the image as base64')),
    found.join('; '),
  );

  const asHex = searcher.find([{ source: 'a log', text: `dump ${png.toString('hex')}` }]);
  assert.ok(asHex.length > 0);

  // THE CONTROL: another run's marker is not in this run's body.
  const other = createLeakSearcher({ image: buildCanaryPng(makeMarker()), marker: makeMarker() });
  assert.deepEqual(other.find([{ source: 'the scan body', text: body }]), []);
});

test('the scan body is an OpenAI-style request with one text part and one PNG data URI', () => {
  const png = buildCanaryPng(makeMarker());
  const body = buildScanBody({ model: 'google/gemini-3.8-flash', png });
  assert.equal(body.model, 'google/gemini-3.8-flash');
  const text = JSON.stringify(body);
  assert.ok(text.includes(`data:image/png;base64,${png.toString('base64')}`));
  assert.equal(text.match(/"type":"image_url"/g)?.length, 1);
  assert.equal(text.match(/"type":"text"/g)?.length, 1);
});

test('the marker forms printed for a log search are the shared ones: five 12-byte windows, three alignments each', () => {
  const marker = makeMarker();
  const windows = markerWindowForms(marker);
  assert.equal(windows.length, MARKER_BYTES - WINDOW_BYTES + 1);
  for (const window of windows) {
    assert.equal(window.hex, marker.subarray(window.start, window.start + WINDOW_BYTES).toString('hex'));
    assert.equal(window.base64.length, 3);
    assert.equal(window.urlSafeBase64.length, 3);
    for (const [alignment, text] of window.base64.entries()) {
      assert.ok(text.length >= 12, `alignment ${alignment} is too short to search for: ${text}`);
      assert.equal(window.urlSafeBase64[alignment], text.replaceAll('+', '-').replaceAll('/', '_'));
    }
  }
  // Each alignment's text really is inside the photograph's base64, at some window.
  const encoded = buildCanaryPng(marker).toString('base64');
  const first = windows[0];
  assert.ok(
    first?.base64.some((text) => encoded.includes(text)),
    'no alignment of the first window is in the photograph',
  );
});

// ── The signup ─────────────────────────────────────────────────────────────

test('the signup body has every field PROTOCOL.md §5.8 names, in the lengths the service checks', () => {
  const body = buildSignupBody({ inviteToken: 'si_example', healthConsentVersion: '2026-09-28' });
  assert.equal(body.inviteToken, 'si_example');
  assert.equal(Buffer.from(body.authHash, 'base64').length, 32);
  assert.equal(Buffer.from(body.recoveryAuthHash, 'base64').length, 32);
  assert.equal(Buffer.from(body.kdfDescriptor.salt, 'base64').length, 16);
  assert.deepEqual(body.kdfDescriptor.params, { memorySizeKib: 65_536, iterations: 3, parallelism: 1 });
  // The service's own parser accepts the recovery code.
  const code = parseRecoveryCode(body.recoveryCode);
  assert.equal(code.ok, true);
  assert.deepEqual(
    body.keyRecords.map((record) => record.kind),
    ['passphrase', 'recovery'],
  );
  assert.equal(body.keyRecords[1]?.kdfDescriptor, null);
  assert.deepEqual(body.healthConsent, { version: '2026-09-28' });
});

test('a signup for an instance that asks no consent sends none, and two bodies share no secret', () => {
  const one = buildSignupBody({ inviteToken: 'si_a', healthConsentVersion: null });
  const two = buildSignupBody({ inviteToken: 'si_a', healthConsentVersion: null });
  assert.equal('healthConsent' in one, false);
  assert.notEqual(one.authHash, two.authHash);
  assert.notEqual(one.recoveryCode, two.recoveryCode);
});

test('the invite token is read off the mint response, from the token or from the join link', () => {
  const base: MintedInviteView = {
    invite: {
      id: 1,
      email: 'a@example.org',
      displayName: null,
      role: 'member',
      dailyAiLimit: 5,
      trialScans: null,
      createdAt: 'x',
      expiresAt: 'y',
      status: 'pending',
      redeemedAccountId: null,
    },
    emailed: true,
    link: null,
    token: null,
  };
  assert.equal(inviteTokenFrom({ ...base, token: 'si_direct' }), 'si_direct');
  assert.equal(
    inviteTokenFrom({
      ...base,
      link: 'https://app.example.org/join#server=https%3A%2F%2Fapi.example.org&invite=si_from_link',
    }),
    'si_from_link',
  );
  // THE CONTROLS: a link with no invite, a link that is no URL, and neither field.
  assert.throws(() => inviteTokenFrom({ ...base, link: 'https://app.example.org/join#server=x' }), CliError);
  assert.throws(() => inviteTokenFrom({ ...base, link: 'not a url' }), CliError);
  assert.throws(() => inviteTokenFrom(base), CliError);
});

test('the instance descriptor gives the consent version and the model, and refuses an instance with no description', () => {
  assert.deepEqual(
    decodeCanaryInstance({
      instance: { ai: { model: 'm' }, healthConsent: { version: 'v1' } },
    }),
    { hasAi: true, aiModel: 'm', healthConsentVersion: 'v1' },
  );
  assert.deepEqual(decodeCanaryInstance({ instance: { ai: null, healthConsent: null } }), {
    hasAi: false,
    aiModel: null,
    healthConsentVersion: null,
  });
  assert.throws(() => decodeCanaryInstance({}), CliError);
});

// ── The flow, against a stub service ───────────────────────────────────────

const ADMIN_TOKEN = 'admin-token-that-must-never-be-printed';
const INVITE_TOKEN = 'si_invite-token-that-must-never-be-printed';
const ACCESS_TOKEN = 'access-token-that-must-never-be-printed';
const BASE_URL = 'http://core.test';

interface Call {
  method: string;
  path: string;
  authorization: string | null;
  intakeId: string | null;
  body: string;
}

interface StubBehavior {
  health?: JsonValue;
  signupStatus?: number;
  scanStatus?: number | 'network-error';
  deleteStatus?: number;
}

interface StubService {
  fetchImpl: typeof fetch;
  calls: Call[];
}

function json(status: number, body: JsonValue | null): Response {
  if (status === 204 || body === null) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubService(behavior: StubBehavior): StubService {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    // `Request` normalises the string, URL and Request forms of `input` for us.
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.get('authorization'),
      intakeId: request.headers.get('x-intake-id'),
      body: await request.text(),
    });
    const key = `${request.method} ${url.pathname}`;
    if (key === 'GET /health') {
      return json(
        200,
        behavior.health ?? {
          instance: { ai: { model: 'google/gemini-3.8-flash' }, healthConsent: { version: '2026-09-28' } },
        },
      );
    }
    if (key === 'POST /v1/admin/invites') {
      return json(201, {
        invite: {
          id: 41,
          email: 'canary@example.org',
          displayName: 'Canary',
          role: 'member',
          dailyAiLimit: CANARY_DAILY_AI_LIMIT,
          trialScans: null,
          createdAt: '2026-10-05T10:00:00.000Z',
          expiresAt: '2026-10-06T10:00:00.000Z',
          status: 'pending',
          redeemedAccountId: null,
        },
        emailed: true,
        link: `https://app.example.org/join#server=https%3A%2F%2Fcore.test&invite=${INVITE_TOKEN}`,
      });
    }
    if (key === 'POST /v1/auth/signup') {
      const status = behavior.signupStatus ?? 201;
      return json(
        status,
        status === 201 ? { account: { id: 77 }, tokens: { accessToken: ACCESS_TOKEN } } : { error: 'x' },
      );
    }
    if (key === 'POST /v1/chat/completions') {
      if (behavior.scanStatus === 'network-error') throw new TypeError('fetch failed');
      return json(behavior.scanStatus ?? 200, { choices: [] });
    }
    if (key === 'DELETE /v1/admin/accounts/77') return json(behavior.deleteStatus ?? 204, null);
    if (key === 'DELETE /v1/admin/invites/41') return json(204, null);
    return json(404, null);
  };
  return { fetchImpl, calls };
}

async function runAgainst(
  behavior: StubBehavior,
  options: { keep?: boolean; model?: string | null } = {},
): Promise<{ report: CanaryReport | null; failure: string | null; calls: Call[] }> {
  const { fetchImpl, calls } = stubService(behavior);
  const client = new AdminClient({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN, fetchImpl });
  try {
    const report = await runCanary({
      client,
      baseUrl: BASE_URL,
      email: 'canary@example.org',
      keep: options.keep ?? false,
      model: options.model ?? null,
      fetchImpl,
    });
    return { report, failure: null, calls };
  } catch (cause) {
    return { report: null, failure: cause instanceof CliError ? cause.message : 'not a CliError', calls };
  }
}

test('the whole flow runs in order, the scan carries the account bearer and an intake id, and the account is deleted', async () => {
  const { report, calls } = await runAgainst({});

  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    [
      'GET /health',
      'POST /v1/admin/invites',
      'POST /v1/auth/signup',
      'POST /v1/chat/completions',
      'DELETE /v1/admin/accounts/77',
    ],
  );
  assert.equal(report?.scan.status, 200);
  assert.deepEqual(report?.account, { id: 77, deleted: true, kept: false });
  assert.equal(report?.invite.mailed, true);

  const invite = JSON.parse(calls[1]?.body ?? '{}');
  assert.equal(invite.email, 'canary@example.org');
  assert.equal(invite.dailyAiLimit, 5);
  const signup = JSON.parse(calls[2]?.body ?? '{}');
  assert.equal(signup.inviteToken, INVITE_TOKEN, 'the token came from the mint response');
  assert.deepEqual(signup.healthConsent, { version: '2026-09-28' });

  const scan = calls[3];
  assert.equal(scan?.authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.match(scan?.intakeId ?? '', /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(JSON.parse(scan?.body ?? '{}').model, 'google/gemini-3.8-flash');
  // The admin token went to the admin calls only.
  assert.equal(calls[3]?.authorization?.includes(ADMIN_TOKEN), false);
  assert.equal(calls[2]?.authorization, null);
});

test('the report names the marker in the forms to search for, and carries no token, key or password', async () => {
  const { report, calls } = await runAgainst({});
  assert.ok(report);
  const printed = JSON.stringify(report);

  // The marker is the one the photograph carries.
  const scanBody = calls.find((call) => call.path === '/v1/chat/completions')?.body ?? '';
  const encoded = /base64,([A-Za-z0-9+/=]+)/.exec(scanBody)?.[1] ?? '';
  const png = Buffer.from(encoded, 'base64');
  assert.equal(offsetsOf(png, Buffer.from(report.marker.hex, 'hex')).length, 4);
  assert.equal(report.marker.windows.length, 5);

  // NOTHING SECRET: not the three tokens, not the signup material.
  const signup = JSON.parse(calls.find((call) => call.path === '/v1/auth/signup')?.body ?? '{}');
  for (const secret of [
    ADMIN_TOKEN,
    INVITE_TOKEN,
    ACCESS_TOKEN,
    signup.authHash,
    signup.recoveryAuthHash,
    signup.recoveryCode,
  ]) {
    assert.equal(printed.includes(secret), false, `the report holds ${secret.slice(0, 8)}...`);
  }
  // THE CONTROL: the search is looking at a report that does hold the marker.
  assert.ok(printed.includes(report.marker.hex));
});

test('--keep leaves the account and sends no delete', async () => {
  const { report, calls } = await runAgainst({}, { keep: true });
  assert.deepEqual(report?.account, { id: 77, deleted: false, kept: true });
  assert.equal(
    calls.some((call) => call.method === 'DELETE'),
    false,
  );
});

test('a scan that fails still deletes the account, and the report carries its status', async () => {
  const refused = await runAgainst({ scanStatus: 502 });
  assert.equal(refused.report?.scan.status, 502);
  assert.equal(refused.report?.account.deleted, true);

  const unreachable = await runAgainst({ scanStatus: 'network-error' });
  assert.equal(unreachable.report?.scan.status, null);
  assert.equal(unreachable.report?.account.deleted, true);
});

test('a delete that fails is reported as not deleted, with the id to delete by hand', async () => {
  const { report } = await runAgainst({ deleteStatus: 500 });
  assert.deepEqual(report?.account, { id: 77, deleted: false, kept: false });
});

test('a refused signup revokes the invite it minted, sends no scan and says the status only', async () => {
  const { report, failure, calls } = await runAgainst({ signupStatus: 403 });
  assert.equal(report, null);
  assert.match(failure ?? '', /refused with 403/);
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.path === '/v1/admin/invites/41'));
  assert.equal(
    calls.some((call) => call.path === '/v1/chat/completions'),
    false,
  );
  assert.equal((failure ?? '').includes(INVITE_TOKEN), false);
});

test('an instance with no AI, or no model and no --model, is refused before anything is minted', async () => {
  const noAi = await runAgainst({ health: { instance: { ai: null, healthConsent: null } } });
  assert.match(noAi.failure ?? '', /no AI proxy/);
  assert.deepEqual(
    noAi.calls.map((call) => call.path),
    ['/health'],
  );

  const noModel = await runAgainst({ health: { instance: { ai: { model: null }, healthConsent: null } } });
  assert.match(noModel.failure ?? '', /--model/);
  assert.equal(
    noModel.calls.some((call) => call.path === '/v1/admin/invites'),
    false,
  );

  // THE CONTROL: the same instance with --model runs.
  const named = await runAgainst(
    { health: { instance: { ai: { model: null }, healthConsent: null } } },
    { model: 'some/model' },
  );
  assert.equal(
    JSON.parse(named.calls.find((call) => call.path === '/v1/chat/completions')?.body ?? '{}').model,
    'some/model',
  );
  assert.equal(
    'healthConsent' in JSON.parse(named.calls.find((call) => call.path === '/v1/auth/signup')?.body ?? '{}'),
    false,
  );
});
