/**
 * The words of the moved page, in the reader's language.
 *
 * ── Why not the i18next singleton ────────────────────────────────────────
 *
 * The moved page is rendered by `server.ts` outside React Router, from a request that never reaches
 * the app's route tree, and `app/i18n/i18n.ts` initializes i18next with the browser's language
 * detector. So this reads the six shipped catalogs directly, the same files the app bundles, under
 * the `moved` key. The catalogs stay the one home of the words: `translate:ui` fills the five
 * other languages from English, and `tests/unit/i18n-key-parity.test.ts` holds them to the same
 * keys.
 *
 * ── Which language ───────────────────────────────────────────────────────
 *
 * The app's order, with one step added. The language cookie first: it is the person's own choice,
 * written by the switcher together with its `localStorage` mirror, and the only half of that pair a
 * server can read. Then the browser's `Accept-Language`, which the app does not read and this page
 * does (see `app/i18n/accept-language.ts` for why). Then `DEFAULT_UI_LANGUAGE`.
 *
 * Server only in practice (`server.ts` is its one importer), though nothing in it reads the
 * environment.
 */
import deCommon from '#app/i18n/locales/de/common.json';
import enCommon from '#app/i18n/locales/en/common.json';
import esCommon from '#app/i18n/locales/es/common.json';
import frCommon from '#app/i18n/locales/fr/common.json';
import itCommon from '#app/i18n/locales/it/common.json';
import trCommon from '#app/i18n/locales/tr/common.json';
import { pickAcceptedLanguage } from '#app/i18n/accept-language';
import { parseLanguageCookie, type LanguageCode } from '#app/i18n/language-prefs';

/** The `moved` block of one catalog: every string the page draws. */
export interface MovedCopy {
  /** The heading, and the document title. */
  readonly title: string;
  /** Where openplate is now, and that the account and the diary came along. */
  readonly body: string;
  /** The label of the one button, which opens the sign-in page at the new address. */
  readonly signIn: string;
  /** What to do with the icon on the home screen. */
  readonly homeScreen: string;
  /** The iPhone step. */
  readonly iphone: string;
  /** The Android step. */
  readonly android: string;
}

/** The six `moved` blocks. `satisfies` makes a seventh language without one a typecheck failure. */
const MOVED_CATALOGS = {
  en: enCommon.moved,
  de: deCommon.moved,
  fr: frCommon.moved,
  it: itCommon.moved,
  es: esCommon.moved,
  tr: trCommon.moved,
} satisfies Record<LanguageCode, MovedCopy>;

/** The placeholder the catalogs write where the new address's host goes. */
const HOST_PLACEHOLDER = '{{host}}';

/**
 * The language to draw the moved page in: the cookie, then `Accept-Language`, then the instance
 * default.
 *
 * @param options.cookieHeader - the request's raw `Cookie` header, or `null`.
 * @param options.acceptLanguage - the request's `Accept-Language` header, or `null`.
 * @param options.instanceDefault - `CONFIG.i18n.defaultLanguage`.
 */
export function resolveMovedPageLanguage(options: {
  cookieHeader: string | null;
  acceptLanguage: string | null;
  instanceDefault: LanguageCode;
}): LanguageCode {
  return (
    parseLanguageCookie(options.cookieHeader) ??
    pickAcceptedLanguage(options.acceptLanguage) ??
    options.instanceDefault
  );
}

/**
 * The page's words in `language`, with the new address's host written in.
 *
 * @param options.language - the language to draw.
 * @param options.host - the host of `MOVED_TO_URL`, e.g. `app.openplate.de`.
 */
export function movedPageCopy(options: { language: LanguageCode; host: string }): MovedCopy {
  const catalog = MOVED_CATALOGS[options.language];
  const withHost = (text: string): string => text.replaceAll(HOST_PLACEHOLDER, options.host);
  return {
    title: catalog.title,
    body: withHost(catalog.body),
    signIn: withHost(catalog.signIn),
    homeScreen: withHost(catalog.homeScreen),
    iphone: catalog.iphone,
    android: catalog.android,
  };
}
