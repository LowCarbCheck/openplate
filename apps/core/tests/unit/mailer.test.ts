/**
 * The HTTP mail adapter: what it posts, and what it refuses to know.
 *
 * IT RUNS AGAINST A REAL LISTENING SERVER on an ephemeral loopback port, not
 * against a stubbed `fetch`. The properties worth testing here are about a
 * real request: the payload shape a Resend-compatible API receives, the
 * `Authorization` header, and the timeout. A stubbed `fetch` would assert that
 * this module called a function, which is not the same claim.
 *
 * THE PRIVACY ASSERTIONS ARE THE POINT OF THE FILE. Both Resend and pigeon
 * echo the request back inside an error body, which means the recipient
 * address, the subject and any html the provider chooses to include — and the
 * html carries a live token. The adapter cancels the body without reading it,
 * so there is no string in scope for a later `${...}` to put into a log. These
 * tests make a failing server return exactly that echo and assert that none of
 * it reaches the thrown error or the logger.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpMailer, createMailer, createNoopMailer } from '../../src/mail/mailer.js';
import type { CreateHttpMailerOptions, Mailer } from '../../src/mail/mailer.js';
import { createDeclarationTemplateSource } from '../../src/mail/declaration-templates.js';
import { detailLines, RECEIPT_WITHHELD, toDeclarationReceipt } from '../../src/mail/declaration-message.js';
import type { LogFields, Logger } from '../../src/logger.js';
import { INSTANCE_LANGUAGES, type InstanceLanguage } from '../../src/protocol.js';

/** The neutral stand-in for a mounted `CONTENT_DIR`, see its README. */
const FIXTURE_CONTENT = fileURLToPath(new URL('../fixtures/content', import.meta.url));

const servers: Server[] = [];

after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

interface ReceivedRequest {
  authorization: string | undefined;
  contentType: string | undefined;
  body: string;
}

/** The Resend-shaped payload this adapter posts. Named so a parsed body has a contract. */
interface MailPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

interface FakeMailApi {
  url: string;
  received: ReceivedRequest[];
}

/**
 * A mail API that records what it was sent and answers however the test asks.
 *
 * `respond` returns the status and the body: the failure cases below make it
 * echo the request back, which is what both real providers do.
 */
async function startFakeMailApi(
  respond: (received: ReceivedRequest) => { status: number; body: string } = () => ({
    status: 200,
    body: JSON.stringify({ id: 'msg_1' }),
  }),
): Promise<FakeMailApi> {
  const received: ReceivedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request: ReceivedRequest = {
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      };
      received.push(request);
      const answer = respond(request);
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(answer.body);
    });
  });
  servers.push(server);
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null) throw new Error('expected a listening fake mail API');
  // SAFETY: `listen(0)` binds a TCP port; Node returns the string form only
  // for a Unix domain socket, which this never opens.
  const { port } = address as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1/emails`, received };
}

interface CapturedLine {
  message: string;
  fields: LogFields | undefined;
}

/** Every line the adapter emitted, so the absence assertions below have something real to search. */
interface CapturingLogger {
  logger: Logger;
  lines: CapturedLine[];
}

function createCapturingLogger(): CapturingLogger {
  const lines: CapturedLine[] = [];
  const record = (message: string, fields?: LogFields): void => {
    lines.push({ message, fields });
  };
  return { lines, logger: { debug: record, info: record, warn: record, error: record } };
}

const LINKS = { clientBaseUrl: 'https://openplate.de', serverPublicUrl: 'https://sync.openplate.de' };

function mailerFor(url: string, logger: Logger, timeoutMs?: number): Mailer {
  const options: CreateHttpMailerOptions = {
    mail: {
      url,
      apiKey: 'a-mail-api-key-nobody-should-see',
      from: 'openplate <openplate@mail.openplate.de>',
      operatorEmail: 'operator@example.org',
    },
    links: LINKS,
    language: 'en',
    templates: createDeclarationTemplateSource({ contentDir: FIXTURE_CONTENT, logger }),
    logger,
  };
  // Set in a statement rather than spread conditionally, so the omission is a
  // line a reader sees instead of a `{}` they have to decode.
  if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;
  return createHttpMailer(options);
}

/** An adapter on an instance whose own language is `language`, the way `INSTANCE_LANGUAGE` sets it. */
function mailerIn(input: { url: string; logger: Logger; language: InstanceLanguage }): Mailer {
  return createHttpMailer({
    mail: { url: input.url, apiKey: 'k', from: 'f', operatorEmail: 'operator@example.org' },
    links: LINKS,
    language: input.language,
    templates: createDeclarationTemplateSource({ contentDir: null, logger: input.logger }),
    logger: input.logger,
  });
}

// ── Which letters ask Pigeon to keep no body ───────────────────────────────

/** The one field these tests read off a posted body. */
interface RetainPayload {
  retain_body?: boolean;
}

/** The request body of the one request a fake mail API received, parsed. */
function onlyPayload(api: FakeMailApi): RetainPayload {
  assert.equal(api.received.length, 1);
  // SAFETY: this adapter posted the body, and it is a JSON object by construction.
  return JSON.parse(api.received[0]?.body ?? '{}') as RetainPayload;
}

interface LetterCase {
  name: string;
  send: (mailer: Mailer) => Promise<void>;
}

test('every letter that carries a secret link posts retain_body: false, spelled exactly so', async () => {
  const letters: LetterCase[] = [
    {
      name: 'an invitation',
      send: (mailer) =>
        mailer.sendInvite({ email: 'a@example.org', displayName: null, inviteToken: 'si_t', expiresAt: 'x' }),
    },
    {
      name: 'a password reset',
      send: (mailer) => mailer.sendReset({ email: 'a@example.org', resetToken: 'sr_t', expiresAt: 'x' }),
    },
    {
      name: 'a sign-up link',
      send: (mailer) =>
        mailer.sendSignupRequest({
          email: 'a@example.org',
          displayName: null,
          inviteToken: 'si_t',
          expiresAt: 'x',
          intent: { plan: null, locale: null },
        }),
    },
  ];
  for (const letter of letters) {
    const api = await startFakeMailApi();
    await letter.send(mailerFor(api.url, createCapturingLogger().logger));
    assert.equal(onlyPayload(api).retain_body, false, letter.name);
    // The wire spelling, not only the parsed key: snake_case, a boolean, no string.
    assert.ok(api.received[0]?.body.includes('"retain_body":false'), letter.name);
  }
});

test('a letter with no secret in it posts no retain_body field at all', async () => {
  // THE CONTROL for the test above: it fails against a transport that adds the field to everything.
  const quiet: LetterCase[] = [
    { name: 'the account notice', send: (mailer) => mailer.sendAccountNotice({ email: 'a@example.org' }) },
    {
      name: 'the sign-up account notice',
      send: (mailer) => mailer.sendSignupAccountNotice({ email: 'a@example.org', language: null }),
    },
    {
      name: 'a declaration receipt',
      send: (mailer) =>
        mailer.sendDeclarationReceipt({ ...sampleReceipt(), receiptId: 'r', to: 'a@example.org', language: 'en' }),
    },
  ];
  for (const letter of quiet) {
    const api = await startFakeMailApi();
    await letter.send(mailerFor(api.url, createCapturingLogger().logger));
    assert.equal('retain_body' in onlyPayload(api), false, letter.name);
  }
});

// ── What it posts ──────────────────────────────────────────────────────────

test('an invite send posts the Resend-shaped payload, with the recipient as an array', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();

  await mailerFor(api.url, captured.logger).sendInvite({
    email: 'anna@example.org',
    displayName: 'Anna',
    inviteToken: 'si_a-token',
    expiresAt: '2026-09-11T10:00:00.000Z',
  });

  assert.equal(api.received.length, 1);
  const request = api.received[0];
  assert.ok(request);
  assert.equal(request.authorization, 'Bearer a-mail-api-key-nobody-should-see');
  assert.equal(request.contentType, 'application/json');

  // SAFETY: this test's own fake API received the body this adapter posted, so
  // it is the shape declared above by construction.
  const payload = JSON.parse(request.body) as MailPayload;
  assert.equal(payload.from, 'openplate <openplate@mail.openplate.de>');
  // AN ARRAY EVEN FOR ONE RECIPIENT: Resend accepts it and pigeon requires it,
  // which is the whole compatibility story between the two.
  assert.deepEqual(payload.to, ['anna@example.org']);
  assert.equal(payload.subject, 'Your openplate invitation');
  assert.ok(payload.text.includes('si_a-token'), 'the text part must carry the link');
  assert.ok(payload.html.startsWith('<!doctype html>'));
});

test('a reset send posts the reset letter, in the configured language', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();

  const german = createHttpMailer({
    mail: { url: api.url, apiKey: 'k', from: 'f', operatorEmail: 'operator@example.org' },
    links: LINKS,
    language: 'de',
    templates: createDeclarationTemplateSource({ contentDir: null, logger: captured.logger }),
    logger: captured.logger,
  });
  await german.sendReset({ email: 'anna@example.org', resetToken: 'sr_a-token', expiresAt: 'x' });

  // SAFETY: as above — our own adapter posted this body.
  const payload = JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
  assert.equal(payload.subject, 'Neues Passwort für openplate festlegen');
  assert.ok(payload.text.includes('/reset#server='), 'the reset link, not the join link');
});

test('the sign-up door posts its own letter and its own note, never the invitation', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();
  const mailer = mailerFor(api.url, captured.logger);

  await mailer.sendSignupRequest({
    email: 'anna@example.org',
    displayName: null,
    inviteToken: 'si_a-token',
    expiresAt: '2026-09-11T10:00:00.000Z',
    intent: { plan: null, locale: null },
  });
  await mailer.sendSignupAccountNotice({ email: 'bert@example.org', language: null });

  // SAFETY: as above, our own adapter posted these bodies.
  const letter = JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
  // SAFETY: as above, our own adapter posted this body.
  const note = JSON.parse(api.received[1]?.body ?? '{}') as MailPayload;
  assert.equal(letter.subject, 'Create your openplate account');
  assert.ok(letter.text.includes('/join#server=') && letter.text.includes('si_a-token'));
  assert.ok(!letter.text.includes('invited'));
  assert.equal(note.subject, 'You already have an openplate account');
  assert.ok(!note.text.includes('http') && !note.text.includes('invited'));
});

test("the posted sign-up letter's link carries the plan and the language the person picked", async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();
  const mailer = mailerFor(api.url, captured.logger);

  await mailer.sendSignupRequest({
    email: 'anna@example.org',
    displayName: null,
    inviteToken: 'si_a-token',
    expiresAt: '2026-09-11T10:00:00.000Z',
    intent: { plan: 'yearly', locale: 'de' },
  });
  // THE CONTROL: the same adapter with nothing picked adds neither parameter.
  await mailer.sendSignupRequest({
    email: 'bert@example.org',
    displayName: null,
    inviteToken: 'si_b-token',
    expiresAt: '2026-09-11T10:00:00.000Z',
    intent: { plan: null, locale: null },
  });

  // SAFETY: as above, our own adapter posted these bodies.
  const picked = JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
  // SAFETY: as above, our own adapter posted this body.
  const plain = JSON.parse(api.received[1]?.body ?? '{}') as MailPayload;
  assert.ok(picked.text.includes('invite=si_a-token&plan=yearly&lang=de'), picked.text);
  assert.ok(
    picked.html.includes('invite=si_a-token&amp;plan=yearly&amp;lang=de'),
    'the HTML part carries the same link',
  );
  assert.ok(plain.text.includes('invite=si_b-token'));
  assert.ok(!plain.text.includes('plan=') && !plain.text.includes('lang='), plain.text);
});

test('the sign-up letter is written in the language the person asked in, and in the instance language when they named none', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();
  // A German instance, the way app.openplate.de runs, asked by a visitor who wrote in English.
  const mailer = mailerIn({ url: api.url, logger: captured.logger, language: 'de' });
  const askIn = (locale: InstanceLanguage | null): Promise<void> =>
    mailer.sendSignupRequest({
      email: 'anna@example.org',
      displayName: null,
      inviteToken: 'si_a-token',
      expiresAt: '2026-09-11T10:00:00.000Z',
      intent: { plan: null, locale },
    });

  await askIn('en');
  // THE CONTROLS: German asked for is German, nothing asked for is the
  // instance's own language, and a third language shows this is no English toggle.
  await askIn('de');
  await askIn(null);
  await askIn('fr');

  assert.equal(api.received.length, 4);
  // SAFETY: as above, our own adapter posted these bodies.
  const [english, german, unnamed, french] = api.received.map((request) => JSON.parse(request.body) as MailPayload);
  assert.equal(english?.subject, 'Create your openplate account');
  assert.ok(english?.text.includes('it expires on 11 September 2026'), 'the body and its date follow the subject');
  assert.ok(english?.html.includes('<html lang="en">'), 'the HTML part names the language it is written in');
  assert.equal(german?.subject, 'Erstelle dein openplate-Konto');
  assert.equal(unnamed?.subject, 'Erstelle dein openplate-Konto');
  assert.equal(french?.subject, 'Crée ton compte openplate');
});

test('the sign-up note to an existing account is written in the language the person asked in, and in the instance language when they named none', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();
  const mailer = mailerIn({ url: api.url, logger: captured.logger, language: 'de' });

  await mailer.sendSignupAccountNotice({ email: 'anna@example.org', language: 'en' });
  // THE CONTROLS, as for the letter above.
  await mailer.sendSignupAccountNotice({ email: 'anna@example.org', language: 'de' });
  await mailer.sendSignupAccountNotice({ email: 'anna@example.org', language: null });

  assert.equal(api.received.length, 3);
  // SAFETY: as above, our own adapter posted these bodies.
  const [english, german, unnamed] = api.received.map((request) => JSON.parse(request.body) as MailPayload);
  assert.equal(english?.subject, 'You already have an openplate account');
  assert.ok(english?.html.includes('<html lang="en">'), 'the HTML part names the language it is written in');
  assert.equal(german?.subject, 'Du hast bereits ein openplate-Konto');
  assert.equal(unnamed?.subject, 'Du hast bereits ein openplate-Konto');
});

test('an account-notice send posts the third letter, and posts no link with it', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();

  await mailerFor(api.url, captured.logger).sendAccountNotice({ email: 'anna@example.org' });

  assert.equal(api.received.length, 1);
  // SAFETY: as above, our own adapter posted this body.
  const payload = JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
  assert.deepEqual(payload.to, ['anna@example.org']);
  assert.equal(payload.subject, 'You already have an openplate account');
  // THE PROPERTY THIS LETTER EXISTS FOR: it hands over nothing. Asserted on
  // the posted payload rather than on the builder, because the adapter is what
  // a mail provider actually receives.
  assert.ok(!payload.text.includes('http'), 'the note must carry no url in its text part');
  assert.ok(!payload.html.includes('href'), 'the note must carry no link in its html part');
});

test('the same adapter DOES post a link for an invitation, so the assertion above is about the note', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();

  await mailerFor(api.url, captured.logger).sendInvite({
    email: 'anna@example.org',
    displayName: null,
    inviteToken: 'si_a-token',
    expiresAt: '2026-09-11T10:00:00.000Z',
  });

  // SAFETY: as above.
  const payload = JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
  assert.ok(payload.html.includes('href'), 'an invitation must carry its link');
});

// ── What it refuses to know ────────────────────────────────────────────────

test('a failing send throws the status code and NOTHING the provider echoed back', async () => {
  // Both real providers echo the request inside an error body. The html in
  // that echo carries a live token, so reading it would put a credential in
  // scope for a later error message or log line to interpolate.
  const echoed = JSON.stringify({ error: 'rejected', echo: { to: ['anna@example.org'], html: 'si_a-secret-token' } });
  const api = await startFakeMailApi(() => ({ status: 422, body: echoed }));
  const captured = createCapturingLogger();

  await assert.rejects(
    () =>
      mailerFor(api.url, captured.logger).sendInvite({
        email: 'anna@example.org',
        displayName: null,
        inviteToken: 'si_a-secret-token',
        expiresAt: '2026-09-11T10:00:00.000Z',
      }),
    (error: Error) => {
      // The status, and only the status.
      assert.equal(error.message, 'mail API responded 422');
      assert.ok(!error.message.includes('anna@example.org'));
      assert.ok(!error.message.includes('si_a-secret-token'));
      assert.ok(!error.message.includes('rejected'));
      return true;
    },
  );
});

test('nothing the adapter logs carries a recipient, a subject, a token or a key', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();

  await mailerFor(api.url, captured.logger).sendInvite({
    email: 'anna@example.org',
    displayName: 'Anna',
    inviteToken: 'si_a-secret-token',
    expiresAt: '2026-09-11T10:00:00.000Z',
  });

  const serialized = JSON.stringify(captured.lines);
  // The positive half first, so an adapter that logged nothing at all would
  // not satisfy this file by silence.
  assert.ok(serialized.includes('Invitation mailed'), 'a send must be recorded');
  // ...and the absence half.
  for (const secret of [
    'anna@example.org',
    'si_a-secret-token',
    'a-mail-api-key-nobody-should-see',
    'Your openplate invitation',
    api.url,
  ]) {
    assert.ok(!serialized.includes(secret), `the log carries "${secret}"`);
  }
});

test('the send is bounded by a timeout rather than hanging forever', async () => {
  // A mail API that accepts the connection and never answers. Without the
  // bound this send would hold the admin request open until the client gave
  // up, and an operator would see a hung terminal rather than a link.
  const server = createServer(() => {
    // Deliberately never responds.
  });
  servers.push(server);
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port, and Node returns the string form of
  // an address only for a Unix domain socket, which this never opens.
  const { port } = server.address() as AddressInfo;
  const captured = createCapturingLogger();

  await assert.rejects(() =>
    mailerFor(`http://127.0.0.1:${port}/v1/emails`, captured.logger, 50).sendReset({
      email: 'anna@example.org',
      resetToken: 'sr_x',
      expiresAt: 'x',
    }),
  );
});

// ── Choosing an adapter ────────────────────────────────────────────────────

test('createMailer answers the no-op when mail or the link bases are absent', async () => {
  const captured = createCapturingLogger();
  const send = { email: 'anna@example.org', resetToken: 'sr_x', expiresAt: 'x' };

  // No mail block: the copy-link deployment most self-hosters run.
  const templates = createDeclarationTemplateSource({ contentDir: null, logger: captured.logger });
  await createMailer({ mail: null, links: LINKS, language: 'en', templates, logger: captured.logger }).sendReset(send);
  // Mail but no links, which `config.ts` refuses at boot — the narrowing here
  // is belt and braces rather than a second policy.
  await createMailer({
    mail: { url: 'http://unreachable.invalid', apiKey: 'k', from: 'f', operatorEmail: 'operator@example.org' },
    links: null,
    language: 'en',
    templates,
    logger: captured.logger,
  }).sendReset(send);

  // Neither attempted a request, so neither threw against an unreachable host.
  assert.deepEqual(captured.lines, []);
});

test('the no-op mailer accepts all five letters and sends none', async () => {
  const mailer = createNoopMailer();
  await mailer.sendInvite({ email: 'a@b.test', displayName: null, inviteToken: 'si_x', expiresAt: 'x' });
  await mailer.sendReset({ email: 'a@b.test', resetToken: 'sr_x', expiresAt: 'x' });
  await mailer.sendAccountNotice({ email: 'a@b.test' });
  await mailer.sendDeclarationReceipt({
    ...sampleReceipt(),
    receiptId: 'a-receipt-id',
    to: 'a@b.test',
    language: 'en',
  });
  await mailer.sendDeclarationOperatorAlert({
    ...sampleDeclarationFields(),
    receiptId: 'a-receipt-id',
    matched: false,
  });
  // Nothing to assert but the absence of a throw: an instance without mail must
  // not fail the request that would have sent one.
  assert.ok(true);
});

// ── The two declaration letters (M214/09) ──────────────────────────────────

interface SampleDeclarationFields {
  kind: 'kuendigung' | 'widerruf';
  name: string;
  email: string;
  contractReference: string | null;
  terminationType: 'ordentlich' | 'ausserordentlich' | null;
  reason: string | null;
  requestedDate: string | null;
  timing: 'earliest' | 'onDate' | null;
  receivedAt: Date;
}

function sampleDeclarationFields(): SampleDeclarationFields {
  return {
    kind: 'kuendigung',
    name: 'Anna Beispiel',
    email: 'anna@example.org',
    contractReference: 'K-1234',
    terminationType: 'ordentlich',
    reason: null,
    requestedDate: null,
    timing: 'earliest',
    receivedAt: new Date('2026-09-21T10:00:00.000Z'),
  };
}

/** What the route hands the receipt: the same declaration, without the text the sender wrote (M270/11). */
function sampleReceipt(): ReturnType<typeof toDeclarationReceipt> {
  return toDeclarationReceipt(sampleDeclarationFields());
}

test('a declaration receipt posts the content folder letter, in the requested language, to the given address', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();

  await mailerFor(api.url, captured.logger).sendDeclarationReceipt({
    ...sampleReceipt(),
    receiptId: 'a-receipt-id',
    to: 'anna@example.org',
    language: 'de',
  });

  assert.equal(api.received.length, 1);
  // SAFETY: as above, our own adapter posted this body.
  const payload = JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
  assert.deepEqual(payload.to, ['anna@example.org']);
  assert.equal(payload.subject, 'Fixture subject receipt kuendigung de');
  assert.ok(payload.text.includes('Fixture closing line kuendigung de.'), 'the body must come from the file');
  assert.ok(
    payload.text.includes(`Vertrags- oder Kundennummer: ${RECEIPT_WITHHELD.de}`),
    'the receipt must confirm every field the person gave',
  );
  assert.ok(!payload.text.includes('K-1234'), 'the receipt must not repeat text the person wrote');
  assert.ok(JSON.stringify(captured.lines).includes('"text":"template"'), 'the send must log where its text came from');
});

test('with no content folder, a declaration receipt posts the neutral fallback, and logs that it did', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();
  const mailer = createHttpMailer({
    mail: { url: api.url, apiKey: 'k', from: 'f', operatorEmail: 'operator@example.org' },
    links: LINKS,
    language: 'en',
    templates: createDeclarationTemplateSource({ contentDir: null, logger: captured.logger }),
    logger: captured.logger,
  });

  await mailer.sendDeclarationReceipt({
    ...sampleReceipt(),
    receiptId: 'a-receipt-id',
    to: 'anna@example.org',
    language: 'en',
  });

  // SAFETY: as above, our own adapter posted this body.
  const payload = JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
  assert.equal(payload.subject, 'Cancellation confirmed');
  assert.ok(payload.text.includes('Receipt no.: a-receipt-id'));
  assert.ok(payload.text.includes(`Contract or customer number: ${RECEIPT_WITHHELD.en}`));
  assert.ok(!payload.text.includes('K-1234'), 'the receipt must not repeat text the person wrote');
  assert.ok(!payload.text.includes('Fixture'), 'a fallback must carry no folder text');
  assert.ok(JSON.stringify(captured.lines).includes('"text":"fallback"'));
});

test('a declaration operator alert posts to the configured operator address, in English, naming the receipt id', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();

  await mailerFor(api.url, captured.logger).sendDeclarationOperatorAlert({
    ...sampleDeclarationFields(),
    kind: 'widerruf',
    receiptId: 'a-receipt-id-9',
    matched: true,
  });
  // The fixture folder holds no withdrawal alert, so this is the neutral text.

  assert.equal(api.received.length, 1);
  // SAFETY: as above — our own adapter posted this body.
  const payload = JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
  // Configured in `mailerFor`, never a value the call site named.
  assert.deepEqual(payload.to, ['operator@example.org']);
  assert.ok(payload.subject.includes('a-receipt-id-9'));
  assert.ok(payload.text.includes('a-receipt-id-9'));
  assert.ok(payload.text.includes('yes'), 'the alert must say whether the declaration matched an account');
});

test('nothing a declaration send logs carries a name, a reason or a contract reference', async () => {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();

  const mailer = mailerFor(api.url, captured.logger);
  await mailer.sendDeclarationReceipt({
    ...sampleReceipt(),
    receiptId: 'a-receipt-id',
    to: 'anna@example.org',
    language: 'en',
  });
  // The operator alert is the letter that carries those words since M270/11,
  // so it is the send this test must watch most.
  await mailer.sendDeclarationOperatorAlert({
    ...sampleDeclarationFields(),
    reason: 'a very personal reason nobody else should read',
    receiptId: 'a-receipt-id',
    matched: false,
  });

  const serialized = JSON.stringify(captured.lines);
  assert.ok(serialized.includes('Declaration receipt mailed'), 'a send must be recorded');
  assert.ok(serialized.includes('Declaration operator alert mailed'), 'a send must be recorded');
  for (const secret of ['anna@example.org', 'Anna Beispiel', 'K-1234', 'a very personal reason']) {
    assert.ok(!serialized.includes(secret), `the log carries "${secret}"`);
  }
});

// ── The receipt in each of the six languages (2026-09-30) ──────────────────
//
// A scratch content folder per test, so each test states which receipt files
// exist: all six, or only German and English, like an instance whose folder
// has not been given the other four. The fixture folder above is left alone.

/** The four languages that had no receipt of their own before 2026-09-30. */
const NEWER_LANGUAGES = ['fr', 'it', 'es', 'tr'] as const satisfies readonly InstanceLanguage[];

/** A neutral cancellation receipt for one language, marked with that language in its subject. */
function receiptFixture(language: InstanceLanguage): string {
  return [
    '---',
    `title: Fixture receipt kuendigung ${language}`,
    'updated: 2026-09-30',
    `subject: Fixture subject receipt kuendigung ${language}`,
    '---',
    '',
    'Fixture received on {{date}}.',
    '',
    '{{details}}',
    '',
    `Fixture closing line kuendigung ${language}.`,
    '',
  ].join('\n');
}

/** A scratch content folder holding the cancellation receipt in `languages` and in nothing else. */
async function contentFolderWith(languages: readonly InstanceLanguage[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openplate-core-receipts-'));
  for (const language of languages) {
    await mkdir(join(root, language, 'mail'), { recursive: true });
    await writeFile(join(root, language, 'mail', 'declaration-receipt-kuendigung.md'), receiptFixture(language));
  }
  return root;
}

/** Sends one cancellation receipt in `language` through a mailer reading `contentDir`, and answers what was posted. */
async function postedReceipt(input: { contentDir: string | null; language: InstanceLanguage }): Promise<MailPayload> {
  const api = await startFakeMailApi();
  const captured = createCapturingLogger();
  const mailer = createHttpMailer({
    mail: { url: api.url, apiKey: 'k', from: 'f', operatorEmail: 'operator@example.org' },
    links: LINKS,
    language: 'en',
    templates: createDeclarationTemplateSource({ contentDir: input.contentDir, logger: captured.logger }),
    logger: captured.logger,
  });
  await mailer.sendDeclarationReceipt({
    ...sampleReceipt(),
    receiptId: 'a-receipt-id',
    to: 'anna@example.org',
    language: input.language,
  });
  // SAFETY: as above, our own adapter posted this body.
  return JSON.parse(api.received[0]?.body ?? '{}') as MailPayload;
}

/**
 * The contract reference line as the receipt writes it in `language`: a label
 * and the not-repeated value, both in that language (M270/11). The label is
 * read off the operator's full line, so it is the app's own word.
 */
function contractLineIn(language: InstanceLanguage): string {
  const suffix = ': K-1234';
  const line = detailLines({ fields: sampleDeclarationFields(), language }).find((one) => one.endsWith(suffix));
  if (line === undefined) throw new Error(`no contract reference line in ${language}`);
  return `${line.slice(0, -suffix.length)}: ${RECEIPT_WITHHELD[language]}`;
}

test('the six contract reference lines are six different labels, so the checks below can tell the languages apart', () => {
  // CONTROL for the two tests that follow: a letter that wrote every label in
  // one language would pass a check against a label all six shared.
  assert.equal(new Set(INSTANCE_LANGUAGES.map(contractLineIn)).size, INSTANCE_LANGUAGES.length);
});

test('a receipt in each of the six languages reads its own file, and fills its labels in that language', async () => {
  const folder = await contentFolderWith(INSTANCE_LANGUAGES);
  try {
    for (const language of INSTANCE_LANGUAGES) {
      const payload = await postedReceipt({ contentDir: folder, language });
      assert.equal(payload.subject, `Fixture subject receipt kuendigung ${language}`, `${language} read another file`);
      assert.ok(payload.text.includes(contractLineIn(language)), `${language} filled its labels in another language`);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a folder with only German and English sends the German receipt to a fr, it, es or tr reader', async () => {
  const folder = await contentFolderWith(['de', 'en']);
  try {
    for (const language of NEWER_LANGUAGES) {
      const payload = await postedReceipt({ contentDir: folder, language });
      assert.equal(payload.subject, 'Fixture subject receipt kuendigung de', `${language} did not fall back to German`);
      // The letter is in one language throughout: the German file's labels.
      assert.ok(payload.text.includes(contractLineIn('de')));
    }
    // CONTROL: the same folder answers an English reader with the English
    // file, so the German above is the fallback and not the only file read.
    const english = await postedReceipt({ contentDir: folder, language: 'en' });
    assert.equal(english.subject, 'Fixture subject receipt kuendigung en');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a folder with only English still sends a letter to every reader, from the English file', async () => {
  const folder = await contentFolderWith(['en']);
  try {
    for (const language of INSTANCE_LANGUAGES) {
      const payload = await postedReceipt({ contentDir: folder, language });
      assert.equal(payload.subject, 'Fixture subject receipt kuendigung en', `${language} sent no English letter`);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('with no content folder, the neutral receipt is in the reader language, for each of the six', async () => {
  const subjects: string[] = [];
  for (const language of INSTANCE_LANGUAGES) {
    const payload = await postedReceipt({ contentDir: null, language });
    assert.ok(payload.text.includes(contractLineIn(language)), `${language} fallback used another language`);
    subjects.push(payload.subject);
  }
  assert.equal(new Set(subjects).size, INSTANCE_LANGUAGES.length, 'two languages share a fallback subject');
});
