/**
 * Unit tests for `#app/lib/conform-field-value` — narrowing a Conform field's
 * `unknown` value into a number for live previews. No React/DB/network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseNumericFieldValue } from '../../app/lib/conform-field-value';

describe('parseNumericFieldValue', () => {
  it('parses a numeric string', () => {
    assert.strictEqual(parseNumericFieldValue('12.5'), 12.5);
    assert.strictEqual(parseNumericFieldValue('0'), 0);
  });

  it('passes through a finite number', () => {
    assert.strictEqual(parseNumericFieldValue(42), 42);
  });

  it('returns null for blank or whitespace-only input', () => {
    assert.strictEqual(parseNumericFieldValue(''), null);
    assert.strictEqual(parseNumericFieldValue('   '), null);
  });

  it('returns null for undefined or non-string, non-number values', () => {
    assert.strictEqual(parseNumericFieldValue(undefined), null);
    assert.strictEqual(parseNumericFieldValue(null), null);
    assert.strictEqual(parseNumericFieldValue({}), null);
    assert.strictEqual(parseNumericFieldValue(['1']), null);
  });

  it('returns null for non-numeric strings', () => {
    assert.strictEqual(parseNumericFieldValue('abc'), null);
    assert.strictEqual(parseNumericFieldValue('12abc'), null);
  });

  it('returns null for non-finite numbers', () => {
    assert.strictEqual(parseNumericFieldValue(Number.NaN), null);
    assert.strictEqual(parseNumericFieldValue(Number.POSITIVE_INFINITY), null);
  });
});
