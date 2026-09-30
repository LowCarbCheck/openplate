/**
 * The account move (`src/move-accounts/`) against two REAL Postgres databases,
 * with accounts created through the REAL sign-up path under two DIFFERENT
 * secrets, and the target booted afterwards under the source's secret: the
 * switch the tool exists for.
 *
 * ONE SCENARIO IN ORDERED STEPS. node:test runs the tests of a file in order,
 * and each step reads the state the one before left: a dry run, a refused
 * apply, an apply with one account rolled back, the apply that finishes, and
 * an apply with nothing left to do. Each step's assertion comes with a control
 * that would make it fail.
 *
 * THE SOURCE (ids from a fresh sequence):
 *   1 owner    address also on the target, and named by --skip-email
 *   2 anna     moves; blobs, usage, feedback with an image, a declaration, a withdrawal, consent
 *   3 ben      moves; the target corrupts his blob on the first apply, so he moves on the second
 *   4 skipped  named by --skip-email (its id is ALSO taken on the target; the flag wins)
 *   5 clash    refused: id 5 belongs to a different target account
 *   6 twin     refused: the address belongs to target account 4
 * THE TARGET, under another secret: 1 owner (a different account, same
 * address), 4 twin's address, 5 an unrelated resident. The source is migrated
 * and then loses `accounts.label`, which is what a 0.26.1 source looks like.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { setupFreshDatabase, dropDatabase } from './db-harness.js';
import {
  startService,
  sampleAuthHash,
  sampleRecoveryCode,
  sampleCiphertext,
  type ServiceHarness,
} from './service-harness.js';
import { runMove, type MoveOptions, type MoveResult } from '../../src/move-accounts/run.js';
import { computeRecoveryVerifier, deriveRecoveryAuthHash } from '../../src/lib/recovery-auth.js';
import { deriveServerSecrets } from '../../src/lib/server-secrets.js';
import { openRecoveryCode } from '../../src/lib/escrow.js';
import type { DatabaseHandle } from '../../src/db/client.js';

const SOURCE_SECRET = 'move-test-source-root-secret-long-enough';
const TARGET_OLD_SECRET = 'move-test-TARGET-old-root-secret-long-enough';
const LABEL = 'Beta supporter';
const CONSENT_VERSION = '2026-09-28';

interface Person {
  readonly email: string;
  readonly seed: number;
}

const SOURCE_PEOPLE = {
  owner: { email: 'owner@example.org', seed: 1 },
  anna: { email: 'anna@example.org', seed: 2 },
  ben: { email: 'ben@example.org', seed: 3 },
  skipped: { email: 'skipped@example.org', seed: 4 },
  clash: { email: 'clash@example.org', seed: 5 },
  twin: { email: 'twin@example.org', seed: 6 },
} satisfies Record<string, Person>;

const TARGET_PEOPLE = {
  owner: { email: 'owner@example.org', seed: 11 },
  twin: { email: 'twin@example.org', seed: 12 },
  resident: { email: 'resident@example.org', seed: 13 },
} satisfies Record<string, Person>;

function canonicalCode(person: Person): string {
  return sampleRecoveryCode(person.seed).replace(/-/g, '');
}

type Fresh = DatabaseHandle & { url: string };
let source: Fresh;
let target: Fresh;
let sourceDigestAtStart = '';
let targetDigestBeforeApply = '';
const annaBlobs: string[] = [];

async function signUp(input: { service: ServiceHarness; person: Person; dailyAiLimit: number }): Promise<number> {
  const code = canonicalCode(input.person);
  const session = await input.service.signupThroughInvite({
    email: input.person.email,
    dailyAiLimit: input.dailyAiLimit,
    authHash: sampleAuthHash(input.person.seed),
    recoveryCode: sampleRecoveryCode(input.person.seed),
    recoveryAuthHash: deriveRecoveryAuthHash(code),
  });
  return session.account.id;
}

async function login(input: { service: ServiceHarness; person: Person }) {
  return input.service.request<{ tokens: { accessToken: string } }>({
    method: 'POST',
    path: '/v1/auth/login',
    body: { email: input.person.email, authHash: sampleAuthHash(input.person.seed) },
  });
}

async function pushBlob(input: {
  service: ServiceHarness;
  person: Person;
  baseVersion: number;
  seed: number;
}): Promise<string> {
  const token = (await login(input)).body.tokens.accessToken;
  const ciphertext = sampleCiphertext(input.seed, 512);
  const pushed = await input.service.request({
    method: 'POST',
    path: '/v1/sync/blob',
    accessToken: token,
    body: { baseVersion: input.baseVersion, envelopeVersion: 1, ciphertext },
  });
  assert.equal(pushed.status, 200);
  return ciphertext;
}

/** Every table and every sequence of a database, as one digest. Row order and session settings are pinned. */
async function digestDatabase(pool: pg.Pool): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("SET TimeZone = 'UTC'");
    const tables = await client.query<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
    );
    const hash = createHash('sha256');
    for (const { name } of tables.rows) {
      const result = await client.query<{ digest: string }>(
        `SELECT md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS digest FROM "${name}" t`,
      );
      hash.update(`${name}:${result.rows[0]?.digest ?? ''};`);
    }
    const sequences = await client.query<{ entry: string }>(
      "SELECT sequencename || '=' || coalesce(last_value::text, 'unset') AS entry FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1",
    );
    for (const { entry } of sequences.rows) hash.update(`${entry};`);
    return hash.digest('hex');
  } finally {
    client.release();
  }
}

async function seedSource(): Promise<void> {
  const service = await startService({ db: source.db, serverSecret: SOURCE_SECRET });
  try {
    const ids: number[] = [];
    for (const person of Object.values(SOURCE_PEOPLE)) ids.push(await signUp({ service, person, dailyAiLimit: 200 }));
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6], 'a fresh source hands out ids 1 to 6 in sign-up order');
    annaBlobs.push(await pushBlob({ service, person: SOURCE_PEOPLE.anna, baseVersion: 0, seed: 21 }));
    annaBlobs.push(await pushBlob({ service, person: SOURCE_PEOPLE.anna, baseVersion: 1, seed: 22 }));
    await pushBlob({ service, person: SOURCE_PEOPLE.ben, baseVersion: 0, seed: 23 });
    await pushBlob({ service, person: SOURCE_PEOPLE.owner, baseVersion: 0, seed: 24 });
  } finally {
    await service.close();
  }

  // Every other table the move classifies, one or more rows each, so a
  // skipped table that leaked, or a moved one that did not, shows up.
  const statements: [string, unknown[]][] = [
    ['UPDATE accounts SET health_consent_version = $1, health_consent_at = now() WHERE id = 2', [CONSENT_VERSION]],
    [
      "INSERT INTO ai_usage_days (account_id, day, count) VALUES (2, '2026-09-29', 7), (2, '2026-09-30', 3), (3, '2026-09-30', 12)",
      [],
    ],
    [
      "INSERT INTO feedback_reports (account_id, idempotency_key, measurements, has_image, consent_agreed_at, consent_wording_version) VALUES (2, 'report-a', '{\"kcal\": 410}', true, now(), 'v1'), (2, 'report-b', '{\"kcal\": 90}', false, now(), 'v1')",
      [],
    ],
    [
      "INSERT INTO feedback_images (report_id, content_type, bytes) SELECT id, 'image/jpeg', '\\xffd8ffe0'::bytea FROM feedback_reports WHERE idempotency_key = 'report-a'",
      [],
    ],
    [
      "INSERT INTO legal_declarations (id, kind, name, email, language, account_id) VALUES ('0f3c1d5e-0000-4000-8000-000000000002', 'widerruf', 'Anna', 'anna@example.org', 'de', 2), ('0f3c1d5e-0000-4000-8000-00000000000f', 'kuendigung', 'Nobody', 'nobody@example.org', 'en', NULL)",
      [],
    ],
    ["INSERT INTO research_withdrawals (study_account_id, pseudonym) VALUES (2, 'PSEUDONYMWITHDRAWN00000000')", []],
    [
      "INSERT INTO sync_shares (account_id, grantee_account_id, wrapped_dek, recipient_key_fingerprint) VALUES (2, 3, $1, 'fp-ben'), (2, 1, $1, 'fp-owner'), (3, 5, $1, 'fp-clash')",
      [Buffer.alloc(125, 5)],
    ],
    [
      "INSERT INTO research_contributions (contributor_account_id, study_account_id, pseudonym, schema_tier, body, contribution_version) VALUES (3, 2, 'PSEUDONYMBENTOANNA00000000', 'daily-intake:v1', $1, 1), (2, 5, 'PSEUDONYMANNATOCLASH000000', 'daily-intake:v1', $1, 1)",
      [Buffer.alloc(200, 11)],
    ],
    ["INSERT INTO pulse_days (day, meals) VALUES ('2026-09-30', 4)", []],
    ["INSERT INTO pulse_day_contributors (day, account_id) VALUES ('2026-09-30', 2)", []],
    ["INSERT INTO pulse_presence (account_id, expires_at) VALUES (2, now() + interval '20 minutes')", []],
    ["INSERT INTO pulse_idempotency (key, account_id) VALUES ('pulse-key-anna', 2)", []],
    [
      "INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth, time_zone, locale, last_seen_day) VALUES (2, 'https://push.example.org/anna', 'p', 'a', 'Europe/Berlin', 'de', '2026-09-30')",
      [],
    ],
    [
      "INSERT INTO password_resets (account_id, token_hash, expires_at) VALUES (2, 'reset-digest-anna', now() + interval '1 hour')",
      [],
    ],
    ["INSERT INTO ai_trial_intakes (account_id, intake_id, created_at) VALUES (2, 'intake-anna', now())", []],
    ["INSERT INTO trial_address_hashes (hash) VALUES ('hash-of-a-deleted-mailbox')", []],
    ["INSERT INTO ai_instance_days (day, count) VALUES ('2026-09-30', 22)", []],
    ["INSERT INTO instance_settings (id, nutrient_reference_basis) VALUES (1, 'dge')", []],
    // What a 0.26.1 source looks like: no label column. Last, because the
    // service above selects it.
    ['ALTER TABLE accounts DROP COLUMN label', []],
  ];
  for (const [text, values] of statements) await source.pool.query(text, values);
}

async function seedTarget(): Promise<void> {
  const service = await startService({ db: target.db, serverSecret: TARGET_OLD_SECRET });
  try {
    assert.equal(await signUp({ service, person: TARGET_PEOPLE.owner, dailyAiLimit: 200 }), 1);
    await target.pool.query("SELECT setval('accounts_id_seq', 3, true)");
    assert.equal(await signUp({ service, person: TARGET_PEOPLE.twin, dailyAiLimit: 0 }), 4);
    assert.equal(await signUp({ service, person: TARGET_PEOPLE.resident, dailyAiLimit: 0 }), 5);
  } finally {
    await service.close();
  }
}

function optionsFor(input: { mode: MoveOptions['mode']; sourceServerSecret?: string }): MoveOptions {
  return {
    mode: input.mode,
    sourceDatabaseUrl: source.url,
    targetDatabaseUrl: target.url,
    sourceServerSecret: input.sourceServerSecret ?? SOURCE_SECRET,
    targetOldServerSecret: TARGET_OLD_SECRET,
    skipEmails: [SOURCE_PEOPLE.owner.email, SOURCE_PEOPLE.skipped.email],
    standing: { dailyAiLimit: 10, label: LABEL },
  };
}

async function move(options: MoveOptions): Promise<{ result: MoveResult; lines: string[] }> {
  const lines: string[] = [];
  const result = await runMove({ options, write: (line) => lines.push(line) });
  return { result, lines };
}

async function read(pool: pg.Pool, sql: string) {
  return (await pool.query(sql)).rows;
}

function decisionKinds(result: MoveResult): string[] {
  return result.decisions.map((decision) => `${decision.id}:${decision.kind}`);
}

before(async () => {
  source = await setupFreshDatabase({ suffix: 'move_source' });
  target = await setupFreshDatabase({ suffix: 'move_target' });
  await seedSource();
  await seedTarget();
  sourceDigestAtStart = await digestDatabase(source.pool);
});

after(async () => {
  await source.close();
  await target.close();
  await dropDatabase({ url: source.url });
  await dropDatabase({ url: target.url });
});

test('a dry run plans every account, proves every escrow, and writes nothing to either side', async () => {
  targetDigestBeforeApply = await digestDatabase(target.pool);
  const { result, lines } = await move(optionsFor({ mode: 'dry-run' }));

  assert.equal(result.status, 'ready', lines.join('\n'));
  assert.deepEqual(decisionKinds(result), [
    '1:skipped-by-flag',
    '2:move',
    '3:move',
    '4:skipped-by-flag',
    '5:id-taken',
    '6:email-taken',
  ]);
  assert.deepEqual(
    [...result.residents].map(([id, outcome]) => `${id}:${outcome.kind}`),
    ['1:would-reseal', '4:would-reseal', '5:would-reseal'],
  );
  assert.deepEqual(result.sequence, { before: 5, after: 6 });
  assert.equal(await digestDatabase(target.pool), targetDigestBeforeApply, 'a dry run leaves the target byte for byte');
  assert.equal(await digestDatabase(source.pool), sourceDigestAtStart, 'a dry run leaves the source byte for byte');
});

test('the output names ids and counts, never an address, a secret or a password', async () => {
  const { lines } = await move(optionsFor({ mode: 'dry-run' }));
  const output = lines.join('\n');
  const forbidden = [
    ...Object.values(SOURCE_PEOPLE).map((person) => person.email),
    ...Object.values(TARGET_PEOPLE).map((person) => person.email),
    SOURCE_SECRET,
    TARGET_OLD_SECRET,
    new URL(source.url).password,
  ];
  for (const value of forbidden) assert.ok(!output.includes(value), 'the output leaked a value it must never print');
  // Control: the check is not vacuous. The masked owner is there, and the
  // account lines are, so an unmasked address would have had a place to be.
  assert.ok(output.includes('o***@***.org'));
  assert.ok(output.includes('account 2: moves'));
});

test('a wrong SOURCE_SERVER_SECRET refuses before the first write', async () => {
  const { result } = await move(
    optionsFor({ mode: 'apply', sourceServerSecret: 'a-wrong-source-secret-that-opens-nothing' }),
  );
  assert.equal(result.status, 'refused');
  assert.ok(result.problems.includes('source account 2: the escrow does not open under SOURCE_SERVER_SECRET'));
  assert.equal(await digestDatabase(target.pool), targetDigestBeforeApply, 'a refused apply writes nothing');
});

test('apply commits account by account and rolls back the one whose rows the target changed', async () => {
  // The target corrupts every blob of account 3 on the way in, the way a
  // broken driver, a trigger or a disk would. The comparison must see it.
  await target.pool.query(`
    CREATE FUNCTION corrupt_account_three() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.account_id = 3 THEN NEW.ciphertext := NEW.ciphertext || '\\x00'::bytea; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER corrupt_account_three BEFORE INSERT ON sync_blobs FOR EACH ROW EXECUTE FUNCTION corrupt_account_three();
  `);
  try {
    const { result, lines } = await move(optionsFor({ mode: 'apply' }));
    assert.equal(result.status, 'incomplete', lines.join('\n'));
    assert.equal(result.moved.get(2)?.kind, 'committed');
    const ben = result.moved.get(3);
    assert.equal(ben?.kind, 'rolled-back');
    assert.match(ben?.kind === 'rolled-back' ? ben.reason : '', /sync_blobs/);
    const present = await target.pool.query<{ id: number }>('SELECT id FROM accounts ORDER BY id');
    assert.deepEqual(
      present.rows.map((row) => row.id),
      [1, 2, 4, 5],
      'account 3 left nothing behind',
    );
    const shares = await target.pool.query('SELECT 1 FROM sync_shares');
    assert.equal(shares.rowCount, 0, 'the share between 2 and 3 waits for 3');
    assert.deepEqual(
      [...result.residents].map(([id, outcome]) => `${id}:${outcome.kind}`),
      ['1:resealed', '4:resealed', '5:resealed'],
    );
    // Control: this apply did write.
    assert.notEqual(await digestDatabase(target.pool), targetDigestBeforeApply);
  } finally {
    await target.pool.query('DROP TRIGGER corrupt_account_three ON sync_blobs; DROP FUNCTION corrupt_account_three()');
  }
});

test('the next apply moves the rolled-back account, and the share between the two travels with it', async () => {
  const { result, lines } = await move(optionsFor({ mode: 'apply' }));
  assert.equal(result.status, 'applied', lines.join('\n'));
  assert.deepEqual(decisionKinds(result).slice(1, 3), ['2:already-moved', '3:move']);
  assert.deepEqual([...result.moved.keys()], [3]);
  assert.equal(result.moved.get(3)?.kind, 'committed');
  assert.deepEqual(
    [...result.residents.values()].map((outcome) => outcome.kind),
    ['already-resealed', 'already-resealed', 'already-resealed'],
  );
  const shares = await target.pool.query<{ pair: string }>(
    "SELECT account_id || '>' || grantee_account_id AS pair FROM sync_shares ORDER BY 1",
  );
  assert.deepEqual(
    shares.rows.map((row) => row.pair),
    ['2>3'],
    'shares to accounts that stay are left behind',
  );
});

test('a third apply finds nothing to do and writes nothing', async () => {
  const digestBefore = await digestDatabase(target.pool);
  const { result } = await move(optionsFor({ mode: 'apply' }));
  assert.equal(result.status, 'applied');
  assert.equal(result.moved.size, 0);
  assert.equal(await digestDatabase(target.pool), digestBefore);
});

test('the moved rows are the source rows, with the new standing, and nothing skipped came along', async () => {
  const copiedColumns =
    "id, email, display_name, role, verifier, recovery_verifier, encode(recovery_code_escrow, 'hex') AS escrow, " +
    'kdf_descriptor::text AS kdf, health_consent_version, health_consent_at::text AS consent_at, created_at::text AS created_at';
  assert.deepEqual(
    await read(target.pool, `SELECT ${copiedColumns} FROM accounts WHERE id IN (2, 3) ORDER BY id`),
    await read(source.pool, `SELECT ${copiedColumns} FROM accounts WHERE id IN (2, 3) ORDER BY id`),
  );
  const standing = await read(
    target.pool,
    'SELECT daily_ai_limit, allowance_expires_at, trial_scans, trial_scans_used, trial_ends_at, label, health_consent_version FROM accounts WHERE id = 2',
  );
  assert.deepEqual(standing, [
    {
      daily_ai_limit: 10,
      allowance_expires_at: null,
      trial_scans: null,
      trial_scans_used: 0,
      trial_ends_at: null,
      label: LABEL,
      health_consent_version: CONSENT_VERSION,
    },
  ]);
  // Control: the source granted 200, so 10 is the move's doing.
  assert.deepEqual(await read(source.pool, 'SELECT daily_ai_limit FROM accounts WHERE id = 2'), [
    { daily_ai_limit: 200 },
  ]);

  for (const table of ['sync_key_records', 'sync_blobs']) {
    const columns =
      table === 'sync_blobs'
        ? "account_id, blob_version, encode(sha256(ciphertext), 'hex') AS hash, size_bytes, created_at::text AS created_at"
        : "account_id, kind, kdf_descriptor::text AS kdf, encode(wrapped_dek, 'hex') AS wrap, updated_at::text AS updated_at";
    const sql = `SELECT ${columns} FROM ${table} WHERE account_id IN (2, 3) ORDER BY 1, 2`;
    assert.deepEqual(await read(target.pool, sql), await read(source.pool, sql), `${table} match row for row`);
  }
  const annaVersions = await read(
    target.pool,
    "SELECT encode(ciphertext, 'base64') AS c FROM sync_blobs WHERE account_id = 2 ORDER BY blob_version",
  );
  assert.deepEqual(
    annaVersions.map((row) => String(row.c).replace(/\n/g, '')),
    annaBlobs,
  );
  // Control: the owner's source blob exists and did not move.
  assert.equal((await source.pool.query('SELECT 1 FROM sync_blobs WHERE account_id = 1')).rowCount, 1);
  assert.equal((await target.pool.query('SELECT 1 FROM sync_blobs WHERE account_id = 1')).rowCount, 0);

  const moved: [string, number][] = [
    ['SELECT 1 FROM ai_usage_days WHERE account_id IN (2, 3)', 3],
    ['SELECT 1 FROM feedback_reports WHERE account_id = 2', 2],
    [
      "SELECT 1 FROM feedback_images i JOIN feedback_reports r ON r.id = i.report_id WHERE r.idempotency_key = 'report-a' AND i.bytes = '\\xffd8ffe0'::bytea",
      1,
    ],
    ["SELECT 1 FROM legal_declarations WHERE id = '0f3c1d5e-0000-4000-8000-000000000002' AND account_id = 2", 1],
    ['SELECT 1 FROM legal_declarations WHERE account_id IS NULL', 0],
    ['SELECT 1 FROM research_withdrawals WHERE study_account_id = 2', 1],
    ['SELECT 1 FROM research_contributions WHERE contributor_account_id = 3 AND study_account_id = 2', 1],
    ['SELECT 1 FROM research_contributions WHERE study_account_id = 5', 0],
  ];
  for (const [sql, rows] of moved) assert.equal((await target.pool.query(sql)).rowCount, rows, sql);

  const skipped = [
    'SELECT 1 FROM account_tokens WHERE account_id IN (2, 3)',
    'SELECT 1 FROM password_resets WHERE account_id = 2',
    'SELECT 1 FROM push_subscriptions WHERE account_id = 2',
    "SELECT 1 FROM signup_invites WHERE email = 'anna@example.org'",
    'SELECT 1 FROM ai_trial_intakes WHERE account_id = 2',
    'SELECT 1 FROM pulse_day_contributors WHERE account_id = 2',
    'SELECT 1 FROM pulse_presence WHERE account_id = 2',
    'SELECT 1 FROM pulse_idempotency WHERE account_id = 2',
    "SELECT 1 FROM trial_address_hashes WHERE hash = 'hash-of-a-deleted-mailbox'",
    'SELECT 1 FROM pulse_days',
    'SELECT 1 FROM instance_settings',
  ];
  for (const sql of skipped) {
    assert.equal((await target.pool.query(sql)).rowCount, 0, `skipped, yet present on the target: ${sql}`);
    // Control: the source has the row the target must not.
    assert.ok(((await source.pool.query(sql)).rowCount ?? 0) > 0, `the fixture must have a row for: ${sql}`);
  }

  const next = await target.pool.query<{ id: string }>("SELECT nextval('accounts_id_seq')::text AS id");
  assert.equal(next.rows[0]?.id, '7', 'a sign-up after the move gets an id past every source id');
});

test('the source is exactly as it was before the first run', async () => {
  assert.equal(await digestDatabase(source.pool), sourceDigestAtStart);
  // Control: the digest sees a one-cell change.
  const client = await source.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE accounts SET display_name = 'changed' WHERE id = 6");
    const changed = await client.query<{ n: string }>(
      "SELECT md5(string_agg(t::text, '' ORDER BY t::text)) AS n FROM accounts t",
    );
    const original = await source.pool.query<{ n: string }>(
      "SELECT md5(string_agg(t::text, '' ORDER BY t::text)) AS n FROM accounts t",
    );
    assert.notEqual(changed.rows[0]?.n, original.rows[0]?.n);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('the resident accounts are re-sealed under the source secret, their codes unchanged', async () => {
  const next = deriveServerSecrets(SOURCE_SECRET);
  const previous = deriveServerSecrets(TARGET_OLD_SECRET);
  const rows = await target.pool.query<{ id: number; escrow: Buffer; recovery_verifier: string }>(
    'SELECT id, recovery_code_escrow AS escrow, recovery_verifier FROM accounts WHERE id IN (1, 4, 5) ORDER BY id',
  );
  const people = [TARGET_PEOPLE.owner, TARGET_PEOPLE.twin, TARGET_PEOPLE.resident];
  for (const [index, row] of rows.rows.entries()) {
    const person = people[index];
    assert.ok(person !== undefined);
    const code = canonicalCode(person);
    assert.equal(openRecoveryCode({ sealed: row.escrow, escrowKey: next.escrowKey }), code);
    assert.equal(row.recovery_verifier, computeRecoveryVerifier({ code, pepper: next.verifierPepper }));
    // Control: the old key no longer opens it.
    assert.throws(() => openRecoveryCode({ sealed: row.escrow, escrowKey: previous.escrowKey }));
  }
});

test('after the switch the target signs moved people in and serves their diary; the old secret does not', async () => {
  const switched = await startService({ db: target.db, serverSecret: SOURCE_SECRET });
  try {
    const anna = await login({ service: switched, person: SOURCE_PEOPLE.anna });
    assert.equal(anna.status, 200);
    const pulled = await switched.request<{ blobVersion: number; ciphertext: string }>({
      method: 'GET',
      path: '/v1/sync/blob',
      accessToken: anna.body.tokens.accessToken,
    });
    assert.equal(pulled.status, 200);
    assert.equal(pulled.body.blobVersion, 2);
    assert.equal(pulled.body.ciphertext, annaBlobs[1]);
    assert.equal((await login({ service: switched, person: SOURCE_PEOPLE.ben })).status, 200);

    // The resident owner: the password cannot be re-keyed (the reported
    // mailed reset), and the recovery path works under the new secret.
    assert.equal((await login({ service: switched, person: TARGET_PEOPLE.owner })).status, 401);
    const recovered = await switched.request({
      method: 'POST',
      path: '/v1/auth/recover',
      body: {
        email: TARGET_PEOPLE.owner.email,
        recoveryAuthHash: deriveRecoveryAuthHash(canonicalCode(TARGET_PEOPLE.owner)),
      },
    });
    assert.equal(recovered.status, 200);
    const asked = await switched.request({
      method: 'POST',
      path: '/v1/auth/reset/request',
      body: { email: TARGET_PEOPLE.owner.email },
    });
    assert.equal(asked.status, 202);
    const resetToken = switched.mailer.resets.at(-1)?.resetToken;
    assert.ok(resetToken !== undefined, 'the reset letter was asked for');
    const opened = await switched.request<{ recoveryCode: string }>({
      method: 'POST',
      path: '/v1/auth/reset/open',
      body: { resetToken },
    });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.recoveryCode, canonicalCode(TARGET_PEOPLE.owner));
  } finally {
    await switched.close();
  }

  // Control: the same database under the target's OLD secret refuses both.
  const unswitched = await startService({ db: target.db, serverSecret: TARGET_OLD_SECRET });
  try {
    assert.equal((await login({ service: unswitched, person: SOURCE_PEOPLE.anna })).status, 401);
    const recovered = await unswitched.request({
      method: 'POST',
      path: '/v1/auth/recover',
      body: {
        email: TARGET_PEOPLE.owner.email,
        recoveryAuthHash: deriveRecoveryAuthHash(canonicalCode(TARGET_PEOPLE.owner)),
      },
    });
    assert.equal(recovered.status, 401);
  } finally {
    await unswitched.close();
  }
});
