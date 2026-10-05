/**
 * Config parsing — every assertion here is a boot that MUST fail rather than
 * a service that starts half-configured and takes real accounts.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_SYNC_NOTICE_LENGTH,
  MIN_ADMIN_TOKEN_LENGTH,
  MIN_SERVER_SECRET_LENGTH,
  parseConfig,
} from '../../src/config.js';
import { BUNDLED_MODEL_TIERS, parseModelTiers } from '../../src/ai/model-tiers.js';
import type { JsonObject } from '../../src/lib/json.js';
import { INSTANCE_LANGUAGES, NUTRIENT_REFERENCE_BASES } from '../../src/protocol.js';

const SECRET = 'x'.repeat(MIN_SERVER_SECRET_LENGTH);

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    SERVER_SECRET: SECRET,
    ...overrides,
  };
}

test('a minimal valid environment parses with sane defaults', () => {
  const config = parseConfig(baseEnv());
  assert.equal(config.port, 3000);
  assert.equal(config.trustProxy, false);
  assert.equal(config.logLevel, 'info');
  assert.equal(config.instanceName, 'openplate');
  assert.equal(config.instanceLanguage, 'en');
  // No link bases and no mail: a self-hosted instance that configured neither
  // still boots, and its invites come back as raw tokens.
  assert.equal(config.serverPublicUrl, null);
  assert.equal(config.clientBaseUrl, null);
  assert.equal(config.mail, null);
  // Both dark features are OFF unless an operator opts in. This is the
  // default every deployment runs on, and it is what makes shipping the
  // routes before anyone opts in safe (ADR-0002 / ADR-0003).
  assert.equal(config.sharingEnabled, false);
  assert.equal(config.researchEnabled, false);
  // And the one whose absence protects a photograph rather than a ciphertext.
  assert.equal(config.feedbackEnabled, false);
  // And no biller: the whole /v1/plans subtree is the ordinary unknown-path
  // 404 until an operator sets both plans variables (M213).
  assert.equal(config.plans, null);
  assert.equal(config.feedbackDailyLimit, 5);
  assert.equal(config.feedbackMaxRequestBytes, 8_000_000);
  // NO INSTANCE-WIDE AI CEILING unless an operator asks for one. A default
  // here would be a bound arriving on a running instance during an ordinary
  // upgrade, and the first anybody would hear of it is users being refused.
  assert.equal(config.aiInstanceDailyLimit, null);
});

test('a missing DATABASE_URL or SERVER_SECRET is fatal', () => {
  for (const key of ['DATABASE_URL', 'SERVER_SECRET']) {
    const env = baseEnv();
    delete env[key];
    assert.throws(() => parseConfig(env), new RegExp(key));
  }
});

test('a short SERVER_SECRET is fatal', () => {
  // The pepper derived from this is the only thing standing between a stolen
  // table and offline verification of guessed auth-hashes.
  assert.throws(() => parseConfig(baseEnv({ SERVER_SECRET: 'too-short' })), /SERVER_SECRET/);
});

test('SIGNUP_MODE is fatal, and the message says signup is invite-only', () => {
  // The direction matters more than the rejection. An instance booting with a
  // stale `SIGNUP_MODE=closed` would be an operator believing they had shut a
  // door that is not implemented at all; one with `open` would be an operator
  // believing public registration is on. Both spellings throw, and the message
  // names the replacement so the fix is one line.
  for (const value of ['open', 'invite', 'closed', 'inviteonly']) {
    assert.throws(() => parseConfig(baseEnv({ SIGNUP_MODE: value })), /invite-only/, `SIGNUP_MODE=${value}`);
  }
  assert.throws(() => parseConfig(baseEnv({ SIGNUPS_OPEN: 'false' })), /invite-only/);
  assert.throws(() => parseConfig(baseEnv({ SIGNUPS_OPEN: 'true' })), /invite-only/);
});

test('INSTANCE_NAME and INSTANCE_LANGUAGE are read, and a bad language is fatal', () => {
  const config = parseConfig(baseEnv({ INSTANCE_NAME: 'Praxis Nord', INSTANCE_LANGUAGE: 'de' }));
  assert.equal(config.instanceName, 'Praxis Nord');
  assert.equal(config.instanceLanguage, 'de');
  // Only the languages the mails exist in. Another would silently fall back
  // to English on the day somebody needs it. Every one the protocol names is
  // accepted, so a language that has letters is never a boot failure.
  for (const language of INSTANCE_LANGUAGES) {
    assert.equal(parseConfig(baseEnv({ INSTANCE_LANGUAGE: language })).instanceLanguage, language);
  }
  assert.throws(() => parseConfig(baseEnv({ INSTANCE_LANGUAGE: 'xx' })), /INSTANCE_LANGUAGE/);
});

test('NUTRIENT_REFERENCE_BASIS defaults to dge, accepts the three, and a typo is fatal', () => {
  // The default is the one this milestone decided on, and it is what every
  // instance that says nothing runs on.
  assert.equal(parseConfig(baseEnv()).nutrientReferenceBasis, 'dge');
  for (const basis of NUTRIENT_REFERENCE_BASES) {
    assert.equal(parseConfig(baseEnv({ NUTRIENT_REFERENCE_BASIS: basis })).nutrientReferenceBasis, basis);
  }
  // `dach` is the plausible wrong one: a typo here would otherwise show a
  // person a different country's nutrition targets without saying so.
  assert.throws(() => parseConfig(baseEnv({ NUTRIENT_REFERENCE_BASIS: 'dach' })), /NUTRIENT_REFERENCE_BASIS/);
});

test('HEALTH_CONSENT_VERSION is unset by default, takes 1 to 32 safe characters, and anything else is fatal', () => {
  // Unset and blank both mean "ask for no consent", the self-hosted default.
  assert.equal(parseConfig(baseEnv()).healthConsentVersion, null);
  assert.equal(parseConfig(baseEnv({ HEALTH_CONSENT_VERSION: '   ' })).healthConsentVersion, null);
  // The intended shape, the edges of the length, and every allowed character.
  assert.equal(parseConfig(baseEnv({ HEALTH_CONSENT_VERSION: '2026-09-28' })).healthConsentVersion, '2026-09-28');
  assert.equal(parseConfig(baseEnv({ HEALTH_CONSENT_VERSION: ' v2 ' })).healthConsentVersion, 'v2');
  assert.equal(parseConfig(baseEnv({ HEALTH_CONSENT_VERSION: 'a' })).healthConsentVersion, 'a');
  assert.equal(parseConfig(baseEnv({ HEALTH_CONSENT_VERSION: 'x'.repeat(32) })).healthConsentVersion, 'x'.repeat(32));
  assert.equal(parseConfig(baseEnv({ HEALTH_CONSENT_VERSION: 'A.b_C-9' })).healthConsentVersion, 'A.b_C-9');
  // A value a client could never echo back byte for byte is a boot failure,
  // never a live instance where every signup answers health-consent-required.
  for (const bad of ['x'.repeat(33), '2026 09 28', '"2026-09-28"', 'v1/2', 'versión']) {
    assert.throws(
      () => parseConfig(baseEnv({ HEALTH_CONSENT_VERSION: bad })),
      /HEALTH_CONSENT_VERSION/,
      `"${bad}" must be refused`,
    );
  }
});

test('CLIENT_BASE_URL and SERVER_PUBLIC_URL are absolute http(s) URLs, or fatal', () => {
  // They end up in a letter somebody clicks. A relative or misspelled value
  // must be discovered by the operator at boot, not by the invited person.
  const config = parseConfig(
    baseEnv({ CLIENT_BASE_URL: 'https://openplate.de/', SERVER_PUBLIC_URL: 'https://sync.openplate.de' }),
  );
  // The trailing slash is stripped once, here, so no caller has to decide.
  assert.equal(config.clientBaseUrl, 'https://openplate.de');
  assert.equal(config.serverPublicUrl, 'https://sync.openplate.de');

  assert.throws(() => parseConfig(baseEnv({ CLIENT_BASE_URL: '/join' })), /CLIENT_BASE_URL/);
  assert.throws(() => parseConfig(baseEnv({ SERVER_PUBLIC_URL: 'javascript:alert(1)' })), /SERVER_PUBLIC_URL/);
});

test('TRUST_PROXY accepts a hop count as well as a boolean', () => {
  assert.equal(parseConfig(baseEnv({ TRUST_PROXY: '1' })).trustProxy, 1);
  assert.equal(parseConfig(baseEnv({ TRUST_PROXY: 'true' })).trustProxy, true);
  assert.throws(() => parseConfig(baseEnv({ TRUST_PROXY: 'maybe' })), /TRUST_PROXY/);
});

test('HOST is unset by default, and unset means every interface', () => {
  // THE PRODUCTION DEFAULT, FROZEN. This service runs in a container behind
  // Traefik and the only route in is the container network address, so a
  // future "hardening" that made this loopback would take production down.
  assert.equal(parseConfig(baseEnv()).host, null);
});

test('an empty or whitespace-only HOST is null, never a bind to the empty string', () => {
  // A commented-out `HOST=` left in an env file, or one with a stray space
  // after it, must mean exactly what an absent one means. The empty string is
  // not an address, and passing it on would be an operator who thinks they
  // switched something off getting something else.
  assert.equal(parseConfig(baseEnv({ HOST: '' })).host, null);
  assert.equal(parseConfig(baseEnv({ HOST: '   ' })).host, null);
  assert.equal(parseConfig(baseEnv({ HOST: '\t\n' })).host, null);
});

test('HOST is carried through trimmed, for IPv4, IPv6 and a tailnet address', () => {
  // The three shapes a developer actually types. None of them is validated
  // here on purpose: Node refuses an address it cannot bind, at listen time,
  // and a pattern in this file would reject working values.
  assert.equal(parseConfig(baseEnv({ HOST: '127.0.0.1' })).host, '127.0.0.1');
  assert.equal(parseConfig(baseEnv({ HOST: '::1' })).host, '::1');
  assert.equal(parseConfig(baseEnv({ HOST: '100.64.0.3' })).host, '100.64.0.3');
  // Surrounding whitespace is stripped, so a value pasted with a trailing
  // space still binds rather than failing with EADDRNOTAVAIL on " 127.0.0.1".
  assert.equal(parseConfig(baseEnv({ HOST: '  127.0.0.1  ' })).host, '127.0.0.1');
});

test('an invalid PORT or LOG_LEVEL is fatal', () => {
  assert.throws(() => parseConfig(baseEnv({ PORT: '0' })), /PORT/);
  assert.throws(() => parseConfig(baseEnv({ PORT: 'http' })), /PORT/);
  assert.throws(() => parseConfig(baseEnv({ LOG_LEVEL: 'chatty' })), /LOG_LEVEL/);
});

test('the mail block is all-or-nothing, and a gap names the missing variable', () => {
  const complete = {
    MAIL_API_URL: 'http://pigeon:3601/v1/emails',
    MAIL_API_KEY: 'a-pigeon-tenant-key',
    MAIL_API_FROM: 'openplate <openplate@mail.openplate.de>',
    MAIL_OPERATOR_EMAIL: 'operator@example.org',
    SERVER_PUBLIC_URL: 'https://sync.openplate.de',
    CLIENT_BASE_URL: 'https://openplate.de',
  };
  assert.deepEqual(parseConfig(baseEnv(complete)).mail, {
    url: 'http://pigeon:3601/v1/emails',
    apiKey: 'a-pigeon-tenant-key',
    from: 'openplate <openplate@mail.openplate.de>',
    operatorEmail: 'operator@example.org',
  });

  // A HALF-CONFIGURED BLOCK IS A BOOT FAILURE, and the message NAMES the
  // missing variable. The alternative is an operator who believes invitations
  // are being delivered while every one of them silently comes back as a link
  // nobody looks at.
  for (const missing of ['MAIL_API_URL', 'MAIL_API_KEY', 'MAIL_API_FROM', 'MAIL_OPERATOR_EMAIL'] as const) {
    const env = baseEnv(complete);
    delete env[missing];
    assert.throws(() => parseConfig(env), new RegExp(missing), `${missing} missing must be fatal`);
  }

  // ...and it names the VARIABLE, never a value: a key or a URL in a startup
  // log is a credential in a log.
  const withoutKey = baseEnv(complete);
  delete withoutKey.MAIL_API_KEY;
  assert.throws(
    () => parseConfig(withoutKey),
    (error: Error) => {
      assert.ok(!error.message.includes('a-pigeon-tenant-key'), 'the message must not quote a configured value');
      return true;
    },
  );
});

test('configured mail without the two link bases is a boot failure', () => {
  // Both account letters exist to carry a link, so mail with nowhere to point
  // is a letter with nothing in it to click.
  const mailOnly = {
    MAIL_API_URL: 'http://pigeon:3601/v1/emails',
    MAIL_API_KEY: 'k',
    MAIL_API_FROM: 'f',
    MAIL_OPERATOR_EMAIL: 'operator@example.org',
  };
  assert.throws(() => parseConfig(baseEnv(mailOnly)), /SERVER_PUBLIC_URL/);
  assert.throws(
    () => parseConfig(baseEnv({ ...mailOnly, SERVER_PUBLIC_URL: 'https://sync.openplate.de' })),
    /CLIENT_BASE_URL/,
  );
  // Without mail, neither is required: a self-hoster who configured no mail
  // still boots and hands out links themselves.
  assert.equal(parseConfig(baseEnv()).mail, null);
});

// ---------------------------------------------------------------------------
// Mailed links must open on the reader's device
// ---------------------------------------------------------------------------
//
// The compose files default both link bases to localhost when PUBLIC_APP_URL
// and PUBLIC_SYNC_URL are unset. An operator who turned mail on and forgot them
// got a server that booted and mailed a family member
// `http://localhost:3000/join#server=http%3A%2F%2Flocalhost%3A3001&invite=...`,
// a link that opens nothing on any other device. In production that is now a
// boot failure; in development and in the test suites it is not.

/** A complete mail block. The link bases are supplied per case. */
const MAIL_BLOCK = {
  MAIL_API_URL: 'http://pigeon:3601/v1/emails',
  MAIL_API_KEY: 'a-pigeon-tenant-key',
  MAIL_API_FROM: 'openplate <openplate@mail.example.org>',
  MAIL_OPERATOR_EMAIL: 'operator@example.org',
};

/** Two link bases that a family member's phone opens. */
const PUBLIC_LINKS = {
  CLIENT_BASE_URL: 'https://openplate.example.org',
  SERVER_PUBLIC_URL: 'https://sync.example.org',
};

/** What the compose files hand the core when PUBLIC_APP_URL and PUBLIC_SYNC_URL are unset. */
const COMPOSE_DEFAULT_LINKS = {
  CLIENT_BASE_URL: 'http://localhost:3000',
  SERVER_PUBLIC_URL: 'http://localhost:3001',
};

/** The message a refused boot carries, or a failure naming the env that booted. */
function refusal(env: NodeJS.ProcessEnv): string {
  try {
    parseConfig(env);
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  assert.fail(`this environment booted and must not have: ${JSON.stringify(env)}`);
}

test('in production, mail with a localhost CLIENT_BASE_URL refuses to boot and names the value and the fix', () => {
  const message = refusal(
    baseEnv({
      NODE_ENV: 'production',
      ...MAIL_BLOCK,
      ...PUBLIC_LINKS,
      CLIENT_BASE_URL: 'http://localhost:3000',
    }),
  );
  assert.match(message, /CLIENT_BASE_URL/);
  assert.ok(message.includes('"http://localhost:3000"'), message);
  assert.match(message, /PUBLIC_APP_URL/, 'the compose files set it under this name');
  assert.match(message, /https:\/\//, 'the message says what to set');
  // The one that is fine is not blamed.
  assert.doesNotMatch(message, /SERVER_PUBLIC_URL/);
});

test('in production, mail with a loopback SERVER_PUBLIC_URL refuses to boot and names the value and the fix', () => {
  const message = refusal(
    baseEnv({
      NODE_ENV: 'production',
      ...MAIL_BLOCK,
      ...PUBLIC_LINKS,
      SERVER_PUBLIC_URL: 'https://127.0.0.1:3001',
    }),
  );
  assert.match(message, /SERVER_PUBLIC_URL/);
  assert.ok(message.includes('"https://127.0.0.1:3001"'), message);
  assert.match(message, /PUBLIC_SYNC_URL/, 'the compose files set it under this name');
  assert.doesNotMatch(message, /CLIENT_BASE_URL/);
});

test('in production, mail with a plain http link base refuses to boot, even on a public host', () => {
  // Opening a plain http address on another device gives a page with no Web
  // Crypto, and an https page cannot call a plain http service. So the scheme
  // is refused on its own, not only the host.
  const appMessage = refusal(
    baseEnv({
      NODE_ENV: 'production',
      ...MAIL_BLOCK,
      ...PUBLIC_LINKS,
      CLIENT_BASE_URL: 'http://openplate.example.org',
    }),
  );
  assert.match(appMessage, /CLIENT_BASE_URL/);
  assert.ok(appMessage.includes('"http://openplate.example.org"'), appMessage);
  assert.match(appMessage, /https:\/\//);

  const syncMessage = refusal(
    baseEnv({ NODE_ENV: 'production', ...MAIL_BLOCK, ...PUBLIC_LINKS, SERVER_PUBLIC_URL: 'http://100.64.0.3:3001' }),
  );
  assert.match(syncMessage, /SERVER_PUBLIC_URL/);
  assert.ok(syncMessage.includes('"http://100.64.0.3:3001"'), syncMessage);
});

test('in production, every spelling of a loopback host is refused, https or not', () => {
  const loopbacks = [
    'https://localhost',
    'https://LOCALHOST:8443',
    'https://localhost.',
    'https://openplate.localhost',
    'https://127.0.0.1',
    'https://127.1.2.3:3000',
    // The WHATWG parser writes these forms out as 127.0.0.1 before the check.
    'https://127.1',
    'https://2130706433',
    'https://[::1]:3000',
    'https://[0:0:0:0:0:0:0:1]',
    'https://[::ffff:127.0.0.1]',
  ];
  for (const value of loopbacks) {
    const message = refusal(
      baseEnv({ NODE_ENV: 'production', ...MAIL_BLOCK, ...PUBLIC_LINKS, CLIENT_BASE_URL: value }),
    );
    assert.match(message, /CLIENT_BASE_URL/, value);
    assert.ok(message.includes(`"${value}"`), `${value} must be quoted as written: ${message}`);
  }
});

test('in production, the compose defaults refuse to boot with mail, and one message names both variables', () => {
  // The exact state of an install that followed the compose file and forgot
  // PUBLIC_APP_URL and PUBLIC_SYNC_URL. Both are wrong, and an operator who
  // fixes one at a time would restart twice.
  const message = refusal(baseEnv({ NODE_ENV: 'production', ...MAIL_BLOCK, ...COMPOSE_DEFAULT_LINKS }));
  assert.ok(message.includes('CLIENT_BASE_URL is "http://localhost:3000"'), message);
  assert.ok(message.includes('SERVER_PUBLIC_URL is "http://localhost:3001"'), message);
  assert.match(message, /PUBLIC_APP_URL/);
  assert.match(message, /PUBLIC_SYNC_URL/);
  // The mail block is a credential; its values stay out of the log.
  assert.ok(!message.includes('a-pigeon-tenant-key'), 'the message must not quote the mail key');
});

test('CONTROL: in production, mail with two public https link bases boots', () => {
  const config = parseConfig(baseEnv({ NODE_ENV: 'production', ...MAIL_BLOCK, ...PUBLIC_LINKS }));
  assert.notEqual(config.mail, null);
  assert.equal(config.clientBaseUrl, 'https://openplate.example.org');
  assert.equal(config.serverPublicUrl, 'https://sync.example.org');
  // A tailnet name with its own certificate is a public https host for this rule.
  assert.notEqual(
    parseConfig(
      baseEnv({
        NODE_ENV: 'production',
        ...MAIL_BLOCK,
        CLIENT_BASE_URL: 'https://bluefin.tail1234.ts.net',
        SERVER_PUBLIC_URL: 'https://bluefin.tail1234.ts.net:8443',
      }),
    ).mail,
    null,
  );
});

test('CONTROL: a host that only contains the word localhost is not a loopback host', () => {
  for (const value of ['https://localhost.example.org', 'https://notlocalhost.example', 'https://127.example.org']) {
    const config = parseConfig(
      baseEnv({ NODE_ENV: 'production', ...MAIL_BLOCK, ...PUBLIC_LINKS, CLIENT_BASE_URL: value }),
    );
    assert.equal(config.clientBaseUrl, value, value);
  }
});

test('CONTROL: in production WITHOUT mail, localhost link bases still boot', () => {
  // The admin copies the link by hand then, and the admin screen warns about
  // an address the family cannot open. Refusing here would stop a trial install.
  const config = parseConfig(baseEnv({ NODE_ENV: 'production', ...COMPOSE_DEFAULT_LINKS }));
  assert.equal(config.mail, null);
  assert.equal(config.clientBaseUrl, 'http://localhost:3000');
});

test('CONTROL: outside production, mail with localhost link bases still boots', () => {
  // The dev setup and the integration suites mail localhost links on purpose.
  for (const nodeEnv of ['test', 'development', undefined]) {
    const env = baseEnv({ ...MAIL_BLOCK, ...COMPOSE_DEFAULT_LINKS });
    if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
    const config = parseConfig(env);
    assert.notEqual(config.mail, null, `NODE_ENV=${nodeEnv ?? '(unset)'}`);
    assert.equal(config.clientBaseUrl, 'http://localhost:3000');
  }
});

// ---------------------------------------------------------------------------
// SMTP, the second mail transport
// ---------------------------------------------------------------------------
//
// A family server rarely has an HTTP mail API, and nearly always has an SMTP
// login: a Gmail app password, Amazon SES SMTP, the provider behind its
// domain. The owner decided on 2026-09-29 to add SMTP back beside the HTTP API.
// Exactly one transport at a time, and TLS is decided by the port, never by a
// switch an operator could leave on "off".

/** A Gmail app password setup, the example the README gives. */
const SMTP_BLOCK = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_USER: 'family.openplate@gmail.com',
  SMTP_PASSWORD: 'abcd efgh ijkl mnop',
  SMTP_FROM: 'openplate <family.openplate@gmail.com>',
  MAIL_OPERATOR_EMAIL: 'operator@example.org',
  ...PUBLIC_LINKS,
};

/** The HTTP transport's three names, for the case that sets both transports. */
const HTTP_TRANSPORT = {
  MAIL_API_URL: 'http://pigeon:3601/v1/emails',
  MAIL_API_KEY: 'a-pigeon-tenant-key',
  MAIL_API_FROM: 'openplate <openplate@mail.example.org>',
};

test('an SMTP block is a mail transport, and port 587 must upgrade with STARTTLS', () => {
  const config = parseConfig(baseEnv(SMTP_BLOCK));
  assert.deepEqual(config.mail, {
    transport: 'smtp',
    host: 'smtp.gmail.com',
    port: 587,
    tls: 'starttls-required',
    auth: { user: 'family.openplate@gmail.com', password: 'abcd efgh ijkl mnop' },
    from: 'openplate <family.openplate@gmail.com>',
    operatorEmail: 'operator@example.org',
  });
});

test('SMTP_PORT defaults to 587, unset or empty', () => {
  const unset = baseEnv(SMTP_BLOCK);
  delete unset.SMTP_PORT;
  const empty = baseEnv({ ...SMTP_BLOCK, SMTP_PORT: '' });
  for (const env of [unset, empty]) {
    const mail = parseConfig(env).mail;
    assert.ok(mail !== null && mail.transport === 'smtp');
    assert.equal(mail.port, 587);
    assert.equal(mail.tls, 'starttls-required');
  }
});

test('port 465 is implicit TLS', () => {
  const mail = parseConfig(baseEnv({ ...SMTP_BLOCK, SMTP_PORT: '465' })).mail;
  assert.ok(mail !== null && mail.transport === 'smtp');
  assert.equal(mail.tls, 'implicit-tls');
});

test('on a host that is not this machine, every other port must upgrade with STARTTLS: no plain text', () => {
  for (const [host, port] of [
    ['smtp.example.org', '25'],
    ['smtp.example.org', '2525'],
    ['email-smtp.eu-central-1.amazonaws.com', '587'],
    ['192.0.2.10', '25'],
    // Contains the word, is not the name.
    ['localhost.example.org', '25'],
  ]) {
    const mail = parseConfig(baseEnv({ ...SMTP_BLOCK, SMTP_HOST: host, SMTP_PORT: port })).mail;
    assert.ok(mail !== null && mail.transport === 'smtp');
    assert.equal(mail.tls, 'starttls-required', `${host}:${port}`);
  }
});

test('a loopback host may send in plain text and needs no login, for a local catcher such as Mailpit', () => {
  for (const host of ['localhost', '127.0.0.1', '127.0.0.53', '::1', '[::1]', 'mailpit.localhost']) {
    const env = baseEnv({ ...SMTP_BLOCK, SMTP_HOST: host, SMTP_PORT: '1025' });
    delete env.SMTP_USER;
    delete env.SMTP_PASSWORD;
    const mail = parseConfig(env).mail;
    assert.ok(mail !== null && mail.transport === 'smtp', host);
    assert.equal(mail.tls, 'starttls-if-offered', host);
    assert.equal(mail.auth, null, host);
  }
  // 465 on loopback is still implicit TLS: the port decides first.
  const tls = parseConfig(baseEnv({ ...SMTP_BLOCK, SMTP_HOST: 'localhost', SMTP_PORT: '465' })).mail;
  assert.ok(tls !== null && tls.transport === 'smtp');
  assert.equal(tls.tls, 'implicit-tls');
});

test('a partial SMTP block refuses to boot, names what is missing, and never quotes the password', () => {
  const cases: { env: NodeJS.ProcessEnv; missing: RegExp }[] = [
    { env: { SMTP_HOST: 'smtp.gmail.com', MAIL_OPERATOR_EMAIL: 'operator@example.org' }, missing: /SMTP_FROM/ },
    { env: { SMTP_FROM: 'f', MAIL_OPERATOR_EMAIL: 'operator@example.org' }, missing: /SMTP_HOST/ },
    { env: { SMTP_HOST: 'smtp.gmail.com', SMTP_FROM: 'f' }, missing: /MAIL_OPERATOR_EMAIL/ },
    { env: { SMTP_PORT: '587' }, missing: /SMTP_HOST/ },
    {
      env: { SMTP_HOST: 'smtp.gmail.com', SMTP_FROM: 'f', MAIL_OPERATOR_EMAIL: 'o@example.org', SMTP_USER: 'u' },
      missing: /SMTP_PASSWORD/,
    },
    {
      env: {
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_FROM: 'f',
        MAIL_OPERATOR_EMAIL: 'o@example.org',
        SMTP_PASSWORD: 'abcd efgh ijkl mnop',
      },
      missing: /SMTP_USER/,
    },
  ];
  for (const { env, missing } of cases) {
    const message = refusal(baseEnv({ ...PUBLIC_LINKS, ...env }));
    assert.match(message, missing, JSON.stringify(Object.keys(env)));
    assert.ok(!message.includes('abcd efgh ijkl mnop'), 'a password in a startup log is a password in a log');
  }
});

test('both transports at once refuse to boot, and the message names both', () => {
  // CONTROL first: each transport alone boots, so the refusal below is about
  // the pair and not about either one.
  assert.equal(parseConfig(baseEnv(SMTP_BLOCK)).mail?.transport, 'smtp');
  const httpOnly = parseConfig(
    baseEnv({ ...HTTP_TRANSPORT, MAIL_OPERATOR_EMAIL: 'operator@example.org', ...PUBLIC_LINKS }),
  ).mail;
  assert.ok(httpOnly !== null && httpOnly.transport !== 'smtp');

  const message = refusal(baseEnv({ ...SMTP_BLOCK, ...HTTP_TRANSPORT }));
  assert.match(message, /MAIL_API_URL/);
  assert.match(message, /SMTP_HOST/);
  assert.ok(!message.includes('abcd efgh ijkl mnop'));
  assert.ok(!message.includes('a-pigeon-tenant-key'));
  // One variable of each is enough to be two transports.
  assert.match(refusal(baseEnv({ ...SMTP_BLOCK, MAIL_API_KEY: 'k' })), /MAIL_API_KEY/);
});

test('an SMTP_PORT that is not a port refuses to boot', () => {
  for (const port of ['0', '65536', 'smtp', '58 7', '-25']) {
    assert.match(refusal(baseEnv({ ...SMTP_BLOCK, SMTP_PORT: port })), /SMTP_PORT/, port);
  }
});

test('an SMTP_HOST that is not a bare host name or address refuses to boot', () => {
  // CONTROL: the same block with a bare host boots.
  assert.equal(parseConfig(baseEnv(SMTP_BLOCK)).mail?.transport, 'smtp');
  for (const host of ['smtp.gmail.com:587', 'smtps://smtp.gmail.com', 'user@smtp.gmail.com', 'smtp.gmail.com/x']) {
    assert.match(refusal(baseEnv({ ...SMTP_BLOCK, SMTP_HOST: host })), /SMTP_HOST/, host);
  }
});

test('every rule that needs mail accepts SMTP: open sign-up, the link bases, and the production link guard', () => {
  assert.equal(parseConfig(baseEnv({ ...SMTP_BLOCK, OPEN_SIGNUP: 'true' })).openSignup, true);
  const withoutLinks = baseEnv(SMTP_BLOCK);
  delete withoutLinks.SERVER_PUBLIC_URL;
  assert.match(refusal(withoutLinks), /SERVER_PUBLIC_URL/);
  const message = refusal(baseEnv({ ...SMTP_BLOCK, NODE_ENV: 'production', CLIENT_BASE_URL: 'http://localhost:3000' }));
  assert.ok(message.includes('CLIENT_BASE_URL is "http://localhost:3000"'), message);
  // And the open sign-up refusal names both transports, so an operator with
  // SMTP learns it counts.
  assert.match(refusal(baseEnv({ OPEN_SIGNUP: 'true' })), /SMTP_HOST/);
});

test('empty SMTP variables, as the compose files pass them, mean no SMTP', () => {
  const config = parseConfig(
    baseEnv({ SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: '', MAIL_OPERATOR_EMAIL: '' }),
  );
  assert.equal(config.mail, null);
});

test('SMTP_SECURE is still refused, and the message says the port decides TLS', () => {
  const message = refusal(baseEnv({ ...SMTP_BLOCK, SMTP_SECURE: 'true' }));
  assert.match(message, /SMTP_SECURE/);
  assert.match(message, /SMTP_PORT/);
  assert.match(message, /465/);
});

test('EMAIL_FROM is still refused, and the message names both sending addresses', () => {
  const message = refusal(baseEnv({ EMAIL_FROM: 'f' }));
  assert.match(message, /MAIL_API_FROM/);
  assert.match(message, /SMTP_FROM/);
});

test('every removed variable is fatal rather than ignored', () => {
  // The same asymmetry SIGNUP_MODE is rejected under, applied to the old mail
  // plumbing. A variable that is quietly ignored lets an operator believe mail
  // is configured under a name this service does not read — a false belief
  // discovered by whoever needs it most, on the day they need it. Refusing to
  // boot costs one deploy.
  //
  // CLIENT_BASE_URL is deliberately NOT on this list any more: M181 made it
  // fatal because nothing linked into the client, and M192 mails invitations
  // and resets again, so it is read again. SMTP_HOST, SMTP_PORT, SMTP_USER and
  // SMTP_PASSWORD left it for the same reason: SMTP is a transport again. Only
  // SMTP_SECURE stays, because the port decides TLS now.
  const removed = ['REQUIRE_EMAIL_VERIFICATION', 'EMAIL_FROM', 'SMTP_SECURE', 'PIGEON_API_KEY', 'PIGEON_BASE_URL'];
  for (const key of removed) {
    // The message must NAME the variable, or an operator reading one line of
    // container output cannot tell which of ten it was.
    assert.throws(() => parseConfig(baseEnv({ [key]: 'anything' })), new RegExp(key), `${key} must be fatal`);
  }
});

test('a removed variable is fatal even when set to its old default', () => {
  // The trap this closes: an operator who left REQUIRE_EMAIL_VERIFICATION at
  // `false` reads it as "off, therefore harmless". It is not harmless, it is
  // stale, and an empty-looking value must not slip past the guard.
  assert.throws(() => parseConfig(baseEnv({ REQUIRE_EMAIL_VERIFICATION: 'false' })), /REQUIRE_EMAIL_VERIFICATION/);
  assert.throws(() => parseConfig(baseEnv({ SMTP_SECURE: '' })), /SMTP_SECURE/);
});

test('SYNC_RESEARCH and SYNC_SHARING are independent flags', () => {
  // PROTOCOL.md §5.18: neither implies the other. A clinic instance may want
  // sharing and no cohort graph; a study host may want the reverse. Folding
  // them into one variable would silently widen every sharing deployment into
  // a research deployment, and vice versa.
  const researchOnly = parseConfig(baseEnv({ SYNC_RESEARCH: 'true' }));
  assert.equal(researchOnly.researchEnabled, true);
  assert.equal(researchOnly.sharingEnabled, false);

  const sharingOnly = parseConfig(baseEnv({ SYNC_SHARING: '1' }));
  assert.equal(sharingOnly.sharingEnabled, true);
  assert.equal(sharingOnly.researchEnabled, false);

  // A typo must not silently mean "off" on a flag whose absence is a 404.
  assert.throws(() => parseConfig(baseEnv({ SYNC_RESEARCH: 'yes' })), /SYNC_RESEARCH/);
});

test('SYNC_FEEDBACK is off by default and implies nothing, and nothing implies it', () => {
  // THE COST OF THIS ONE IS DIFFERENT IN KIND. Turning sharing or research on
  // leaves this service holding more bytes it has no key for. Turning this on
  // means the operator holds photographs of their users' food that they can
  // look at (ADR-0006), so it must never arrive as a side effect of another
  // flag.
  const sharingAndResearch = parseConfig(baseEnv({ SYNC_SHARING: 'true', SYNC_RESEARCH: 'true' }));
  assert.equal(sharingAndResearch.feedbackEnabled, false);

  const feedbackOnly = parseConfig(baseEnv({ SYNC_FEEDBACK: 'true' }));
  assert.equal(feedbackOnly.feedbackEnabled, true);
  assert.equal(feedbackOnly.sharingEnabled, false);
  assert.equal(feedbackOnly.researchEnabled, false);

  // A typo must not silently mean "off" on a flag whose absence is a 404, and
  // it must not silently mean "on" either.
  assert.throws(() => parseConfig(baseEnv({ SYNC_FEEDBACK: 'yes' })), /SYNC_FEEDBACK/);
});

test('the two feedback bounds are operator knobs with sane defaults', () => {
  const tuned = parseConfig(baseEnv({ FEEDBACK_DAILY_LIMIT: '20', FEEDBACK_MAX_REQUEST_BYTES: '2000000' }));
  assert.equal(tuned.feedbackDailyLimit, 20);
  assert.equal(tuned.feedbackMaxRequestBytes, 2_000_000);

  // Zero is not "unlimited" and not "off": both are a misconfiguration that
  // would read as a working instance refusing every report.
  assert.throws(() => parseConfig(baseEnv({ FEEDBACK_DAILY_LIMIT: '0' })), /FEEDBACK_DAILY_LIMIT/);
  assert.throws(() => parseConfig(baseEnv({ FEEDBACK_MAX_REQUEST_BYTES: '-1' })), /FEEDBACK_MAX_REQUEST_BYTES/);
});

test('the two legal receipt ceilings are operator knobs with sane defaults (M270/11)', () => {
  const defaults = parseConfig(baseEnv());
  assert.equal(defaults.legalReceiptsPerDay, 200);
  assert.equal(defaults.legalReceiptsPerNetworkPerDay, 10);

  // CONTROL: a set value is carried whole, so the defaults above are not
  // what the parser answers for everything.
  const tuned = parseConfig(
    baseEnv({ LEGAL_DECLARATION_RECEIPTS_PER_DAY: '1000', LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY: '25' }),
  );
  assert.equal(tuned.legalReceiptsPerDay, 1000);
  assert.equal(tuned.legalReceiptsPerNetworkPerDay, 25);

  // Zero is not "no receipts" and not "unlimited": both are a misconfiguration
  // that would read as a working form whose receipts never arrive.
  assert.throws(
    () => parseConfig(baseEnv({ LEGAL_DECLARATION_RECEIPTS_PER_DAY: '0' })),
    /LEGAL_DECLARATION_RECEIPTS_PER_DAY/,
  );
  assert.throws(
    () => parseConfig(baseEnv({ LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY: 'ten' })),
    /LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY/,
  );
});

test('AI_INSTANCE_DAILY_LIMIT is optional, and zero is a boot failure that says why', () => {
  // THE CONTROL FIRST: a real value parses and is carried whole, so the
  // assertions below cannot pass by the parser refusing everything.
  assert.equal(parseConfig(baseEnv({ AI_INSTANCE_DAILY_LIMIT: '1500' })).aiInstanceDailyLimit, 1500);
  // Unset and empty both mean NO ceiling, which is not the same as a number.
  assert.equal(parseConfig(baseEnv()).aiInstanceDailyLimit, null);
  assert.equal(parseConfig(baseEnv({ AI_INSTANCE_DAILY_LIMIT: '   ' })).aiInstanceDailyLimit, null);

  // ZERO IS THE DANGEROUS ONE. It reads like "no ceiling" and means the
  // opposite: every request refused on an instance that still has a provider
  // key, which an operator debugs as a provider outage. The message has to
  // name the remedy, so a person reading a boot log knows what to unset.
  const zero = (): void => {
    parseConfig(baseEnv({ AI_INSTANCE_DAILY_LIMIT: '0' }));
  };
  assert.throws(zero, /AI_INSTANCE_DAILY_LIMIT/);
  // The remedy is named, so a person reading a boot log knows what to unset.
  assert.throws(zero, /UPSTREAM_API_KEY/);
  // And nothing else silently becomes a number either.
  assert.throws(() => parseConfig(baseEnv({ AI_INSTANCE_DAILY_LIMIT: '-1' })), /AI_INSTANCE_DAILY_LIMIT/);
  assert.throws(() => parseConfig(baseEnv({ AI_INSTANCE_DAILY_LIMIT: '1.5' })), /AI_INSTANCE_DAILY_LIMIT/);
  assert.throws(() => parseConfig(baseEnv({ AI_INSTANCE_DAILY_LIMIT: 'lots' })), /AI_INSTANCE_DAILY_LIMIT/);
});

test('UPSTREAM_ZDR and UPSTREAM_PROVIDER_ONLY are optional, parse whole, and a malformed value stops the boot', () => {
  const aiEnv = { UPSTREAM_BASE_URL: 'https://openrouter.ai/api/v1', UPSTREAM_API_KEY: 'sk-test' };
  // THE CONTROL FIRST: real values parse and are carried whole, so the refusals below
  // cannot pass by the parser refusing everything.
  const both = parseConfig(
    baseEnv({ ...aiEnv, UPSTREAM_ZDR: 'true', UPSTREAM_PROVIDER_ONLY: 'google-vertex, amazon-bedrock' }),
  );
  assert.deepEqual(both.ai?.routing, { zeroDataRetention: true, onlyProviders: ['google-vertex', 'amazon-bedrock'] });
  // Unset, empty and `false` all mean today's behaviour.
  const none = { zeroDataRetention: false, onlyProviders: [] };
  assert.deepEqual(parseConfig(baseEnv(aiEnv)).ai?.routing, none);
  assert.deepEqual(
    parseConfig(baseEnv({ ...aiEnv, UPSTREAM_ZDR: '', UPSTREAM_PROVIDER_ONLY: '  ' })).ai?.routing,
    none,
  );
  assert.deepEqual(parseConfig(baseEnv({ ...aiEnv, UPSTREAM_ZDR: 'false' })).ai?.routing, none);
  // A duplicate slug is one slug.
  assert.deepEqual(parseConfig(baseEnv({ ...aiEnv, UPSTREAM_PROVIDER_ONLY: 'a,a' })).ai?.routing?.onlyProviders, ['a']);

  // A spelling that is not `true` must not quietly mean "off": the operator would believe retention is.
  for (const bad of ['yes', '1', 'on', 'tru']) {
    assert.throws(
      () => parseConfig(baseEnv({ ...aiEnv, UPSTREAM_ZDR: bad })),
      /Invalid UPSTREAM_ZDR.*expected true/,
      bad,
    );
  }
  // Each bad slug list names the entry that is wrong.
  for (const bad of ['a,,b', 'google-vertex,', ',a', 'Google Vertex', 'GOOGLE-VERTEX', 'a b']) {
    assert.throws(
      () => parseConfig(baseEnv({ ...aiEnv, UPSTREAM_PROVIDER_ONLY: bad })),
      /Invalid UPSTREAM_PROVIDER_ONLY entry/,
      bad,
    );
  }
  assert.throws(
    () => parseConfig(baseEnv({ ...aiEnv, UPSTREAM_PROVIDER_ONLY: 'google-vertex,Bad Slug' })),
    /entry "Bad Slug"/,
  );
  // The typo is found even before the AI block exists.
  assert.throws(() => parseConfig(baseEnv({ UPSTREAM_ZDR: 'yes' })), /Invalid UPSTREAM_ZDR/);
  assert.equal(parseConfig(baseEnv({ UPSTREAM_ZDR: 'true' })).ai, null);
});

test('AI_BUDGET_ALERT_FRACTION defaults to 0.2, takes a share, and refuses 0, 1 and words', () => {
  // THE CONTROL FIRST: a real share parses and is carried whole.
  assert.equal(parseConfig(baseEnv({ AI_BUDGET_ALERT_FRACTION: '0.15' })).aiBudgetAlertFraction, 0.15);
  assert.equal(parseConfig(baseEnv()).aiBudgetAlertFraction, 0.2);
  assert.equal(parseConfig(baseEnv({ AI_BUDGET_ALERT_FRACTION: '  ' })).aiBudgetAlertFraction, 0.2);
  // `0` would never alert and `1` would alert on a full key: neither is "off".
  for (const refused of ['0', '1', '-0.1', '1.5', 'twenty']) {
    assert.throws(
      () => parseConfig(baseEnv({ AI_BUDGET_ALERT_FRACTION: refused })),
      /AI_BUDGET_ALERT_FRACTION/,
      refused,
    );
  }
});

test('the two member-invite settings are all-or-nothing, and the allowance has a ceiling', () => {
  // THE CONTROL FIRST: both set parse into the policy whole, so the refusals
  // below cannot pass by the parser rejecting everything.
  assert.deepEqual(
    parseConfig(baseEnv({ MEMBER_INVITE_DAILY_AI_LIMIT: '50', MEMBER_INVITE_ALLOWANCE_DAYS: '30' })).memberInvites,
    { dailyAiLimit: 50, allowanceDays: 30, lifetimeCap: 5 },
  );
  // Neither set is the default: members cannot invite anybody, and
  // `POST /v1/auth/invites` answers 404.
  assert.equal(parseConfig(baseEnv()).memberInvites, null);
  assert.equal(parseConfig(baseEnv({ MEMBER_INVITE_DAILY_AI_LIMIT: '  ' })).memberInvites, null);

  // HALF THE PAIR IS A BOOT FAILURE THAT NAMES THE MISSING ONE. An allowance
  // with no end date is a trial that never ends, and an end date with no
  // allowance is a letter that grants nothing.
  assert.throws(() => parseConfig(baseEnv({ MEMBER_INVITE_DAILY_AI_LIMIT: '50' })), /MEMBER_INVITE_ALLOWANCE_DAYS/);
  assert.throws(() => parseConfig(baseEnv({ MEMBER_INVITE_ALLOWANCE_DAYS: '30' })), /MEMBER_INVITE_DAILY_AI_LIMIT/);

  // ONE MISTYPED DIGIT IS THE LARGEST BILL THIS FILE CAN WRITE: the allowance
  // is multiplied by every member times five invitations.
  assert.throws(
    () => parseConfig(baseEnv({ MEMBER_INVITE_DAILY_AI_LIMIT: '500000', MEMBER_INVITE_ALLOWANCE_DAYS: '30' })),
    /MEMBER_INVITE_DAILY_AI_LIMIT/,
  );
  // And zero is refused for either, rather than read as "off".
  assert.throws(
    () => parseConfig(baseEnv({ MEMBER_INVITE_DAILY_AI_LIMIT: '0', MEMBER_INVITE_ALLOWANCE_DAYS: '30' })),
    /MEMBER_INVITE_DAILY_AI_LIMIT/,
  );
  assert.throws(
    () => parseConfig(baseEnv({ MEMBER_INVITE_DAILY_AI_LIMIT: '50', MEMBER_INVITE_ALLOWANCE_DAYS: '0' })),
    /MEMBER_INVITE_ALLOWANCE_DAYS/,
  );
});

test('the lifetime cap comes from the environment, and it needs the pair to stand on', () => {
  const pair = { MEMBER_INVITE_DAILY_AI_LIMIT: '50', MEMBER_INVITE_ALLOWANCE_DAYS: '30' };

  // THE CONTROL FIRST: unset, the cap is five, which is what every instance
  // has run on since M212. An upgrade must not change what a member may do.
  assert.equal(parseConfig(baseEnv(pair)).memberInvites?.lifetimeCap, 5);

  // Two, which is what a managed instance whose administrator pays for the
  // provider key asks for.
  assert.deepEqual(parseConfig(baseEnv({ ...pair, MEMBER_INVITE_LIFETIME_CAP: '2' })).memberInvites, {
    dailyAiLimit: 50,
    allowanceDays: 30,
    lifetimeCap: 2,
  });

  // ZERO IS A VALUE HERE AND NOT A MISTAKE, unlike the pair. It leaves the
  // route mounted and gives every member nothing to spend, which is what an
  // operator wants while they watch the bill. Unsetting the pair is the other
  // move, and it takes the route away instead.
  assert.equal(parseConfig(baseEnv({ ...pair, MEMBER_INVITE_LIFETIME_CAP: '0' })).memberInvites?.lifetimeCap, 0);

  // Nothing else silently becomes a number.
  for (const bad of ['-1', '1.5', 'a few']) {
    assert.throws(
      () => parseConfig(baseEnv({ ...pair, MEMBER_INVITE_LIFETIME_CAP: bad })),
      /MEMBER_INVITE_LIFETIME_CAP/,
      `MEMBER_INVITE_LIFETIME_CAP="${bad}" must be refused`,
    );
  }

  // THE CAP WITHOUT THE PAIR IS A BOOT FAILURE NAMING IT, for the reason the
  // half-pair refusal above exists: an operator who set only this one believes
  // they have narrowed a door that is not open, on an instance where
  // `POST /v1/auth/invites` answers 404 to everybody.
  assert.throws(() => parseConfig(baseEnv({ MEMBER_INVITE_LIFETIME_CAP: '2' })), /MEMBER_INVITE_LIFETIME_CAP/);
});

test('an instance with nothing to say publishes no notice at all', () => {
  // ABSENCE IS THE DEFAULT AND IT IS A SHAPE, not just a value: `null` here is
  // what keeps the field off the /health body entirely, so a client older than
  // M181 parses the response exactly as it always did.
  assert.equal(parseConfig(baseEnv()).notice, null);
  assert.equal(parseConfig(baseEnv({ SYNC_NOTICE: '   ' })).notice, null);
});

test('SYNC_NOTICE is carried whole, with its optional link', () => {
  assert.deepEqual(parseConfig(baseEnv({ SYNC_NOTICE: '  We move on 1 March.  ' })).notice, {
    text: 'We move on 1 March.',
  });
  assert.deepEqual(
    parseConfig(baseEnv({ SYNC_NOTICE: 'We move on 1 March.', SYNC_NOTICE_URL: 'https://example.org/moving' })).notice,
    { text: 'We move on 1 March.', url: 'https://example.org/moving' },
  );
});

test('an over-long SYNC_NOTICE is a boot failure, never a truncation', () => {
  // /health is this container's own HEALTHCHECK path and is polled forever, so
  // the cap is real. Failing to boot is the only honest answer: quietly cutting
  // a shutdown notice in half ships a sentence the operator never wrote.
  const tooLong = 'n'.repeat(MAX_SYNC_NOTICE_LENGTH + 1);
  assert.throws(() => parseConfig(baseEnv({ SYNC_NOTICE: tooLong })), /SYNC_NOTICE/);
  // The boundary itself is accepted, so the cap is a limit and not an off-by-one.
  const atCap = 'n'.repeat(MAX_SYNC_NOTICE_LENGTH);
  assert.deepEqual(parseConfig(baseEnv({ SYNC_NOTICE: atCap })).notice, { text: atCap });
});

test('SYNC_NOTICE_URL must be an absolute http(s) URL, and must have something to link from', () => {
  const withNotice = (url: string): NodeJS.ProcessEnv => baseEnv({ SYNC_NOTICE: 'Read this.', SYNC_NOTICE_URL: url });
  // The client refuses these schemes too; refusing them at boot means the
  // operator hears about it instead of wondering why no link appears.
  assert.throws(() => parseConfig(withNotice('javascript:alert(1)')), /SYNC_NOTICE_URL/);
  assert.throws(() => parseConfig(withNotice('data:text/html,hi')), /SYNC_NOTICE_URL/);
  assert.throws(() => parseConfig(withNotice('/moving')), /SYNC_NOTICE_URL/);
  // A link with no message is far more likely a typo in the variable name than
  // an intention, and it would publish nothing either way.
  assert.throws(() => parseConfig(baseEnv({ SYNC_NOTICE_URL: 'https://example.org/moving' })), /SYNC_NOTICE_URL/);
});

test('BILLING_TOKEN is unset by default, so the service principal does not exist', () => {
  // THE DEFAULT IS THE PROPERTY. A self-hoster who configured nothing must
  // gain no admin surface at all, so `null` here is what keeps the whole
  // `/v1/admin` tree answering the ordinary unknown-path 404 on their
  // instance. See `server/admin-auth.ts`.
  assert.equal(parseConfig(baseEnv()).billingToken, null);
  assert.equal(parseConfig(baseEnv({ BILLING_TOKEN: '' })).billingToken, null);
  assert.equal(parseConfig(baseEnv({ BILLING_TOKEN: '   ' })).billingToken, null);
});

test('a short BILLING_TOKEN is fatal, on the same floor ADMIN_TOKEN has', () => {
  // Not a warning. What this credential moves is what somebody paid for, so a
  // guessable value is a free allowance for anybody who finds the host, and a
  // boot failure is the only refusal an operator cannot ignore.
  assert.throws(() => parseConfig(baseEnv({ BILLING_TOKEN: 'short' })), /BILLING_TOKEN/);
  assert.throws(() => parseConfig(baseEnv({ BILLING_TOKEN: 'a'.repeat(MIN_ADMIN_TOKEN_LENGTH - 1) })), /BILLING_TOKEN/);

  const generated = 'a'.repeat(MIN_ADMIN_TOKEN_LENGTH);
  assert.equal(parseConfig(baseEnv({ BILLING_TOKEN: generated })).billingToken, generated);
});

test('BILLING_TOKEN and ADMIN_TOKEN are two independent variables', () => {
  // Neither implies the other, and setting one alone is a supported shape: a
  // paid instance may run a biller without a break-glass token, and every
  // instance today runs a break-glass token without a biller.
  const billingOnly = parseConfig(baseEnv({ BILLING_TOKEN: 'b'.repeat(MIN_ADMIN_TOKEN_LENGTH) }));
  assert.equal(billingOnly.adminToken, null);
  assert.notEqual(billingOnly.billingToken, null);

  const adminOnly = parseConfig(baseEnv({ ADMIN_TOKEN: 'c'.repeat(MIN_ADMIN_TOKEN_LENGTH) }));
  assert.equal(adminOnly.billingToken, null);
  assert.notEqual(adminOnly.adminToken, null);
});

test('a BILLING_TOKEN equal to ADMIN_TOKEN refuses to boot, and prints neither value', () => {
  // The admin door checks ADMIN_TOKEN first, so one string in both variables
  // would admit the biller as the operator and skip its scope entirely.
  const shared = 'd'.repeat(MIN_ADMIN_TOKEN_LENGTH);
  const env = baseEnv({ ADMIN_TOKEN: shared, BILLING_TOKEN: shared });
  assert.throws(() => parseConfig(env), /BILLING_TOKEN must differ from ADMIN_TOKEN/);
  assert.throws(
    () => parseConfig(env),
    (error: Error) => !error.message.includes(shared),
  );
  // Surrounding whitespace is trimmed before the comparison, as before the use.
  assert.throws(() => parseConfig(baseEnv({ ADMIN_TOKEN: ` ${shared}`, BILLING_TOKEN: `${shared} ` })), /differ/);
  // Two different values still boot.
  const both = parseConfig(baseEnv({ ADMIN_TOKEN: shared, BILLING_TOKEN: 'e'.repeat(MIN_ADMIN_TOKEN_LENGTH) }));
  assert.equal(both.adminToken, shared);
});

test('BILLING_MAX_DAILY_AI_LIMIT defaults to 1000 and may not exceed the operator ceiling', () => {
  assert.equal(parseConfig(baseEnv()).billingMaxDailyAiLimit, 1000);
  assert.equal(parseConfig(baseEnv({ BILLING_MAX_DAILY_AI_LIMIT: '250' })).billingMaxDailyAiLimit, 250);
  assert.throws(() => parseConfig(baseEnv({ BILLING_MAX_DAILY_AI_LIMIT: '10001' })), /BILLING_MAX_DAILY_AI_LIMIT/);
  assert.throws(() => parseConfig(baseEnv({ BILLING_MAX_DAILY_AI_LIMIT: '0' })), /BILLING_MAX_DAILY_AI_LIMIT/);
});

test('PUSH_ENDPOINT_HOSTS is empty by default, lower-cased, and refuses a malformed entry', () => {
  assert.deepEqual(parseConfig(baseEnv()).pushEndpointHosts, []);
  assert.deepEqual(
    parseConfig(baseEnv({ PUSH_ENDPOINT_HOSTS: ' Push.Example.org , *.relay.example.net ' })).pushEndpointHosts,
    ['push.example.org', '*.relay.example.net'],
  );
  for (const bad of ['*', 'https://push.example.org', 'push.example.org:8443', '10.0.0.5/32', 'a..b']) {
    assert.throws(() => parseConfig(baseEnv({ PUSH_ENDPOINT_HOSTS: bad })), /PUSH_ENDPOINT_HOSTS/, bad);
  }
});

test('a plans URL with no secret refuses to boot, and names the missing variable', () => {
  assert.throws(
    () => parseConfig(baseEnv({ PLANS_UPSTREAM_URL: 'http://openplate-billing:3000/plans' })),
    /PLANS_UPSTREAM_SECRET/,
  );
});

test('a plans secret with no URL refuses to boot too, because it is a typo far more often than an intention', () => {
  assert.throws(() => parseConfig(baseEnv({ PLANS_UPSTREAM_SECRET: 'a-shared-secret' })), /PLANS_UPSTREAM_URL/);
});

test('the refusal never prints the secret it refused', () => {
  // A message that quoted the value would put a shared secret in a startup
  // log, which is the one place an operator pastes into an issue.
  const secret = 'the-secret-that-must-not-be-logged';
  assert.throws(
    () => parseConfig(baseEnv({ PLANS_UPSTREAM_SECRET: secret })),
    (error: Error) => !error.message.includes(secret),
  );
});

test('a relative or misspelled plans URL is a boot failure, not an upstream that goes nowhere', () => {
  assert.throws(
    () => parseConfig(baseEnv({ PLANS_UPSTREAM_URL: 'openplate-billing/plans', PLANS_UPSTREAM_SECRET: 's' })),
    /PLANS_UPSTREAM_URL/,
  );
});

test('both set is the feature on, with the trailing slash stripped once', () => {
  // THE CONTROL for the four refusals above: without it they would all pass
  // against a parser that refused every plans configuration.
  const config = parseConfig(
    baseEnv({ PLANS_UPSTREAM_URL: 'http://openplate-billing:3000/plans/', PLANS_UPSTREAM_SECRET: 'a-shared-secret' }),
  );

  assert.deepEqual(config.plans, { baseUrl: 'http://openplate-billing:3000/plans', secret: 'a-shared-secret' });
});

// ── open sign-up (M253) ────────────────────────────────────────────────────

/** A complete mail block, which `OPEN_SIGNUP=true` needs beside it. */
const MAIL_ENV = {
  MAIL_API_URL: 'http://pigeon:3601/v1/emails',
  MAIL_API_KEY: 'a-pigeon-tenant-key',
  MAIL_API_FROM: 'openplate <openplate@mail.openplate.de>',
  MAIL_OPERATOR_EMAIL: 'operator@example.org',
  SERVER_PUBLIC_URL: 'https://sync.openplate.de',
  CLIENT_BASE_URL: 'https://openplate.de',
};

test('open sign-up is off unless set, and every instance that says nothing stays invite-only', () => {
  const config = parseConfig(baseEnv());
  assert.equal(config.openSignup, false);
  assert.equal(config.turnstile, null);
});

test('OPEN_SIGNUP=true without mail refuses to boot and says why', () => {
  // The facts, not the verb: the variable, and what to set for either transport.
  const message = refusal(baseEnv({ OPEN_SIGNUP: 'true' }));
  assert.match(message, /OPEN_SIGNUP=true/);
  assert.match(message, /MAIL_API_URL/);
  assert.match(message, /SMTP_HOST/);
});

test('OPEN_SIGNUP=true with mail boots with the door open', () => {
  // THE CONTROL for the refusal above: without it that test would pass against
  // a parser that refused every open instance.
  assert.equal(parseConfig(baseEnv({ ...MAIL_ENV, OPEN_SIGNUP: 'true' })).openSignup, true);
});

test('OPEN_SIGNUP accepts "true" or nothing, and names any other value', () => {
  for (const value of ['false', '1', 'yes', 'TRUE ']) {
    // `TRUE ` is trimmed to `TRUE`, which is still not the one spelling.
    assert.throws(() => parseConfig(baseEnv({ ...MAIL_ENV, OPEN_SIGNUP: value })), /Invalid OPEN_SIGNUP/, value);
  }
  assert.equal(parseConfig(baseEnv({ ...MAIL_ENV, OPEN_SIGNUP: '' })).openSignup, false);
});

test('the Turnstile pair is both or neither, and a gap names the missing key and never a value', () => {
  const secret = 'turnstile-secret-that-must-not-be-logged';
  assert.throws(
    () => parseConfig(baseEnv({ ...MAIL_ENV, OPEN_SIGNUP: 'true', TURNSTILE_SECRET_KEY: secret })),
    (error: Error) => /TURNSTILE_SITE_KEY/.test(error.message) && !error.message.includes(secret),
  );
  assert.throws(
    () => parseConfig(baseEnv({ ...MAIL_ENV, OPEN_SIGNUP: 'true', TURNSTILE_SITE_KEY: 'site' })),
    /TURNSTILE_SECRET_KEY/,
  );
});

test('a Turnstile pair on an invite-only instance refuses to boot: there is no door for it to guard', () => {
  assert.throws(
    () => parseConfig(baseEnv({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: 'site' })),
    /OPEN_SIGNUP is not/,
  );
});

test('the Turnstile pair beside an open door is the captcha on', () => {
  // THE CONTROL for the three refusals above.
  const config = parseConfig(
    baseEnv({ ...MAIL_ENV, OPEN_SIGNUP: 'true', TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: 'site' }),
  );
  assert.deepEqual(config.turnstile, { secretKey: 'secret', siteKey: 'site' });
});

// ── the scan trial (M253) ──────────────────────────────────────────────────

const PEPPER_ENV = { TRIAL_ADDRESS_PEPPER: 'p'.repeat(MIN_SERVER_SECRET_LENGTH) };
const TRIAL_ENV = { TRIAL_SCANS: '10', TRIAL_DAILY_AI_LIMIT: '50', ...PEPPER_ENV };

test('no new variable boots exactly as before: no trial, no sub-ceiling, no pepper', () => {
  const config = parseConfig(baseEnv());
  assert.equal(config.trial, null);
  assert.equal(config.aiTrialInstanceDailyLimit, null);
  assert.equal(config.trialAddressPepper, null);
  assert.equal(config.memberInvites, null);
});

test('the trial pair is both or neither, and a gap names the missing one', () => {
  assert.throws(() => parseConfig(baseEnv({ TRIAL_SCANS: '10', ...PEPPER_ENV })), /TRIAL_DAILY_AI_LIMIT is not set/);
  assert.throws(() => parseConfig(baseEnv({ TRIAL_DAILY_AI_LIMIT: '50', ...PEPPER_ENV })), /TRIAL_SCANS is not set/);
});

test('the trial count is 1 to 100 and its daily bound is positive', () => {
  for (const scans of ['0', '101', 'ten', '1.5']) {
    assert.throws(() => parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_SCANS: scans })), /TRIAL_SCANS/, scans);
  }
  assert.throws(() => parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAILY_AI_LIMIT: '0' })), /TRIAL_DAILY_AI_LIMIT/);
});

test('the trial needs its pepper, and a short one is refused without being printed', () => {
  assert.throws(
    () => parseConfig(baseEnv({ TRIAL_SCANS: '10', TRIAL_DAILY_AI_LIMIT: '50' })),
    /need TRIAL_ADDRESS_PEPPER/,
  );
  const short = 'short-pepper-value';
  assert.throws(
    () => parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_ADDRESS_PEPPER: short })),
    (error: Error) => /TRIAL_ADDRESS_PEPPER/.test(error.message) && !error.message.includes(short),
  );
});

test('the trial pair with its pepper is the trial on', () => {
  // THE CONTROL for the refusals above.
  const config = parseConfig(baseEnv(TRIAL_ENV));
  assert.deepEqual(config.trial, { scans: 10, dailyAiLimit: 50, days: null, timeZone: 'UTC' });
  assert.equal(config.trialAddressPepper, PEPPER_ENV.TRIAL_ADDRESS_PEPPER);
});

// ── the day limit (M267) ───────────────────────────────────────────────────

test('TRIAL_DAYS beside the trial pair ends the trial after that many days', () => {
  const config = parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '14' }));
  assert.deepEqual(config.trial, { scans: 10, dailyAiLimit: 50, days: 14, timeZone: 'UTC' });
});

// ── the zone the day boundary falls in (owner decision, 2026-09-29) ────────

test("TRIAL_TIME_ZONE places the trial's last midnight, and UTC is the default", () => {
  const berlin = parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '14', TRIAL_TIME_ZONE: 'Europe/Berlin' }));
  assert.equal(berlin.trial?.timeZone, 'Europe/Berlin');
  // THE CONTROL: unset, the zone is UTC.
  assert.equal(parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '14' })).trial?.timeZone, 'UTC');
  assert.equal(parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '14', TRIAL_TIME_ZONE: '' })).trial?.timeZone, 'UTC');
});

test('TRIAL_TIME_ZONE is written the way Intl names the zone', () => {
  const lower = parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '14', TRIAL_TIME_ZONE: 'europe/berlin' }));
  assert.equal(lower.trial?.timeZone, 'Europe/Berlin');
});

test('an unknown TRIAL_TIME_ZONE fails the boot, and the message names the setting', () => {
  assert.throws(
    () => parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '14', TRIAL_TIME_ZONE: 'Europe/Berln' })),
    /TRIAL_TIME_ZONE.*Europe\/Berln/,
  );
});

test('TRIAL_TIME_ZONE without TRIAL_DAYS fails the boot, as TRIAL_DAYS without the trial pair does', () => {
  assert.throws(
    () => parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_TIME_ZONE: 'Europe/Berlin' })),
    /TRIAL_TIME_ZONE.*TRIAL_DAYS/,
  );
  assert.throws(() => parseConfig(baseEnv({ ...PEPPER_ENV, TRIAL_TIME_ZONE: 'Europe/Berlin' })), /TRIAL_TIME_ZONE/);
});

test('TRIAL_DAYS unset keeps a trial with no end date, as every instance before it', () => {
  // THE CONTROL for the day limit above.
  assert.equal(parseConfig(baseEnv(TRIAL_ENV)).trial?.days, null);
  assert.equal(parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '' })).trial?.days, null);
});

test('TRIAL_DAYS without the trial pair is a boot failure: a dial with no door', () => {
  assert.throws(() => parseConfig(baseEnv({ TRIAL_DAYS: '14', ...PEPPER_ENV })), /TRIAL_DAYS.*no scan trial/);
});

test('TRIAL_DAYS is a whole number from 1 to 90, and zero is refused rather than read as off', () => {
  for (const days of ['0', '91', '-3', 'fourteen', '1.5']) {
    assert.throws(() => parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: days })), /TRIAL_DAYS/, days);
  }
  // THE CONTROLS: both ends of the range boot.
  assert.equal(parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '1' })).trial?.days, 1);
  assert.equal(parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '90' })).trial?.days, 90);
});

test('MEMBER_INVITE_TRIAL refuses to stand beside the day pair or without the trial', () => {
  assert.throws(
    () => parseConfig(baseEnv({ ...TRIAL_ENV, MEMBER_INVITE_TRIAL: 'true', MEMBER_INVITE_ALLOWANCE_DAYS: '3' })),
    /never both/,
  );
  // THE COMBINED RULE (M267): a trial that ends after some days is the
  // instance's own trial with TRIAL_DAYS, and the refusal says so, so an
  // operator reaching for the day pair is sent to the one setting that works.
  assert.throws(
    () => parseConfig(baseEnv({ ...TRIAL_ENV, MEMBER_INVITE_TRIAL: 'true', MEMBER_INVITE_ALLOWANCE_DAYS: '3' })),
    /set TRIAL_DAYS/,
  );
  assert.throws(
    () => parseConfig(baseEnv({ ...TRIAL_ENV, MEMBER_INVITE_TRIAL: 'true', MEMBER_INVITE_DAILY_AI_LIMIT: '50' })),
    /never both/,
  );
  assert.throws(() => parseConfig(baseEnv({ MEMBER_INVITE_TRIAL: 'true' })), /needs the trial it grants/);
});

test('MEMBER_INVITE_TRIAL with the trial opens the member door on the scan trial, narrowed by the cap', () => {
  // THE CONTROL for the refusals above.
  const config = parseConfig(baseEnv({ ...TRIAL_ENV, MEMBER_INVITE_TRIAL: 'true', MEMBER_INVITE_LIFETIME_CAP: '2' }));
  assert.deepEqual(config.memberInvites, {
    kind: 'trial',
    dailyAiLimit: 50,
    trialScans: 10,
    trialDays: null,
    lifetimeCap: 2,
  });
  // A member invitation grants the whole trial, its day limit included (M267).
  const dated = parseConfig(baseEnv({ ...TRIAL_ENV, TRIAL_DAYS: '14', MEMBER_INVITE_TRIAL: 'true' }));
  assert.equal(dated.memberInvites?.kind === 'trial' ? dated.memberInvites.trialDays : 'not the trial door', 14);
  // And the day door still boots on its own, unchanged.
  const days = parseConfig(baseEnv({ MEMBER_INVITE_DAILY_AI_LIMIT: '50', MEMBER_INVITE_ALLOWANCE_DAYS: '3' }));
  assert.deepEqual(days.memberInvites, { dailyAiLimit: 50, allowanceDays: 3, lifetimeCap: 5 });
});

test('the trial sub-ceiling refuses zero and refuses an instance with no trial to bound', () => {
  assert.throws(() => parseConfig(baseEnv({ ...TRIAL_ENV, AI_TRIAL_INSTANCE_DAILY_LIMIT: '0' })), /AI_TRIAL_INSTANCE/);
  assert.throws(() => parseConfig(baseEnv({ AI_TRIAL_INSTANCE_DAILY_LIMIT: '1000' })), /nothing for it to bound/);
  // THE CONTROL.
  assert.equal(
    parseConfig(baseEnv({ ...TRIAL_ENV, AI_TRIAL_INSTANCE_DAILY_LIMIT: '1000' })).aiTrialInstanceDailyLimit,
    1000,
  );
});

// ── one network's share of the trial ceiling (M270 spec 12) ────────────────

test('the network share defaults to a tenth of the trial ceiling, rounded down, at least one unit', () => {
  const share = (ceiling: string): number | null =>
    parseConfig(baseEnv({ ...TRIAL_ENV, AI_TRIAL_INSTANCE_DAILY_LIMIT: ceiling })).aiTrialNetworkDailyLimit;
  assert.equal(share('1000'), 100, 'the production ceiling');
  assert.equal(share('25'), 2, 'rounded down');
  assert.equal(share('5'), 1, 'never below one unit');
});

test('the network share is off without a trial ceiling, and refused there when named', () => {
  assert.equal(parseConfig(baseEnv()).aiTrialNetworkDailyLimit, null);
  assert.equal(parseConfig(baseEnv(TRIAL_ENV)).aiTrialNetworkDailyLimit, null);
  assert.throws(
    () => parseConfig(baseEnv({ ...TRIAL_ENV, AI_TRIAL_NETWORK_DAILY_LIMIT: '50' })),
    /AI_TRIAL_NETWORK_DAILY_LIMIT.*AI_TRIAL_INSTANCE_DAILY_LIMIT/,
  );
});

test('a named network share takes a positive integer no larger than the trial ceiling', () => {
  const withCeiling = { ...TRIAL_ENV, AI_TRIAL_INSTANCE_DAILY_LIMIT: '1000' };
  // THE CONTROL for the refusals below.
  assert.equal(
    parseConfig(baseEnv({ ...withCeiling, AI_TRIAL_NETWORK_DAILY_LIMIT: '250' })).aiTrialNetworkDailyLimit,
    250,
  );
  assert.equal(
    parseConfig(baseEnv({ ...withCeiling, AI_TRIAL_NETWORK_DAILY_LIMIT: '1000' })).aiTrialNetworkDailyLimit,
    1000,
  );
  for (const invalid of ['0', '-1', '2.5', 'lots', '1001']) {
    assert.throws(
      () => parseConfig(baseEnv({ ...withCeiling, AI_TRIAL_NETWORK_DAILY_LIMIT: invalid })),
      /AI_TRIAL_NETWORK_DAILY_LIMIT/,
      invalid,
    );
  }
});

test('AI_MAX_OUTPUT_TOKENS defaults to 8192, takes a positive integer, and refuses anything else', () => {
  // ALWAYS SET, unlike the instance ceiling above: an unbounded answer is the
  // cost path M256 closes, so there is no "off" (M256/01).
  assert.equal(parseConfig(baseEnv()).aiMaxOutputTokens, 8192);
  assert.equal(parseConfig(baseEnv({ AI_MAX_OUTPUT_TOKENS: '2048' })).aiMaxOutputTokens, 2048);
  for (const invalid of ['0', '-1', '1.5', 'lots']) {
    assert.throws(() => parseConfig(baseEnv({ AI_MAX_OUTPUT_TOKENS: invalid })), /AI_MAX_OUTPUT_TOKENS/, invalid);
  }
});

// ── DEFAULT_FREE_DAILY_AI_LIMIT (2026-10-05) ────────────────────────────────

test('the standing free daily limit is off unless set, and unset, empty and 0 all mean off', () => {
  assert.equal(parseConfig(baseEnv()).defaultFreeDailyAiLimit, 0);
  assert.equal(parseConfig(baseEnv({ DEFAULT_FREE_DAILY_AI_LIMIT: '' })).defaultFreeDailyAiLimit, 0);
  assert.equal(parseConfig(baseEnv({ DEFAULT_FREE_DAILY_AI_LIMIT: '0' })).defaultFreeDailyAiLimit, 0);
  assert.equal(parseConfig(baseEnv({ DEFAULT_FREE_DAILY_AI_LIMIT: ' 3 ' })).defaultFreeDailyAiLimit, 3);
});

test('a standing free daily limit that is not a whole number from 0 to the ceiling stops the boot', () => {
  for (const value of ['-1', '2.5', 'three', '10001']) {
    assert.throws(
      () => parseConfig(baseEnv({ DEFAULT_FREE_DAILY_AI_LIMIT: value })),
      /DEFAULT_FREE_DAILY_AI_LIMIT/,
      value,
    );
  }
});

test('a standing free daily limit beside a scan trial stops the boot, naming both settings', () => {
  assert.throws(
    () => parseConfig(baseEnv({ ...TRIAL_ENV, DEFAULT_FREE_DAILY_AI_LIMIT: '3' })),
    /DEFAULT_FREE_DAILY_AI_LIMIT.*TRIAL_SCANS.*TRIAL_DAILY_AI_LIMIT/s,
  );
  // THE CONTROLS: each half alone boots, and a limit of 0 beside the trial is
  // the same as no limit.
  assert.equal(parseConfig(baseEnv({ ...TRIAL_ENV })).defaultFreeDailyAiLimit, 0);
  assert.equal(parseConfig(baseEnv({ DEFAULT_FREE_DAILY_AI_LIMIT: '3' })).trial, null);
  assert.equal(parseConfig(baseEnv({ ...TRIAL_ENV, DEFAULT_FREE_DAILY_AI_LIMIT: '0' })).trial?.scans, 10);
});

// ── DEFAULT_CAPABILITIES and CAPABILITY_SCHEMA_MAP (2026-10-05) ─────────────

test('no capability setting means no check and no schema map: an instance that sets nothing is unchanged', () => {
  const unset = parseConfig(baseEnv());
  assert.equal(unset.defaultCapabilities, null);
  assert.equal(unset.capabilitySchemaMap.size, 0);
  // The compose files forward an unset variable as the empty string.
  const empty = parseConfig(baseEnv({ DEFAULT_CAPABILITIES: '', CAPABILITY_SCHEMA_MAP: '' }));
  assert.equal(empty.defaultCapabilities, null);
  assert.equal(empty.capabilitySchemaMap.size, 0);
});

test('DEFAULT_CAPABILITIES and CAPABILITY_SCHEMA_MAP are read, and "none" is the empty default', () => {
  const config = parseConfig(
    baseEnv({ DEFAULT_CAPABILITIES: 'scan, recipes', CAPABILITY_SCHEMA_MAP: 'scan_result:scan' }),
  );
  assert.deepEqual(config.defaultCapabilities, ['recipes', 'scan']);
  assert.deepEqual([...config.capabilitySchemaMap], [['scan_result', 'scan']]);
  assert.deepEqual(parseConfig(baseEnv({ DEFAULT_CAPABILITIES: 'none' })).defaultCapabilities, []);
});

test('a malformed capability setting stops the boot and names the variable', () => {
  assert.throws(() => parseConfig(baseEnv({ DEFAULT_CAPABILITIES: 'Scan' })), /DEFAULT_CAPABILITIES/);
  assert.throws(() => parseConfig(baseEnv({ CAPABILITY_SCHEMA_MAP: 'scan_result' })), /CAPABILITY_SCHEMA_MAP/);
});

// ── TRIAL_HASH_RETENTION_DAYS (2026-10-05, ADR-0010) ────────────────────────

test('the mailbox hash is kept 365 days unless the operator says otherwise', () => {
  assert.equal(parseConfig(baseEnv()).trialHashRetentionDays, 365);
  assert.equal(parseConfig(baseEnv({ TRIAL_HASH_RETENTION_DAYS: '' })).trialHashRetentionDays, 365);
  assert.equal(parseConfig(baseEnv({ TRIAL_HASH_RETENTION_DAYS: ' 90 ' })).trialHashRetentionDays, 90);
  assert.equal(parseConfig(baseEnv({ TRIAL_HASH_RETENTION_DAYS: '3650' })).trialHashRetentionDays, 3650);
});

test('TRIAL_HASH_RETENTION_DAYS refuses zero, a fraction, text and ten years and a day, naming the variable', () => {
  for (const value of ['0', '-5', '1.5', 'a year', '3651']) {
    assert.throws(() => parseConfig(baseEnv({ TRIAL_HASH_RETENTION_DAYS: value })), /TRIAL_HASH_RETENTION_DAYS/, value);
  }
});

// ── AI_TIERS_FILE ────────────────────────────────────────────────────────────

const tierDirectories: string[] = [];

after(() => {
  for (const directory of tierDirectories) rmSync(directory, { recursive: true, force: true });
});

/** Writes a file into a fresh temporary directory and returns its absolute path. */
function mountedFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'ai-tiers-config-'));
  tierDirectories.push(directory);
  const path = join(directory, 'ai-tiers.json');
  writeFileSync(path, contents);
  return path;
}

const TEST_PRICE = { inputUsdPerMillion: 1, outputUsdPerMillion: 4, checked: '2026-10-05', source: 'a fixture' };

function testTier(patch: JsonObject = {}): JsonObject {
  return {
    use: 'A test tier.',
    model: 'vendor/test-model',
    routing: { zdr: true, only: ['test-provider'] },
    price: TEST_PRICE,
    disclose: ['Test Model'],
    ...patch,
  };
}

function testTierFile(patch: JsonObject = {}): string {
  return JSON.stringify({ version: 1, defaultTier: 'standard', routes: {}, tiers: { standard: testTier() }, ...patch });
}

function defaultModelOf(env: NodeJS.ProcessEnv): string | null {
  const config = parseConfig(env);
  return config.aiTiers.tiers.get(config.aiTiers.defaultTier)?.model ?? null;
}

test('AI_TIERS_FILE unset or blank is legacy mode: one implicit tier from the three older variables, no warnings', () => {
  for (const value of [undefined, '', '   ']) {
    const config = parseConfig(baseEnv({ AI_TIERS_FILE: value }));
    assert.deepEqual(config.aiTiersSource, { kind: 'legacy' });
    assert.deepEqual(config.aiTiersWarnings, []);
    assert.equal(config.aiTiers.defaultTier, 'standard');
    assert.equal(config.aiTiers.tiers.size, 1);
    assert.equal(config.aiTiers.tiers.get('standard')?.model, null);
    assert.equal(config.aiAdvertisedModel, null);
  }
  // The three older variables ARE the tier, and nothing warns about them.
  const legacy = parseConfig(
    baseEnv({
      AI_ADVERTISED_MODEL: 'vendor/test-model',
      UPSTREAM_ZDR: 'true',
      UPSTREAM_PROVIDER_ONLY: 'test-provider',
    }),
  );
  assert.deepEqual(legacy.aiTiersSource, { kind: 'legacy' });
  assert.deepEqual(legacy.aiTiersWarnings, []);
  assert.equal(legacy.aiAdvertisedModel, 'vendor/test-model');
  assert.deepEqual(legacy.aiTiers.tiers.get('standard')?.routing, {
    zeroDataRetention: true,
    onlyProviders: ['test-provider'],
  });
  assert.equal(legacy.aiTiers.tiers.get('standard')?.model, 'vendor/test-model');
});

test('AI_TIERS_FILE=bundled loads the file in the image, and AI_ADVERTISED_MODEL stays the parsed override with a warning', () => {
  const bundled = parseConfig(baseEnv({ AI_TIERS_FILE: 'bundled' }));
  assert.deepEqual(bundled.aiTiersSource, { kind: 'bundled' });
  assert.deepEqual(bundled.aiTiersWarnings, []);
  assert.equal(bundled.aiAdvertisedModel, null);
  // The model comes from the file, whatever it is today: compare with the parsed file itself.
  const shipped = parseModelTiers(BUNDLED_MODEL_TIERS);
  assert.equal(bundled.aiTiers.defaultTier, shipped.defaultTier);
  assert.equal(defaultModelOf(baseEnv({ AI_TIERS_FILE: 'bundled' })), shipped.tiers.get(shipped.defaultTier)?.model);

  // CONTROL: the override replaces the default tier model, is kept as parsed, and says so once.
  const overridden = parseConfig(baseEnv({ AI_TIERS_FILE: 'bundled', AI_ADVERTISED_MODEL: 'vendor/emergency' }));
  assert.equal(overridden.aiAdvertisedModel, 'vendor/emergency');
  assert.equal(overridden.aiTiers.tiers.get('standard')?.model, 'vendor/emergency');
  assert.equal(overridden.aiTiersWarnings.length, 1);
  assert.match(overridden.aiTiersWarnings[0] ?? '', /AI_ADVERTISED_MODEL.*vendor\/emergency/);
});

test('AI_TIERS_FILE with a relative path, or a word that is not bundled, stops the boot and names the variable', () => {
  for (const value of ['ai-tiers.json', './ai-tiers.json', '../ai-tiers.json', 'Bundled', 'default']) {
    assert.throws(() => parseConfig(baseEnv({ AI_TIERS_FILE: value })), /Invalid AI_TIERS_FILE .*absolute path/, value);
  }
  // CONTROL: the same variable with a good value boots.
  assert.doesNotThrow(() => parseConfig(baseEnv({ AI_TIERS_FILE: 'bundled' })));
});

test('AI_TIERS_FILE naming a missing file stops the boot, with the path and the variable', () => {
  const missing = join(tmpdir(), 'ai-tiers-config-nowhere', 'ai-tiers.json');
  assert.throws(() => parseConfig(baseEnv({ AI_TIERS_FILE: missing })), {
    message: /^AI_TIERS_FILE .*ai-tiers-config-nowhere.* cannot be read/,
  });
  // CONTROL: the same path, once the file exists, boots.
  assert.doesNotThrow(() => parseConfig(baseEnv({ AI_TIERS_FILE: mountedFile(testTierFile()) })));
});

test('AI_TIERS_FILE with a mounted file reads it once at boot and runs on its tiers', () => {
  const path = mountedFile(testTierFile());
  const config = parseConfig(baseEnv({ AI_TIERS_FILE: path }));
  assert.deepEqual(config.aiTiersSource, { kind: 'file', path });
  assert.equal(config.aiTiers.tiers.get('standard')?.model, 'vendor/test-model');
  assert.deepEqual(config.aiTiers.tiers.get('standard')?.routing, {
    zeroDataRetention: true,
    onlyProviders: ['test-provider'],
  });
  assert.equal(config.aiAdvertisedModel, null);
});

test('a mounted file that is not JSON, or breaks a rule, stops the boot and names AI_TIERS_FILE and the rule', () => {
  const garbage = mountedFile('{ "version": 1, ');
  assert.throws(() => parseConfig(baseEnv({ AI_TIERS_FILE: garbage })), /AI_TIERS_FILE .* is not valid JSON/);

  const typo = mountedFile(testTierFile({ tiers: { standard: testTier({ modle: 'x' }) } }));
  assert.throws(
    () => parseConfig(baseEnv({ AI_TIERS_FILE: typo })),
    /AI_TIERS_FILE.*tiers\.standard.*unknown key "modle"/,
  );

  const wrongVersion = mountedFile(testTierFile({ version: 2 }));
  assert.throws(() => parseConfig(baseEnv({ AI_TIERS_FILE: wrongVersion })), /AI_TIERS_FILE.*version/);
});

test('the tier file is parsed even with no upstream key, so a typo is found on the day it is made', () => {
  const typo = mountedFile(testTierFile({ defaultTier: 'nothing' }));
  // No UPSTREAM_BASE_URL and no UPSTREAM_API_KEY in this environment.
  assert.throws(() => parseConfig(baseEnv({ AI_TIERS_FILE: typo })), /AI_TIERS_FILE.*defaultTier/);
  assert.doesNotThrow(() => parseConfig(baseEnv()));
});

test('a malformed UPSTREAM_ZDR stops the boot with a tier file too, and the message is unchanged', () => {
  assert.throws(
    () => parseConfig(baseEnv({ AI_TIERS_FILE: 'bundled', UPSTREAM_ZDR: 'yes' })),
    /Invalid UPSTREAM_ZDR: expected true, or leave it unset, got "yes"/,
  );
});

test('a routed tier dearer than the default warns at boot unless CAPABILITY_SCHEMA_MAP guards its schema', () => {
  const twoTiers = (inputUsdPerMillion: number): string =>
    testTierFile({
      routes: { speech_transcript: 'audio' },
      tiers: {
        standard: testTier(),
        audio: testTier({
          model: 'vendor/test-audio',
          routing: { zdr: false, only: [] },
          price: { ...TEST_PRICE, inputUsdPerMillion },
        }),
      },
    });
  const dear = mountedFile(twoTiers(2));
  const unguarded = parseConfig(baseEnv({ AI_TIERS_FILE: dear }));
  assert.equal(unguarded.aiTiersWarnings.length, 1);
  assert.match(unguarded.aiTiersWarnings[0] ?? '', /"audio".*"speech_transcript".*CAPABILITY_SCHEMA_MAP/);

  // CONTROLS: guarded, and not dearer, give no warning.
  const guarded = parseConfig(baseEnv({ AI_TIERS_FILE: dear, CAPABILITY_SCHEMA_MAP: 'speech_transcript:voice' }));
  assert.deepEqual(guarded.aiTiersWarnings, []);
  const cheap = parseConfig(baseEnv({ AI_TIERS_FILE: mountedFile(twoTiers(0.5)) }));
  assert.deepEqual(cheap.aiTiersWarnings, []);
});
