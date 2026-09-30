/**
 * The one request both statutory forms send (`/kuendigung`, `/widerrufen`),
 * and the language it carries (2026-09-30).
 *
 * The form sends the reader's own language, one of the six, where it used to
 * narrow French, Italian, Spanish and Turkish to German. openplate-core
 * mails the receipt in that language. A language outside the six is English
 * (owner decision, 2026-09-30). A core older than the change accepts only
 * `de` and `en` and refuses any other with a `400` naming `language`; the
 * request then goes again ONCE, in English, by the same rule, so a statutory
 * button never fails over a language.
 *
 * The fetch is a fake that answers in order and records every body, so each
 * claim is a count of requests and the bodies they carried. Every claim has a
 * control that differs in one fact and goes the other way.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DECLARATIONS_API_PATH,
  declarationLanguageFor,
  submitDeclaration,
  type DeclarationFetch,
  type DeclarationRequest,
} from '../../app/lib/declaration-submit';

const SERVER = 'https://sync.example.test';

/** What one fake answer is: a status and a JSON body. */
interface FakeAnswer {
  status: number;
  body: object;
}

/** A fetch that answers `answers` in order, the last one repeating, and records every body it was sent. */
interface FakeFetch {
  fetchDeclaration: DeclarationFetch;
  bodies: DeclarationRequest[];
  urls: string[];
}

function fakeFetch(answers: readonly FakeAnswer[]): FakeFetch {
  const bodies: DeclarationRequest[] = [];
  const urls: string[] = [];
  const fetchDeclaration: DeclarationFetch = async (url, init) => {
    urls.push(url);
    // SAFETY: the module under test serialises a `DeclarationRequest`; the
    // fake reads it back to record what went over the wire.
    bodies.push(JSON.parse(String(init.body)) as DeclarationRequest);
    const answer = answers[Math.min(bodies.length, answers.length) - 1];
    if (answer === undefined) throw new Error('the fake fetch was given no answer');
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchDeclaration, bodies, urls };
}

function cancellation(language: DeclarationRequest['language']): DeclarationRequest {
  return {
    kind: 'kuendigung',
    name: 'Anna Beispiel',
    email: 'anna@example.org',
    contractReference: null,
    terminationType: 'ordentlich',
    reason: null,
    requestedDate: null,
    timing: 'earliest',
    language,
  };
}

/** A fetch whose request never arrives, as the browser's does when the core is down. */
const failingFetch: DeclarationFetch = async () => {
  throw new TypeError('Failed to fetch');
};

const ACCEPTED: FakeAnswer = {
  status: 202,
  body: { receiptId: 'r-1', receivedAt: '2026-09-30T10:00:00.000Z', kind: 'kuendigung' },
};
const LANGUAGE_REFUSED: FakeAnswer = { status: 400, body: { error: 'declaration-invalid', field: 'language' } };
const NAME_REFUSED: FakeAnswer = { status: 400, body: { error: 'declaration-invalid', field: 'name' } };

describe('the language a declaration is sent in', () => {
  it('is the language the form is drawn in, for each of the six', () => {
    for (const language of ['en', 'de', 'fr', 'it', 'es', 'tr'] as const) {
      assert.equal(declarationLanguageFor(language), language);
    }
  });

  it('reads a region tag by its language', () => {
    assert.equal(declarationLanguageFor('fr-CH'), 'fr');
    assert.equal(declarationLanguageFor('tr-TR'), 'tr');
    assert.equal(declarationLanguageFor('es-419'), 'es');
  });

  it('is English for a language the app does not ship (owner decision, 2026-09-30)', () => {
    for (const unknown of ['pt', 'pt-BR', '', 'nonsense']) {
      assert.equal(declarationLanguageFor(unknown), 'en');
    }
  });

  it('CONTROL: German and a German region tag stay German, so the English fallback is not a constant answer', () => {
    assert.equal(declarationLanguageFor('de'), 'de');
    assert.equal(declarationLanguageFor('de-CH'), 'de');
  });
});

describe('the declaration request', () => {
  it('posts once to the core, in the reader language, and answers the receipt', async () => {
    const fake = fakeFetch([ACCEPTED]);
    const outcome = await submitDeclaration({
      serverUrl: SERVER,
      request: cancellation('fr'),
      fetchDeclaration: fake.fetchDeclaration,
    });
    assert.deepEqual(outcome, { status: 'accepted', receiptId: 'r-1', receivedAt: '2026-09-30T10:00:00.000Z' });
    assert.deepEqual(fake.urls, [`${SERVER}${DECLARATIONS_API_PATH}`]);
    assert.deepEqual(fake.bodies, [cancellation('fr')]);
  });

  it('sends it again in English, once, when a core older than the six languages refuses the language', async () => {
    const fake = fakeFetch([LANGUAGE_REFUSED, ACCEPTED]);
    const outcome = await submitDeclaration({
      serverUrl: SERVER,
      request: cancellation('tr'),
      fetchDeclaration: fake.fetchDeclaration,
    });
    assert.equal(outcome.status, 'accepted');
    // Every other field goes again unchanged; only the language moves.
    assert.deepEqual(fake.bodies, [cancellation('tr'), cancellation('en')]);
  });

  it('CONTROL: a refusal that names another field is answered as invalid and not sent again', async () => {
    const fake = fakeFetch([NAME_REFUSED, ACCEPTED]);
    const outcome = await submitDeclaration({
      serverUrl: SERVER,
      request: cancellation('tr'),
      fetchDeclaration: fake.fetchDeclaration,
    });
    assert.deepEqual(outcome, { status: 'invalid' });
    assert.equal(fake.bodies.length, 1);
  });

  it('CONTROL: an English declaration refused for its language is not sent again, so the retry cannot loop', async () => {
    const fake = fakeFetch([LANGUAGE_REFUSED, ACCEPTED]);
    const outcome = await submitDeclaration({
      serverUrl: SERVER,
      request: cancellation('en'),
      fetchDeclaration: fake.fetchDeclaration,
    });
    assert.deepEqual(outcome, { status: 'invalid' });
    assert.equal(fake.bodies.length, 1);
  });

  it('CONTROL: a German declaration refused for its language goes again in English, so the guard above is keyed on English', async () => {
    const fake = fakeFetch([LANGUAGE_REFUSED, ACCEPTED]);
    const outcome = await submitDeclaration({
      serverUrl: SERVER,
      request: cancellation('de'),
      fetchDeclaration: fake.fetchDeclaration,
    });
    assert.equal(outcome.status, 'accepted');
    assert.deepEqual(fake.bodies, [cancellation('de'), cancellation('en')]);
  });

  it('an English retry that is refused too is answered as invalid, after two requests and no third', async () => {
    const fake = fakeFetch([LANGUAGE_REFUSED]);
    const outcome = await submitDeclaration({
      serverUrl: SERVER,
      request: cancellation('it'),
      fetchDeclaration: fake.fetchDeclaration,
    });
    assert.deepEqual(outcome, { status: 'invalid' });
    assert.equal(fake.bodies.length, 2);
  });

  it('keeps the other three answers it had: a 429, a failed request, a receipt of the wrong kind', async () => {
    const limited = fakeFetch([{ status: 429, body: { error: 'rate-limited' } }]);
    assert.deepEqual(
      await submitDeclaration({ serverUrl: SERVER, request: cancellation('es'), fetchDeclaration: limited.fetchDeclaration }),
      { status: 'rate-limited' },
    );

    assert.deepEqual(await submitDeclaration({ serverUrl: SERVER, request: cancellation('es'), fetchDeclaration: failingFetch }), {
      status: 'unreachable',
    });

    const wrongKind = fakeFetch([{ status: 202, body: { ...ACCEPTED.body, kind: 'widerruf' } }]);
    assert.deepEqual(
      await submitDeclaration({ serverUrl: SERVER, request: cancellation('es'), fetchDeclaration: wrongKind.fetchDeclaration }),
      { status: 'unreachable' },
    );
  });
});
