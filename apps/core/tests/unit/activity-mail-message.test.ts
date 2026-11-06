/**
 * The two activity reminders as built letters, and the unsubscribe pages.
 *
 * ONLY THE ENGLISH IS PINNED. The other five languages come from the
 * wordsmith pipeline, so they are held by shape: every placeholder filled,
 * every link present, no dash, no banned word, and a "week" sentence that
 * differs from the "days" one. A re-translation keeps this file green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActionUrl,
  buildActivityMailMessage,
  buildUnsubscribeUrl,
  TEST_SUBJECT_PREFIX,
  type ActivityMailMessageInput,
} from '../../src/mail/activity-mail-message.js';
import { ACTIVITY_MAIL_STRINGS } from '../../src/mail/activity-mail-strings.js';
import {
  renderUnsubscribeConfirmPage,
  renderUnsubscribeDonePage,
  renderUnsubscribeInvalidPage,
} from '../../src/activity-mail/unsubscribe-page.js';
import { ACTIVITY_MAIL_KINDS } from '../../src/activity-mail/due-rules.js';
import { INSTANCE_LANGUAGES } from '../../src/protocol.js';

const CLIENT = 'https://app.example.org';
const SERVER = 'https://api.example.org';
const TOKEN = '12.abc_DEF-ghi';

function build(overrides: Partial<ActivityMailMessageInput>): ReturnType<typeof buildActivityMailMessage> {
  return buildActivityMailMessage({
    kind: 'first-scan',
    days: 7,
    language: 'en',
    clientBaseUrl: CLIENT,
    serverPublicUrl: SERVER,
    unsubscribeToken: TOKEN,
    isTest: false,
    ...overrides,
  });
}

/** Every `https://` address in a text, as written. */
function linksIn(text: string): string[] {
  return text.match(/https:\/\/[^\s"<>]+/g) ?? [];
}

const BANNED_WORDS = ['Sync', 'sync', 'Gateway', 'gateway'];
/** The em dash and the en dash, by code point, so this file carries neither. */
const EM_DASH = String.fromCodePoint(0x2014);
const BANNED_DASHES = [EM_DASH, String.fromCodePoint(0x2013)];

test('the button goes to the photo page for first-scan and to the app itself for quiet', () => {
  assert.equal(buildActionUrl({ clientBaseUrl: CLIENT, kind: 'first-scan' }), `${CLIENT}/add/photo`);
  assert.equal(buildActionUrl({ clientBaseUrl: CLIENT, kind: 'quiet' }), CLIENT);
});

test('no link ends in a slash, even when the configured bases do', () => {
  for (const kind of ACTIVITY_MAIL_KINDS) {
    const mail = build({ kind, clientBaseUrl: `${CLIENT}/`, serverPublicUrl: `${SERVER}//` });
    const links = [...linksIn(mail.text), ...linksIn(mail.html)];
    assert.ok(links.length >= 4, `${kind}: the text and the html each carry both links`);
    for (const link of links) assert.ok(!link.endsWith('/'), `${kind}: ${link} ends in a slash`);
    assert.ok(!mail.actionUrl.endsWith('/'));
  }
  // The control: the stripping is what makes it pass, the bare base ends in one.
  assert.ok(`${CLIENT}/`.endsWith('/'));
});

test('the unsubscribe link is the server path with the token, in the headers too', () => {
  const url = buildUnsubscribeUrl({ serverPublicUrl: SERVER, token: TOKEN });
  assert.equal(url, `${SERVER}/v1/mail/unsubscribe?token=12.abc_DEF-ghi`);
  const mail = build({});
  assert.equal(mail.unsubscribeUrl, url);
  assert.deepEqual(mail.headers, {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
  assert.ok(mail.text.includes(url));
  assert.ok(mail.html.includes(`href="${url}"`));
});

test('the English first-scan letter says "a week ago" at seven days, and the number otherwise', () => {
  assert.ok(
    build({ days: 7 }).text.startsWith('You joined openplate a week ago and have not tried a plate photo yet.'),
  );
  const eight = build({ days: 8 }).text;
  assert.ok(eight.startsWith('You joined openplate 8 days ago'), eight);
  assert.ok(!eight.includes('a week'));
  assert.ok(build({ days: 3 }).text.startsWith('You joined openplate 3 days ago'));
});

test('the English letters, word for word', () => {
  const first = build({ kind: 'first-scan', days: 7 });
  assert.equal(first.subject, 'Try your first plate photo');
  assert.equal(
    first.text,
    [
      'You joined openplate a week ago and have not tried a plate photo yet. Take a photo of your next meal, and openplate works out the carbs, protein and calories for you. It takes about ten seconds.',
      `Take a photo: ${CLIENT}/add/photo`,
      `You get this email because you asked for reminders when you signed up.\nTurn off reminders: ${SERVER}/v1/mail/unsubscribe?token=${TOKEN}`,
    ].join('\n\n'),
  );
  const quiet = build({ kind: 'quiet', days: 14 });
  assert.equal(quiet.subject, 'Your diary is where you left it');
  assert.ok(
    quiet.text.startsWith('You have not opened openplate for 14 days. Log one meal today and you are back on track.'),
  );
  assert.ok(quiet.text.includes(`Open openplate: ${CLIENT}\n`));
});

test('a test send adds the prefix to the subject and changes nothing else', () => {
  const real = build({});
  const trial = build({ isTest: true });
  assert.equal(trial.subject, `${TEST_SUBJECT_PREFIX}${real.subject}`);
  assert.equal(trial.text, real.text);
  assert.equal(trial.html, real.html);
  assert.ok(!real.subject.startsWith(TEST_SUBJECT_PREFIX), 'the control: a real letter has no prefix');
});

test('every language fills every placeholder, carries both links, and has no dash or banned word', () => {
  for (const language of INSTANCE_LANGUAGES) {
    for (const kind of ACTIVITY_MAIL_KINDS) {
      for (const days of [7, 9]) {
        const mail = build({ language, kind, days });
        const whole = `${mail.subject}\n${mail.text}\n${mail.html}`;
        const name = `${language}/${kind}/${days}`;
        assert.ok(!/\{(days|link)\}/.test(whole), `${name} has an unfilled placeholder`);
        assert.ok(mail.text.includes(mail.actionUrl), `${name} lacks the button link`);
        assert.ok(mail.text.includes(mail.unsubscribeUrl), `${name} lacks the unsubscribe link`);
        assert.ok(mail.html.includes(`lang="${language}"`), `${name} is not marked as ${language}`);
        for (const word of BANNED_WORDS) assert.ok(!whole.includes(word), `${name} says "${word}"`);
        for (const dash of BANNED_DASHES) assert.ok(!whole.includes(dash), `${name} contains a dash`);
      }
    }
  }
});

test('every language has its own week sentence and states the number of days otherwise', () => {
  for (const language of INSTANCE_LANGUAGES) {
    const week = build({ language, days: 7 }).text;
    const nine = build({ language, days: 9 }).text;
    assert.notEqual(week.split('\n')[0], nine.split('\n')[0], `${language}: the week and the days sentence differ`);
    assert.ok(!week.split('\n\n')[0]?.includes('7'), `${language}: the week sentence names no number`);
    assert.ok(nine.split('\n\n')[0]?.includes('9'), `${language}: the days sentence names the number`);
    assert.ok(build({ language, kind: 'quiet', days: 21 }).text.includes('21'), `${language}: quiet names its days`);
  }
});

test('no shipped reminder string contains a dash', () => {
  const serialized = JSON.stringify(ACTIVITY_MAIL_STRINGS);
  for (const dash of BANNED_DASHES) assert.ok(!serialized.includes(dash));
  // The control: the check sees a dash when there is one.
  assert.ok(`${serialized}${EM_DASH}`.includes(EM_DASH));
});

test('the confirm page posts to the same relative address and carries the token once', () => {
  const page = renderUnsubscribeConfirmPage({ language: 'en', token: TOKEN });
  assert.ok(page.includes(`<form method="post" action="/v1/mail/unsubscribe?token=${TOKEN}">`));
  assert.ok(page.includes('Turn off reminder emails?'));
  assert.equal(page.split(TOKEN).length - 1, 1);
});

test('the pages encode the token they print, and every language renders all three', () => {
  const hostile = '1.<script>';
  const page = renderUnsubscribeConfirmPage({ language: 'en', token: hostile });
  assert.ok(!page.includes('<script>'));
  // Encoded into the query, so nothing of it reaches the markup as a tag.
  assert.ok(page.includes('token=1.%3Cscript%3E'));
  // The control: the same render with a plain token does carry it verbatim.
  assert.ok(renderUnsubscribeConfirmPage({ language: 'en', token: TOKEN }).includes(`token=${TOKEN}`));
  for (const language of INSTANCE_LANGUAGES) {
    for (const html of [
      renderUnsubscribeConfirmPage({ language, token: TOKEN }),
      renderUnsubscribeDonePage({ language }),
      renderUnsubscribeInvalidPage({ language }),
    ]) {
      assert.ok(html.includes(`lang="${language}"`), language);
      for (const dash of BANNED_DASHES) assert.ok(!html.includes(dash), `${language} page has a dash`);
    }
  }
});
