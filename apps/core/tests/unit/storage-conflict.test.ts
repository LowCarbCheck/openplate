/**
 * The unique-violation predicate every CAS path depends on. Kept in its own
 * DB-free module precisely so this test can exist without a Postgres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrizzleQueryError } from 'drizzle-orm';
import { POSTGRES_UNIQUE_VIOLATION_CODE, isUniqueViolation, sqlstate } from '../../src/lib/storage-conflict.js';

/** A `pg`-shaped driver error: an `Error` with a SQLSTATE on `code`. */
function driverError(code: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), { code });
}

test('a pg error carrying 23505 is a unique violation', () => {
  assert.equal(isUniqueViolation({ code: POSTGRES_UNIQUE_VIOLATION_CODE }), true);
});

test('a pg error wrapped by drizzle-orm still reads as its SQLSTATE', () => {
  // drizzle-orm 0.44+ wraps every driver error. The wrapper has no `code`,
  // so reading only the outer value turned each lost CAS race into a 500.
  const wrapped = new DrizzleQueryError('insert into "t"', [], driverError(POSTGRES_UNIQUE_VIOLATION_CODE));
  assert.equal(isUniqueViolation(wrapped), true);
  assert.equal(sqlstate(new DrizzleQueryError('insert into "t"', [], driverError('23503'))), '23503');
});

test('a wrapper with no coded cause has no SQLSTATE, and a cyclic chain ends', () => {
  assert.equal(sqlstate(new DrizzleQueryError('select 1', [], new Error('socket hang up'))), null);
  const cyclic = new Error('wraps itself');
  cyclic.cause = cyclic;
  assert.equal(sqlstate(cyclic), null);
});

test('anything else is not, and nothing throws on odd input', () => {
  // Getting this wrong in either direction is bad: a false positive turns a
  // real fault into a silent "conflict", a false negative turns a routine
  // race into a 500.
  assert.equal(isUniqueViolation({ code: '23503' }), false);
  assert.equal(isUniqueViolation(new Error('boom')), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
  assert.equal(isUniqueViolation('23505'), false);
});
