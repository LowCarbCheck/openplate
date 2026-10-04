/**
 * `pnpm core-api canary --email <address>`: one marked photograph through a
 * LIVE instance, so an operator can search the host's logs for it afterwards
 * (M3 spec 06, "Canary", 2026-10-05).
 *
 * WHY. `tests/integration/photo-path-guard.test.ts` proves the claim "our server
 * does not save your photo" inside one process. It cannot see the reverse proxy,
 * the container runtime, journald or the Docker log files. The cheapest real
 * test is to send one photograph with a unique marker through production, then
 * search every place a log could hold it. Run it after every release.
 *
 * WHAT IT DOES, in order, all through the public protocol:
 *  1. Reads `GET /health` for what a signup must send: the health consent
 *     version, and the model the proxy forwards to.
 *  2. Mints an invite for the address with five AI requests a day
 *     (`POST /v1/admin/invites`, the admin token). THE TOKEN IS READ OFF THE
 *     RESPONSE, never off a letter: the admin API answers a `link` carrying it
 *     (or a `token` on an instance with no link bases), even when the invitation
 *     was mailed too. The letter still goes out to the address, so use an
 *     address you own. Pigeon keeps no copy of its body (`retain_body: false`).
 *  3. Redeems it with `POST /v1/auth/signup`, the way a client does.
 *  4. Sends ONE small PNG with a random marker in a tEXt chunk and in the pixel
 *     data to `POST /v1/chat/completions`, with the new account's own bearer and
 *     a fresh `X-Intake-Id` (PROTOCOL.md §5.19).
 *  5. Deletes the account (`DELETE /v1/admin/accounts/:id`), unless `--keep`.
 *  6. Prints a JSON report: the HTTP status of the scan, the marker in the forms
 *     a log search needs (`lib/marker-forms.ts`), and whether the account is gone.
 *
 * THE KEY MATERIAL IS RANDOM BYTES OF THE RIGHT SHAPE, not a derived hierarchy.
 * A real client derives its keys from a passphrase with Argon2id
 * (`apps/app/app/lib/sync/engine/client/setup-keys.ts`), which lives in the app
 * and needs a browser's WebCrypto. This account lives for seconds and is deleted,
 * nothing is ever wrapped under these keys, and the service only checks their
 * lengths and encodings, so random bytes redeem the invite through exactly the
 * same endpoint and the same transaction. It is not a test of the key
 * derivation, and says so here rather than in a surprise later.
 *
 * IT NEVER PRINTS A TOKEN, A PASSWORD OR A KEY. The invite token, the access
 * token, the admin token and the signup material stay in variables of this
 * module. A failed response's body is never read, like every `core-api` call
 * (`client.ts`), and the scan's answer is cancelled unread: it is the provider's
 * words about a photograph of nothing, and the status is all the canary needs.
 *
 * A FAILURE CLEANS UP. A signup that fails revokes the unredeemed invite, and a
 * scan that fails still deletes the account.
 */
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { asNumber, asObject, asString, type JsonObject, type JsonValue } from '../../src/lib/json.js';
import { markerWindowForms, WINDOW_BYTES, type MarkerWindowForms } from '../../src/lib/marker-forms.js';
import { CliError, type AdminClient } from './client.js';
import { decodeMintedInvite, type MintedInviteView } from './views.js';

/** Five requests a day: enough for one scan and a retry, and nothing a leaked token could spend. */
export const CANARY_DAILY_AI_LIMIT = 5;

/** How long the invite lives if the canary dies before it redeems it. */
const CANARY_INVITE_DAYS = 1;

/** The marker, in bytes. 16 gives five 12-byte windows, and 128 bits that no photograph contains by chance. */
export const MARKER_BYTES = 16;

/** How long the scan may take. The proxy's own upstream timeout is two minutes by default. */
const SCAN_TIMEOUT_MS = 150_000;

/** The shape of the PNG: wide enough that rows start at different offsets modulo three (33 + 1 filter byte). */
const PNG_WIDTH = 33;
const PNG_HEIGHT = 4;
const PIXEL_FILL = 0x80;
/** The pixel column the marker starts at, in each of the first three rows. */
const MARKER_PIXEL_COLUMN = 8;
const PIXEL_MARKER_ROWS = 3;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Crockford base32, the alphabet a recovery code is written in (PROTOCOL.md §3.1). */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A marker of random bytes with no zero byte, because a tEXt chunk's text may not hold one. */
export function makeMarker(): Buffer {
  const marker = Buffer.alloc(MARKER_BYTES);
  for (let index = 0; index < MARKER_BYTES; index += 1) {
    let byte = 0;
    // Redrawn until it is not zero: one byte in 256, so this ends at once, bounded all the same.
    for (let attempt = 1; attempt <= 64 && byte === 0; attempt += 1) byte = randomBytes(1).readUInt8(0);
    marker[index] = byte === 0 ? 1 : byte;
  }
  return marker;
}

function pngChunk(input: { type: string; data: Buffer }): Buffer {
  const type = Buffer.from(input.type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(input.data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, input.data])));
  return Buffer.concat([length, type, input.data, checksum]);
}

/**
 * A small grayscale PNG that holds the marker twice over, so a search for it
 * finds it wherever a log line cut the photograph:
 *
 *  - once in a `tEXt` chunk, as raw bytes after the keyword `Comment`;
 *  - three times in the pixel data, one per row. The zlib stream is written
 *    with stored blocks (level 0), so the bytes sit in the file as they are and
 *    the rows, 34 bytes apart, put the marker at three different alignments
 *    modulo three.
 */
export function buildCanaryPng(marker: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(PNG_WIDTH, 0);
  header.writeUInt32BE(PNG_HEIGHT, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(0, 9); // grayscale
  // Compression, filter and interlace methods stay 0.

  const stride = 1 + PNG_WIDTH;
  const pixels = Buffer.alloc(stride * PNG_HEIGHT, PIXEL_FILL);
  for (let row = 0; row < PNG_HEIGHT; row += 1) {
    pixels[row * stride] = 0; // filter type: none
    if (row < PIXEL_MARKER_ROWS) marker.copy(pixels, row * stride + 1 + MARKER_PIXEL_COLUMN);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk({ type: 'IHDR', data: header }),
    pngChunk({ type: 'tEXt', data: Buffer.concat([Buffer.from('Comment', 'latin1'), Buffer.from([0]), marker]) }),
    pngChunk({ type: 'IDAT', data: deflateSync(pixels, { level: 0 }) }),
    pngChunk({ type: 'IEND', data: Buffer.alloc(0) }),
  ]);
}

/** The body of the scan: the smallest valid request the proxy accepts, one text part and one data-URI image. */
export function buildScanBody(input: { model: string; png: Buffer }): JsonObject {
  return {
    model: input.model,
    max_tokens: 16,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reply with the single word ok.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${input.png.toString('base64')}` } },
        ],
      },
    ],
  };
}

/** The invite token, read off the mint response: its own `token`, else the `invite` parameter of the join link. */
export function inviteTokenFrom(minted: MintedInviteView): string {
  if (minted.token !== null) return minted.token;
  if (minted.link === null) throw new CliError('The service minted an invite and returned neither a link nor a token.');
  let fragment: string;
  try {
    fragment = new URL(minted.link).hash;
  } catch {
    throw new CliError('The invite link the service returned is not a URL, so the canary cannot read the invite.');
  }
  const token = new URLSearchParams(fragment.replace(/^#/, '')).get('invite');
  if (token === null || token === '') {
    throw new CliError('The invite link the service returned carries no invite, so the canary cannot read it.');
  }
  return token;
}

function crockford(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += CROCKFORD_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return text;
}

/** The fields of a signup body, spelled out so a missing one is a type error and not a 400 on a live instance. */
type SignupBody = {
  inviteToken: string;
  authHash: string;
  kdfDescriptor: { salt: string; params: { memorySizeKib: number; iterations: number; parallelism: number } };
  displayName: null;
  recoveryAuthHash: string;
  recoveryCode: string;
  keyRecords: JsonObject[];
  healthConsent?: { version: string };
};

/**
 * The body of `POST /v1/auth/signup` (PROTOCOL.md §5.8): random bytes of the
 * documented lengths, see the module header. `healthConsentVersion` is the
 * instance's own, or `null` where it asks for none.
 */
export function buildSignupBody(input: { inviteToken: string; healthConsentVersion: string | null }): SignupBody {
  const kdfDescriptor = {
    salt: randomBytes(16).toString('base64'),
    params: { memorySizeKib: 65_536, iterations: 3, parallelism: 1 },
  };
  const body: SignupBody = {
    inviteToken: input.inviteToken,
    authHash: randomBytes(32).toString('base64'),
    kdfDescriptor,
    displayName: null,
    recoveryAuthHash: randomBytes(32).toString('base64'),
    recoveryCode: crockford(randomBytes(20)),
    keyRecords: [
      { kind: 'passphrase', kdfDescriptor, wrappedDek: randomBytes(60).toString('base64') },
      { kind: 'recovery', kdfDescriptor: null, wrappedDek: randomBytes(60).toString('base64') },
    ],
  };
  if (input.healthConsentVersion !== null) body.healthConsent = { version: input.healthConsentVersion };
  return body;
}

/** What `GET /health` says that a canary needs. */
export interface CanaryInstance {
  hasAi: boolean;
  aiModel: string | null;
  healthConsentVersion: string | null;
}

export function decodeCanaryInstance(value: JsonValue): CanaryInstance {
  const instance = asObject(asObject(value)?.instance);
  if (instance === null) {
    throw new CliError(
      'The service answered /health without an instance description, so the canary cannot tell what to send.',
    );
  }
  const ai = asObject(instance.ai);
  return {
    hasAi: ai !== null,
    aiModel: asString(ai?.model),
    healthConsentVersion: asString(asObject(instance.healthConsent)?.version),
  };
}

/** The new account's id and bearer, out of the `201` of a signup. The bearer is never printed. */
interface SignedUp {
  accountId: number;
  accessToken: string;
}

function decodeSignedUp(value: JsonValue): SignedUp {
  const body = asObject(value);
  const accountId = asNumber(asObject(body?.account)?.id);
  const accessToken = asString(asObject(body?.tokens)?.accessToken);
  if (accountId === null || accessToken === null) {
    throw new CliError('The signup answered without the documented account and tokens.');
  }
  return { accountId, accessToken };
}

/** What the canary hands back: the scan status, the marker in log-search forms, and the account's fate. */
export interface CanaryReport {
  scan: { status: number | null };
  marker: { hex: string; windowBytes: number; windows: MarkerWindowForms[] };
  invite: { mailed: boolean };
  account: { id: number; deleted: boolean; kept: boolean };
}

export interface RunCanaryInput {
  client: AdminClient;
  baseUrl: string;
  email: string;
  /** `--keep`: leave the account in place. */
  keep: boolean;
  /** `--model`, for an instance that names no model of its own. */
  model: string | null;
  /** Injected in tests; the entrypoint passes the global. */
  fetchImpl?: typeof fetch;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** One unauthenticated or account-authenticated POST. A transport failure is a sentence, never the cause. */
async function postJson(input: {
  fetchImpl: typeof fetch;
  url: string;
  path: string;
  body: JsonObject;
  bearer: string | null;
  intakeId: string | null;
  timeoutMs: number;
}): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
  // THE ONLY PLACES AN ACCOUNT'S BEARER IS WRITTEN, in one header and nowhere else.
  if (input.bearer !== null) headers.set('Authorization', `Bearer ${input.bearer}`);
  if (input.intakeId !== null) headers.set('X-Intake-Id', input.intakeId);
  try {
    return await input.fetchImpl(input.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch {
    throw new CliError(`Could not reach the service for POST ${input.path}. Is --url (or CORE_URL) right?`);
  }
}

async function signUp(input: {
  fetchImpl: typeof fetch;
  baseUrl: string;
  inviteToken: string;
  healthConsentVersion: string | null;
}): Promise<SignedUp> {
  const path = '/v1/auth/signup';
  const response = await postJson({
    fetchImpl: input.fetchImpl,
    url: joinUrl(input.baseUrl, path),
    path,
    body: buildSignupBody({ inviteToken: input.inviteToken, healthConsentVersion: input.healthConsentVersion }),
    bearer: null,
    intakeId: null,
    timeoutMs: 30_000,
  });
  if (!response.ok) {
    // The body is NOT read, see the module header.
    await response.body?.cancel();
    throw new CliError(`The signup was refused with ${response.status}. The canary account was not created.`);
  }
  // SAFETY: `json()` yields a JSON value by definition; `decodeSignedUp` decodes the fields it reads.
  return decodeSignedUp((await response.json()) as JsonValue);
}

/** The scan's HTTP status, or `null` when it got none. The answer is cancelled unread. */
async function sendScan(input: {
  fetchImpl: typeof fetch;
  baseUrl: string;
  accessToken: string;
  model: string;
  png: Buffer;
}): Promise<number | null> {
  const path = '/v1/chat/completions';
  try {
    const response = await postJson({
      fetchImpl: input.fetchImpl,
      url: joinUrl(input.baseUrl, path),
      path,
      body: buildScanBody({ model: input.model, png: input.png }),
      bearer: input.accessToken,
      // One fresh id per action (PROTOCOL.md §5.19): 32 hex characters.
      intakeId: randomBytes(16).toString('hex'),
      timeoutMs: SCAN_TIMEOUT_MS,
    });
    await response.body?.cancel();
    return response.status;
  } catch (cause) {
    // A transport failure is a result for a canary, not a reason to leave the account behind.
    if (cause instanceof CliError) return null;
    throw cause;
  }
}

/** Revokes an invite nobody redeemed, best effort: the invite dies in a day anyway. */
async function revokeInvite(client: AdminClient, inviteId: number): Promise<void> {
  try {
    await client.request({ method: 'DELETE', path: `/v1/admin/invites/${inviteId}` });
  } catch {
    // Nothing more to do: the primary failure is the one the operator reads.
  }
}

/** Deletes the canary account through the admin API. `false` means it is still there. */
async function deleteAccount(client: AdminClient, accountId: number): Promise<boolean> {
  try {
    await client.request({ method: 'DELETE', path: `/v1/admin/accounts/${accountId}` });
    return true;
  } catch {
    return false;
  }
}

/** Runs the canary and returns its report. Throws a {@link CliError} for anything that stops it before a scan. */
export async function runCanary(input: RunCanaryInput): Promise<CanaryReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const instance = decodeCanaryInstance(await input.client.request({ method: 'GET', path: '/health' }));
  if (!instance.hasAi) {
    throw new CliError('This instance has no AI proxy (instance.ai is null), so there is no photograph path to test.');
  }
  const model = input.model ?? instance.aiModel;
  if (model === null) {
    throw new CliError('This instance names no model (AI_ADVERTISED_MODEL is unset). Pass --model <id>.');
  }

  const minted = decodeMintedInvite(
    await input.client.request({
      method: 'POST',
      path: '/v1/admin/invites',
      body: {
        email: input.email,
        displayName: 'Canary',
        dailyAiLimit: CANARY_DAILY_AI_LIMIT,
        expiresInDays: CANARY_INVITE_DAYS,
      },
    }),
  );

  let session: SignedUp;
  try {
    session = await signUp({
      fetchImpl,
      baseUrl: input.baseUrl,
      inviteToken: inviteTokenFrom(minted),
      healthConsentVersion: instance.healthConsentVersion,
    });
  } catch (cause) {
    await revokeInvite(input.client, minted.invite.id);
    throw cause;
  }

  const marker = makeMarker();
  let status: number | null = null;
  let deleted = false;
  try {
    status = await sendScan({
      fetchImpl,
      baseUrl: input.baseUrl,
      accessToken: session.accessToken,
      model,
      png: buildCanaryPng(marker),
    });
  } finally {
    if (!input.keep) deleted = await deleteAccount(input.client, session.accountId);
  }

  return {
    scan: { status },
    marker: { hex: marker.toString('hex'), windowBytes: WINDOW_BYTES, windows: markerWindowForms(marker) },
    invite: { mailed: minted.emailed },
    account: { id: session.accountId, deleted, kept: input.keep },
  };
}
