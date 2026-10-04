/**
 * The scrubber against a REAL photograph-shaped payload.
 *
 * `ai-proxy.test.ts` proves the wiring with `'A'.repeat(120)`, which is the
 * easiest string a scrubber will ever see: no `+`, no `/`, no `-`, no `_`, no
 * escape. A photograph is random bytes, so its base64 is full of `+` and `/`,
 * and the encodings that wrap it on the way out of a provider (JSON with
 * escaped slashes, URL-safe base64, a form encoder) are exactly what splits a
 * run into pieces under the 48-character floor. Every case here starts from
 * `jpegLike`, which gives random bytes behind a JPEG header.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { scrubPayloads, DEFAULT_SCRUBBED_MAX_CHARS } from '../../src/ai/scrub.js';

/** Random bytes behind a JPEG start-of-image and a JFIF marker, and an end-of-image. */
function jpegLike(length: number): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  return Buffer.concat([header, randomBytes(length), Buffer.from([0xff, 0xd9])]);
}

const IMAGE = jpegLike(3000);
const STANDARD = IMAGE.toString('base64');
const URL_SAFE = IMAGE.toString('base64url');

test('the fixture is what a photograph is: standard base64 with slashes and pluses, URL-safe with dashes and underscores', () => {
  // Without this the cases below could pass against a fixture that never
  // contained the character each one is about. 3000 random bytes miss any one
  // of these four characters with probability about 2^-200.
  assert.ok(STANDARD.includes('/') && STANDARD.includes('+'));
  assert.ok(URL_SAFE.includes('-') && URL_SAFE.includes('_'));
  assert.ok(!URL_SAFE.includes('/') && !URL_SAFE.includes('+'));
});

test('a data URI of random bytes is redacted whole', () => {
  assert.equal(scrubPayloads(`before data:image/jpeg;base64,${STANDARD} after`), 'before [redacted] after');
});

test('a bare run of random bytes is redacted whole, whichever alphabet it uses', () => {
  assert.equal(scrubPayloads(`id: ${STANDARD}.`), 'id: [redacted].');
  assert.equal(scrubPayloads(`id: ${URL_SAFE}.`), 'id: [redacted].');
});

test('a payload with JSON-escaped slashes is redacted whole, not in pieces', () => {
  const escaped = STANDARD.replaceAll('/', String.raw`\/`);
  assert.ok(escaped.includes(String.raw`\/`));

  assert.equal(scrubPayloads(`"url":"data:image/jpeg;base64,${escaped}"`), '"url":"[redacted]"');
  // Without the data-URI prefix the pieces between two escaped slashes are
  // about 64 characters long on average, and a good share are under the floor:
  // each of those is bytes of the photograph left in the line.
  assert.equal(scrubPayloads(`"input":"${escaped}"`), '"input":"[redacted]"');
});

test('a payload encoded twice (two backslashes before the slash) is redacted whole', () => {
  const twice = STANDARD.replaceAll('/', String.raw`\\/`);
  assert.equal(scrubPayloads(`"input":"${twice}"`), '"input":"[redacted]"');
});

test('a payload with escaped code points, or percent-encoded, is redacted whole', () => {
  const codePoints = STANDARD.replaceAll('/', String.raw`/`).replaceAll('+', String.raw`+`);
  assert.equal(scrubPayloads(`"input":"${codePoints}"`), '"input":"[redacted]"');

  const percent = encodeURIComponent(STANDARD);
  assert.ok(percent.includes('%2F') && percent.includes('%2B'));
  assert.equal(scrubPayloads(`image=${percent}&n=1`), '[redacted]&n=1');
});

test('a URL-safe payload is redacted whole, with and without padding and a data URI', () => {
  assert.equal(scrubPayloads(`data:image/jpeg;base64,${URL_SAFE} tail`), '[redacted] tail');
  assert.equal(scrubPayloads(`"input":"${URL_SAFE}"`), '"input":"[redacted]"');
  const padded = IMAGE.subarray(0, IMAGE.length - 1).toString('base64url') + '==';
  assert.equal(scrubPayloads(`x ${padded} y`), 'x [redacted] y');
});

test('short identifiers and ordinary words survive', () => {
  assert.equal(scrubPayloads('accountId=42 family=abc123'), 'accountId=42 family=abc123');
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  assert.equal(uuid.length, 36);
  assert.equal(scrubPayloads(`request ${uuid} failed`), `request ${uuid} failed`);
});

test('output is capped at the default, and at a length the caller names', () => {
  const prose = 'the provider said no, and then it said it again. '.repeat(400);
  assert.ok(prose.length > DEFAULT_SCRUBBED_MAX_CHARS);

  const capped = scrubPayloads(prose);
  assert.ok(capped.startsWith(prose.slice(0, DEFAULT_SCRUBBED_MAX_CHARS)));
  assert.ok(capped.endsWith('...[truncated]'));
  assert.ok(capped.length <= DEFAULT_SCRUBBED_MAX_CHARS + '...[truncated]'.length);

  const small = scrubPayloads(prose, { maxChars: 50 });
  assert.equal(small, `${prose.slice(0, 50)}...[truncated]`);
});

test('the cap cuts AFTER redaction, so a cut cannot leave the tail of a run', () => {
  // A photograph that starts before the cap and ends after it. Cut first, and
  // the head of it would be 40 characters of base64 under the floor.
  const text = `${'x'.repeat(10)} ${STANDARD}`;
  const scrubbed = scrubPayloads(text, { maxChars: 50 });
  assert.equal(scrubbed, 'xxxxxxxxxx [redacted]');
});

test('scrubbing is idempotent, a capped string included', () => {
  const prose = 'words and more words '.repeat(500);
  for (const text of [
    `a data:image/jpeg;base64,${STANDARD} b`,
    `"x":"${STANDARD.replaceAll('/', String.raw`\/`)}"`,
    prose,
  ]) {
    const once = scrubPayloads(text, { maxChars: 200 });
    assert.equal(scrubPayloads(once, { maxChars: 200 }), once);
  }
});
