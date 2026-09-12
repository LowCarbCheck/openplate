/**
 * `pnpm seed:test-account` — one command that leaves you with an account you
 * can sign in as, and a diary worth looking at.
 *
 * It exists because of a real gap. There is no login on this app's own server,
 * so "sign in and check the incident" needs an account on a separately
 * deployed `openplate-core`; and the diary is local-first, so a fresh browser
 * holds nothing and every review of a screen starts on an empty app. Two
 * halves, two places, one script:
 *
 *  1. THE ACCOUNT, on the sync service. An invite is minted over `/v1/admin`
 *     and redeemed here, with the real client crypto, into a real account with
 *     a passphrase you chose.
 *  2. THE DIARY, on the device. A deterministic multi-week backup envelope
 *     (`lib/seed-diary.ts`), written to a file you restore at `/settings/data`,
 *     and — unless you say otherwise — also pushed to the account as encrypted
 *     state, so a fresh device pulls a populated diary on its first sign-in.
 *
 * ── THE ACCOUNT IT CREATES IS A REAL ACCOUNT ────────────────────────────────
 * Nothing about it is a test double. It occupies an address, it holds a blob,
 * and it stays there until somebody removes it. Delete it when you are done:
 *
 *   cd ../openplate-core
 *   ADMIN_TOKEN=… pnpm sync-api accounts list
 *   ADMIN_TOKEN=… pnpm sync-api accounts delete <id> --yes
 *
 * ── LOCALHOST IS THE DEFAULT, AND ANYTHING ELSE IS A DELIBERATE ACT ─────────
 * `--url`, then `SYNC_SERVER_URL`, then `http://localhost:3000` — the same
 * precedence `openplate-core/scripts/sync-api/main.ts` documents, and no
 * `--production` shortcut for the same reason it has none. A non-loopback host
 * additionally needs `--allow-remote`, and the host being written to is
 * printed before the first request either way. There is no production URL
 * anywhere in this file; the operator supplies every address.
 *
 * ── CREDENTIALS COME FROM THE ENVIRONMENT, AND ONLY FROM THERE ──────────────
 * `ADMIN_TOKEN` mints the invite and `SEED_PASSPHRASE` becomes the account's
 * password. Neither has a flag, deliberately: a credential in argv is a
 * credential in your shell history and is visible in `ps` to every other user
 * on the box for as long as the command runs. A missing one is an error that
 * names the variable, raised before any request is built.
 */
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { serializeBackup } from '../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../app/lib/local-store/schema';
import type { LocalStoreSnapshot } from '../app/lib/local-store/schema';
import { isValidTimeZone } from '../app/lib/user-days';
import { SyncAuthClient } from '../app/lib/sync/engine/client/auth-client';
import { SyncHttpClient } from '../app/lib/sync/engine/client/http-client';
import { setupSyncKeys } from '../app/lib/sync/engine/client/setup-keys';
import { deriveArgon2idHash } from '../app/lib/sync/engine/crypto/argon2';
import { deriveRecoveryAuthHash, generateRecoveryCode } from '../app/lib/sync/engine/client/recovery-kek';
import { bytesToBase64 } from '../app/lib/sync/engine/crypto/base64';
import { runSyncCycleUnlocked } from '../app/lib/sync/orchestrator';
import {
  createPrivateStoreSession,
  sealedCompartmentOrNull,
  sealOwnerPrivateRegion,
} from '../app/lib/sync/private-store';
import { partitionSnapshot, type SyncedSnapshot } from '../app/lib/sync/snapshot-partition';
import { createMemoryStorage, createSyncStateStore } from '../app/lib/sync/sync-state';
import { normalizeInviteToken, parseJoinLinkInput } from '../app/lib/join-link';
import { buildSeedDiary, MAX_SEED_WEEKS, summarizeSeedDiary, type SeedDiarySummary } from './lib/seed-diary';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_WEEKS = 3;
const DEFAULT_SEED = 'openplate-seed';
const DEFAULT_TIMEZONE = 'Europe/Berlin';
const DEFAULT_OUT = 'seed-diary.json';

/**
 * An address in a reserved, undeliverable TLD (RFC 2606). Obviously fake at a
 * glance in an account list, and mail to it can never reach a real person by
 * accident if the instance has a mailer configured.
 */
const DEFAULT_EMAIL = 'openplate-seed@example.invalid';

/** The device this script claims to be, in the sync metadata it stamps. Fixed, so a re-run is the same device. */
const SEED_DEVICE_ID = 'seed-test-account';

const USAGE = `seed-test-account — a test account and a diary worth looking at

  Usage: pnpm seed:test-account [options]

  By default it mints an invite, redeems it into a real account, writes the
  diary to a file, and pushes that diary to the account as encrypted state.

  Options:
    --weeks <n>            Weeks of diary, 1-${MAX_SEED_WEEKS} (default ${DEFAULT_WEEKS})
    --seed <text>          PRNG seed; the same seed picks the same foods (default "${DEFAULT_SEED}")
    --end-day <YYYY-MM-DD> Last day of the diary (default: today in --timezone)
    --timezone <iana>      Zone every logged time is local to (default ${DEFAULT_TIMEZONE})
    --out <path>           Where the restorable backup JSON is written (default ${DEFAULT_OUT})
    --url <base>           Service base URL (default: SYNC_SERVER_URL, else ${DEFAULT_BASE_URL})
    --email <address>      Who the account is for (default ${DEFAULT_EMAIL})
    --display-name <text>  The name carried onto the account
    --daily-ai-limit <n>   AI requests a day for the account (default 0)
    --allow-remote         Required for any --url that is not loopback
    --diary-only           Write the diary file and stop. Touches no network
    --no-push              Create the account but leave its blob empty
    --help

  Authentication:
    ADMIN_TOKEN      must be set: it mints the invite over /v1/admin
    SEED_PASSPHRASE  must be set: it becomes the account's password

    Neither has a flag, on purpose: a credential in argv is a credential in
    your shell history. --diary-only needs neither.

  THE ACCOUNT THIS CREATES IS A REAL ACCOUNT. It is not a test double and
  nothing removes it for you. When you are done:

    cd ../openplate-core && ADMIN_TOKEN=... pnpm sync-api accounts delete <id> --yes

  Restoring the diary on a device: open /settings/data and upload the written
  file. A fresh browser must be walked past onboarding first, or /settings/data
  is unreachable.
`;

/** Everything the two halves need, after parsing and validation. */
interface Invocation {
  weeks: number;
  seed: string;
  endDay: string | undefined;
  timezone: string;
  outPath: string;
  baseUrl: string;
  email: string;
  displayName: string | null;
  dailyAiLimit: number;
  allowRemote: boolean;
  diaryOnly: boolean;
  push: boolean;
}

/** A failure with a sentence for the operator and no stack trace worth printing. */
class SeedError extends Error {}

function parseWholeNumber({ raw, name, min, max }: { raw: string; name: string; min: number; max: number }): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SeedError(`${name} must be a whole number between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseInvocation(argv: string[]): Invocation {
  const { values } = parseArgs({
    args: argv,
    // `--no-push` is spelled by negation rather than by a `--skip-push` flag of
    // its own, so the two spellings of one decision cannot drift apart.
    allowNegative: true,
    options: {
      weeks: { type: 'string' },
      seed: { type: 'string' },
      'end-day': { type: 'string' },
      timezone: { type: 'string' },
      out: { type: 'string' },
      url: { type: 'string' },
      email: { type: 'string' },
      'display-name': { type: 'string' },
      'daily-ai-limit': { type: 'string' },
      'allow-remote': { type: 'boolean', default: false },
      'diary-only': { type: 'boolean', default: false },
      push: { type: 'boolean', default: true },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help === true) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const endDay = values['end-day'];
  if (endDay !== undefined && !DAY_KEY_PATTERN.test(endDay)) {
    throw new SeedError(`--end-day must be YYYY-MM-DD, got "${endDay}"`);
  }
  const timezone = values.timezone ?? DEFAULT_TIMEZONE;
  if (!isValidTimeZone(timezone)) throw new SeedError(`--timezone is not a valid IANA zone: "${timezone}"`);

  return {
    weeks:
      values.weeks === undefined ?
        DEFAULT_WEEKS
      : parseWholeNumber({ raw: values.weeks, name: '--weeks', min: 1, max: MAX_SEED_WEEKS }),
    seed: values.seed ?? DEFAULT_SEED,
    endDay,
    timezone,
    outPath: resolve(process.cwd(), values.out ?? DEFAULT_OUT),
    baseUrl: values.url ?? process.env.SYNC_SERVER_URL ?? DEFAULT_BASE_URL,
    email: values.email ?? DEFAULT_EMAIL,
    displayName: values['display-name'] ?? null,
    dailyAiLimit:
      values['daily-ai-limit'] === undefined ?
        0
      : parseWholeNumber({ raw: values['daily-ai-limit'], name: '--daily-ai-limit', min: 0, max: 100_000 }),
    allowRemote: values['allow-remote'] === true,
    diaryOnly: values['diary-only'] === true,
    push: values.push !== false,
  };
}

/** The hostnames this script will write to without being told twice. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The safety gate.
 *
 * It refuses BEFORE the first request rather than after a 401, because the
 * thing being guarded against is not a wrong credential: it is a right one
 * pointed at an instance with real people on it. This tool creates accounts,
 * and an account created on somebody's production instance is a row a stranger
 * has to find and delete.
 */
export function assertWritableHost({ baseUrl, allowRemote }: { baseUrl: string; allowRemote: boolean }): string {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    throw new SeedError(`--url is not a URL: "${baseUrl}"`);
  }
  const hostname = new URL(baseUrl).hostname;
  if (LOOPBACK_HOSTS.has(hostname) || allowRemote) return host;
  throw new SeedError(
    `Refusing to create an account on ${host}: it is not localhost. This tool creates REAL accounts, and a production instance has real people on it. Pass --allow-remote if you meant it.`,
  );
}

/** The one field of the admin mint response this script reads, plus the one it falls back to. */
const mintedInviteSchema = z.object({
  link: z.string().nullable().default(null),
  token: z.string().nullable().default(null),
});

/**
 * Mints an addressed invite over `/v1/admin/invites`.
 *
 * The response carries a join LINK when the instance knows where its client
 * lives and a raw TOKEN when it does not, so both are read and the token is
 * pulled out of the link with the app's own fragment parser rather than a
 * second, private copy of that grammar.
 */
async function mintInvite({
  baseUrl,
  adminToken,
  email,
  displayName,
  dailyAiLimit,
}: {
  baseUrl: string;
  adminToken: string;
  email: string;
  displayName: string | null;
  dailyAiLimit: number;
}): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/admin/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, displayName, role: 'member', dailyAiLimit }),
  });
  if (response.status === 404) {
    throw new SeedError(
      'The admin API is not enabled on this instance (404). Set ADMIN_TOKEN in the service environment and restart it.',
    );
  }
  if (!response.ok) {
    throw new SeedError(`Minting an invite failed: ${response.status} ${await response.text()}`);
  }
  const minted = mintedInviteSchema.parse(await response.json());
  const token = minted.token ?? (minted.link === null ? null : parseJoinLinkInput(minted.link).invite);
  const normalized = normalizeInviteToken(token);
  if (normalized === null)
    throw new SeedError('The admin API minted an invite this script could not read a token out of');
  return normalized;
}

/** What redeeming an invite left behind. */
interface SeededAccount {
  accountId: number;
  email: string;
  dek: Uint8Array;
  snapshot: SyncedSnapshot;
  http: SyncHttpClient;
}

/**
 * Redeems the invite into an account, with the real client crypto.
 *
 * ── WHY THE ENGINE AND NOT `createSyncAccount` ─────────────────────────────
 *
 * `sync-actions.ts`'s `createSyncAccount` is the UI's composition and its last
 * line opens the VAULT, which is IndexedDB-backed and has no meaning in a
 * process with no device. Everything under `app/lib/sync/engine/` is free of
 * that: it imports no storage at all, so `setupSyncKeys`, `SyncAuthClient` and
 * `SyncHttpClient` are exactly the production modules, running unmodified.
 * What is NOT reused is the twelve lines that assemble them, and those are
 * reproduced below rather than reached for through a browser shim.
 *
 * Argon2id runs here on the main thread at PRODUCTION parameters, unlike the
 * unit suite which injects tiny ones. It costs about a second and the account
 * this mints has to be openable by a real browser, so the cost is the point.
 */
async function createAccount({
  baseUrl,
  inviteToken,
  passphrase,
  displayName,
  snapshot,
}: {
  baseUrl: string;
  inviteToken: string;
  passphrase: string;
  displayName: string | null;
  snapshot: LocalStoreSnapshot;
}): Promise<SeededAccount> {
  const authClient = new SyncAuthClient({ baseUrl });
  const compatibility = await authClient.handshake();
  if (compatibility.status !== 'compatible') throw new SeedError(compatibility.reason);

  const recovery = generateRecoveryCode();
  const keys = await setupSyncKeys({ passphrase, recoveryCodeRaw: recovery.raw, deriveHash: deriveArgon2idHash });
  const created = await authClient.signup({
    inviteToken,
    authHash: keys.authHash,
    kdfDescriptor: { salt: keys.kdfDescriptor.salt, params: keys.kdfDescriptor.params },
    displayName,
    recoveryAuthHash: await deriveRecoveryAuthHash(recovery.raw),
    recoveryCode: recovery.formatted,
    keyRecords: [
      {
        kind: 'passphrase',
        kdfDescriptor: keys.passphraseKeyRecord.kdfDescriptor,
        wrappedDek: bytesToBase64(keys.passphraseKeyRecord.wrappedDek),
      },
      { kind: 'recovery', kdfDescriptor: null, wrappedDek: bytesToBase64(keys.recoveryKeyRecord.wrappedDek) },
    ],
  });

  // The owner-private compartment, sealed with the one this setup just minted.
  // Pushing `privateStore: null` instead would publish an account whose
  // compartment exists only in this process and can never be opened again,
  // which is the degraded state `private-store.ts` documents rather than a
  // clean fixture.
  const { shareable, ownerPrivate } = partitionSnapshot(snapshot);
  const session = createPrivateStoreSession({
    accountId: created.account.id,
    passphraseKek: keys.privateStoreKek,
    established: keys.privateStore,
  });
  return {
    accountId: created.account.id,
    email: created.account.email,
    dek: keys.dek,
    snapshot: {
      ...shareable,
      privateStore: sealedCompartmentOrNull(
        await sealOwnerPrivateRegion({
          session,
          region: ownerPrivate,
          // NOTHING WAS REMOVED HERE AND NOTHING COULD BE. This process mints
          // the compartment a line above, so the region it seals has only ever
          // grown, and the shrink rule the two arguments feed is never
          // consulted. `hasPersistedDatabase: false` is the honest answer for a
          // node script with no device database at all, rather than a `true`
          // that would be a claim about a browser that is not here.
          deletedEntityKeys: new Set(),
          integrity: { hasPersistedDatabase: false, isTableLoaded: {} },
        }),
      ),
    },
    http: new SyncHttpClient({ baseUrl, tokens: authClient }),
  };
}

/** What the push settled on. */
interface PushOutcome {
  blobVersion: number;
  attempts: number;
}

/**
 * Pushes the seeded diary as the account's first encrypted blob.
 *
 * The REAL cycle (`runSyncCycleUnlocked`), not a hand-rolled encrypt-and-post:
 * the AAD binding, the schema-version stamp, the size cap and the
 * compare-and-swap retry are all decisions this script must not make a second
 * version of. Only the two documented seams are substituted — the snapshot
 * comes from the generated envelope instead of IndexedDB, and applying a merge
 * result is a no-op because there is no device here to apply it to.
 */
async function pushSeedDiary(account: SeededAccount): Promise<PushOutcome> {
  const result = await runSyncCycleUnlocked({
    accountId: account.accountId,
    dek: account.dek,
    http: account.http,
    state: createSyncStateStore({ storage: createMemoryStorage(), accountId: account.accountId }),
    deviceId: SEED_DEVICE_ID,
    readSnapshot: async () => ({
      snapshot: account.snapshot,
      // A GENERATED account with no device behind it. There is no IndexedDB to
      // cross-check and no baseline to lose: the first cycle has nothing to
      // tombstone, so the trusting values here can only ever apply to an empty
      // set (`snapshot-sync.ts`).
      //
      // The DELETE JOURNAL is empty for the same reason: nothing was ever
      // deleted here, so there is nothing to record and nothing to authorise.
      integrity: {
        hasPersistedDatabase: true,
        isTableLoaded: {},
        isCompartmentKnown: true,
        deletedEntityKeys: new Set(),
      },
    }),
    applySnapshot: async () => {},
    // No journal, so nothing to prune.
    forgetPublishedDeletes: async () => {},
    // The account was created moments ago, so a pulled blob can only be one
    // this same run wrote. There is nothing for a veto to refuse.
    assertPulledSnapshot: async () => {},
    // SAFETY: the only snapshot the engine can hand back here is the one
    // `readSnapshot` supplied, which is a `SyncedSnapshot` by construction.
    parseRemoteSnapshot: ({ snapshot }: { snapshot: unknown }) => snapshot as SyncedSnapshot,
  });
  return { blobVersion: result.blobVersion, attempts: result.attempts };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new SeedError(`${name} must be set in the environment. There is no flag for it, on purpose.`);
  }
  return value;
}

function reportDiary({ summary, outPath }: { summary: SeedDiarySummary; outPath: string }): void {
  process.stdout.write(
    [
      `Diary written to ${outPath}`,
      `  schema v${SCHEMA_VERSION}, ${summary.firstDay} to ${summary.lastDay} (${summary.dayCount} days)`,
      `  ${summary.foodLogCount} entries, ${summary.personalFoodCount} saved foods, ${summary.weightEntryCount} weights`,
      `  ${summary.emptyDayCount} days with nothing logged at all`,
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const invocation = parseInvocation(process.argv.slice(2));

  // THE GATE RUNS FIRST, before a single byte is written. A refusal that
  // arrives underneath a "diary written" line reads as a partial success, and
  // the thing being refused is not partial: it is creating an account on
  // somebody else's instance.
  const target =
    invocation.diaryOnly ? null : (
      {
        host: assertWritableHost({ baseUrl: invocation.baseUrl, allowRemote: invocation.allowRemote }),
        adminToken: requireEnv('ADMIN_TOKEN'),
        passphrase: requireEnv('SEED_PASSPHRASE'),
      }
    );

  const envelope = buildSeedDiary({
    weeks: invocation.weeks,
    seed: invocation.seed,
    endDay: invocation.endDay,
    timezone: invocation.timezone,
  });
  await writeFile(invocation.outPath, `${serializeBackup(envelope)}\n`, 'utf8');
  reportDiary({ summary: summarizeSeedDiary(envelope), outPath: invocation.outPath });

  if (target === null) {
    process.stdout.write('--diary-only: no account was created and no request was sent.\n');
    return;
  }

  process.stdout.write(`Creating a REAL account for ${invocation.email} on ${target.host}\n`);

  const inviteToken = await mintInvite({
    baseUrl: invocation.baseUrl,
    adminToken: target.adminToken,
    email: invocation.email,
    displayName: invocation.displayName,
    dailyAiLimit: invocation.dailyAiLimit,
  });
  const account = await createAccount({
    baseUrl: invocation.baseUrl,
    inviteToken,
    passphrase: target.passphrase,
    displayName: invocation.displayName,
    snapshot: envelope.data,
  });
  process.stdout.write(`  account ${account.accountId} (${account.email}) created\n`);

  if (invocation.push) {
    const pushed = await pushSeedDiary(account);
    process.stdout.write(`  diary pushed as blob version ${pushed.blobVersion} in ${pushed.attempts} attempt(s)\n`);
  } else {
    process.stdout.write('  --no-push: the account has no blob; restore the file on a device instead\n');
  }

  process.stdout.write(
    `\nDelete it when you are done:\n  cd ../openplate-core && ADMIN_TOKEN=... pnpm sync-api accounts delete ${account.accountId} --yes\n`,
  );
}

// A `SeedError` is a sentence written for the operator, so it prints as one and
// exits. Anything else is a defect in this script and keeps its stack trace.
try {
  await main();
} catch (error) {
  if (!(error instanceof SeedError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
