/**
 * THE STUDY PSEUDONYM (M161/03, `PROTOCOL.md` §3.5, `openplate-sync`
 * ADR-0003) — stability, unlinkability, and the byte encoding.
 *
 * The encoding is the part worth testing hardest, because it is the part that
 * fails SILENTLY. §3.5 originally wrote the HMAC message as
 * `label || studyAccountId` without fixing the id's bytes: a study client
 * deriving over the id's ASCII digits and a contributor client deriving over
 * eight big-endian bytes both satisfy that sentence, both produce a
 * well-formed 26-character pseudonym, and they disagree — so a contributor's
 * rows would never join up with anything.
 *
 * So this file pins it twice: once against an INDEPENDENT construction of the
 * message built here from raw bytes, and once against a FROZEN literal. The
 * literal is the stronger of the two going forward — an implementation change
 * that also changed the independent construction in the same commit would slip
 * past the first check, and cannot slip past the second.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveStudyPseudonym,
  generatePseudonymRoot,
  PSEUDONYM_ROOT_BYTES,
} from '../../app/lib/sync/research/pseudonym';
import { CROCKFORD_BASE32_ALPHABET } from '../../app/lib/sync/engine/crypto/base32';

/** A fixed root — `0x00 0x01 ... 0x1f` — so the vector below is reproducible by any other implementation of §3.5. */
const FIXED_ROOT = new Uint8Array(PSEUDONYM_ROOT_BYTES).map((_, index) => index);

/**
 * THE FROZEN VECTOR: `deriveStudyPseudonym({ root: 0x00..0x1f, studyAccountId: 7 })`.
 *
 * Independently reproduced outside this codebase (Python `hmac` + `struct`
 * `'>Q'` + a from-scratch Crockford encoder) before being frozen here, so it
 * pins §3.5 rather than pinning this implementation's habits.
 *
 * Changing this literal to make a test pass is changing the protocol. Every
 * contributor already enrolled would present a new pseudonym to every study,
 * and each researcher would read it as a new participant with no history.
 */
const FIXED_ROOT_STUDY_7 = '1YYFSZXRK6DTYM03TZ22VR1M9M';

/** The independent construction: `label || uint64be(id)`, built here from raw bytes rather than by calling the module under test. */
async function pseudonymByHand({ root, studyAccountId }: { root: Uint8Array; studyAccountId: number }): Promise<string> {
  const label = 'openplate-sync:study-pseudonym:v1';
  const idBytes: number[] = [];
  let remaining = BigInt(studyAccountId);
  for (let index = 0; index < 8; index += 1) {
    idBytes.unshift(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  const message = new Uint8Array([...new TextEncoder().encode(label), ...idBytes]);
  // Copied into a fresh plain-buffer view: `BufferSource` will not accept a
  // possibly-shared backing buffer, which is the whole point of the engine's
  // own `toBufferSource` — not reused here, so this stays an independent path.
  const key = await crypto.subtle.importKey('raw', new Uint8Array(root), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));

  // Base32 by hand too, five bits at a time over the leading 128 bits.
  let bits = '';
  for (const byte of mac.slice(0, 16)) bits += byte.toString(2).padStart(8, '0');
  bits = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0');
  let out = '';
  for (let index = 0; index < bits.length; index += 5) {
    out += CROCKFORD_BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5), 2)];
  }
  return out;
}

describe('the study pseudonym', () => {
  it('pseudonym derivation matches the frozen §3.5 vector, byte encoding and all', async () => {
    const derived = await deriveStudyPseudonym({ root: FIXED_ROOT, studyAccountId: 7 });

    assert.equal(derived, FIXED_ROOT_STUDY_7, 'the pseudonym encoding moved — that is a protocol revision');
    assert.equal(derived, await pseudonymByHand({ root: FIXED_ROOT, studyAccountId: 7 }));

    // The id is EIGHT bytes, big-endian, always — not the decimal text, and
    // not a minimal-length encoding. An id whose low byte is zero is where a
    // minimal encoding and a fixed-width one visibly disagree.
    assert.equal(
      await deriveStudyPseudonym({ root: FIXED_ROOT, studyAccountId: 256 }),
      await pseudonymByHand({ root: FIXED_ROOT, studyAccountId: 256 }),
    );

    // Shape: 26 upper-case Crockford characters, ungrouped. This is a machine
    // identifier, not a value anyone types, so there are no separators.
    assert.equal(derived.length, 26);
    for (const character of derived) assert.ok(CROCKFORD_BASE32_ALPHABET.includes(character), derived);
  });

  it('pseudonym is stable per study and unlinkable across studies', async () => {
    const root = generatePseudonymRoot();
    const otherRoot = generatePseudonymRoot();
    assert.equal(root.byteLength, 32);

    // STABLE: the same root and the same study always give the same value.
    // This is what makes a contributor's submissions one participant series.
    const first = await deriveStudyPseudonym({ root, studyAccountId: 42 });
    assert.equal(await deriveStudyPseudonym({ root, studyAccountId: 42 }), first);

    // UNLINKABLE: a different study sees a different value, so two
    // researchers pooling cohorts cannot tell that a row in each is one
    // person. Adjacent ids are used deliberately — a construction that leaked
    // structure would leak it here first.
    assert.notEqual(await deriveStudyPseudonym({ root, studyAccountId: 43 }), first);
    assert.notEqual(await deriveStudyPseudonym({ root, studyAccountId: 42 }), await deriveStudyPseudonym({ root: otherRoot, studyAccountId: 42 }));

    // Two roots minted in a row are not the same root.
    assert.notDeepEqual(root, otherRoot);
  });

  it('pseudonym derivation refuses a malformed root or a malformed study id', async () => {
    // A half-understood input is a participant series pointing at the wrong
    // person, so every one of these is a refusal rather than a best effort.
    await assert.rejects(() => deriveStudyPseudonym({ root: new Uint8Array(16), studyAccountId: 7 }), /32 bytes/);
    await assert.rejects(() => deriveStudyPseudonym({ root: FIXED_ROOT, studyAccountId: -1 }), /non-negative/);
    await assert.rejects(() => deriveStudyPseudonym({ root: FIXED_ROOT, studyAccountId: 1.5 }), /safe integer/);
    await assert.rejects(() => deriveStudyPseudonym({ root: FIXED_ROOT, studyAccountId: 2 ** 63 }), /safe integer/);
  });
});
