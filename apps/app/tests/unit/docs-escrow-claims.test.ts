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

/**
 * THE README'S OPENING PROMISE (2026-09-28). "Your key, your provider, your
 * data." stood as a bare sentence under the project name, and on a hosted
 * instance with accounts the operator provides the AI and keeps a recovery key
 * that can open the diary. The promise is kept only where it holds: on a copy
 * a person runs themselves. A bare sentence starting with the slogan is the
 * false one; a sentence that scopes it first is the true one.
 */
const UNSCOPED_BYOK_PROMISE = /(?:^|[.!?]\s)Your key, your provider,? (?:and )?your data\./m;

describe('the README scopes its BYOK promise to a copy you run yourself', () => {
  it('README.md does not state the promise as a bare sentence', () => {
    const readme = normalise(readFileSync(new URL('README.md', REPO_ROOT), 'utf8'));
    assert.equal(UNSCOPED_BYOK_PROMISE.test(readme), false);
  });

  it('THE CONTROL: the old opening is caught, and the scoped sentence is left alone', () => {
    assert.equal(UNSCOPED_BYOK_PROMISE.test('estimates the macros. Your key, your provider, your data.'), true);
    assert.equal(
      UNSCOPED_BYOK_PROMISE.test('On a copy you run yourself, it is your key, your provider, and your data.'),
      false,
    );
  });
});

/**
 * SYNC IS OPTIONAL ONLY WHERE YOU RUN IT YOURSELF (M3/01). `docs/sync.md` said "Sync is entirely
 * optional" and put "(optional)" in its title. On the hosted service every account syncs, because
 * the account is the sync: the diary keeps an encrypted copy on the server. A bare "optional" is
 * the false sentence; one that names the copy you run yourself, and says the hosted service
 * differs, is the true one.
 */
const SYNC_DOC = 'docs/sync.md';
const BARE_OPTIONAL_SYNC = /(?:^|[.!?]\s)Sync is entirely optional\./m;
const OPTIONAL_IN_TITLE = /^# .*\(optional\)/m;
const OPTIONAL_ONLY_ON_YOUR_OWN = /On your own instance sync is optional\./;
const HOSTED_ALWAYS_SYNCS = /On the hosted service every account syncs/;

describe('docs/sync.md scopes "sync is optional" to an instance you run yourself', () => {
  const doc = normalise(readFileSync(new URL(SYNC_DOC, REPO_ROOT), 'utf8'));
  const rawDoc = readFileSync(new URL(SYNC_DOC, REPO_ROOT), 'utf8');

  it('does not call sync entirely optional, and its title does not say "(optional)"', () => {
    assert.equal(BARE_OPTIONAL_SYNC.test(doc), false);
    assert.equal(OPTIONAL_IN_TITLE.test(rawDoc), false);
  });

  it('says that sync is optional on your own instance and that every hosted account syncs', () => {
    assert.equal(OPTIONAL_ONLY_ON_YOUR_OWN.test(doc), true);
    assert.equal(HOSTED_ALWAYS_SYNCS.test(doc), true);
  });

  it('THE CONTROL: the old sentence and the old title are caught, the scoped sentence is left alone', () => {
    assert.equal(BARE_OPTIONAL_SYNC.test('Sync is entirely optional. Unset, openplate loses no feature.'), true);
    assert.equal(BARE_OPTIONAL_SYNC.test('Text before. Sync is entirely optional.'), true);
    assert.equal(OPTIONAL_IN_TITLE.test('# Sync across devices (optional)\n\nBody'), true);
    assert.equal(
      BARE_OPTIONAL_SYNC.test('On your own instance sync is optional. Unset, openplate loses no feature.'),
      false,
    );
    assert.equal(OPTIONAL_IN_TITLE.test('# Sync across devices\n\nBody'), false);
  });
});
