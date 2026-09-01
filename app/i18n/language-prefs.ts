/**
 * language-prefs.ts — the UI-locale preference, stored entirely on the device.
 *
 * openplate is local-first (M117): a visitor may have no account at all, and
 * the ones who do still keep their data on the device. So — unlike tgl, whose
 * pattern the rest of `app/i18n/` mirrors — there is NO server persistence
 * here: no `users.settings.language` column, no `/api/language` resource
 * route. The language is a per-device preference, like the theme.
 *
 * That leaves the cookie doing exactly ONE job: it is the only signal the
 * server can read synchronously while producing the very first byte of HTML,
 * so `app/root.tsx`'s loader parses it to stamp `<html lang>` correctly on
 * first paint. It is written by the client (the language switcher), never by
 * a server action. `localStorage` is the durable mirror — it survives cookie
 * eviction; `selectLanguage` writes both so they cannot drift.
 *
 * NOT httpOnly: the switcher and the pre-hydration i18next detector both read
 * and write it from the client.
 *
 * Client- and server-safe: plain TS, no server-only imports, no `document`
 * access at module scope; the client helpers guard `document`/`localStorage`
 * themselves so this file is import-safe under SSR.
 */

export const LANGUAGE_COOKIE = 'openplate-language';

/** Same key as the cookie so i18next's detector can use one lookup name for both. */
export const LANGUAGE_STORAGE_KEY = 'openplate-language';

/** The languages the app ships translations for. `en` is the fallback for every missing key. */
export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * The VALUE-LEVEL fallback: what a cookie, a loader payload or a function
 * argument that did not parse resolves to. Roughly 24 call sites.
 *
 * NOT the instance default. What a visitor with no cookie is served is
 * `CONFIG.i18n.defaultLanguage` (`DEFAULT_UI_LANGUAGE`, M167/01), read only by
 * `app/root.tsx`'s loader. This constant stays `'en'` and is not configurable:
 * `en` is the reference bundle, so it is also the one safe answer when the
 * real answer is unknown.
 */
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/** Native display names — a language is always named in its own language, never translated. */
export const LANGUAGE_LABELS = {
  en: 'English',
  de: 'Deutsch',
} satisfies Record<LanguageCode, string>;

/**
 * What a language value can be BEFORE it is validated: a cookie or
 * localStorage string, `null`/`undefined` when the store has nothing, or any
 * other JSON scalar a tampered/stale store can hand back. Deliberately a
 * closed set of scalars rather than `unknown` — every source is JSON-ish.
 */
export type UnvalidatedLanguage = string | number | boolean | null | undefined;

const SUPPORTED_LANGUAGE_SET: ReadonlySet<UnvalidatedLanguage> = new Set<UnvalidatedLanguage>(SUPPORTED_LANGUAGES);

export function isLanguageCode(value: UnvalidatedLanguage): value is LanguageCode {
  return SUPPORTED_LANGUAGE_SET.has(value);
}

/** 1 year — a durable per-device preference, like the theme. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function readCookieFromHeader(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * SERVER: parse the locale cookie out of a request's raw `Cookie` header.
 * Returns `null` when absent or not a supported code (tampered, or stale from
 * a removed locale) — never throws, so the caller can fall back to the default.
 */
export function parseLanguageCookie(cookieHeader: string | null): LanguageCode | null {
  const raw = readCookieFromHeader(cookieHeader, LANGUAGE_COOKIE);
  return isLanguageCode(raw) ? raw : null;
}

/**
 * SERVER: the language to render this request in.
 *
 * Two inputs, and the order between them is the whole rule: a visitor's own
 * choice (the cookie) always beats the operator's choice (the instance
 * default). `DEFAULT_UI_LANGUAGE` picks a STARTING language, never a locked
 * one — a German instance still serves English to anyone who asked for it.
 *
 * `instanceDefault` is passed in rather than imported so this file stays free
 * of `#config`, which reads `process.env` and is server-only. That keeps
 * `language-prefs.ts` importable from the browser bundle, which it has to be:
 * the switcher below lives in it.
 *
 * @param cookieHeader - the request's raw `Cookie` header, or `null`.
 * @param instanceDefault - `CONFIG.i18n.defaultLanguage`.
 */
export function resolveRequestLanguage(cookieHeader: string | null, instanceDefault: LanguageCode): LanguageCode {
  return parseLanguageCookie(cookieHeader) ?? instanceDefault;
}

/** CLIENT: read the locale cookie from `document.cookie`. SSR-safe (returns `null`). */
export function readLanguageCookie(): LanguageCode | null {
  if (globalThis.document === undefined) return null;
  return parseLanguageCookie(document.cookie);
}

/** CLIENT: write the locale cookie (1 year, `path=/`, `SameSite=Lax`). No-op on the server. */
export function writeLanguageCookie(code: LanguageCode): void {
  if (globalThis.document === undefined) return;
  document.cookie = `${LANGUAGE_COOKIE}=${code}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

/** CLIENT: read the durable localStorage mirror. Guards both SSR and a throwing/blocked storage. */
export function readStoredLanguage(): LanguageCode | null {
  if (globalThis.localStorage === undefined) return null;
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguageCode(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** CLIENT: write the durable localStorage mirror. Never throws (private mode, quota). */
export function writeStoredLanguage(code: LanguageCode): void {
  if (globalThis.localStorage === undefined) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    /* storage blocked — the cookie still carries the preference */
  }
}

/**
 * The full "user picked a language" effect, as a pure-ish function so the
 * order (persist BEFORE reload) is pinned by a unit test rather than by
 * watching a page blink.
 *
 * A change forces a FULL DOCUMENT RELOAD rather than a live
 * `i18n.changeLanguage()`: the server then re-renders from the new cookie, so
 * the document is never half-translated and SSR and client can never be live
 * in two different languages at once. The reload is cheap — everything the
 * app needs is already on the device.
 */
export function applyLanguageChange(
  code: LanguageCode,
  effects: {
    writeCookie: (code: LanguageCode) => void;
    writeStorage: (code: LanguageCode) => void;
    reload: () => void;
  },
): void {
  effects.writeCookie(code);
  effects.writeStorage(code);
  effects.reload();
}

/** Browser-wired convenience over `applyLanguageChange`. No-op on the server. */
export function selectLanguage(code: LanguageCode): void {
  if (globalThis.document === undefined) return;
  applyLanguageChange(code, {
    writeCookie: writeLanguageCookie,
    writeStorage: writeStoredLanguage,
    reload: () => window.location.reload(),
  });
}
