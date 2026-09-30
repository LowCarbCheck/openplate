/**
 * The operator's label, parsed: what is stored, what clears it, and what is
 * refused.
 *
 * EVERY REFUSAL HAS A CONTROL BESIDE IT. The bound is tested at 40 and at 41,
 * in plain letters and in emoji, so a check that refused everything, or one
 * that counted UTF-16 units instead of code points, fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_LABEL_REFUSAL, MAX_ACCOUNT_LABEL_LENGTH, parseAccountLabel } from '../../src/admin/account-label.js';

test('the bound is 40, the number the check constraint in the migration carries', () => {
  assert.equal(MAX_ACCOUNT_LABEL_LENGTH, 40);
});

test('a label is stored trimmed', () => {
  assert.deepEqual(parseAccountLabel('  Beta supporter '), { ok: true, value: 'Beta supporter' });
});

test('null and a blank string both clear the label', () => {
  assert.deepEqual(parseAccountLabel(null), { ok: true, value: null });
  assert.deepEqual(parseAccountLabel(''), { ok: true, value: null });
  assert.deepEqual(parseAccountLabel('   '), { ok: true, value: null });
});

test('40 code points pass and 41 are refused, in letters and in emoji', () => {
  assert.deepEqual(parseAccountLabel('a'.repeat(40)), { ok: true, value: 'a'.repeat(40) });
  assert.deepEqual(parseAccountLabel('a'.repeat(41)), { ok: false, reason: ACCOUNT_LABEL_REFUSAL });

  const fortyEmoji = '\u{1F331}'.repeat(40);
  assert.deepEqual(parseAccountLabel(fortyEmoji), { ok: true, value: fortyEmoji });
  assert.deepEqual(parseAccountLabel('\u{1F331}'.repeat(41)), { ok: false, reason: ACCOUNT_LABEL_REFUSAL });
});

test('the trim happens before the count, so padding does not push a 40 character label over', () => {
  assert.deepEqual(parseAccountLabel(`   ${'b'.repeat(40)}   `), { ok: true, value: 'b'.repeat(40) });
});

test('a line break, a tab or another control character is refused', () => {
  for (const label of ['Beta\nsupporter', 'Beta\tsupporter', 'Beta\u0007', 'Beta\u0085supporter']) {
    assert.deepEqual(parseAccountLabel(label), { ok: false, reason: ACCOUNT_LABEL_REFUSAL }, JSON.stringify(label));
  }
  // THE CONTROL: accents, umlauts and a non-Latin script are ordinary text.
  assert.deepEqual(parseAccountLabel('Bêta-Unterstützerin, 早期'), { ok: true, value: 'Bêta-Unterstützerin, 早期' });
});

test('anything that is not a string or null is refused', () => {
  for (const value of [42, true, ['Beta'], { text: 'Beta' }]) {
    assert.deepEqual(parseAccountLabel(value), { ok: false, reason: ACCOUNT_LABEL_REFUSAL }, JSON.stringify(value));
  }
});

test('the refusal names the field and the bound', () => {
  assert.match(ACCOUNT_LABEL_REFUSAL, /^label /);
  assert.match(ACCOUNT_LABEL_REFUSAL, /40/);
});
