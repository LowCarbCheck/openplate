/**
 * The one HTML layout every letter shares: a branded card on a tinted page,
 * with the mark and wordmark on top, the letter's body inside, and an optional
 * footer below the card.
 *
 * EMAIL-SAFE ON PURPOSE. Mail clients ignore most of modern CSS, so the layout
 * is tables with inline styles only: no `<style>` block to rely on, no flex or
 * grid, no CSS variable, no web font, no SVG and no background image. The
 * colours are hex because a client cannot read the app's HSL triples; they
 * live in `mail-palette.ts` and nowhere else.
 *
 * NO LEFT ACCENT BORDER, anywhere: the card has rounded corners, and a thick
 * left border on a rounded box is a house ban.
 *
 * Changing a letter's WORDS is not this file's business. It wraps what it is
 * given.
 */
import type { InstanceLanguage } from '../protocol.js';
import { stripTrailingSlashes } from '../lib/trailing-slashes.js';
import {
  MAIL_BORDER,
  MAIL_MUTED_TEXT,
  MAIL_PAGE_BACKGROUND,
  MAIL_PRIMARY,
  MAIL_TEXT,
  MAIL_WHITE,
} from './mail-palette.js';

/** Where the app serves the 192 pixel mark, below the instance's own client URL. */
const LOGO_PATH = '/icons/icon-192.png';

/** The mark's edge in pixels, in the markup and in the style. */
const LOGO_SIZE = 32;

const FONT_STACK = `-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

const TABLE_RESET = 'role="presentation" cellspacing="0" cellpadding="0" border="0"';

/**
 * Minimal escaping for the values interpolated into the HTML part.
 *
 * Not a general-purpose sanitiser and it does not need to be: the only sinks
 * are element text and an `href` or `src` this module built itself.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The mark's absolute URL on the instance's own app. Never a double slash. */
export function buildLogoUrl(clientBaseUrl: string): string {
  return `${stripTrailingSlashes(clientBaseUrl)}${LOGO_PATH}`;
}

/** A link in the app's primary colour, underlined. The label is escaped here. */
export function renderLink(input: { href: string; label: string }): string {
  return `<a href="${escapeHtml(input.href)}" style="color:${MAIL_PRIMARY};text-decoration:underline">${escapeHtml(input.label)}</a>`;
}

/**
 * A "bulletproof" button: a table cell that carries the colour, with the
 * anchor inside carrying it too, so the whole pill is clickable and survives a
 * client that drops padding from an inline anchor.
 */
export function renderButton(input: { href: string; label: string }): string {
  const ground = `background-color:${MAIL_PRIMARY};border-radius:8px`;
  const anchor =
    `display:inline-block;padding:12px 22px;${ground};color:${MAIL_WHITE};font-family:${FONT_STACK};` +
    'font-size:16px;font-weight:bold;line-height:1.5;text-decoration:none';
  return (
    `<table ${TABLE_RESET} style="margin:8px 0 16px"><tr>` +
    `<td align="center" bgcolor="${MAIL_PRIMARY}" style="${ground}">` +
    `<a href="${escapeHtml(input.href)}" style="${anchor}">${escapeHtml(input.label)}</a>` +
    '</td></tr></table>'
  );
}

/** The mark (when the instance's app URL is known) beside the two-colour wordmark, which is text. */
function renderHeader(clientBaseUrl: string | undefined): string {
  const logo =
    clientBaseUrl === undefined
      ? ''
      : `<td valign="middle" style="padding-right:10px;vertical-align:middle">` +
        `<img src="${escapeHtml(buildLogoUrl(clientBaseUrl))}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" alt="" style="display:block;border:0">` +
        '</td>';
  const wordmark =
    `<td valign="middle" style="vertical-align:middle;font-family:${FONT_STACK};font-size:20px;font-weight:bold;line-height:${LOGO_SIZE}px">` +
    `<span style="color:${MAIL_PRIMARY}">open</span><span style="color:${MAIL_TEXT}">plate</span></td>`;
  return `<table ${TABLE_RESET} style="margin:0 0 24px"><tr>${logo}${wordmark}</tr></table>`;
}

function renderFooter(footer: string | undefined): string {
  if (footer === undefined) return '';
  return (
    `<table ${TABLE_RESET} width="100%" align="center" style="max-width:560px;margin:0 auto"><tr>` +
    `<td align="center" style="padding:16px 24px 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${MAIL_MUTED_TEXT};text-align:center">` +
    `${footer}</td></tr></table>`
  );
}

export interface HtmlDocumentInput {
  language: InstanceLanguage;
  /** ALREADY-ESCAPED markup, one element per entry. */
  body: readonly string[];
  /**
   * The instance's own app, from `CLIENT_BASE_URL`. With it the header carries
   * the mark; without it the header is the wordmark alone.
   */
  clientBaseUrl?: string | undefined;
  /** ALREADY-ESCAPED inline markup for the line below the card. Omitted: no footer. */
  footer?: string | undefined;
}

/**
 * The document shell every letter shares. `body` and `footer` are
 * ALREADY-ESCAPED markup; this function adds nothing a caller could inject
 * into, only the language attribute, which is one of `InstanceLanguage`'s
 * literals, and the mark's URL, which is escaped.
 */
export function renderHtmlDocument(input: HtmlDocumentInput): string {
  const card =
    `<table ${TABLE_RESET} width="100%" align="center" bgcolor="${MAIL_WHITE}" ` +
    `style="max-width:560px;margin:0 auto;background-color:${MAIL_WHITE};border:1px solid ${MAIL_BORDER};border-radius:12px;border-collapse:separate"><tr>` +
    `<td style="padding:32px 24px;font-family:${FONT_STACK};font-size:16px;line-height:1.5;color:${MAIL_TEXT}">`;
  return [
    '<!doctype html>',
    `<html lang="${input.language}"><head>`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    '</head>',
    `<body style="margin:0;padding:0;background-color:${MAIL_PAGE_BACKGROUND}">`,
    `<table ${TABLE_RESET} width="100%" bgcolor="${MAIL_PAGE_BACKGROUND}" style="background-color:${MAIL_PAGE_BACKGROUND}"><tr>`,
    `<td align="center" style="padding:24px 12px">`,
    card,
    renderHeader(input.clientBaseUrl),
    ...input.body,
    '</td></tr></table>',
    renderFooter(input.footer),
    '</td></tr></table>',
    '</body></html>',
  ].join('\n');
}
