/**
 * The one HTML layout every letter shares (`mail-layout.ts`), asserted on the
 * letters the builders return.
 *
 * BY SHAPE, NOT BY EXACT MARKUP: a test that pinned the whole document would
 * fail on every spacing tweak and say nothing about whether the letter is
 * still the letter. These hold what a person or a mail client depends on: the
 * mark's address, the button's link and label, the absence of anything the
 * house bans, and a text part that is still plain text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityMailMessage } from '../../src/mail/activity-mail-message.js';
import { buildAccountNoticeMessage } from '../../src/mail/account-notice-message.js';
import { buildAiBudgetAlertMessage } from '../../src/mail/ai-budget-message.js';
import { buildDeclarationOperatorAlertMessage } from '../../src/mail/declaration-message.js';
import { buildInviteMessage } from '../../src/mail/invite-message.js';
import { buildLogoUrl, renderButton, renderHtmlDocument, renderLink } from '../../src/mail/mail-layout.js';
import { MAIL_PRIMARY, MAIL_WHITE } from '../../src/mail/mail-palette.js';
import { buildResetMessage } from '../../src/mail/reset-message.js';
import { buildSignupAccountNoticeMessage, buildSignupRequestMessage } from '../../src/mail/signup-message.js';
import { ACTIVITY_MAIL_KINDS } from '../../src/activity-mail/due-rules.js';
import { ACTIVITY_MAIL_STRINGS } from '../../src/mail/activity-mail-strings.js';
import { MAIL_STRINGS } from '../../src/mail/strings.js';
import { INSTANCE_LANGUAGES } from '../../src/protocol.js';

const CLIENT = 'https://app.example.org';
const SERVER = 'https://api.example.org';
const LOGO = `${CLIENT}/icons/icon-192.png`;

interface LetterCase {
  name: string;
  /** `clientBaseUrl` is what the mailer passes; `undefined` is a builder called without it. */
  build: (clientBaseUrl: string | undefined) => { html: string; text: string };
}

const declarationFields = {
  kind: 'kuendigung',
  name: 'Anna Beispiel',
  email: 'anna@example.org',
  contractReference: null,
  terminationType: null,
  reason: null,
  requestedDate: null,
  timing: null,
  receivedAt: new Date('2026-09-21T10:00:00.000Z'),
  receiptId: 'a-receipt-id',
  matched: false,
} as const;

const LETTERS: LetterCase[] = [
  ...INSTANCE_LANGUAGES.map((language): LetterCase => ({
    name: `invite ${language}`,
    build: (clientBaseUrl) =>
      buildInviteMessage({
        clientBaseUrl: clientBaseUrl ?? CLIENT,
        serverPublicUrl: SERVER,
        inviteToken: 'si_token',
        expiresAt: '2026-09-11T10:00:00.000Z',
        language,
      }),
  })),
  {
    name: 'reset',
    build: (clientBaseUrl) =>
      buildResetMessage({
        clientBaseUrl: clientBaseUrl ?? CLIENT,
        serverPublicUrl: SERVER,
        resetToken: 'sr_token',
        language: 'en',
      }),
  },
  {
    name: 'signup request',
    build: (clientBaseUrl) =>
      buildSignupRequestMessage({
        clientBaseUrl: clientBaseUrl ?? CLIENT,
        serverPublicUrl: SERVER,
        inviteToken: 'si_token',
        expiresAt: '2026-09-11T10:00:00.000Z',
        language: 'en',
        intent: { plan: null, tier: null, locale: null },
      }),
  },
  {
    name: 'signup notice',
    build: (clientBaseUrl) => buildSignupAccountNoticeMessage({ language: 'en', clientBaseUrl }),
  },
  { name: 'account notice', build: (clientBaseUrl) => buildAccountNoticeMessage({ language: 'en', clientBaseUrl }) },
  {
    name: 'ai budget',
    build: (clientBaseUrl) =>
      buildAiBudgetAlertMessage({
        limitUsd: 5,
        remainingUsd: 1,
        reset: 'weekly',
        usageDailyUsd: 0.5,
        usageMonthlyUsd: 3,
        fraction: 0.2,
        clientBaseUrl,
      }),
  },
  {
    name: 'declaration fallback',
    build: (clientBaseUrl) =>
      buildDeclarationOperatorAlertMessage({ declaration: declarationFields, template: null, clientBaseUrl }),
  },
  ...ACTIVITY_MAIL_KINDS.flatMap((kind) =>
    INSTANCE_LANGUAGES.map((language): LetterCase => ({
      name: `activity ${kind} ${language}`,
      build: (clientBaseUrl) =>
        buildActivityMailMessage({
          kind,
          days: 7,
          language,
          clientBaseUrl: clientBaseUrl ?? CLIENT,
          serverPublicUrl: SERVER,
          unsubscribeToken: '1.abc',
          isTest: false,
        }),
    })),
  ),
];

for (const letter of LETTERS) {
  test(`${letter.name}: the layout asks for a light scheme and uses nothing a mail client drops`, () => {
    const { html } = letter.build(CLIENT);
    assert.match(html, /<meta name="color-scheme" content="light">/);
    assert.match(html, /<meta name="supported-color-schemes" content="light">/);
    assert.match(html, /<table role="presentation"/);
    assert.ok(!html.includes('<style'), 'no style block to rely on');
    assert.ok(!/display:\s*(flex|grid)/.test(html), 'no flex or grid');
    assert.ok(!html.includes('var('), 'no CSS variable');
    assert.ok(!html.includes('background-image'), 'no background image');
    assert.ok(!html.includes('<svg'), 'no SVG');
  });

  test(`${letter.name}: no left accent border, and no border on one side only`, () => {
    const { html } = letter.build(CLIENT);
    assert.ok(!/border-left/.test(html));
    assert.ok(!/border-(top|right|bottom):/.test(html));
  });

  test(`${letter.name}: the wordmark is text, "open" then "plate", and the mark points at the instance's app`, () => {
    const { html } = letter.build(CLIENT);
    assert.match(html, />open<\/span><span style="color:#[0-9a-f]{6}">plate<\/span>/);
    assert.equal(
      html.split(`<img src="${LOGO}" width="32" height="32" alt="" style="display:block;border:0">`).length,
      2,
    );
  });

  test(`${letter.name}: the text part carries no markup`, () => {
    const { text } = letter.build(CLIENT);
    assert.ok(!/<[a-z!/]/i.test(text), 'the text part must stay plain text');
  });
}

test('a base URL with trailing slashes gives one slashless logo URL', () => {
  assert.equal(buildLogoUrl(`${CLIENT}///`), LOGO);
  const html = buildAccountNoticeMessage({ language: 'en', clientBaseUrl: `${CLIENT}//` }).html;
  assert.ok(html.includes(`src="${LOGO}"`));
  assert.ok(!html.includes('//icons'));
});

for (const letter of LETTERS.filter((entry) => ['signup notice', 'account notice', 'ai budget'].includes(entry.name))) {
  test(`${letter.name}: without a client base URL the header is the wordmark alone`, () => {
    const { html } = letter.build(undefined);
    assert.ok(!html.includes('<img'), 'no <img> without a base URL');
    assert.ok(html.includes('>open</span>'));
  });
}

test('the text part of an invite is the paragraphs and the link, as before the layout', () => {
  const strings = MAIL_STRINGS.en.invite;
  const message = buildInviteMessage({
    clientBaseUrl: CLIENT,
    serverPublicUrl: SERVER,
    inviteToken: 'si_token',
    expiresAt: '2026-09-11T10:00:00.000Z',
    language: 'en',
  });
  const [head, ...rest] = message.text.split('\n\n');
  assert.deepEqual([head, rest[0], rest[1]], [strings.greeting, strings.invited, strings.open]);
  assert.equal(rest[2], message.link);
  assert.equal(rest[4], strings.password);
  assert.equal(rest[5], strings.help);
});

test('an invite keeps its link as readable, breakable text in the primary colour', () => {
  const message = buildInviteMessage({
    clientBaseUrl: CLIENT,
    serverPublicUrl: SERVER,
    inviteToken: 'si_token',
    expiresAt: '2026-09-11T10:00:00.000Z',
    language: 'en',
  });
  assert.match(message.html, /<p style="word-break:break-all"><a href="[^"]+" style="color:#057a78;/);
  assert.ok(message.html.includes(`>${message.link.replace(/&/g, '&amp;')}</a>`));
});

for (const kind of ACTIVITY_MAIL_KINDS) {
  test(`activity ${kind}: the button keeps its href and label, and the text part is unchanged`, () => {
    const strings = ACTIVITY_MAIL_STRINGS.en;
    const message = buildActivityMailMessage({
      kind,
      days: 7,
      language: 'en',
      clientBaseUrl: `${CLIENT}/`,
      serverPublicUrl: SERVER,
      unsubscribeToken: '1.abc',
      isTest: true,
    });
    const label = kind === 'quiet' ? strings.quiet.button : strings.firstScan.button;
    const href = kind === 'quiet' ? CLIENT : `${CLIENT}/add/photo`;
    assert.equal(message.actionUrl, href);
    assert.ok(message.html.includes(`<a href="${href}" style="`));
    assert.ok(message.html.includes(`>${label}</a>`));
    assert.ok(message.text.includes(`${label}: ${href}`));
    assert.ok(message.text.includes(message.unsubscribeUrl));
    assert.deepEqual(Object.keys(message.headers).toSorted(), ['List-Unsubscribe', 'List-Unsubscribe-Post']);
  });

  test(`activity ${kind}: the reason and the unsubscribe link sit in a footer BELOW the card`, () => {
    const strings = ACTIVITY_MAIL_STRINGS.en;
    const { html, unsubscribeUrl } = buildActivityMailMessage({
      kind,
      days: 7,
      language: 'en',
      clientBaseUrl: CLIENT,
      serverPublicUrl: SERVER,
      unsubscribeToken: '1.abc',
      isTest: false,
    });
    const reasonAt = html.indexOf(strings.footer.reason);
    const buttonAt = html.indexOf('>' + (kind === 'quiet' ? strings.quiet.button : strings.firstScan.button) + '</a>');
    const footerLink = `<a href="${unsubscribeUrl}" style="color:${MAIL_PRIMARY};text-decoration:underline">${strings.footer.linkLabel}</a>`;
    assert.ok(reasonAt > buttonAt && buttonAt > 0);
    assert.ok(html.includes(footerLink), 'the unsubscribe link is primary and underlined');
    // The card closes before the footer starts: a `</table>` sits between them.
    assert.ok(html.slice(buttonAt, reasonAt).split('</table>').length >= 3);
  });
}

test('a letter with no footer today gets none', () => {
  const html = buildAccountNoticeMessage({ language: 'en', clientBaseUrl: CLIENT }).html;
  assert.ok(!html.includes('font-size:13px'));
});

test('renderButton is a bulletproof table button: primary ground in cell and anchor, white bold label', () => {
  const html = renderButton({ href: 'https://x.example/a?b=1&c=2', label: 'Go <now>' });
  assert.match(html, /^<table role="presentation"/);
  assert.equal(html.split(`background-color:${MAIL_PRIMARY}`).length - 1, 2, 'cell and anchor both carry the ground');
  assert.ok(html.includes(`bgcolor="${MAIL_PRIMARY}"`));
  assert.ok(html.includes(`color:${MAIL_WHITE}`));
  assert.ok(html.includes('font-weight:bold'));
  assert.ok(html.includes('padding:12px 22px'));
  assert.ok(html.includes('text-decoration:none'));
  assert.ok(html.includes('border-radius:8px'));
  assert.ok(html.includes('href="https://x.example/a?b=1&amp;c=2"'));
  assert.ok(html.includes('>Go &lt;now&gt;</a>'));
});

test('renderLink escapes the label and the address', () => {
  assert.ok(
    renderLink({ href: 'https://x.example/?a="1"', label: '<b>' }).includes(
      'href="https://x.example/?a=&quot;1&quot;"',
    ),
  );
});

test('the card is white, 560 wide at most, rounded, and fully outlined', () => {
  const html = renderHtmlDocument({ language: 'en', body: ['<p>x</p>'] });
  assert.ok(html.includes('max-width:560px'));
  assert.ok(html.includes('border:1px solid'));
  assert.ok(html.includes('border-radius:12px'));
  assert.ok(html.includes('<p>x</p>'));
});
