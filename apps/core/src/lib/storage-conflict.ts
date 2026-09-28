/**
 * Pure Postgres unique-violation detection — the signal every compare-and-swap
 * write in this service uses to distinguish "lost a race" from "something is
 * actually broken".
 *
 * Kept in its own DB-free module (ported from the openplate app, where it was
 * extracted for security-review finding #4) so the conflict-mapping rule is
 * unit-testable without a live database: `db/storage-adapter.ts` imports the
 * connection pool at module load, and a plain `node --test` run has no
 * Postgres to give it.
 */
import { asString } from './json.js';

/** Postgres SQLSTATE for a unique-constraint violation; the `pg` driver surfaces it as `error.code`. */
export const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

/**
 * The two properties this module reads off a caught value: the five-character
 * SQLSTATE, and the error it wraps, if any.
 */
interface SqlstateCarrier {
  readonly code?: string;
  readonly cause?: unknown;
}

/**
 * How many wrapping errors `sqlstate` looks through. drizzle-orm 0.44 and
 * later throw a `DrizzleQueryError` whose `cause` is the `pg` error, so the
 * code sits one level down. A small bound keeps a cyclic `cause` chain finite.
 */
const MAX_CAUSE_DEPTH = 4;

/**
 * The SQLSTATE of a caught value, or `null` when it carries none.
 *
 * The value's own `code` wins. Without one, the `cause` chain is followed, so
 * a driver error wrapped by the ORM still reads as its SQLSTATE; without that
 * every CAS path would turn a routine lost race into a 500.
 *
 * `Object()` boxes primitives instead of narrowing them, so a thrown string or
 * number simply has no `code` property and reads as `null`, the same answer a
 * non-Postgres `Error` gives, which is exactly what callers want.
 */
export function sqlstate(cause: unknown): string | null {
  let current = cause;
  for (let depth = 1; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (current === null || current === undefined) return null;
    const carrier: SqlstateCarrier = Object(current);
    const code = asString(carrier.code);
    if (code !== null) return code;
    current = carrier.cause;
  }
  return null;
}

/**
 * Whether `error` is a Postgres unique-constraint violation. Both the blob
 * CAS (`UNIQUE (account_id, blob_version)`) and the key-record CAS
 * (`UNIQUE (account_id, kind)`) rely on this to re-read the real current
 * value and return a clean conflict instead of throwing.
 */
export function isUniqueViolation(cause: unknown): boolean {
  return sqlstate(cause) === POSTGRES_UNIQUE_VIOLATION_CODE;
}
