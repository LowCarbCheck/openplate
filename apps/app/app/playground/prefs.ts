/**
 * The playground's three page controls, and where they are kept.
 *
 * Theme, language and width are remembered in `localStorage` under
 * `openplate-playground:*`. The app's own keys (`theme`, the language cookie)
 * are never read or written here, so opening the playground changes nothing
 * about the app on the same browser.
 *
 * Plain functions, no React: `app.tsx` holds the state and calls these.
 */
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type LanguageCode } from '#app/i18n/language-prefs';

/** The theme choices. `system` follows the operating system, as the app's own control does. */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The width choices. `phone` puts each card's stage in a 375 px frame. */
export const WIDTH_CHOICES = ['phone', 'full'] as const;
export type WidthChoice = (typeof WIDTH_CHOICES)[number];

/** The width of the phone frame, in CSS pixels. */
export const PHONE_FRAME_PX = 375;

/** The storage keys. One prefix, so a person can clear exactly these. */
export const PREF_KEYS = {
  theme: 'openplate-playground:theme',
  language: 'openplate-playground:language',
  width: 'openplate-playground:width',
} as const;

/** The value in storage, or null where storage is missing or refuses (private mode, a test, a server render). */
function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Writes a value and ignores a refusal: a control that cannot be remembered still works. */
function writeStored({ key, value }: { key: string; value: string }): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage is full or blocked. The choice holds for this visit only.
  }
}

/**
 * The saved choice if it is one of the allowed values, else the fallback.
 *
 * `find` hands back the allowed value itself, so the result is typed without
 * a cast and a tampered or stale entry can only fall through to the fallback.
 */
function pickAllowed<Choice extends string>({
  allowed,
  stored,
  fallback,
}: {
  allowed: readonly Choice[];
  stored: string | null;
  fallback: Choice;
}): Choice {
  return allowed.find((choice) => choice === stored) ?? fallback;
}

/** The saved theme, `system` when there is none. */
export function readThemeChoice(): ThemeChoice {
  return pickAllowed({ allowed: THEME_CHOICES, stored: readStored(PREF_KEYS.theme), fallback: 'system' });
}

/** The saved language, English when there is none. */
export function readLanguageChoice(): LanguageCode {
  return pickAllowed({ allowed: SUPPORTED_LANGUAGES, stored: readStored(PREF_KEYS.language), fallback: DEFAULT_LANGUAGE });
}

/** The saved width, full when there is none. */
export function readWidthChoice(): WidthChoice {
  return pickAllowed({ allowed: WIDTH_CHOICES, stored: readStored(PREF_KEYS.width), fallback: 'full' });
}

/** Remembers the theme. */
export function saveThemeChoice(choice: ThemeChoice): void {
  writeStored({ key: PREF_KEYS.theme, value: choice });
}

/** Remembers the language. */
export function saveLanguageChoice(choice: LanguageCode): void {
  writeStored({ key: PREF_KEYS.language, value: choice });
}

/** Remembers the width. */
export function saveWidthChoice(choice: WidthChoice): void {
  writeStored({ key: PREF_KEYS.width, value: choice });
}

/** True when the theme choice paints dark right now. `system` asks the operating system. */
export function isDarkTheme(choice: ThemeChoice): boolean {
  if (choice === 'dark') return true;
  if (choice === 'light') return false;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * Paints the theme the way `app/root.tsx`'s inline script does: toggle the
 * `dark` class on `<html>`, then fire `themechange` so `useResolvedTheme`
 * readers (the charts) follow. The event name and detail are that hook's.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  const isDark = isDarkTheme(choice);
  document.documentElement.classList.toggle('dark', isDark);
  window.dispatchEvent(new CustomEvent('themechange', { detail: isDark ? 'dark' : 'light' }));
}
