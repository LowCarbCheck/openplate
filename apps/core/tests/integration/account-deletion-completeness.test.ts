/**
 * One test proves that an account delete reaches every table of this database
 * and both neighbours (M1 spec 07, 2026-10-05).
 *
 * WHY IT EXISTS. Each earlier piece of M1 added one erase path or one written
 * decision, and nothing proved the whole chain at once. A table added next
 * month, or a step skipped by accident, would stay unseen until a person asked.
 *
 * THE CHECK IS SPLIT IN THREE, because this repo is public and its test must
 * not need the private billing and mail databases. This file is the core third:
 * it reads THIS database and fakes both neighbours. The billing and mail repos
 * replay the contract fixtures in `tests/fixtures/erase-contract/` in their own
 * suites, so a change to what core sends fails there too.
 *
 * THE TABLE LIST IS NOT WRITTEN HERE. It is read from `information_schema` (every
 * base table of the public schema). `DECISIONS` is the one place a person says
 * what a delete does to each table, and the first test fails when a table has no
 * entry and when an entry names a table that is gone. An `erased` table is then
 * proven in three ways: it held rows of the leaving account before the delete,
 * none refer to that account after it, and a second account's rows are exactly
 * as many as they were.
 *
 * THE SCAN. Foreign keys to `accounts` are read from `pg_constraint` and followed
 * through parent tables (`feedback_images` reaches an account through its
 * report), so "rows of this account" is a property of the schema and not of a
 * list. On top of that, every text, json, array and bytea column of every table
 * is searched for the address (any case) and for the account id as a whole
 * number. A column type the scan cannot classify fails the test, so a new type
 * cannot slip past it.
 *
 * EVERY CLAIM HAS ITS CONTROL. The scan is run BEFORE the delete over rows that
 * hold the address and the id in a text, a json, an array and a bytea column,
 * and must find them there. The commit that added this file pastes the output of
 * four mutations, each failing this file: the Pigeon call skipped, the invite
 * scrub skipped, a header renamed, and the foreign key of one table dropped in
 * the test database.
 *
 * REGENERATING THE FIXTURES after a deliberate contract change:
 * `UPDATE_ERASE_CONTRACT=1 node --import tsx --test tests/integration/account-deletion-completeness.test.ts`,
 * then `prettier --write tests/fixtures/erase-contract`. The diff is the review.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { createTrialAddressHasher } from '../../src/accounts/trial-address.js';
import type { Database } from '../../src/db/client.js';
import {
  aiBudgetAlerts,
  aiFreeNetworkDays,
  aiInstanceDays,
  aiTrialIntakes,
  aiTrialNetworkDays,
  aiUsageDays,
  feedbackImages,
  feedbackReports,
  instanceSettings,
  legalDeclarations,
  pulseDayContributors,
  pulseDays,
  pulseIdempotency,
  pulsePresence,
  pushSubscriptions,
  researchContributions,
  researchWithdrawals,
  signupInvites,
  syncBlobs,
  syncShares,
  trialAddressHashes,
} from '../../src/db/schema.js';
import { createSilentLogger } from '../../src/logger.js';
import { createPigeonRecipientEraser } from '../../src/mail/recipient-eraser.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { sampleAuthHash, startService, type ServiceHarness } from './service-harness.js';

const PEPPER = 'a-trial-address-pepper-that-is-long-enough-0123';
const PLANS_SECRET = 'a-shared-secret-for-the-biller';
const MAIL_KEY = 'ske_the-key-of-the-fake-pigeon';

const LEAVER_EMAIL = 'leaving.person@example.org';
const STAYER_EMAIL = 'staying.person@example.org';
const BYSTANDER_EMAIL = 'bystander.person@example.org';
/**
 * The ids are chosen, not counted: the account sequence is moved to just below
 * the first one, so the leaving account's id is a five digit number that no
 * other seeded value equals, and a text column holding it is a real hit.
 */
const LEAVER_ID = 48_211;
const STAYER_ID = 48_212;
const BYSTANDER_ID = 48_213;
const LEAVER_AUTH_SEED = 61;
const STAYER_AUTH_SEED = 62;
const BYSTANDER_AUTH_SEED = 63;
const DAY = '2026-10-01';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const FIXTURE_DIRECTORY = fileURLToPath(new URL('../fixtures/erase-contract/', import.meta.url));

// =============================================================================
// THE DECISIONS: one entry per table, and the only list in this file.
// =============================================================================

/**
 * What a delete of one account does to one table.
 *
 *  - `erased`: after the delete no row refers to the account id and none holds
 *    its address. A row may stay, unlinked, when the reason says so.
 *  - `kept-on-purpose`: something stays, with a reason and an end. `growsOnDelete`
 *    is how many rows the delete itself adds.
 *  - `no-account-data`: the table cannot hold anything about an account.
 */
type Decision =
  | { kind: 'erased'; reason: string }
  | { kind: 'kept-on-purpose'; reason: string; ends: string; growsOnDelete: number }
  | { kind: 'no-account-data'; reason: string };

function erased(reason: string): Decision {
  return { kind: 'erased', reason };
}

function keptOnPurpose(input: { reason: string; ends: string; growsOnDelete?: number }): Decision {
  return { kind: 'kept-on-purpose', reason: input.reason, ends: input.ends, growsOnDelete: input.growsOnDelete ?? 0 };
}

function noAccountData(reason: string): Decision {
  return { kind: 'no-account-data', reason };
}

const CASCADE = 'deleted with the account by ON DELETE CASCADE';

const DECISIONS: ReadonlyMap<string, Decision> = new Map<string, Decision>([
  ['accounts', erased('the row is the account, deleted by `AccountStore.deleteAccount`')],
  ['account_tokens', erased(`session pairs, ${CASCADE}`)],
  [
    'signup_invites',
    erased(
      'the row STAYS, unlinked: a member lifetime cap counts rows and a delete must not refund it. ' +
        '`deleteKeepingOnlyTheHash` scrubs email, name and trial_key, and the foreign keys go null',
    ),
  ],
  ['password_resets', erased(`reset tokens, ${CASCADE}`)],
  ['ai_usage_days', erased(`per account day counters, ${CASCADE}`)],
  ['ai_trial_intakes', erased(`scan trial intake ids, ${CASCADE}`)],
  ['pulse_day_contributors', erased(`who contributed on a day, ${CASCADE}`)],
  ['pulse_presence', erased(`who is fasting now, ${CASCADE}`)],
  ['pulse_idempotency', erased(`replay keys, ${CASCADE}`)],
  ['push_subscriptions', erased(`devices to wake, ${CASCADE}`)],
  ['sync_blobs', erased(`the encrypted diary, ${CASCADE}`)],
  ['sync_key_records', erased(`wrapped keys, ${CASCADE}`)],
  ['sync_shares', erased(`a grant, ${CASCADE} from both the grantor and the grantee side`)],
  ['research_contributions', erased(`a contribution, ${CASCADE} from both the contributor and the study side`)],
  ['research_withdrawals', erased(`a tombstone addressed to a study account, ${CASCADE} with that study`)],
  ['feedback_reports', erased(`reported estimates, ${CASCADE}`)],
  ['feedback_images', erased(`the photograph of a report, ${CASCADE} through the report`)],
  [
    'trial_address_hashes',
    keptOnPurpose({
      reason:
        'a keyed one-way hash of the mailbox, so one mailbox gets one trial. It holds neither the account id nor the address. ' +
        'The delete adds one row for an account that held a trial (ADR-0010).',
      ends: 'TRIAL_HASH_RETENTION_DAYS after the deletion, 365 by default (db/trial-hash-retention.ts, hourly sweep)',
      growsOnDelete: 1,
    }),
  ],
  [
    'legal_declarations',
    keptOnPurpose({
      reason:
        'a statutory cancellation or withdrawal (BGB 312k, 356a): evidence that a right was used. The address stays as the person typed ' +
        'it, and account_id goes null. A delete must not erase the proof.',
      ends: 'end of the third calendar year after the year of receipt, Europe/Berlin (legal/legal-declarations-retention.ts)',
    }),
  ],
  [
    'ai_instance_days',
    keptOnPurpose({
      reason:
        'instance wide sums per day (requests, trial requests, free requests, provider cost), no account column. A ceiling that fell on a delete ' +
        'would hand spend back.',
      ends: 'none: one row per day with no personal data',
    }),
  ],
  [
    'ai_trial_network_days',
    keptOnPurpose({
      reason: 'a keyed hash of a caller network and the day, with a count. No account, no address.',
      ends: 'every row before today, hourly sweep (ai/usage-retention.ts)',
    }),
  ],
  [
    'ai_free_network_days',
    keptOnPurpose({
      reason:
        'the free tier network bound (2026-10-07): a keyed hash of a caller network and the day, with a count. No ' +
        'account, no address.',
      ends: 'every row before today, hourly sweep (ai/usage-retention.ts)',
    }),
  ],
  [
    'pulse_days',
    keptOnPurpose({
      reason:
        'instance wide pulse sums per day, no account column (ADR-0007). A total for a past day must not fall on a delete.',
      ends: '30 days (pulse/pulse-retention.ts)',
    }),
  ],
  ['ai_budget_alerts', noAccountData('one row per provider budget period: a period name and a time')],
  ['instance_settings', noAccountData('the operator single settings row, chosen for the whole instance')],
]);

/** The two sets the first test compares, as a pure function so a control can feed it a wrong list. */
interface TableListComparison {
  withoutDecision: string[];
  decisionWithoutTable: string[];
}

function compareTableLists(input: {
  inDatabase: readonly string[];
  inDecisions: readonly string[];
}): TableListComparison {
  const withoutDecision = input.inDatabase.filter((table) => !input.inDecisions.includes(table));
  const decisionWithoutTable = input.inDecisions.filter((table) => !input.inDatabase.includes(table));
  return { withoutDecision, decisionWithoutTable };
}

// =============================================================================
// What the database says about itself.
// =============================================================================

interface ColumnInfo {
  table: string;
  column: string;
  dataType: string;
}

interface ForeignKey {
  table: string;
  column: string;
  parentTable: string;
  parentColumn: string;
}

interface SchemaFacts {
  tables: string[];
  columns: ColumnInfo[];
  foreignKeys: ForeignKey[];
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function readSchema(pool: pg.Pool): Promise<SchemaFacts> {
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const columns = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT c.table_name, c.column_name, c.data_type
     FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position`,
  );
  const keys = await pool.query<{
    child_table: string;
    child_column: string;
    parent_table: string;
    parent_column: string;
    width: number;
  }>(
    `SELECT child.relname AS child_table, child_attribute.attname AS child_column,
            parent.relname AS parent_table, parent_attribute.attname AS parent_column,
            array_length(constraint_row.conkey, 1) AS width
     FROM pg_constraint constraint_row
     JOIN pg_class child ON child.oid = constraint_row.conrelid
     JOIN pg_namespace namespace_row ON namespace_row.oid = child.relnamespace
     JOIN pg_class parent ON parent.oid = constraint_row.confrelid
     JOIN pg_attribute child_attribute
       ON child_attribute.attrelid = constraint_row.conrelid AND child_attribute.attnum = constraint_row.conkey[1]
     JOIN pg_attribute parent_attribute
       ON parent_attribute.attrelid = constraint_row.confrelid AND parent_attribute.attnum = constraint_row.confkey[1]
     WHERE constraint_row.contype = 'f' AND namespace_row.nspname = 'public'
     ORDER BY child.relname, child_attribute.attname`,
  );
  for (const key of keys.rows) {
    // The ownership walk below follows one column per key. A composite key needs a new walk, not a silent miss.
    assert.equal(key.width, 1, `${key.child_table} has a composite foreign key, which this scan does not follow`);
  }
  return {
    tables: tables.rows.map((row) => row.table_name),
    columns: columns.rows.map((row) => ({ table: row.table_name, column: row.column_name, dataType: row.data_type })),
    foreignKeys: keys.rows.map((row) => ({
      table: row.child_table,
      column: row.child_column,
      parentTable: row.parent_table,
      parentColumn: row.parent_column,
    })),
  };
}

const ACCOUNTS_TABLE = 'accounts';
/** Column types that cannot hold an address. Integer columns that name an account are found through the foreign keys instead. */
const NOT_TEXT_TYPES: ReadonlySet<string> = new Set([
  'integer',
  'bigint',
  'smallint',
  'boolean',
  'date',
  'timestamp without time zone',
  'timestamp with time zone',
]);

/** The SQL that turns a column into searchable text, or `null` for a column that cannot hold any. Throws on a type nobody classified. */
function textExpression(column: ColumnInfo): string | null {
  const name = quoteIdentifier(column.column);
  if (column.dataType === 'text' || column.dataType === 'character varying' || column.dataType === 'character')
    return name;
  if (column.dataType === 'json' || column.dataType === 'jsonb') return `${name}::text`;
  if (column.dataType === 'ARRAY') return `array_to_string(${name}, ' ')`;
  if (column.dataType === 'bytea') return `encode(${name}, 'escape')`;
  if (NOT_TEXT_TYPES.has(column.dataType)) return null;
  throw new Error(`${column.table}.${column.column} has type ${column.dataType}, which the scan has not classified`);
}

/**
 * The WHERE clause for "rows of the account `param` names" in `table`, or `null` for a table that
 * has no path to an account. The path is the foreign keys: a column that references `accounts`
 * directly, or one that references a parent table whose rows are the account's.
 */
function ownedPredicate(input: { schema: SchemaFacts; table: string; param: string; depth?: number }): string | null {
  const depth = input.depth ?? 0;
  if (depth > 4) throw new Error(`the foreign keys of ${input.table} nest deeper than this walk follows`);
  const parts: string[] = [];
  if (input.table === ACCOUNTS_TABLE) parts.push(`"id" = ${input.param}`);
  for (const key of input.schema.foreignKeys.filter((candidate) => candidate.table === input.table)) {
    if (key.parentTable === ACCOUNTS_TABLE) {
      parts.push(`${quoteIdentifier(key.column)} = ${input.param}`);
      continue;
    }
    const inner = ownedPredicate({
      schema: input.schema,
      table: key.parentTable,
      param: input.param,
      depth: depth + 1,
    });
    if (inner === null) continue;
    parts.push(
      `${quoteIdentifier(key.column)} IN (SELECT ${quoteIdentifier(key.parentColumn)} FROM ${quoteIdentifier(key.parentTable)} WHERE ${inner})`,
    );
  }
  return parts.length === 0 ? null : parts.map((part) => `(${part})`).join(' OR ');
}

async function countRows(input: { pool: pg.Pool; sql: string; values: readonly (string | number)[] }): Promise<number> {
  const result = await input.pool.query<{ n: number }>(input.sql, [...input.values]);
  return result.rows[0]?.n ?? 0;
}

interface TableCounts {
  total: number;
  /** Rows that belong to the leaving account, or `null` for a table with no path to an account. */
  leaver: number | null;
  stayer: number | null;
  /** Rows that belong to both, such as a share from one to the other. They go with the leaver. */
  both: number | null;
}

async function countTables(input: { pool: pg.Pool; schema: SchemaFacts }): Promise<Map<string, TableCounts>> {
  const { pool, schema } = input;
  const counts = new Map<string, TableCounts>();
  for (const table of schema.tables) {
    const quoted = quoteIdentifier(table);
    const total = await countRows({ pool, sql: `SELECT count(*)::int AS n FROM ${quoted}`, values: [] });
    const first = ownedPredicate({ schema, table, param: '$1' });
    const second = ownedPredicate({ schema, table, param: '$2' });
    if (first === null || second === null) {
      counts.set(table, { total, leaver: null, stayer: null, both: null });
      continue;
    }
    const owned = async (id: number): Promise<number> =>
      countRows({ pool, sql: `SELECT count(*)::int AS n FROM ${quoted} WHERE ${first}`, values: [id] });
    const both = await countRows({
      pool,
      sql: `SELECT count(*)::int AS n FROM ${quoted} WHERE (${first}) AND (${second})`,
      values: [LEAVER_ID, STAYER_ID],
    });
    counts.set(table, { total, leaver: await owned(LEAVER_ID), stayer: await owned(STAYER_ID), both });
  }
  return counts;
}

interface Hit {
  table: string;
  column: string;
  needle: 'address' | 'account id';
}

/** Every text, json, array and bytea column of every table, searched for the address and for the id as a whole number. */
async function scanForLeftovers(input: { pool: pg.Pool; schema: SchemaFacts }): Promise<Hit[]> {
  const hits: Hit[] = [];
  // The id counts only as a whole number: a hex digest that happens to contain the digits is not a reference.
  const idPattern = `(^|[^0-9A-Za-z])${LEAVER_ID}($|[^0-9A-Za-z])`;
  for (const column of input.schema.columns) {
    const expression = textExpression(column);
    if (expression === null) continue;
    const table = quoteIdentifier(column.table);
    const byAddress = await countRows({
      pool: input.pool,
      sql: `SELECT count(*)::int AS n FROM ${table} WHERE strpos(lower(${expression}), lower($1)) > 0`,
      values: [LEAVER_EMAIL],
    });
    if (byAddress > 0) hits.push({ table: column.table, column: column.column, needle: 'address' });
    const byId = await countRows({
      pool: input.pool,
      sql: `SELECT count(*)::int AS n FROM ${table} WHERE ${expression} ~ $1`,
      values: [idPattern],
    });
    if (byId > 0) hits.push({ table: column.table, column: column.column, needle: 'account id' });
  }
  return hits;
}

function describeHits(hits: readonly Hit[]): string {
  return hits.map((hit) => `${hit.table}.${hit.column} holds the ${hit.needle}`).join('; ');
}

function hasHit(input: { hits: readonly Hit[]; table: string; column: string; needle: Hit['needle'] }): boolean {
  return input.hits.some(
    (hit) => hit.table === input.table && hit.column === input.column && hit.needle === input.needle,
  );
}

// =============================================================================
// The two neighbours, as local servers that record every request.
// =============================================================================

interface RecordedRequest {
  method: string;
  path: string;
  /** Header names are lowercase, as Node parses them, with every value joined. */
  headers: ReadonlyArray<readonly [string, string]>;
  body: string;
}

interface RecordingServer {
  origin: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

async function startRecordingServer(): Promise<RecordingServer> {
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: Object.entries(req.headers).map(([name, value]) => [name, [value ?? ''].flat().join(', ')] as const),
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(204);
      res.end();
    });
  });
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form only for a Unix socket.
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

// =============================================================================
// The contract fixtures.
// =============================================================================

/** Headers the HTTP client adds on its own, and that no neighbour reads. */
const TRANSPORT_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'content-length',
  'accept',
  'accept-encoding',
  'accept-language',
  'user-agent',
  'sec-fetch-mode',
  'transfer-encoding',
  'keep-alive',
]);

/** Headers that carry a credential: their NAMES are the contract, their values never go in a file. */
const SECRET_HEADERS: ReadonlySet<string> = new Set(['authorization', 'x-plans-secret']);

interface ContractFixture {
  contract: string;
  /** The account and the address the request was made for, so a replay knows which values are the test's. */
  testAccountId: number;
  testAddress: string;
  method: string;
  path: string;
  headerNames: string[];
  secretHeaderNames: string[];
  headerValues: Record<string, string>;
  body: string;
}

/** What a neighbour has to accept, from one request core really sent. */
function contractOf(input: { contract: string; request: RecordedRequest }): ContractFixture {
  const sent = input.request.headers.filter(([name]) => !TRANSPORT_HEADERS.has(name));
  return {
    contract: input.contract,
    testAccountId: LEAVER_ID,
    testAddress: LEAVER_EMAIL,
    method: input.request.method,
    path: input.request.path,
    headerNames: sent.map(([name]) => name).toSorted(),
    secretHeaderNames: sent
      .map(([name]) => name)
      .filter((name) => SECRET_HEADERS.has(name))
      .toSorted(),
    headerValues: Object.fromEntries(sent.filter(([name]) => !SECRET_HEADERS.has(name))),
    body: input.request.body,
  };
}

async function matchFixture(input: { file: string; live: ContractFixture }): Promise<void> {
  const target = `${FIXTURE_DIRECTORY}${input.file}`;
  if (process.env.UPDATE_ERASE_CONTRACT === '1') {
    await mkdir(FIXTURE_DIRECTORY, { recursive: true });
    await writeFile(target, `${JSON.stringify(input.live, null, 2)}\n`);
  }
  const committed = JSON.parse(await readFile(target, 'utf8'));
  assert.deepEqual(
    input.live,
    committed,
    `core now sends something other than ${input.file}. Review the diff, regenerate with UPDATE_ERASE_CONTRACT=1, and tell the neighbour.`,
  );
}

// =============================================================================
// The scenario: one account is made the real way, filled in every table, and deleted.
// =============================================================================

interface Outcome {
  schema: SchemaFacts;
  before: Map<string, TableCounts>;
  after: Map<string, TableCounts>;
  hitsBefore: Hit[];
  hitsAfter: Hit[];
  deleteStatus: number;
  biller: RecordedRequest[];
  pigeon: RecordedRequest[];
  keptHash: { hash: string; createdAt: Date } | null;
  declarationAfter: { email: string; accountId: number | null } | null;
  deletedAround: number;
}

let database: TestDatabase;
let billerServer: RecordingServer;
let pigeonServer: RecordingServer;
let service: ServiceHarness;
let outcome: Outcome;
/** The same scenario on an instance with no `TRIAL_ADDRESS_PEPPER`, which the hosted one is not and a self-hosted one may be. */
let pepperless: Outcome;

interface SeedInput {
  accountId: number;
  peerId: number;
  tag: string;
  address: string;
}

/**
 * Rows in every table that has a path to an account, written straight into the database. The account,
 * its sessions, its keys, its invite and its reset token are made by the real routes instead.
 * Where a column can hold text, it holds the account's address or id, so a leftover is findable.
 */
async function seedAccountRows(db: Database, input: SeedInput): Promise<void> {
  const { accountId, peerId, tag, address } = input;
  await db.insert(aiUsageDays).values({ accountId, day: DAY, count: 3 });
  await db.insert(aiTrialIntakes).values({
    accountId,
    intakeId: `intake-${tag}`,
    createdAt: new Date(),
    requests: 1,
    delivered: true,
    claim: 1,
  });
  await db.insert(pulseDayContributors).values({ accountId, day: DAY });
  await db.insert(pulsePresence).values({ accountId, expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
  await db.insert(pulseIdempotency).values({ key: `idem-${tag}-${accountId}`, accountId });
  await db.insert(pushSubscriptions).values({
    accountId,
    endpoint: `https://push.example.org/${tag}`,
    p256dh: 'device-public-key',
    auth: 'device-auth-secret',
    userAgent: `Browser of ${address}`,
    timeZone: 'Europe/Berlin',
    locale: 'en',
    lastSeenDay: DAY,
  });
  await db.insert(syncBlobs).values({
    accountId,
    blobVersion: 100,
    envelopeVersion: 1,
    ciphertext: Buffer.alloc(256, 3),
    sizeBytes: 256,
  });
  await db.insert(syncShares).values({
    accountId,
    granteeAccountId: peerId,
    wrappedDek: Buffer.alloc(125, 5),
    recipientKeyFingerprint: `fingerprint-${tag}`,
  });
  await db.insert(researchContributions).values({
    contributorAccountId: accountId,
    studyAccountId: peerId,
    pseudonym: `pseudonym-${tag}`,
    schemaTier: 'daily-intake:v1',
    body: Buffer.alloc(200, 11),
    contributionVersion: 1,
  });
  await db.insert(researchWithdrawals).values({ studyAccountId: accountId, pseudonym: `withdrawn-${tag}` });
  const [report] = await db
    .insert(feedbackReports)
    .values({
      accountId,
      idempotencyKey: `report-${tag}`,
      measurements: { reportedBy: address, accountId },
      hasImage: true,
      consentAgreedAt: new Date(),
      consentWordingVersion: 'v1',
    })
    .returning({ id: feedbackReports.id });
  if (!report) throw new Error(`no feedback report came back for ${tag}`);
  await db
    .insert(feedbackImages)
    .values({ reportId: report.id, contentType: 'image/jpeg', bytes: Buffer.from(`photo taken by ${address}`) });
}

/** Rows in the tables that hold no account link, so a delete that wipes them is seen. */
async function seedSharedRows(db: Database): Promise<void> {
  await db.insert(aiInstanceDays).values({ day: DAY, count: 40, trialCount: 5, costMicroUsd: 1_200 });
  await db.insert(aiTrialNetworkDays).values({ day: DAY, networkHash: 'a-keyed-network-hash', count: 2 });
  await db.insert(aiFreeNetworkDays).values({ day: DAY, networkHash: 'a-keyed-free-network-hash', count: 1 });
  await db.insert(aiBudgetAlerts).values({ period: 'monthly:2026-10' });
  await db.insert(pulseDays).values({ day: DAY, meals: 3, photos: 1, kcal: 1_500, protein: 100 });
  await db.insert(instanceSettings).values({ id: 1, nutrientReferenceBasis: 'dge' }).onConflictDoNothing();
  await db.insert(trialAddressHashes).values({
    hash: 'hash-of-an-earlier-deletion',
    createdAt: new Date(Date.now() - 10 * MS_PER_DAY),
  });
}

async function requireStatus(input: { label: string; status: number; wanted: number }): Promise<void> {
  assert.equal(input.status, input.wanted, `${input.label} answered ${input.status}`);
}

async function runScenario(input: { pepper: string | null }): Promise<Outcome> {
  await database.reset();
  await database.pool.query("SELECT setval(pg_get_serial_sequence('accounts', 'id'), $1)", [LEAVER_ID - 1]);
  billerServer.requests.length = 0;
  pigeonServer.requests.length = 0;
  await service?.close();
  const eraser = createPigeonRecipientEraser({
    mail: {
      url: `${pigeonServer.origin}/v1/emails`,
      apiKey: MAIL_KEY,
      from: 'from@example.org',
      operatorEmail: 'operator@example.org',
    },
    logger: createSilentLogger(),
    attemptTimeoutMs: 500,
    backoffMs: [5, 5],
    answerBudgetMs: 1_500,
  });
  service = await startService({
    db: database.db,
    trialAddressPepper: input.pepper,
    plans: { baseUrl: `${billerServer.origin}/plans`, secret: PLANS_SECRET, timeoutMs: 1_000 },
    mailRecipientEraser: eraser,
  });

  // THE ACCOUNTS, THE REAL WAY: an invite, a sign-up, a second sign-in and a reset letter each.
  const leaver = await service.signupThroughInvite({
    email: LEAVER_EMAIL,
    displayName: 'Leaving Person',
    dailyAiLimit: 50,
    trialScans: 10,
    authHash: sampleAuthHash(LEAVER_AUTH_SEED),
  });
  const stayer = await service.signupThroughInvite({
    email: STAYER_EMAIL,
    dailyAiLimit: 50,
    trialScans: 10,
    authHash: sampleAuthHash(STAYER_AUTH_SEED),
  });
  const bystander = await service.signupThroughInvite({
    email: BYSTANDER_EMAIL,
    authHash: sampleAuthHash(BYSTANDER_AUTH_SEED),
  });
  assert.deepEqual(
    [leaver.account.id, stayer.account.id, bystander.account.id],
    [LEAVER_ID, STAYER_ID, BYSTANDER_ID],
    'the account sequence was not where the scenario put it',
  );
  for (const [email, seed] of [
    [LEAVER_EMAIL, LEAVER_AUTH_SEED],
    [STAYER_EMAIL, STAYER_AUTH_SEED],
  ] as const) {
    const login = await service.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { email, authHash: sampleAuthHash(seed) },
    });
    await requireStatus({ label: `a second sign-in of ${email}`, status: login.status, wanted: 200 });
    const reset = await service.request({ method: 'POST', path: '/v1/auth/reset/request', body: { email } });
    await requireStatus({ label: `a reset request for ${email}`, status: reset.status, wanted: 202 });
  }

  // THE REST, STRAIGHT INTO THE DATABASE: every other table that can hold something about an account.
  await seedAccountRows(database.db, { accountId: LEAVER_ID, peerId: STAYER_ID, tag: 'leaver', address: LEAVER_EMAIL });
  await seedAccountRows(database.db, {
    accountId: STAYER_ID,
    peerId: BYSTANDER_ID,
    tag: 'stayer',
    address: STAYER_EMAIL,
  });
  // Rows that point AT the leaving account from the second one: a share, a contribution to it as a study.
  await database.db.insert(syncShares).values({
    accountId: STAYER_ID,
    granteeAccountId: LEAVER_ID,
    wrappedDek: Buffer.alloc(125, 6),
    recipientKeyFingerprint: 'fingerprint-stayer-to-leaver',
  });
  await database.db.insert(researchContributions).values({
    contributorAccountId: STAYER_ID,
    studyAccountId: LEAVER_ID,
    pseudonym: 'pseudonym-stayer-to-leaver',
    schemaTier: 'daily-intake:v1',
    body: Buffer.alloc(200, 12),
    contributionVersion: 1,
  });
  // An invitation the leaving account sent and nobody redeemed.
  await database.db.insert(signupInvites).values({
    tokenHash: 'digest-of-a-pending-invitation',
    email: 'invited.guest@example.org',
    expiresAt: new Date(Date.now() + 7 * MS_PER_DAY),
    invitedByAccountId: LEAVER_ID,
    source: 'member',
  });
  // A statutory declaration typed with the leaving address, matched to the account.
  await database.db.insert(legalDeclarations).values({
    id: randomUUID(),
    kind: 'kuendigung',
    name: 'Leaving Person',
    email: LEAVER_EMAIL,
    language: 'en',
    accountId: LEAVER_ID,
  });
  await seedSharedRows(database.db);

  const schema = await readSchema(database.pool);

  // THE CONTROL FOR THE SCAN: it must find the address in an array column too, so for one moment the
  // account holds a label with the address in it. It is put back before the delete.
  await database.pool.query("UPDATE accounts SET capabilities = ARRAY['scan', 'note for ' || email] WHERE id = $1", [
    LEAVER_ID,
  ]);
  const hitsBefore = await scanForLeftovers({ pool: database.pool, schema });
  await database.pool.query('UPDATE accounts SET capabilities = NULL WHERE id = $1', [LEAVER_ID]);
  const countsBefore = await countTables({ pool: database.pool, schema });

  const deletedAround = Date.now();
  const deleted = await service.request({
    method: 'POST',
    path: '/v1/auth/delete',
    accessToken: leaver.tokens.accessToken,
    body: { authHash: sampleAuthHash(LEAVER_AUTH_SEED) },
  });

  const countsAfter = await countTables({ pool: database.pool, schema });
  const hitsAfter = await scanForLeftovers({ pool: database.pool, schema });
  // Through drizzle, which reads a `timestamp` as UTC; a raw read would parse it in this machine's zone.
  const [keptHash] =
    input.pepper === null
      ? []
      : await database.db
          .select()
          .from(trialAddressHashes)
          .where(eq(trialAddressHashes.hash, createTrialAddressHasher(input.pepper)(LEAVER_EMAIL)));
  const declarations = await database.pool.query<{ email: string; account_id: number | null }>(
    'SELECT email, account_id FROM legal_declarations',
  );
  return {
    schema,
    before: countsBefore,
    after: countsAfter,
    hitsBefore,
    hitsAfter,
    deleteStatus: deleted.status,
    biller: [...billerServer.requests],
    pigeon: [...pigeonServer.requests],
    keptHash: keptHash ?? null,
    declarationAfter: declarations.rows[0]
      ? { email: declarations.rows[0].email, accountId: declarations.rows[0].account_id }
      : null,
    deletedAround,
  };
}

before(async () => {
  database = await setupTestDatabase();
  billerServer = await startRecordingServer();
  pigeonServer = await startRecordingServer();
  outcome = await runScenario({ pepper: PEPPER });
  pepperless = await runScenario({ pepper: null });
});

after(async () => {
  await service?.close();
  await billerServer.close();
  await pigeonServer.close();
  await database.close();
});

function countsOf(input: { counts: Map<string, TableCounts>; table: string }): TableCounts {
  const found = input.counts.get(input.table);
  if (found === undefined) throw new Error(`${input.table} was not counted`);
  return found;
}

function tablesDecided(kind: Decision['kind']): string[] {
  return [...DECISIONS].filter(([, decision]) => decision.kind === kind).map(([table]) => table);
}

// =============================================================================
// The table list and the decisions.
// =============================================================================

test('every table of the public schema has one decision, and every decision names a table that exists', () => {
  const compared = compareTableLists({ inDatabase: outcome.schema.tables, inDecisions: [...DECISIONS.keys()] });
  assert.deepEqual(
    compared.withoutDecision,
    [],
    'a table with no decision: add it to DECISIONS and say what a delete does to it',
  );
  assert.deepEqual(compared.decisionWithoutTable, [], 'a decision for a table that is gone: remove it from DECISIONS');
  assert.ok(outcome.schema.tables.length >= 20, `only ${outcome.schema.tables.length} tables were read`);
});

test('the comparison CAN fail: a table with no entry and an entry with no table are both reported', () => {
  const compared = compareTableLists({
    inDatabase: ['accounts', 'a_new_table'],
    inDecisions: ['accounts', 'a_dropped_table'],
  });
  assert.deepEqual(compared.withoutDecision, ['a_new_table']);
  assert.deepEqual(compared.decisionWithoutTable, ['a_dropped_table']);
});

test('every decision says why, and a kept table says until when', () => {
  for (const [table, decision] of DECISIONS) {
    assert.ok(decision.reason.length > 20, `${table} has no reason`);
    if (decision.kind === 'kept-on-purpose') assert.ok(decision.ends.length > 5, `${table} is kept with no end`);
  }
});

test('every erased table has a path to an account through the foreign keys, so it can be proven', () => {
  for (const table of tablesDecided('erased')) {
    assert.notEqual(
      ownedPredicate({ schema: outcome.schema, table, param: '$1' }),
      null,
      `${table} references no account`,
    );
  }
});

// =============================================================================
// Before the delete: every table held something, and the scan could see it.
// =============================================================================

test('before the delete every erased table held rows of the leaving account and of a second one', () => {
  for (const table of tablesDecided('erased')) {
    const counts = countsOf({ counts: outcome.before, table });
    assert.ok((counts.leaver ?? 0) > 0, `${table} held no row of the leaving account, so it proves nothing`);
    assert.ok(
      (counts.stayer ?? 0) > 0,
      `${table} held no row of the second account, so a wipe of the table would pass`,
    );
  }
});

test('before the delete every kept table and every table without account data held a row', () => {
  for (const table of [...tablesDecided('kept-on-purpose'), ...tablesDecided('no-account-data')]) {
    assert.ok(countsOf({ counts: outcome.before, table }).total > 0, `${table} was empty before the delete`);
  }
});

test('the scan CAN see: before the delete it finds the address and the id in a text, a json, an array and a bytea column', () => {
  const found = (table: string, column: string, needle: Hit['needle']): boolean =>
    hasHit({ hits: outcome.hitsBefore, table, column, needle });
  assert.ok(found('accounts', 'email', 'address'), 'text column');
  assert.ok(found('feedback_reports', 'measurements', 'address'), 'json column');
  assert.ok(found('feedback_reports', 'measurements', 'account id'), 'the id inside json');
  assert.ok(found('accounts', 'capabilities', 'address'), 'array column');
  assert.ok(found('feedback_images', 'bytes', 'address'), 'bytea column');
  assert.ok(found('push_subscriptions', 'user_agent', 'address'), 'a text column of another table');
  assert.ok(found('pulse_idempotency', 'key', 'account id'), 'the id inside a text column');
});

// =============================================================================
// The delete and what it left.
// =============================================================================

test('the delete answers 204', () => {
  assert.equal(outcome.deleteStatus, 204);
});

test('after the delete no row of any table refers to the leaving account', () => {
  for (const table of outcome.schema.tables) {
    const counts = countsOf({ counts: outcome.after, table });
    if (counts.leaver === null) continue;
    assert.equal(counts.leaver, 0, `${table} still holds ${counts.leaver} row(s) that refer to the leaving account`);
  }
});

test('after the delete the address and the id sit only in tables kept on purpose', () => {
  const keptTables = new Set(tablesDecided('kept-on-purpose'));
  const unexpected = outcome.hitsAfter.filter((hit) => !keptTables.has(hit.table));
  assert.deepEqual(unexpected, [], `a delete left the account behind: ${describeHits(unexpected)}`);
});

test('what stays in a kept table is what the decision says: the typed address in legal_declarations, unlinked, and nothing else', () => {
  assert.deepEqual(
    outcome.hitsAfter.map((hit) => `${hit.table}.${hit.column}:${hit.needle}`),
    ['legal_declarations.email:address'],
  );
  assert.deepEqual(outcome.declarationAfter, { email: LEAVER_EMAIL, accountId: null });
});

test('the second account keeps every row that is not shared with the leaving one', () => {
  for (const table of tablesDecided('erased')) {
    const countsBefore = countsOf({ counts: outcome.before, table });
    const countsAfter = countsOf({ counts: outcome.after, table });
    const expected = (countsBefore.stayer ?? 0) - (countsBefore.both ?? 0);
    assert.equal(
      countsAfter.stayer,
      expected,
      `${table}: the second account had ${countsBefore.stayer} rows, ${countsBefore.both} shared, now ${countsAfter.stayer}`,
    );
    assert.ok((countsAfter.stayer ?? 0) > 0, `${table} lost every row of the second account`);
  }
});

test('the delete shrinks an erased table and grows nothing except the one row it is allowed to add', () => {
  for (const [table, decision] of DECISIONS) {
    const totalBefore = countsOf({ counts: outcome.before, table }).total;
    const totalAfter = countsOf({ counts: outcome.after, table }).total;
    if (decision.kind === 'erased') {
      assert.ok(totalAfter <= totalBefore, `${table} grew from ${totalBefore} to ${totalAfter}`);
      continue;
    }
    const growth = decision.kind === 'kept-on-purpose' ? decision.growsOnDelete : 0;
    assert.equal(
      totalAfter - totalBefore,
      growth,
      `${table} went from ${totalBefore} to ${totalAfter} rows, the decision allows ${growth} more`,
    );
  }
});

test('the mailbox hash kept for a trial is the keyed hash, written at the delete, and holds neither the address nor the id', () => {
  const expected = createTrialAddressHasher(PEPPER)(LEAVER_EMAIL);
  assert.equal(outcome.keptHash?.hash, expected);
  assert.equal(expected.includes('leaving'), false);
  assert.equal(expected.includes(String(LEAVER_ID)), false);
  assert.ok(
    Math.abs((outcome.keptHash?.createdAt.getTime() ?? 0) - outcome.deletedAround) < 60_000,
    'created_at is not the deletion',
  );
});

// =============================================================================
// The two neighbours.
// =============================================================================

test('the biller got exactly one erase call, for the leaving account', () => {
  assert.equal(outcome.biller.length, 1, `the biller received ${outcome.biller.length} requests`);
  const [call] = outcome.biller;
  assert.equal(call?.method, 'POST');
  assert.equal(call?.path, '/plans/erase');
  assert.deepEqual(
    call?.headers.filter(([name]) => name === 'x-account-id'),
    [['x-account-id', String(LEAVER_ID)]],
  );
  assert.equal(call?.body, '');
});

test('Pigeon got exactly one erase call, with the address in the body and not in the path', () => {
  assert.equal(outcome.pigeon.length, 1, `Pigeon received ${outcome.pigeon.length} requests`);
  const [call] = outcome.pigeon;
  assert.equal(call?.method, 'POST');
  assert.equal(call?.path, '/v1/recipients/erase');
  assert.deepEqual(JSON.parse(call?.body ?? ''), { email: LEAVER_EMAIL });
  assert.equal(call?.path.toLowerCase().includes('leaving'), false);
});

test('the requests core sent are the committed contract fixtures, so a change shows as a diff', async () => {
  const biller = outcome.biller[0];
  const pigeon = outcome.pigeon[0];
  assert.ok(biller, 'no request reached the biller');
  assert.ok(pigeon, 'no request reached Pigeon');
  await matchFixture({
    file: 'biller-erase-request.json',
    live: contractOf({ contract: 'core to the biller: an account is about to be erased', request: biller }),
  });
  await matchFixture({
    file: 'pigeon-erase-request.json',
    live: contractOf({ contract: 'core to Pigeon: forget this address', request: pigeon }),
  });
});

test('the fixtures carry no credential value', async () => {
  for (const file of ['biller-erase-request.json', 'pigeon-erase-request.json']) {
    const text = await readFile(`${FIXTURE_DIRECTORY}${file}`, 'utf8');
    assert.equal(text.includes(PLANS_SECRET), false, `${file} holds the biller secret`);
    assert.equal(text.includes(MAIL_KEY), false, `${file} holds the mail key`);
  }
});

// =============================================================================
// An instance with no pepper: the same delete, the same promise.
// =============================================================================

test('with no pepper the delete still leaves the address and the id only in the table kept on purpose', () => {
  assert.equal(pepperless.deleteStatus, 204);
  assert.deepEqual(
    pepperless.hitsAfter.map((hit) => `${hit.table}.${hit.column}:${hit.needle}`),
    ['legal_declarations.email:address'],
    `a delete with no pepper left the account behind: ${describeHits(pepperless.hitsAfter)}`,
  );
  for (const table of pepperless.schema.tables) {
    const counts = countsOf({ counts: pepperless.after, table });
    if (counts.leaver !== null) assert.equal(counts.leaver, 0, `${table} still refers to the leaving account`);
  }
});

test('with no pepper the invitation rows all stay for the lifetime cap and no hash is written', () => {
  const invites = countsOf({ counts: pepperless.before, table: 'signup_invites' });
  assert.equal(countsOf({ counts: pepperless.after, table: 'signup_invites' }).total, invites.total, 'a row went');
  assert.equal(
    countsOf({ counts: pepperless.after, table: 'trial_address_hashes' }).total,
    countsOf({ counts: pepperless.before, table: 'trial_address_hashes' }).total,
    'only the keyed hash needs the pepper, and none is written without one',
  );
  assert.equal(pepperless.keptHash, null);
});
