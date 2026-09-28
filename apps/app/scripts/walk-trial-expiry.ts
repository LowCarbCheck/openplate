/**
 * walk-trial-expiry, the scripted half of the M214 spec 05 walk.
 *
 * WHAT IT PROVES. A person whose three day trial has run out sees the PLANS
 * door, with the date it ended on, and not the administrator sentence. It
 * proves that without waiting three days and without buying anything: it moves
 * the account's `allowanceExpiresAt` to yesterday over the admin API, reads the
 * account back the way the app reads it, and then asks the app's own resolver
 * which door a screen would draw. The resolver is imported, never restated, so
 * a change to the rule changes this check with it.
 *
 * IT WRITES TO A REAL ACCOUNT ON A REAL INSTANCE. The date it overwrites is
 * gone; nothing here puts the old one back, and the old value is printed
 * before the write so a person can restore it by hand:
 *
 *   cd ../openplate-core && ADMIN_TOKEN=... pnpm sync-api accounts set-expiry <id> --allowance-expires <iso|none>
 *
 * ── THE TWO CREDENTIALS, BOTH FROM THE ENVIRONMENT AND ONLY FROM THERE ──────
 * `OPENPLATE_SYNC_ADMIN_TOKEN`, or `ADMIN_TOKEN` under the name
 * `openplate-core`'s own CLI reads (`openplate-core/scripts/sync-api/main.ts`
 * line 147), moves the date. `WALK_SESSION_TOKEN` is the walker's ACCESS token
 * from the browser session they just opened, and it reads the account back.
 * Neither has a flag: a credential in argv is a credential in the shell
 * history and is visible in `ps`. Neither is ever printed, quoted in an error,
 * or written into any string this file builds.
 *
 * ── THE EXACT COMMAND LINE ──────────────────────────────────────────────────
 *
 *   toolbox run -c ts-dev env CI=true SYNC_SERVER_URL=https://api.openplate.de \
 *     ADMIN_TOKEN="$OPENPLATE_CONSUMER_ADMIN_TOKEN" WALK_SESSION_TOKEN="$WALK_SESSION_TOKEN" \
 *     pnpm -C openplate exec node --import tsx scripts/walk-trial-expiry.ts
 *
 * `--account <id|handle>` is accepted and is only ever a CONFIRMATION: the
 * account walked is always the one the session token belongs to, because a
 * door computed for one account and a date written on another would pass while
 * proving nothing. A reference that names a different account is refused.
 *
 * ── WHERE EVERY FACT COMES FROM ─────────────────────────────────────────────
 * - `PATCH /v1/admin/accounts/:id` with `{ "allowanceExpiresAt": <iso|null> }`,
 *   bearer `Authorization`: `openplate-core/src/server/admin-routes.ts:810` is
 *   the route, `:462` documents the field, and
 *   `openplate-core/scripts/sync-api/client.ts:157` is the header.
 * - `GET /v1/auth/account`, bearer `Authorization`, answering
 *   `{ account: AccountViewWire }`: `app/lib/sync/engine/client/auth-client.ts:781`,
 *   with `allowanceExpiresAt` at `app/lib/sync/engine/client/auth-wire.ts:85`.
 * - `GET /health` carries the instance descriptor, and `plans` plus
 *   `memberInvites` are read from it by the app's own decoder,
 *   `readHandshakeInstance` (`app/lib/sync/engine/protocol.ts:337`).
 * - The door rule is `resolveAiIntakeDoor`
 *   (`app/components/add/use-ai-connection.ts:147`), which returns
 *   `{ kind: 'plans', endedAt }` only with `plansAvailable` true and an ended
 *   allowance.
 *
 * Owned by `.tracker/M214-openplate-launch-paid-version/05-the-trial-expires-into-the-plans-door.md`.
 * Nothing here buys anything; spec 04 owns the checkout.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';
import { z } from 'zod';

import { resolveAiIntakeDoor, type AiIntakeDoor } from '../app/components/add/use-ai-connection';
import { AUTH_API_PREFIX } from '../app/lib/sync/engine/client/auth-wire';
import { readHandshakeInstance, type InstanceDescriptor, type JsonValue } from '../app/lib/sync/engine/protocol';

const DEFAULT_BASE_URL = 'http://localhost:3000';

const MS_PER_DAY = 86_400_000;

/**
 * The instance serves the AI itself, which is what makes an allowance the only
 * thing that can be missing.
 *
 * A CONSTANT RATHER THAN A READ, because the walk only exists on a managed
 * consumer instance: an open instance answers `byok` for everybody and has no
 * allowance to expire. `CONFIG` is not consulted, because the mode being
 * checked belongs to the instance at `--url` and not to this checkout.
 */
const AI_COMES_FROM_THE_INSTANCE = true;

const USAGE = `walk-trial-expiry, move a trial's end date to yesterday and read the door it opens

  Usage: node --import tsx scripts/walk-trial-expiry.ts [options]

  Options:
    --url <base>         Service base URL (default: SYNC_SERVER_URL, else ${DEFAULT_BASE_URL})
    --account <id|handle> Confirms which account is walked. The session token
                         decides; a reference that names another account is refused
    --help

  Authentication:
    OPENPLATE_SYNC_ADMIN_TOKEN, or ADMIN_TOKEN, moves the date over /v1/admin
    WALK_SESSION_TOKEN is the walker's access token and reads the account back

    Neither has a flag, on purpose. Neither is ever printed.

  IT OVERWRITES A REAL DATE ON A REAL ACCOUNT. The old value is printed before
  the write, and putting it back is a person's job:

    cd ../openplate-core && ADMIN_TOKEN=... pnpm sync-api accounts set-expiry <id> --allowance-expires <iso|none>
`;

/** A failure with a sentence for the operator and no stack trace worth printing. */
export class WalkError extends Error {}

/** Everything the walk needs, after parsing. */
export interface WalkInvocation {
  baseUrl: string;
  /** The account id or handle the operator named, or `null` for "the session's own account". */
  account: string | null;
  help: boolean;
}

/**
 * The command line. PURE: it reads `SYNC_SERVER_URL` through no global of its
 * own, so the test drives it with an explicit environment.
 */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): WalkInvocation {
  const { values } = parseNodeArgs({
    args: argv,
    options: {
      url: { type: 'string' },
      account: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  const account = values.account;
  if (account !== undefined && account.trim() === '') {
    throw new WalkError('--account needs an account id or a handle, e.g. `--account 42` or `--account someone@example.com`.');
  }

  return {
    baseUrl: values.url ?? env.SYNC_SERVER_URL ?? DEFAULT_BASE_URL,
    account: account === undefined ? null : account.trim(),
    help: values.help === true,
  };
}

/**
 * Yesterday, as the instant the allowance is moved to.
 *
 * PURE, AND THE CLOCK IS AN ARGUMENT, for the reason `resolveAllowanceDoor`
 * takes one: the boundary is the whole subject here, and a function that read
 * its own clock could not be tested at it.
 *
 * A WHOLE DAY BACK rather than a second, so a service whose clock runs a
 * little behind this laptop's still reads the date as passed. The proxy
 * refuses from the instant on (`PROTOCOL.md` 5.19), and a margin of seconds
 * would make this walk flaky for a reason that has nothing to do with the door.
 */
export function yesterdayIso(today: Date): string {
  return new Date(today.getTime() - MS_PER_DAY).toISOString();
}

/** Whether the operator's `--account` names the account the session token opened. */
export function accountReferenceMatches({
  reference,
  id,
  email,
}: {
  reference: string;
  id: number;
  email: string;
}): boolean {
  const wanted = reference.trim().toLowerCase();
  return wanted === String(id) || wanted === email.trim().toLowerCase();
}

/** The verdict on the door, with the date when there is one, and never a `process.exit`. */
export type DoorAssertion = { ok: true; endedAt: string } | { ok: false; reason: string };

/**
 * THE CHECK THIS SCRIPT EXISTS FOR: the door is `plans` and it carries the
 * date that was just written.
 *
 * The date is compared as an INSTANT and not as a string, because the service
 * re-renders the ISO it stores and a differently spelled equal instant is a
 * pass, not a failure.
 *
 * It returns a verdict and never exits, so the test can drive every failing
 * case as well as the passing one.
 */
export function assertPlansDoor(door: AiIntakeDoor, expectedEndedAt: string): DoorAssertion {
  if (door.kind !== 'plans') {
    return {
      ok: false,
      reason: `the door is "${door.kind}", not "plans". An expired trial on an instance with a biller behind it must offer the plan page.`,
    };
  }
  if (door.endedAt === null) {
    return { ok: false, reason: 'the plans door carries no end date, so the notice cannot name one.' };
  }
  const expected = Date.parse(expectedEndedAt);
  if (Number.isNaN(expected)) {
    return { ok: false, reason: `the date written is not an ISO instant: "${expectedEndedAt}".` };
  }
  const actual = Date.parse(door.endedAt);
  if (Number.isNaN(actual)) {
    return { ok: false, reason: `the door's end date is not an ISO instant: "${door.endedAt}".` };
  }
  if (actual !== expected) {
    return { ok: false, reason: `the door names ${door.endedAt}, and the date written was ${expectedEndedAt}.` };
  }
  return { ok: true, endedAt: door.endedAt };
}

// ---- the impure half ----------------------------------------------------------------------------

/** The body of the one write this script sends. One field, because one field is all it may change. */
interface AccountExpiryPatch {
  allowanceExpiresAt: string;
}

/** One request, named rather than assembled, so the header that carries a credential is part of a fixed shape. */
interface JsonRequest {
  url: string;
  method: 'GET' | 'PATCH';
  /** Absent on `/health`, which is unauthenticated. NEVER printed, quoted or logged. */
  bearer?: string;
  body?: AccountExpiryPatch;
}

/** The one field of `GET /v1/auth/account` this walk reads, plus the two that identify the account. */
const sessionAccountSchema = z.object({
  account: z.object({
    id: z.number(),
    email: z.string(),
    allowanceExpiresAt: z.string().nullable(),
  }),
});

/** What the account looks like from the session, which is the reading the app itself branches on. */
interface SessionAccount {
  id: number;
  email: string;
  allowanceExpiresAt: string | null;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    throw new WalkError(`${name} is not set. Export it in your shell; there is no flag for it.`);
  }
  return value;
}

/**
 * The admin token, under either name.
 *
 * `openplate-core`'s CLI reads `ADMIN_TOKEN` and the workspace `.env` carries
 * `OPENPLATE_SYNC_ADMIN_TOKEN`, so both are accepted and the workspace name
 * wins. The message names both rather than picking one, because an operator
 * who exported the other has done nothing wrong.
 */
function requireAdminToken(): string {
  const workspace = process.env.OPENPLATE_SYNC_ADMIN_TOKEN?.trim();
  if (workspace !== undefined && workspace !== '') return workspace;
  const cli = process.env.ADMIN_TOKEN?.trim();
  if (cli !== undefined && cli !== '') return cli;
  throw new WalkError(
    'Neither OPENPLATE_SYNC_ADMIN_TOKEN nor ADMIN_TOKEN is set. One of them must hold the admin token the service was started with; there is no flag for it.',
  );
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * One request, one decoded JSON answer.
 *
 * A FAILURE BODY IS NOT READ, following `openplate-core/scripts/sync-api/client.ts`:
 * `--url` points wherever the operator says, and a proxy's error page quotes
 * the request it rejected, which here would be a bearer token. The status is
 * the only thing taken from a non-2xx answer, and the transport error is
 * discarded rather than quoted for the same reason.
 */
async function requestJson(request: JsonRequest): Promise<JsonValue> {
  const headers = new Headers({ Accept: 'application/json' });
  if (request.bearer !== undefined) headers.set('Authorization', `Bearer ${request.bearer}`);
  if (request.body !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch {
    throw new WalkError(`Could not reach ${request.url}. Is the instance up, and is --url (or SYNC_SERVER_URL) right?`);
  }

  if (!response.ok) {
    throw new WalkError(
      `${request.method} ${request.url} answered ${response.status}. The body is deliberately not quoted; the service's own log has the reason.`,
    );
  }

  const text = await response.text();
  try {
    // SAFETY: `JSON.parse` returns exactly the `JsonValue` union by definition.
    // The shape underneath is unproven and is decoded by a schema, or by the
    // app's own handshake decoder, before any field is read.
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new WalkError(`${request.url} answered with something that is not JSON. That address is probably not an openplate-core instance.`);
  }
}

/** The instance's self description, read with the app's own decoder rather than a second one. */
async function readInstance(baseUrl: string): Promise<InstanceDescriptor> {
  const instance = readHandshakeInstance(await requestJson({ url: joinUrl(baseUrl, '/health'), method: 'GET' }));
  if (instance === null) {
    throw new WalkError(
      `${baseUrl} answered /health without an instance descriptor. Either it is not an openplate-core instance, or it is older than the descriptor.`,
    );
  }
  return instance;
}

/** The account, as the signed-in walker's own app reads it. */
async function readSessionAccount({ baseUrl, sessionToken }: { baseUrl: string; sessionToken: string }): Promise<SessionAccount> {
  const body = await requestJson({
    url: joinUrl(baseUrl, `${AUTH_API_PREFIX}/account`),
    method: 'GET',
    bearer: sessionToken,
  });
  const parsed = sessionAccountSchema.safeParse(body);
  if (!parsed.success) {
    throw new WalkError(`${baseUrl} answered ${AUTH_API_PREFIX}/account with an undocumented body. The response is not quoted.`);
  }
  return parsed.data.account;
}

/** Moves the account's allowance to `endsAt`. The one write in this file. */
async function writeExpiry({
  baseUrl,
  adminToken,
  accountId,
  endsAt,
}: {
  baseUrl: string;
  adminToken: string;
  accountId: number;
  endsAt: string;
}): Promise<void> {
  await requestJson({
    url: joinUrl(baseUrl, `/v1/admin/accounts/${accountId}`),
    method: 'PATCH',
    bearer: adminToken,
    body: { allowanceExpiresAt: endsAt },
  });
}

async function main(argv: string[]): Promise<void> {
  const invocation = parseArgs(argv);
  if (invocation.help) {
    process.stdout.write(USAGE);
    return;
  }

  const sessionToken = requireEnv('WALK_SESSION_TOKEN');
  const adminToken = requireAdminToken();

  print(`Instance ${invocation.baseUrl}`);
  const instance = await readInstance(invocation.baseUrl);
  print(`  name          ${instance.name}`);
  print(`  plans         ${instance.plans ? 'yes' : 'no'}`);
  print(`  memberInvites ${instance.memberInvites ? 'yes' : 'no'}`);

  const before = await readSessionAccount({ baseUrl: invocation.baseUrl, sessionToken });
  if (invocation.account !== null && !accountReferenceMatches({ reference: invocation.account, id: before.id, email: before.email })) {
    throw new WalkError(
      `--account named "${invocation.account}", and WALK_SESSION_TOKEN belongs to account ${before.id}. The walk reads the door for the session's own account, so the two must be the same account.`,
    );
  }

  print(`Account ${before.id} (${before.email})`);
  print(`  allowance ends ${before.allowanceExpiresAt ?? 'no end date'}`);

  const endsAt = yesterdayIso(new Date());
  await writeExpiry({ baseUrl: invocation.baseUrl, adminToken, accountId: before.id, endsAt });
  print(`  allowance moved to ${endsAt}`);

  // READ BACK THROUGH THE SESSION rather than trusting the write, because the
  // door is drawn from what the app sees and not from what this script sent.
  const after = await readSessionAccount({ baseUrl: invocation.baseUrl, sessionToken });
  print(`  the app now reads ${after.allowanceExpiresAt ?? 'no end date'}`);

  const door = resolveAiIntakeDoor({
    aiComesFromTheInstance: AI_COMES_FROM_THE_INSTANCE,
    plansAvailable: instance.plans,
    allowance: {
      memberInvites: instance.memberInvites,
      allowanceExpiresAt: after.allowanceExpiresAt,
      now: new Date(),
    },
  });
  print(`Door ${door.kind}`);

  const verdict = assertPlansDoor(door, endsAt);
  if (!verdict.ok) throw new WalkError(`The door is wrong: ${verdict.reason}`);
  print(`  ended at ${verdict.endedAt}`);
  print('The expired trial opens the plans door, with the date. Nothing was bought.');
}

/**
 * Run only when this file is the entry point. The unit test imports the pure
 * exports above, and an unconditional `main()` would send requests from a test
 * run.
 */
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof WalkError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
