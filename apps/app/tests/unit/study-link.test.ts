/**
 * The study join link — how a study's contribution key reaches a
 * contributor's device (M163/02).
 *
 * The same transport problem `connect-clinician.test.ts` holds three lines on,
 * with more at stake: ADR-0003 ranks study-key substitution above the
 * clinician case by a factor of N, because one substituted key harvests a
 * whole cohort.
 *
 *  1. A payload that arrived in the QUERY STRING is refused, even when a
 *     perfectly good fragment sits beside it. That both-halves case is the
 *     only discriminating one — a fragment-first parser with a query fallback
 *     passes every other test in this file.
 *  2. The link carries no fingerprint field, and could not: the fingerprint is
 *     printed in the study's consent document, which is the second channel the
 *     ceremony rests on.
 *  3. The screen adds no fourth outcome to the ceremony's three.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STUDY_JOIN_PATH,
  STUDY_LINK_PARAMS,
  buildStudyLink,
  joinStudyViewFor,
  parseStudyLink,
} from '../../app/lib/study-link';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { generateShareKeyPair, type ShareKeyPair } from '../../app/lib/sync/engine/crypto/share-wrap';

const STUDY_ACCOUNT_ID = 903;
const APP_ORIGIN = 'https://openplate.de';

/** The fragment of a freshly built link, without the leading `#`. */
function fragmentFor(pair: ShareKeyPair, { label = 'Charité sleep trial' }: { label?: string } = {}): string {
  const link = buildStudyLink({
    origin: APP_ORIGIN,
    studyAccountId: STUDY_ACCOUNT_ID,
    publicKeyBase64: bytesToBase64(pair.publicKeyRaw),
    label,
  });
  return link.slice(link.indexOf('#') + 1);
}

test('buildStudyLink puts the whole payload after the # and nothing before it', async () => {
  const pair = await generateShareKeyPair();
  const url = new URL(
    buildStudyLink({
      origin: APP_ORIGIN,
      studyAccountId: STUDY_ACCOUNT_ID,
      publicKeyBase64: bytesToBase64(pair.publicKeyRaw),
      label: 'Charité sleep trial',
    }),
  );

  assert.equal(url.pathname, STUDY_JOIN_PATH);
  // The part a server sees is empty. That is the property the design rests on:
  // a fragment is never transmitted, a query string always is.
  assert.equal(url.search, '');
  assert.match(url.hash, new RegExp(`^#${STUDY_LINK_PARAMS.publicKey}=`));
});

test('a study link round-trips the key, the account and the claimed name', async () => {
  const pair = await generateShareKeyPair();
  const parsed = parseStudyLink({ hash: `#${fragmentFor(pair)}`, search: '' });

  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') return;
  assert.equal(parsed.invite.studyAccountId, STUDY_ACCOUNT_ID);
  assert.equal(parsed.invite.publicKeyBase64, bytesToBase64(pair.publicKeyRaw));
  assert.equal(parsed.invite.claimedLabel, 'Charité sleep trial');
});

/**
 * THE DISCRIMINATING TEST. Making `parseStudyLink` read the query string when
 * the fragment is empty leaves every other test in this file green and fails
 * only the last assertion here — the one where a valid fragment sits beside
 * the transmitted copy. Verified by defect injection, 2026-08-28: the
 * assertion that fired was "a fragment beside a query-string payload does not
 * rescue the link".
 */
test('parseStudyLink refuses a study key in the query string', async () => {
  const pair = await generateShareKeyPair();
  const fragment = fragmentFor(pair);

  const transmitted = parseStudyLink({ hash: '', search: `?${fragment}` });
  assert.equal(transmitted.status, 'query-string');
  if (transmitted.status !== 'query-string') return;
  // Named so the screen can tell the person what happened to their link.
  assert.deepEqual(transmitted.parameters.toSorted(), ['a', 'k', 'n']);

  // Not only the key: a rewriting mailer moves the whole fragment at once, so
  // a stray account id is the same signal.
  const partial = parseStudyLink({ hash: `#${fragment}`, search: `?${STUDY_LINK_PARAMS.accountId}=903` });
  assert.equal(partial.status, 'query-string');

  // The both-halves case. A parser that preferred the fragment would return
  // `ok` here and nothing else in this file would notice.
  const both = parseStudyLink({ hash: `#${fragment}`, search: `?${fragment}` });
  assert.equal(both.status, 'query-string', 'a fragment beside a query-string payload does not rescue the link');
});

test('a link that is not a contribution key is invalid rather than accepted', async () => {
  const pair = await generateShareKeyPair();
  const shortened = bytesToBase64(pair.publicKeyRaw.slice(0, 40));

  assert.equal(parseStudyLink({ hash: '', search: '' }).status, 'invalid');
  assert.equal(parseStudyLink({ hash: '#k=not-base64!!&a=903', search: '' }).status, 'invalid');
  assert.equal(parseStudyLink({ hash: `#k=${shortened}&a=903`, search: '' }).status, 'invalid');
  assert.equal(
    parseStudyLink({ hash: `#${fragmentFor(pair)}`.replace('&a=903', '&a=0'), search: '' }).status,
    'invalid',
  );
});

test('the join link carries no fingerprint field for a screen to trust', async () => {
  const pair = await generateShareKeyPair();
  const link = buildStudyLink({
    origin: APP_ORIGIN,
    studyAccountId: STUDY_ACCOUNT_ID,
    publicKeyBase64: bytesToBase64(pair.publicKeyRaw),
    label: null,
  });

  // Three parameters, and none of them is a fingerprint. A fingerprint that
  // travelled beside the key is one the same attacker can rewrite.
  const fragment = new URLSearchParams(link.slice(link.indexOf('#') + 1));
  assert.deepEqual([...fragment.keys()].toSorted(), ['a', 'k']);
});

test('the join screen has three outcomes and adds no fourth', async () => {
  assert.equal(joinStudyViewFor({ status: 'verify' }), 'verify');
  assert.equal(joinStudyViewFor({ status: 'enrolled', pseudonym: 'abc' }), 'enrolled');
  assert.equal(joinStudyViewFor({ status: 'compartment-missing' }), 'compartment-missing');
  // A mismatch wrote nothing, so the person is where they were, one message
  // wiser — not on a new screen with a way past the refusal.
  assert.equal(joinStudyViewFor({ status: 'fingerprint-mismatch' }), 'verify');
});
