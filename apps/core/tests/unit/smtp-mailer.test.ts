/**
 * The SMTP mail transport: a real send over a real socket, and what it
 * refuses to do.
 *
 * ── A REAL SERVER, NOT A STUBBED TRANSPORT ────────────────────────────────
 *
 * The fake below is a few dozen lines of SMTP on `node:net`, listening on
 * 127.0.0.1: greeting, EHLO, AUTH PLAIN, MAIL FROM, RCPT TO, DATA, QUIT. The
 * claims worth testing are about what crosses the wire: which recipient the
 * envelope names, which subject and link the letter carries, and that nothing
 * is sent at all when STARTTLS is required and not offered. A stubbed
 * `sendMail` would only prove that a function was called.
 *
 * ── A FAILED SEND LOOKS LIKE A FAILED HTTP SEND ───────────────────────────
 *
 * The HTTP transport throws `mail API responded <status>` and nothing the
 * provider echoed; the call site decides what that means (`emailed: false`
 * and the link, in the admin answer). The SMTP transport must fail the same
 * way, and a server's refusal text is exactly where a recipient address comes
 * back, so the last test here runs both transports through the same admin
 * route and compares the answers.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { createHttpMailer, createSmtpMailer } from '../../src/mail/mailer.js';
import { DEFAULT_SMTP_TIMEOUT_MS, smtpTransportOptions, type SmtpMailConfig } from '../../src/mail/smtp-transport.js';
import { createDeclarationTemplateSource } from '../../src/mail/declaration-templates.js';
import type { LogFields, Logger } from '../../src/logger.js';
import { startAdminHarness } from './admin-harness.js';

const servers: (Server | HttpServer)[] = [];

after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

// ── The fake SMTP server ───────────────────────────────────────────────────

/** How the fake answers. Every field off is an ordinary, accepting server. */
interface FakeSmtpBehaviour {
  /** Answer `550` to every `RCPT TO`, echoing the address the way real servers do. */
  rejectRecipients?: boolean;
  /** Accept the connection and never greet. */
  isSilent?: boolean;
  /** Advertise `AUTH PLAIN`. */
  offersAuth?: boolean;
}

/** One message the fake accepted: the envelope and the raw DATA. */
interface ReceivedSmtpMessage {
  from: string;
  to: string[];
  data: string;
}

interface FakeSmtpServer {
  port: number;
  /** Every command line a client sent, in order, as sent. */
  commands: string[];
  messages: ReceivedSmtpMessage[];
  /** The decoded `AUTH PLAIN` credentials, `\0user\0password`, or `null`. */
  authPlain: string | null;
}

/** The address inside `MAIL FROM:<...>` or `RCPT TO:<...>`. */
function angleAddress(line: string): string {
  return /<([^>]*)>/u.exec(line)?.[1] ?? '';
}

/** One connection's state machine. Separate from the listener so the listener stays readable. */
function serveSmtp(input: { socket: Socket; behaviour: FakeSmtpBehaviour; server: FakeSmtpServer }): void {
  const { socket, behaviour, server } = input;
  let buffer = '';
  let isReadingData = false;
  let envelope: ReceivedSmtpMessage = { from: '', to: [], data: '' };
  const reply = (line: string): void => {
    socket.write(`${line}\r\n`);
  };
  socket.setEncoding('latin1');
  if (!behaviour.isSilent) reply('220 fake.test ESMTP');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\r\n'); at !== -1; at = buffer.indexOf('\r\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (isReadingData) {
        if (line !== '.') {
          envelope.data += `${line}\r\n`;
          continue;
        }
        isReadingData = false;
        server.messages.push(envelope);
        envelope = { from: '', to: [], data: '' };
        reply('250 2.0.0 queued');
        continue;
      }
      server.commands.push(line);
      const verb = line.split(' ')[0]?.toUpperCase() ?? '';
      if (verb === 'EHLO') {
        if (behaviour.offersAuth) reply('250-AUTH PLAIN');
        reply('250-8BITMIME');
        reply('250 fake.test');
      } else if (verb === 'HELO') {
        reply('250 fake.test');
      } else if (verb === 'AUTH') {
        server.authPlain = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString('utf8');
        reply('235 2.7.0 authenticated');
      } else if (verb === 'MAIL') {
        envelope.from = angleAddress(line);
        reply('250 2.1.0 ok');
      } else if (verb === 'RCPT' && behaviour.rejectRecipients) {
        reply(`550 5.1.1 <${angleAddress(line)}>: Recipient address rejected`);
      } else if (verb === 'RCPT') {
        envelope.to.push(angleAddress(line));
        reply('250 2.1.5 ok');
      } else if (verb === 'DATA') {
        isReadingData = true;
        reply('354 end with <CRLF>.<CRLF>');
      } else if (verb === 'RSET' || verb === 'NOOP') {
        reply('250 2.0.0 ok');
      } else if (verb === 'QUIT') {
        reply('221 2.0.0 bye');
        socket.end();
      } else {
        reply('502 5.5.2 not implemented');
      }
    }
  });
  socket.on('error', () => {
    // A client that hangs up mid-conversation is part of the tests below.
  });
}

async function startFakeSmtp(behaviour: FakeSmtpBehaviour = {}): Promise<FakeSmtpServer> {
  const server: FakeSmtpServer = { port: 0, commands: [], messages: [], authPlain: null };
  const listener = createServer((socket) => serveSmtp({ socket, behaviour, server }));
  servers.push(listener);
  listener.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => listener.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form of
  // an address only for a Unix domain socket, which this never opens.
  server.port = (listener.address() as AddressInfo).port;
  return server;
}

// ── Reading a letter off the wire ──────────────────────────────────────────

/** One header of a raw message, unfolded. */
function header(input: { data: string; name: string }): string {
  const head = input.data.split('\r\n\r\n')[0] ?? '';
  const unfolded = head.replaceAll(/\r\n[ \t]+/gu, ' ');
  const line = unfolded
    .split('\r\n')
    .find((candidate) => candidate.toLowerCase().startsWith(`${input.name.toLowerCase()}:`));
  return line?.slice(input.name.length + 1).trim() ?? '';
}

/** A MIME part's body, decoded from the transfer encoding its headers name. */
function decodePart(part: string): string {
  const [head = '', ...rest] = part.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  const encoding = /content-transfer-encoding:\s*([\w-]+)/iu.exec(head)?.[1]?.toLowerCase() ?? '7bit';
  if (encoding === 'base64') return Buffer.from(body.replaceAll(/\s/gu, ''), 'base64').toString('utf8');
  if (encoding !== 'quoted-printable') return body;
  const bytes = body
    .replaceAll(/=\r\n/gu, '')
    .replaceAll(/=([0-9A-F]{2})/gu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
  return Buffer.from(bytes, 'latin1').toString('utf8');
}

/** The text/plain part of a raw message, decoded, with SMTP dot-stuffing undone. */
function plainText(data: string): string {
  const unstuffed = data.replaceAll(/^\.\./gmu, '.');
  const boundary = /boundary="?([^";\r\n]+)"?/iu.exec(header({ data: unstuffed, name: 'content-type' }))?.[1];
  if (boundary === undefined) return decodePart(unstuffed);
  const part = unstuffed.split(`--${boundary}`).find((candidate) => /content-type:\s*text\/plain/iu.test(candidate));
  return part === undefined ? '' : decodePart(part.replace(/^\r\n/u, ''));
}

// ── The mailer under test ──────────────────────────────────────────────────

interface CapturedLine {
  message: string;
  fields: LogFields | undefined;
}

/** Every line a mailer emitted, so the absence assertions have something real to search. */
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

const FROM = 'openplate <family.openplate@example.org>';

/** A local catcher on the fake's port: no login, plain text allowed, as `config.ts` parses a loopback host. */
function loopbackConfig(input: { port: number; auth?: SmtpMailConfig['auth'] }): SmtpMailConfig {
  return {
    transport: 'smtp',
    host: '127.0.0.1',
    port: input.port,
    tls: 'starttls-if-offered',
    auth: input.auth ?? null,
    from: FROM,
    operatorEmail: 'operator@example.org',
  };
}

function smtpMailerFor(input: { mail: SmtpMailConfig; logger: Logger; timeoutMs?: number }) {
  return createSmtpMailer({
    mail: input.mail,
    links: LINKS,
    language: 'en',
    templates: createDeclarationTemplateSource({ contentDir: null, logger: input.logger }),
    logger: input.logger,
    timeoutMs: input.timeoutMs,
  });
}

const INVITE = {
  email: 'anna@example.org',
  displayName: 'Anna',
  inviteToken: 'si_a-secret-token',
  expiresAt: '2026-10-06T10:00:00.000Z',
};

// ── What it sends ──────────────────────────────────────────────────────────

test('an invitation sent over SMTP reaches the server with the recipient, the subject and the link', async () => {
  const smtp = await startFakeSmtp();
  const captured = createCapturingLogger();

  await smtpMailerFor({ mail: loopbackConfig({ port: smtp.port }), logger: captured.logger }).sendInvite(INVITE);

  assert.equal(smtp.messages.length, 1, 'exactly one letter');
  const message = smtp.messages[0];
  assert.ok(message);
  assert.deepEqual(message.to, ['anna@example.org'], 'the envelope names the invited address and nobody else');
  assert.equal(message.from, 'family.openplate@example.org');
  assert.equal(header({ data: message.data, name: 'subject' }), 'Your openplate invitation');
  assert.equal(header({ data: message.data, name: 'from' }), FROM);
  const text = plainText(message.data);
  assert.ok(
    text.includes('https://openplate.de/join#server=https%3A%2F%2Fsync.openplate.de&invite=si_a-secret-token'),
    text,
  );
  assert.ok(message.data.includes('text/html'), 'the html part travels too');
  // The same log line the HTTP transport writes, and nothing that names the letter.
  const serialized = JSON.stringify(captured.lines);
  assert.ok(serialized.includes('Invitation mailed'));
  for (const secret of ['anna@example.org', 'si_a-secret-token', 'Your openplate invitation']) {
    assert.ok(!serialized.includes(secret), `the log carries "${secret}"`);
  }
});

test('a login reaches the server as SMTP_USER and SMTP_PASSWORD', async () => {
  const smtp = await startFakeSmtp({ offersAuth: true });
  const captured = createCapturingLogger();
  const mail = loopbackConfig({ port: smtp.port, auth: { user: 'family', password: 'abcd efgh ijkl mnop' } });

  await smtpMailerFor({ mail, logger: captured.logger }).sendReset({
    email: 'anna@example.org',
    resetToken: 'sr_x',
    expiresAt: 'x',
  });

  assert.equal(smtp.authPlain, '\u0000family\u0000abcd efgh ijkl mnop');
  assert.equal(smtp.messages.length, 1);
});

// ── What it refuses to do ──────────────────────────────────────────────────

test('with STARTTLS required, a server that does not offer it gets no envelope and no letter', async () => {
  // The fake offers no STARTTLS. Every non-loopback host parses to this mode,
  // so this is what "never sends in plain text" means on the wire.
  const smtp = await startFakeSmtp({ offersAuth: true });
  const captured = createCapturingLogger();
  const mail: SmtpMailConfig = {
    ...loopbackConfig({ port: smtp.port, auth: { user: 'family', password: 'abcd efgh ijkl mnop' } }),
    tls: 'starttls-required',
  };

  await assert.rejects(() => smtpMailerFor({ mail, logger: captured.logger }).sendInvite(INVITE));

  const sent = new Set(smtp.commands.map((line) => line.split(' ')[0]?.toUpperCase()));
  assert.ok(sent.has('EHLO'), 'the client did talk to the server, so the silence below is a refusal');
  for (const verb of ['AUTH', 'MAIL', 'RCPT', 'DATA']) {
    assert.ok(!sent.has(verb), `${verb} went out in plain text: ${JSON.stringify(smtp.commands)}`);
  }
  assert.equal(smtp.authPlain, null, 'the password never crossed an unencrypted socket');
  assert.equal(smtp.messages.length, 0);
});

test('a server that refuses the recipient fails the send with its reply code and nothing it echoed', async () => {
  const smtp = await startFakeSmtp({ rejectRecipients: true });
  const captured = createCapturingLogger();

  await assert.rejects(
    () => smtpMailerFor({ mail: loopbackConfig({ port: smtp.port }), logger: captured.logger }).sendInvite(INVITE),
    (error: Error) => {
      // The reply code, as the HTTP transport reports its status.
      assert.equal(error.message, 'SMTP server responded 550');
      assert.ok(!error.message.includes('anna@example.org'), 'the server echoed the address; the error must not');
      return true;
    },
  );
  assert.equal(smtp.messages.length, 0);
  // Like the HTTP transport, a failed send logs nothing of its own: the call site does.
  assert.ok(!JSON.stringify(captured.lines).includes('Invitation mailed'));
});

test('a server that never greets fails the send within the timeout, instead of hanging', async () => {
  const smtp = await startFakeSmtp({ isSilent: true });
  const captured = createCapturingLogger();
  const startedAt = Date.now();

  await assert.rejects(
    () =>
      smtpMailerFor({ mail: loopbackConfig({ port: smtp.port }), logger: captured.logger, timeoutMs: 200 }).sendInvite(
        INVITE,
      ),
    (error: Error) => {
      assert.match(error.message, /^SMTP send failed: E[A-Z]+$/u, error.message);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 5_000, 'bounded by the timeout, not by the operating system');
});

test('the transport options: 465 is implicit TLS, STARTTLS is required elsewhere, certificates are always checked', () => {
  const base = loopbackConfig({ port: 587 });
  const implicit = smtpTransportOptions({ mail: { ...base, port: 465, tls: 'implicit-tls' }, timeoutMs: 10_000 });
  assert.equal(implicit.secure, true);
  assert.notEqual(implicit.requireTLS, true, 'TLS from the first byte, no upgrade to require');

  const required = smtpTransportOptions({ mail: { ...base, tls: 'starttls-required' }, timeoutMs: 10_000 });
  assert.equal(required.secure, false);
  assert.equal(required.requireTLS, true);
  assert.notEqual(required.ignoreTLS, true);

  const loopback = smtpTransportOptions({ mail: base, timeoutMs: 10_000 });
  assert.equal(loopback.secure, false);
  assert.notEqual(loopback.requireTLS, true);
  assert.notEqual(loopback.ignoreTLS, true, 'a catcher that offers STARTTLS still gets it');

  for (const options of [implicit, required, loopback]) {
    assert.notEqual(options.tls?.rejectUnauthorized, false, 'a certificate is always checked');
    assert.equal(options.connectionTimeout, 10_000);
    assert.equal(options.greetingTimeout, 10_000);
    assert.equal(options.socketTimeout, 10_000);
  }
  assert.equal(DEFAULT_SMTP_TIMEOUT_MS, 10_000);
  // A login is handed on as nodemailer names it, and absent means none.
  assert.equal(loopback.auth, undefined);
  const login = smtpTransportOptions({
    mail: { ...base, auth: { user: 'u', password: 'p' } },
    timeoutMs: 10_000,
  });
  assert.deepEqual(login.auth, { user: 'u', pass: 'p' });
});

// ── The same answer as a failed HTTP send ──────────────────────────────────

const ADMIN_TOKEN = 'smtp-admin-token-0123456789abcdef';

/** A mail API that refuses every letter, echoing it back, as both real providers do. */
async function startRefusingMailApi(): Promise<string> {
  const server = createHttpServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'rejected', echo: { to: ['anna@example.org'] } }));
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: as above, an ephemeral TCP port and never a Unix domain socket.
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/emails`;
}

/** What the admin answer and the log say about one invitation whose letter was refused. */
interface RefusedMintReading {
  status: number;
  emailed: boolean;
  hasLink: boolean;
  hasToken: boolean;
  warning: CapturedLine | undefined;
}

/** A mint answer, read loosely: the fields this comparison needs. */
interface MintAnswer {
  emailed?: boolean;
  link?: string | null;
  token?: string;
}

async function mintWithRefusedLetter(mailer: ReturnType<typeof createSmtpMailer>): Promise<RefusedMintReading> {
  const harness = await startAdminHarness({ adminToken: ADMIN_TOKEN, links: LINKS, mailer });
  try {
    const response = await harness.request({
      method: 'POST',
      path: '/v1/admin/invites',
      token: ADMIN_TOKEN,
      body: { email: 'anna@example.org' },
    });
    // SAFETY: the admin mint answers this JSON shape (PROTOCOL.md); every field
    // is optional here, so a missing one reads as a difference below.
    const answer = (await response.json()) as MintAnswer;
    return {
      status: response.status,
      emailed: answer.emailed === true,
      hasLink: (answer.link ?? null) !== null,
      hasToken: answer.token !== undefined,
      warning: harness.logLines.find((line) => line.message === 'Mail send failed'),
    };
  } finally {
    await harness.close();
  }
}

test('a refused SMTP send and a refused HTTP send give the administrator the same answer', async () => {
  const smtp = await startFakeSmtp({ rejectRecipients: true });
  const quiet = createCapturingLogger().logger;
  const templates = createDeclarationTemplateSource({ contentDir: null, logger: quiet });
  const httpMailer = createHttpMailer({
    mail: { url: await startRefusingMailApi(), apiKey: 'k', from: FROM, operatorEmail: 'operator@example.org' },
    links: LINKS,
    language: 'en',
    templates,
    logger: quiet,
  });
  const smtpMailer = smtpMailerFor({ mail: loopbackConfig({ port: smtp.port }), logger: quiet });

  const overHttp = await mintWithRefusedLetter(httpMailer);
  const overSmtp = await mintWithRefusedLetter(smtpMailer);

  // THE CONTROL: the HTTP side is the behaviour this repo already promises.
  assert.equal(overHttp.status, 201);
  assert.equal(overHttp.emailed, false);
  assert.equal(overHttp.hasLink, true, 'the operator gets the link to pass on instead');
  // ...and SMTP matches it field for field.
  assert.deepEqual(
    { status: overSmtp.status, emailed: overSmtp.emailed, hasLink: overSmtp.hasLink, hasToken: overSmtp.hasToken },
    { status: overHttp.status, emailed: overHttp.emailed, hasLink: overHttp.hasLink, hasToken: overHttp.hasToken },
  );
  assert.equal(overSmtp.warning?.fields?.what, overHttp.warning?.fields?.what);
  assert.equal(overSmtp.warning?.fields?.error, 'SMTP server responded 550');
  assert.equal(overHttp.warning?.fields?.error, 'mail API responded 500');
  assert.ok(!JSON.stringify(overSmtp.warning).includes('anna@example.org'));
});
