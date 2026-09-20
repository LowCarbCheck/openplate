/**
 * The shipped documents must not say the server cannot read a diary.
 *
 * Since the recovery code escrow (M192), openplate-core keeps each account's
 * recovery code sealed under its own secret, so the operator of an instance
 * CAN open a diary. `device-only-managed-copy.test.ts` only scans the app's UI
 * strings, so `docs/topologies.md` and `docs/sync.md` kept the old claim.
 *
 * Every text is collapsed to single spaces first, so a claim broken across a
 * hard wrap is still seen. THE CONTROL BLOCK feeds the detector the very
 * sentences it exists to catch, one of them wrapped, and one real sentence it
 * must leave alone: a scan that cannot fail proves nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const REPO_ROOT = new URL('../../', import.meta.url);

// Escrow (M192): the operator can in principle open a diary, so these claims are false.
const FALSE_CLAIMS = [
  /cannot read (?:a single entry|the entries|your entries|your diary|the diary)/i,
  /ciphertext it cannot read/i,
];

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function findFalseClaim(normalisedText: string): RegExp | undefined {
  return FALSE_CLAIMS.find((claim) => claim.test(normalisedText));
}

function listScannedFiles(): string[] {
  const docs = readdirSync(new URL('docs/', REPO_ROOT), { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => `docs/${entry}`);
  return ['README.md', 'AGENTS.md', ...docs].toSorted();
}

const SCANNED_FILES = listScannedFiles();

describe('the documents do not deny that the operator can open a diary', () => {
  it('scans docs/topologies.md, docs/sync.md and at least 5 files', () => {
    assert.ok(SCANNED_FILES.includes('docs/topologies.md'), SCANNED_FILES.join(', '));
    assert.ok(SCANNED_FILES.includes('docs/sync.md'), SCANNED_FILES.join(', '));
    assert.ok(SCANNED_FILES.length >= 5, `only ${SCANNED_FILES.length} files scanned`);
  });

  for (const relativePath of SCANNED_FILES) {
    it(`${relativePath} does not say the server cannot read the diary`, () => {
      const text = normalise(readFileSync(new URL(relativePath, REPO_ROOT), 'utf8'));
      assert.equal(findFalseClaim(text), undefined, `${relativePath} matches ${findFalseClaim(text)}`);
    });
  }
});

describe('the detector fires on the claims it exists for', () => {
  it('catches the old topologies.md sentence', () => {
    const oldSentence = 'The service cannot read a single entry, which also means it cannot recover one on its own';
    assert.ok(findFalseClaim(normalise(oldSentence)), 'the old topologies.md sentence slipped through');
  });

  it('catches the old sync.md phrase', () => {
    assert.ok(
      findFalseClaim(normalise('from holding ciphertext it cannot read.')),
      'the old sync.md phrase slipped through',
    );
  });

  it('catches the claim after a hard wrap, through the same normaliser the scan uses', () => {
    const wrapped = 'The service cannot read\n    a single entry, which also means it cannot recover one on its own';
    assert.equal(findFalseClaim(wrapped), undefined, 'the raw wrapped text should not match before normalising');
    assert.ok(findFalseClaim(normalise(wrapped)), 'the wrapped sentence slipped through the normaliser');
  });

  it('leaves an unrelated sentence from docs/podman.md alone', () => {
    const unrelated = 'a container cannot read or write a bind-mounted host';
    assert.equal(findFalseClaim(normalise(unrelated)), undefined, `the detector is too broad: ${unrelated}`);
  });
});
