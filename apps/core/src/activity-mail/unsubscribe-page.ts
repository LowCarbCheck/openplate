/**
 * The three small HTML pages the unsubscribe link opens, as pure functions.
 *
 * NO SCRIPT, NO IMAGE, NO EXTERNAL STYLE. The confirm page is one sentence and
 * one button inside an HTML form that POSTs back to the same address, so it
 * works in every browser and every mail client's built-in viewer. The route
 * sends a Content-Security-Policy that allows exactly that.
 */
import { ACTIVITY_MAIL_STRINGS } from '../mail/activity-mail-strings.js';
import { buildUnsubscribeUrl } from '../mail/activity-mail-message.js';
import { escapeHtml } from '../mail/invite-message.js';
import type { InstanceLanguage } from '../protocol.js';

/** The page shell: a title, one paragraph or heading, and an optional form. */
function renderPage(input: { language: InstanceLanguage; title: string; body: readonly string[] }): string {
  return [
    '<!doctype html>',
    `<html lang="${input.language}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title></head>`,
    '<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:32rem;margin:3rem auto;padding:0 1rem">',
    ...input.body,
    '</body></html>',
  ].join('\n');
}

/**
 * The confirm page. GET shows it and changes nothing, because link scanners
 * open every link in a mail; only the button's POST turns reminders off.
 */
export function renderUnsubscribeConfirmPage(input: { language: InstanceLanguage; token: string }): string {
  const strings = ACTIVITY_MAIL_STRINGS[input.language].unsubscribe;
  // A RELATIVE action, the same path and token: the page is served from the
  // address the form posts to.
  const action = buildUnsubscribeUrl({ serverPublicUrl: '', token: input.token });
  return renderPage({
    language: input.language,
    title: strings.title,
    body: [
      `<h1 style="font-size:1.4rem">${escapeHtml(strings.title)}</h1>`,
      `<form method="post" action="${escapeHtml(action)}">`,
      `<button type="submit" style="font:inherit;padding:10px 18px;border:1px solid #111;border-radius:6px;background:none;color:#111;cursor:pointer">${escapeHtml(strings.button)}</button>`,
      '</form>',
    ],
  });
}

/** The page after the POST: reminders are off. */
export function renderUnsubscribeDonePage(input: { language: InstanceLanguage }): string {
  const strings = ACTIVITY_MAIL_STRINGS[input.language].unsubscribe;
  return renderPage({ language: input.language, title: strings.done, body: [`<p>${escapeHtml(strings.done)}</p>`] });
}

/** The one page for every bad link: unknown, altered or truncated token, or an account that is gone. */
export function renderUnsubscribeInvalidPage(input: { language: InstanceLanguage }): string {
  const strings = ACTIVITY_MAIL_STRINGS[input.language].unsubscribe;
  return renderPage({
    language: input.language,
    title: strings.invalid,
    body: [`<p>${escapeHtml(strings.invalid)}</p>`],
  });
}
