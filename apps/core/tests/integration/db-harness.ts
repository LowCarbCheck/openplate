/**
 * Integration-test database harness.
 *
 * Points at the SHARED local Postgres (`localhost:5433` by default, the
 * workspace's `projects-postgres-1`), never at a per-repo compose database.
 * `docker/compose.yml` exists for self-hosters; using it for tests would mean
 * every developer running a second Postgres for no reason. A contributor with
 * no shared Postgres can start `docker/compose.dev.yml`, which serves exactly
 * the default URL below.
 *
 * The test database is created idempotently (a `42P04` "already exists" is
 * the expected outcome on every run after the first) and migrated with the
 * SAME committed migrations production uses, which is the point. A harness
 * that built its schema by any other route would let a broken migration pass
 * a green suite.
 *
 * Override with `TEST_DATABASE_URL` to run against something else.
 */
import pg from 'pg';
import { createDatabase, runMigrations, type DatabaseHandle } from '../../src/db/client.js';
import { sqlstate } from '../../src/lib/storage-conflict.js';

const DEFAULT_TEST_DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/openplate_sync_test';

/** Postgres SQLSTATE for "database already exists", the normal case, not an error. */
const DUPLICATE_DATABASE = '42P04';

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

/**
 * Creates the test database if it is missing, by connecting to the server's
 * default `postgres` database first (you cannot `CREATE DATABASE` from inside
 * the database you are creating).
 */
async function ensureTestDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = target.pathname.replace(/^\//, '');

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    // Identifier interpolation is unavoidable here (Postgres does not accept a
    // parameter for a database name); the value comes from our own test URL,
    // and the quoting below is the standard escape.
    await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
  } catch (error) {
    if (sqlstate(error) !== DUPLICATE_DATABASE) throw error;
  } finally {
    await admin.end();
  }
}

/**
 * A SIBLING of the test database with its own name, dropped and created again
 * from nothing, then migrated. For a suite that needs two databases at once
 * (the account move reads one and writes another) and must not share either
 * with the rest of the suite. `WITH (FORCE)` ends a connection a crashed
 * earlier run left open.
 */
export async function setupFreshDatabase(input: { suffix: string }): Promise<DatabaseHandle & { url: string }> {
  const url = new URL(testDatabaseUrl());
  url.pathname = `${url.pathname}_${input.suffix}`;
  await dropDatabase({ url: url.toString() });
  await ensureTestDatabaseExists(url.toString());
  const handle = createDatabase({ connectionString: url.toString(), ssl: false });
  await runMigrations({ db: handle.db, migrationsFolder: 'drizzle/migrations' });
  return { ...handle, url: url.toString() };
}

/**
 * A database that exists and holds nothing, not even the migrations, for a
 * suite that has to migrate it in steps (the free-grant backfill, 0026 to
 * 0028, is asserted on rows written by the schema before it). Dropped first,
 * like {@link setupFreshDatabase}.
 */
export async function setupEmptyDatabase(input: { suffix: string }): Promise<DatabaseHandle & { url: string }> {
  const url = new URL(testDatabaseUrl());
  url.pathname = `${url.pathname}_${input.suffix}`;
  await dropDatabase({ url: url.toString() });
  await ensureTestDatabaseExists(url.toString());
  return { ...createDatabase({ connectionString: url.toString(), ssl: false }), url: url.toString() };
}

/** Drops a database made by {@link setupFreshDatabase}, if it exists. */
export async function dropDatabase(input: { url: string }): Promise<void> {
  const target = new URL(input.url);
  const databaseName = target.pathname.replace(/^\//, '');
  const adminUrl = new URL(input.url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    // Same identifier rule as `ensureTestDatabaseExists`: our own test name, quoted.
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName.replace(/"/g, '""')}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export interface TestDatabase extends DatabaseHandle {
  /** Empties every table, resetting identity sequences so ids are predictable per test. */
  reset(): Promise<void>;
}

export async function setupTestDatabase(): Promise<TestDatabase> {
  const url = testDatabaseUrl();
  await ensureTestDatabaseExists(url);

  const handle = createDatabase({ connectionString: url, ssl: false });
  await runMigrations({ db: handle.db, migrationsFolder: 'drizzle/migrations' });

  return {
    ...handle,
    async reset() {
      // One statement, CASCADE, identity restart: fast, and it exercises the
      // real foreign keys rather than deleting in a hand-maintained order.
      //
      // THE TABLE LIST IS HAND-MAINTAINED AND A NEW TABLE MUST JOIN IT.
      // `ai_instance_days`, `pulse_days` and `instance_settings` reference
      // nothing on purpose (see `db/schema.ts`), so CASCADE cannot reach any of
      // them through `accounts`: left out, one test's instance spend, one
      // test's pulse sums or one test's chosen reference basis would still be
      // there in the next one, and a ceiling, a floor or a handshake test would
      // fail as a fixture problem.
      await handle.pool.query(
        'TRUNCATE TABLE account_tokens, password_resets, ai_usage_days, ai_instance_days, ai_trial_network_days, ai_budget_alerts, pulse_days, pulse_day_contributors, pulse_presence, pulse_idempotency, push_subscriptions, sync_blobs, sync_key_records, sync_shares, research_contributions, research_withdrawals, feedback_images, feedback_reports, signup_invites, instance_settings, legal_declarations, ai_trial_intakes, trial_address_hashes, accounts RESTART IDENTITY CASCADE',
      );
    },
  };
}
