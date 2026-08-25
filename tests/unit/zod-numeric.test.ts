/**
 * `createOptionalNonNegativeNumberSchema` — the coercion-failure message is
 * the thing worth pinning here: without it, a non-numeric value in an
 * optional macro field surfaces zod's raw "Expected number, received nan"
 * developer-speak straight to the person filling in the form. The
 * empty-string -> `undefined` behaviour is the trap in this area of the
 * code (a naive `z.coerce.number().optional()` reads `''` as `0`), so it is
 * asserted here too, not just assumed to still hold.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOptionalNonNegativeNumberSchema } from '../../app/lib/zod-numeric';

/** Identity translator: assertions read the KEY, so this stays language-proof. */
const t = (key: string) => key;

const schema = createOptionalNonNegativeNumberSchema(t);

describe('createOptionalNonNegativeNumberSchema', () => {
  it('accepts a valid non-negative number', () => {
    const result = schema.safeParse('12.5');
    assert.equal(result.success, true);
    assert.equal(result.data, 12.5);
  });

  it('treats an empty string as "not entered", not zero', () => {
    const result = schema.safeParse('');
    assert.equal(result.success, true);
    assert.equal(result.data, undefined);
  });

  it('treats a whitespace-only string as "not entered", not zero', () => {
    const result = schema.safeParse('   ');
    assert.equal(result.success, true);
    assert.equal(result.data, undefined);
  });

  it('rejects a non-numeric string with the plain-language message, not a raw zod message', () => {
    const result = schema.safeParse('abc');
    assert.equal(result.success, false);
    const issues = result.error?.issues ?? [];
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.message, 'errors.notANumber');
  });

  it('still rejects a negative number', () => {
    const result = schema.safeParse('-5');
    assert.equal(result.success, false);
  });

  it('defaults to the i18next singleton when no translator is passed, so existing call sites keep working', () => {
    const defaultSchema = createOptionalNonNegativeNumberSchema();
    const result = defaultSchema.safeParse('12');
    assert.equal(result.success, true);
    assert.equal(result.data, 12);
  });

  it('resolves the message at PARSE time, not at schema-construction time', () => {
    // A translator whose return value changes AFTER the schema is built.
    // `diary.tsx` builds this schema once at module load, before i18next has
    // a language set — an eager `error: t(key)` string would freeze
    // whichever value `t` returned at that one construction call forever.
    // Only a lazy `error: () => t(key)` re-reads `t` on every parse.
    let language: 'en' | 'de' = 'en';
    const switchableT = (key: string) => `${key}:${language}`;

    const lazySchema = createOptionalNonNegativeNumberSchema(switchableT);

    // Construction already happened above with language = 'en'. Now change
    // what the translator would return, and parse AFTER that change.
    language = 'de';
    const result = lazySchema.safeParse('abc');

    assert.equal(result.success, false);
    const issues = result.error?.issues ?? [];
    assert.equal(issues.length, 1);
    // An eager implementation would still carry 'errors.notANumber:en' here,
    // captured once when the schema was constructed.
    assert.equal(issues[0]?.message, 'errors.notANumber:de');
  });
});
