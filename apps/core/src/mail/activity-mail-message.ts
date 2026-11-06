/**
 * The two activity reminders, as PURE FUNCTIONS of their inputs, for the
 * reasons `invite-message.ts` gives: every link is checked by string
 * comparison, and nothing here is tempted to log what it built.
 *
 * THE UNSUBSCRIBE LINK CARRIES A TOKEN, so the letter is sent with
 * `retainBody: false` (`mailer.ts`), and the token is never logged. It is in
 * the query string rather than a fragment on purpose: the link is opened by a
 * mail client's one-click POST (RFC 8058) and by a browser, and the server has
 * to read it. What it grants is one thing, turning this account's reminders
 * off, so a copy in an access log costs the person nothing they could not
 * undo in the app.
 *
 * NO LINK ENDS IN A SLASH. The button opens `CLIENT_BASE_URL` + `/add/photo`
 * for the first-scan letter and `CLIENT_BASE_URL` itself for the quiet one,
 * each with its trailing slashes stripped.
 */
import type { ActivityMailKind } from '../activity-mail/due-rules.js';
import type { InstanceLanguage } from '../protocol.js';
import { stripTrailingSlashes } from '../lib/trailing-slashes.js';
import { ACTIVITY_MAIL_STRINGS, fillActivityMail, type ActivityMailStrings } from './activity-mail-strings.js';
import { escapeHtml, renderHtmlDocument } from './invite-message.js';

/** The path of the unsubscribe route, GET for the page and POST for the change. */
export const UNSUBSCRIBE_PATH = '/v1/mail/unsubscribe';

/** What a test letter's subject starts with. Operator-facing, so never translated. */
export const TEST_SUBJECT_PREFIX = '[Test] ';

/** The age, in days, that the first-scan letter calls "a week". */
const ONE_WEEK_IN_DAYS = 7;

export interface ActivityMailMessageInput {
  kind: ActivityMailKind;
  /** Days since sign-up (first-scan) or since the person was last seen (quiet). */
  days: number;
  language: InstanceLanguage;
  clientBaseUrl: string;
  serverPublicUrl: string;
  /** The unsubscribe token. A capability: never logged. */
  unsubscribeToken: string;
  /** An administrator's test send: the subject says so, nothing else changes. */
  isTest: boolean;
}

export interface BuiltActivityMail {
  subject: string;
  text: string;
  html: string;
  /** Where the button goes. */
  actionUrl: string;
  unsubscribeUrl: string;
  /** `List-Unsubscribe` and `List-Unsubscribe-Post`, for the one-click unsubscribe of RFC 8058. */
  headers: Record<string, string>;
}

export function buildUnsubscribeUrl(input: { serverPublicUrl: string; token: string }): string {
  return `${stripTrailingSlashes(input.serverPublicUrl)}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(input.token)}`;
}

/** Where a letter's button goes: the photo page for the first scan, the app itself for the quiet one. */
export function buildActionUrl(input: { clientBaseUrl: string; kind: ActivityMailKind }): string {
  const client = stripTrailingSlashes(input.clientBaseUrl);
  const byKind = { 'first-scan': `${client}/add/photo`, quiet: client } satisfies Record<ActivityMailKind, string>;
  return byKind[input.kind];
}

/** The letter's own subject, paragraph and button words. */
interface ReminderLetter {
  subject: string;
  paragraph: string;
  button: string;
}

/** The letter's own paragraph, subject and button words, by kind. */
function letterOf(input: { strings: ActivityMailStrings; kind: ActivityMailKind; days: number }): ReminderLetter {
  const { strings, days } = input;
  if (input.kind === 'quiet') {
    return {
      subject: strings.quiet.subject,
      paragraph: fillActivityMail(strings.quiet.body, { days }),
      button: strings.quiet.button,
    };
  }
  const joined =
    days === ONE_WEEK_IN_DAYS ? strings.firstScan.joinedWeek : fillActivityMail(strings.firstScan.joinedDays, { days });
  return {
    subject: strings.firstScan.subject,
    paragraph: `${joined} ${strings.firstScan.body}`,
    button: strings.firstScan.button,
  };
}

/**
 * PARAGRAPH ORDER: the letter's paragraph, the button, then the footer that
 * says why it arrived and how to stop it. Both parts carry every URL as
 * readable text or as an `href` of a link whose words say what it does.
 */
export function buildActivityMailMessage(input: ActivityMailMessageInput): BuiltActivityMail {
  const strings = ACTIVITY_MAIL_STRINGS[input.language];
  const letter = letterOf({ strings, kind: input.kind, days: input.days });
  const actionUrl = buildActionUrl({ clientBaseUrl: input.clientBaseUrl, kind: input.kind });
  const unsubscribeUrl = buildUnsubscribeUrl({ serverPublicUrl: input.serverPublicUrl, token: input.unsubscribeToken });
  const subject = input.isTest ? `${TEST_SUBJECT_PREFIX}${letter.subject}` : letter.subject;

  const text = [
    letter.paragraph,
    `${letter.button}: ${actionUrl}`,
    `${strings.footer.reason}\n${fillActivityMail(strings.footer.text, { link: unsubscribeUrl })}`,
  ].join('\n\n');

  const button =
    `<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:10px 18px;border:1px solid #111;` +
    `border-radius:6px;color:#111;text-decoration:none">${escapeHtml(letter.button)}</a></p>`;
  const footer =
    `<p style="font-size:13px">${escapeHtml(strings.footer.reason)} ` +
    `<a href="${escapeHtml(unsubscribeUrl)}">${escapeHtml(strings.footer.linkLabel)}</a></p>`;
  const html = renderHtmlDocument({
    language: input.language,
    body: [`<p>${escapeHtml(letter.paragraph)}</p>`, button, footer],
  });

  return {
    subject,
    text,
    html,
    actionUrl,
    unsubscribeUrl,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
