/**
 * The two doors a caught value gets through to a log line.
 *
 * `errorFields` is a name and a code and nothing else, whatever the error
 * carries; `scrubbedErrorMessage` is words, but scrubbed, one line and capped
 * at 200 characters, and for boot and CLI failures only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { errorFields, scrubbedErrorMessage, SCRUBBED_ERROR_MESSAGE_MAX_CHARS } from '../../src/log-error.js';

const MARKER = 'PHOTO-MARKER-0b6d41f8a2c7';

test('an error is reduced to its name and its code', () => {
  const failure = Object.assign(new TypeError(`bad input ${MARKER}`), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.deepEqual(errorFields(failure), { errorName: 'TypeError', errorCode: 'ERR_INVALID_ARG_TYPE' });
});

test('the code is found along the cause chain, which is where fetch hides it', () => {
  const root = Object.assign(new Error(MARKER), { code: 'ECONNREFUSED' });
  const wrapped = new TypeError('fetch failed', { cause: root });
  assert.deepEqual(errorFields(wrapped), { errorName: 'TypeError', errorCode: 'ECONNREFUSED' });
});

test('a numeric code is read, an absent one is null', () => {
  assert.equal(errorFields(Object.assign(new Error('x'), { code: 23505 })).errorCode, '23505');
  assert.equal(errorFields(new Error('x')).errorCode, null);
});

test('a name or a code that is not a plain token is dropped, so neither can carry a sentence', () => {
  const sentence = Object.assign(new Error('x'), { name: `Error ${MARKER}`, code: `see ${MARKER}` });
  assert.deepEqual(errorFields(sentence), { errorName: 'Error', errorCode: null });

  const long = Object.assign(new Error('x'), { code: 'A'.repeat(65) });
  assert.equal(errorFields(long).errorCode, null);
});

test('a thrown value that is not an error is a NonError, and its text is not read', () => {
  assert.deepEqual(errorFields(`text with ${MARKER}`), { errorName: 'NonError', errorCode: null });
  assert.deepEqual(errorFields({ message: MARKER }), { errorName: 'NonError', errorCode: null });
  assert.deepEqual(errorFields(null), { errorName: 'NonError', errorCode: null });
  assert.deepEqual(errorFields(undefined), { errorName: 'NonError', errorCode: null });
});

test('a cause chain that loops does not hang', () => {
  const first = new Error('a');
  const second = new Error('b', { cause: first });
  Object.assign(first, { cause: second });
  assert.deepEqual(errorFields(first), { errorName: 'Error', errorCode: null });
});

test('scrubbedErrorMessage scrubs a payload out of the message, flattens it to one line and caps it', () => {
  const photograph = randomBytes(2000).toString('base64');
  const message = scrubbedErrorMessage(new Error(`connect failed\nfor data:image/jpeg;base64,${photograph} end`));
  assert.equal(message, 'connect failed for [redacted] end');

  const long = scrubbedErrorMessage(new Error('no route to host '.repeat(100)));
  assert.equal(long.length, SCRUBBED_ERROR_MESSAGE_MAX_CHARS + '...[truncated]'.length);
  assert.ok(long.endsWith('...[truncated]'));
});

test('scrubbedErrorMessage does not read a thrown string or the cause chain', () => {
  assert.equal(scrubbedErrorMessage(`secret ${MARKER}`), 'unknown error');
  assert.ok(!scrubbedErrorMessage(new Error('outer', { cause: new Error(MARKER) })).includes(MARKER));
});
