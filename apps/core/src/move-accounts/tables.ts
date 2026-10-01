/**
 * WHAT MOVES WITH AN ACCOUNT, table by table, as the SQL that moves it.
 *
 * The reasons are argued once, in the header of `src/move-accounts.ts`. This
 * module is the executable half: every statement the tool runs against a row
 * of user data is written out here in full, so a reviewer reads the copy as
 * SQL rather than reconstructing it from a builder.
 *
 * EVERY TABLE IN THE SCHEMA IS CLASSIFIED, moved or skipped, and
 * `tests/unit/move-accounts-tables.test.ts` fails when a table in
 * `db/schema.ts` is neither. At run time `schema-check.ts` does the same
 * against the two live databases, so a newer source with a table this build
 * has never heard of is refused rather than half copied.
 *
 * ACCOUNT IDS ARE KEPT, NEVER REMAPPED. PROTOCOL.md §3.2 binds the numeric
 * account id into the blob's AAD (and the compartment's, §3.4's share AAD and
 * §3.5's research AAD and pseudonym), so a moved row keeps every account id it
 * carries. Only serial row ids the target mints itself are regenerated, and
 * the one row id something points at (`feedback_reports.id`, from
 * `feedback_images`) is followed through its natural key instead.
 */

/** Postgres identifiers here are our own literals, quoted once so a reserved word (`count`, `day`) is never a parse error. */
function quoted(identifier: string): string {
  return `"${identifier}"`;
}

function placeholders(count: number, offset = 0): string {
  return Array.from({ length: count }, (_unused, index) => `$${index + 1 + offset}`).join(', ');
}

/** A table whose rows belong to exactly one account through one column. */
export interface OwnedTable {
  readonly name: string;
  /** Every column the table has. The drift check refuses a source or a target whose table differs. */
  readonly columns: readonly string[];
  /** The columns the target mints for itself (a serial id), never copied. */
  readonly regenerated: readonly string[];
  /** One account's rows, `$1` the account id, cells in `insert` order, in a deterministic order. Runs on both sides. */
  readonly select: string;
  /** One row: `$1..$n` are the selected cells, then the account id when `insertTakesAccountId`. */
  readonly insert: string;
  readonly insertTakesAccountId: boolean;
}

/** A table whose rows join two accounts. A row moves only when BOTH ends move. */
export interface PairTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly regenerated: readonly string[];
  /** Rows between `$1` and any of `$2::int[]`, in either direction, in a deterministic order. Runs on both sides. */
  readonly select: string;
  /** Every row that touches `$1` at all, whoever is at the other end. */
  readonly countTouching: string;
  readonly insert: string;
}

function ownedTable(input: {
  name: string;
  columns: readonly string[];
  regenerated: readonly string[];
  ownerColumn: string;
  orderBy: readonly string[];
}): OwnedTable {
  const copied = input.columns.filter((column) => !input.regenerated.includes(column));
  return {
    name: input.name,
    columns: input.columns,
    regenerated: input.regenerated,
    select:
      `SELECT ${copied.map(quoted).join(', ')} FROM ${quoted(input.name)} ` +
      `WHERE ${quoted(input.ownerColumn)} = $1 ORDER BY ${input.orderBy.map(quoted).join(', ')}`,
    insert: `INSERT INTO ${quoted(input.name)} (${copied.map(quoted).join(', ')}) VALUES (${placeholders(copied.length)})`,
    insertTakesAccountId: false,
  };
}

function pairTable(input: {
  name: string;
  columns: readonly string[];
  regenerated: readonly string[];
  ends: readonly [string, string];
}): PairTable {
  const copied = input.columns.filter((column) => !input.regenerated.includes(column));
  const [first, second] = input.ends.map(quoted);
  return {
    name: input.name,
    columns: input.columns,
    regenerated: input.regenerated,
    select:
      `SELECT ${copied.map(quoted).join(', ')} FROM ${quoted(input.name)} ` +
      `WHERE (${first} = $1 AND ${second} = ANY($2::int[])) OR (${second} = $1 AND ${first} = ANY($2::int[])) ` +
      `ORDER BY ${first}, ${second}`,
    countTouching: `SELECT count(*)::text FROM ${quoted(input.name)} WHERE ${first} = $1 OR ${second} = $1`,
    insert: `INSERT INTO ${quoted(input.name)} (${copied.map(quoted).join(', ')}) VALUES (${placeholders(copied.length)})`,
  };
}

// =============================================================================
// The account row
// =============================================================================

/**
 * The columns copied byte for byte from the source row, the id first.
 *
 * `verifier`, `recovery_verifier` and `recovery_code_escrow` travel UNCHANGED:
 * the target instance runs with the source's `SERVER_SECRET` after the switch,
 * so the source pepper and escrow key are the target's. `kdf_descriptor` is
 * the client's own salt and binds to nothing on the server.
 */
export const ACCOUNT_COPIED_COLUMNS = [
  'id',
  'email',
  'display_name',
  'role',
  'verifier',
  'recovery_verifier',
  'recovery_code_escrow',
  'kdf_descriptor',
  'suspended_at',
  'last_seen_at',
  'health_consent_version',
  'health_consent_at',
  'created_at',
] as const;

/**
 * The columns the move SETS rather than copies: the new standing (a standing
 * free grant, no paid limit, no expiry, no scan trial, the operator's label)
 * and the row's own `updated_at`. `label` is absent on a source older than
 * migration 0024, and `free_daily_ai_limit` on one older than 0026; both are
 * allowed because neither is read from the source.
 *
 * THE FREE GRANT, NOT A PAID LIMIT WITH NO DATE (2026-09-30). The first move
 * wrote `daily_ai_limit` with no date, and a Beta supporter who then bought a
 * plan and cancelled lost AI for good when the paid period ended. The free
 * grant sits beneath any paid window and outlives it.
 */
export const ACCOUNT_SET_COLUMNS = [
  'daily_ai_limit',
  'free_daily_ai_limit',
  'allowance_expires_at',
  'trial_scans',
  'trial_scans_used',
  'trial_ends_at',
  'label',
  'updated_at',
] as const;

/** The account columns a source may lack, because the move never reads them from there. */
export const ACCOUNT_COLUMNS_ABSENT_FROM_OLDER_SOURCES = ['label', 'free_daily_ai_limit'] as const;

/** One source account row, by id, copied columns only. */
export const SELECT_SOURCE_ACCOUNT = `SELECT ${ACCOUNT_COPIED_COLUMNS.map(quoted).join(', ')} FROM "accounts" WHERE "id" = $1`;

/** The same columns read back from the target, for the comparison. */
export const SELECT_TARGET_ACCOUNT = SELECT_SOURCE_ACCOUNT;

/**
 * The account insert. `$1..$13` are the copied cells, `$14` the free daily
 * limit and `$15` the label. `daily_ai_limit` is `0`: a moved account holds no
 * paid window. `trial_scans_used` is `0`, not `NULL`: the column is
 * `NOT NULL DEFAULT 0`, and "no scan trial" is `trial_scans IS NULL`.
 */
export const INSERT_ACCOUNT =
  `INSERT INTO "accounts" (${ACCOUNT_COPIED_COLUMNS.map(quoted).join(', ')}, ` +
  `"daily_ai_limit", "free_daily_ai_limit", "allowance_expires_at", "trial_scans", "trial_scans_used", ` +
  `"trial_ends_at", "label", "updated_at") ` +
  `VALUES (${placeholders(ACCOUNT_COPIED_COLUMNS.length)}, 0, $${ACCOUNT_COPIED_COLUMNS.length + 1}, NULL, NULL, 0, ` +
  `NULL, $${ACCOUNT_COPIED_COLUMNS.length + 2}, now())`;

/** The set columns read back, as text, for the comparison against what the move meant to write. */
export const SELECT_TARGET_STANDING =
  'SELECT "daily_ai_limit"::text, "free_daily_ai_limit"::text, ("allowance_expires_at" IS NULL)::text, ' +
  '("trial_scans" IS NULL)::text, "trial_scans_used"::text, ("trial_ends_at" IS NULL)::text, "label" ' +
  'FROM "accounts" WHERE "id" = $1';

// =============================================================================
// Tables whose rows follow one account
// =============================================================================

export const SYNC_KEY_RECORDS = ownedTable({
  name: 'sync_key_records',
  columns: ['id', 'account_id', 'kind', 'kdf_descriptor', 'wrapped_dek', 'created_at', 'updated_at'],
  regenerated: ['id'],
  ownerColumn: 'account_id',
  orderBy: ['kind'],
});

export const SYNC_BLOBS = ownedTable({
  name: 'sync_blobs',
  columns: [
    'id',
    'account_id',
    'blob_version',
    'envelope_version',
    'ciphertext',
    'size_bytes',
    'created_at',
    'pinned_until',
  ],
  regenerated: ['id'],
  ownerColumn: 'account_id',
  orderBy: ['blob_version'],
});

/** Postgres hashes each ciphertext itself, on both sides, so the blob check does not depend on the tool's own read path. */
export const SELECT_BLOB_HASHES =
  'SELECT "blob_version"::text, encode(sha256("ciphertext"), \'hex\') FROM "sync_blobs" WHERE "account_id" = $1 ORDER BY "blob_version"';

export const AI_USAGE_DAYS = ownedTable({
  name: 'ai_usage_days',
  columns: ['account_id', 'day', 'count'],
  regenerated: [],
  ownerColumn: 'account_id',
  orderBy: ['day'],
});

export const FEEDBACK_REPORTS = ownedTable({
  name: 'feedback_reports',
  columns: [
    'id',
    'account_id',
    'idempotency_key',
    'measurements',
    'has_image',
    'consent_agreed_at',
    'consent_wording_version',
    'created_at',
  ],
  regenerated: ['id'],
  ownerColumn: 'account_id',
  orderBy: ['idempotency_key'],
});

/**
 * The photograph of a report, found through its report's natural key
 * (`account_id`, `idempotency_key`, unique per account) because the report's
 * serial id is minted again on the target. Must run after `FEEDBACK_REPORTS`.
 */
export const FEEDBACK_IMAGES: OwnedTable = {
  name: 'feedback_images',
  columns: ['report_id', 'content_type', 'bytes', 'created_at'],
  regenerated: ['report_id'],
  select:
    'SELECT r."idempotency_key", i."content_type", i."bytes", i."created_at" FROM "feedback_images" i ' +
    'JOIN "feedback_reports" r ON r."id" = i."report_id" WHERE r."account_id" = $1 ORDER BY r."idempotency_key"',
  insert:
    'INSERT INTO "feedback_images" ("report_id", "content_type", "bytes", "created_at") ' +
    'SELECT r."id", $2, $3, $4 FROM "feedback_reports" r WHERE r."account_id" = $5 AND r."idempotency_key" = $1',
  insertTakesAccountId: true,
};

/** A compliance record: its UUID `id` is the receipt a person holds, so it is kept, not minted again. */
export const LEGAL_DECLARATIONS = ownedTable({
  name: 'legal_declarations',
  columns: [
    'id',
    'kind',
    'name',
    'email',
    'contract_reference',
    'termination_type',
    'reason',
    'requested_date',
    'timing',
    'language',
    'received_at',
    'account_id',
    'forwarded_at',
    'forward_error',
  ],
  regenerated: [],
  ownerColumn: 'account_id',
  orderBy: ['id'],
});

/** A study's purge ledger, keyed by pseudonym alone. It belongs to the STUDY account and moves with it. */
export const RESEARCH_WITHDRAWALS = ownedTable({
  name: 'research_withdrawals',
  columns: ['id', 'study_account_id', 'pseudonym', 'withdrawn_at'],
  regenerated: ['id'],
  ownerColumn: 'study_account_id',
  orderBy: ['pseudonym'],
});

/** Copied in this order inside each account's transaction; `FEEDBACK_IMAGES` needs its reports first. */
export const OWNED_TABLES: readonly OwnedTable[] = [
  SYNC_KEY_RECORDS,
  SYNC_BLOBS,
  AI_USAGE_DAYS,
  FEEDBACK_REPORTS,
  FEEDBACK_IMAGES,
  LEGAL_DECLARATIONS,
  RESEARCH_WITHDRAWALS,
];

// =============================================================================
// Tables whose rows join two accounts
// =============================================================================

export const SYNC_SHARES = pairTable({
  name: 'sync_shares',
  columns: [
    'id',
    'account_id',
    'grantee_account_id',
    'wrapped_dek',
    'recipient_key_fingerprint',
    'created_at',
    'updated_at',
  ],
  regenerated: ['id'],
  ends: ['account_id', 'grantee_account_id'],
});

export const RESEARCH_CONTRIBUTIONS = pairTable({
  name: 'research_contributions',
  columns: [
    'id',
    'contributor_account_id',
    'study_account_id',
    'pseudonym',
    'schema_tier',
    'body',
    'contribution_version',
    'created_at',
    'updated_at',
  ],
  regenerated: ['id'],
  ends: ['contributor_account_id', 'study_account_id'],
});

export const PAIR_TABLES: readonly PairTable[] = [SYNC_SHARES, RESEARCH_CONTRIBUTIONS];

// =============================================================================
// Tables that do not move
// =============================================================================

/**
 * Every table the move leaves behind, each for the reason argued in the header
 * of `src/move-accounts.ts`. A table in neither this list nor the ones above
 * fails the unit test and the run-time drift check.
 */
export const SKIPPED_TABLES = [
  'account_tokens',
  'password_resets',
  'push_subscriptions',
  'signup_invites',
  'ai_trial_intakes',
  'trial_address_hashes',
  'ai_instance_days',
  'ai_trial_network_days',
  'ai_budget_alerts',
  'pulse_days',
  'pulse_day_contributors',
  'pulse_presence',
  'pulse_idempotency',
  'instance_settings',
] as const;

/** Every table the move copies rows into, `accounts` included. */
export const MOVED_TABLES: readonly string[] = [
  'accounts',
  ...OWNED_TABLES.map((table) => table.name),
  ...PAIR_TABLES.map((table) => table.name),
];

const CLASSIFIED_TABLES = new Set<string>([...MOVED_TABLES, ...SKIPPED_TABLES]);

/** Whether this build has decided what happens to a table: moved or skipped. */
export function isClassifiedTable(name: string): boolean {
  return CLASSIFIED_TABLES.has(name);
}
