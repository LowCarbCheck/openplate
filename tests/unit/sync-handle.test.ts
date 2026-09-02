/**
 * The account handle: what the generator may emit, and what the shared rule
 * refuses.
 *
 * THE CLAIM THIS FILE DEFENDS is narrow and load-bearing: a generated handle
 * is never email-shaped and never contains a character a person mis-reads. It
 * is checked over many samples rather than one, because a table with a wrong
 * entry, or an off-by-one mask, shows up as a rare character and not as a
 * failing single draw.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findHandleProblem,
  generateHandle,
  HANDLE_LENGTH,
  MAX_HANDLE_LENGTH,
  normalizeHandle,
} from '../../app/lib/sync/handle';

/** Crockford's table, lowercased — restated here on purpose, so a drift in `base32.ts` fails this file. */
const ALLOWED = '0123456789abcdefghjkmnpqrstvwxyz';

/** The four letters Crockford omits because a human mis-transcribes them. */
const AMBIGUOUS = ['i', 'l', 'o', 'u'];

const SAMPLES = 500;

describe('generateHandle', () => {
  it('emits only Crockford characters, over many samples', () => {
    for (let index = 0; index < SAMPLES; index += 1) {
      const handle = generateHandle();
      for (const character of handle) {
        assert.ok(ALLOWED.includes(character), `"${character}" is not in the Crockford alphabet (from "${handle}")`);
      }
    }
  });

  it('never emits an ambiguous letter, over many samples', () => {
    for (let index = 0; index < SAMPLES; index += 1) {
      const handle = generateHandle();
      for (const letter of AMBIGUOUS) {
        assert.equal(handle.includes(letter), false, `"${letter}" must never appear (from "${handle}")`);
      }
    }
  });

  it('THE RULE: never emits an email-shaped handle, over many samples', () => {
    for (let index = 0; index < SAMPLES; index += 1) {
      const handle = generateHandle();
      assert.equal(handle.includes('@'), false, `a generated handle must never contain "@" (from "${handle}")`);
      assert.equal(
        findHandleProblem(handle),
        null,
        `a generated handle must pass its own validator (from "${handle}")`,
      );
    }
  });

  it('is already canonical, so the user sees what the service stores', () => {
    for (let index = 0; index < 50; index += 1) {
      const handle = generateHandle();
      assert.equal(normalizeHandle(handle), handle);
    }
  });

  it('is the stated length', () => {
    assert.equal(generateHandle().length, HANDLE_LENGTH);
  });

  it('draws every position from the randomness it is given, not from a fixed seed', () => {
    // Injected bytes rather than a statistical test: a generator that ignored
    // its input (or reused byte 0) would still pass a uniqueness check on real
    // randomness, and would fail here.
    const ascending = generateHandle((length) => Uint8Array.from({ length }, (_, index) => index));
    assert.equal(ascending, '0123456789'.slice(0, HANDLE_LENGTH));

    // The mask is 5 bits, so byte 32 must wrap to the first entry — the check
    // that would catch a modulo or an off-by-one.
    const wrapped = generateHandle((length) => new Uint8Array(length).fill(32));
    assert.equal(wrapped, '0'.repeat(HANDLE_LENGTH));
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let index = 0; index < SAMPLES; index += 1) seen.add(generateHandle());
    assert.equal(seen.size, SAMPLES, 'a collision at this sample size means the randomness is not being used');
  });
});

describe('normalizeHandle', () => {
  it('lowercases, trims and applies NFKC — the service’s own canonical form', () => {
    assert.equal(normalizeHandle('  K7M2Q3XR9T  '), 'k7m2q3xr9t');
  });

  it('normalises BEFORE trimming, so a full-width space still disappears', () => {
    // NFKC turns U+3000 into an ordinary space; trimming first would leave it.
    assert.equal(normalizeHandle('ｋ７ｍ　'), 'k7m');
  });
});

describe('findHandleProblem', () => {
  it('THE RULE: an address is refused, and named as an address', () => {
    assert.equal(findHandleProblem('someone@example.test'), 'email-shaped');
    assert.equal(findHandleProblem('@'), 'email-shaped');
  });

  it('refuses an empty or whitespace-only handle', () => {
    assert.equal(findHandleProblem(''), 'empty');
    assert.equal(findHandleProblem('   '), 'empty');
  });

  it('refuses a handle longer than the service accepts', () => {
    assert.equal(findHandleProblem('a'.repeat(MAX_HANDLE_LENGTH)), null);
    assert.equal(findHandleProblem('a'.repeat(MAX_HANDLE_LENGTH + 1)), 'too-long');
  });

  it('accepts an ordinary edited handle, since a user may choose their own', () => {
    assert.equal(findHandleProblem('kitchen-sink'), null);
    assert.equal(findHandleProblem('  Kitchen-Sink  '), null);
  });
});
