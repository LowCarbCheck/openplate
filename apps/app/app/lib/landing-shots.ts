/**
 * THE OPEN LANDING'S SCREENSHOTS, in the reader's language (M266 design, step 3).
 *
 * `scripts/capture-landing.ts` drives the running app in one language and writes
 * its captures to `public/landing/<language>/`. The landing asked for
 * `/landing/en/` whatever the page's language was, so a German page showed an
 * English diary although the German captures were on disk. It now asks for the
 * reader's folder, and for English where no folder exists for that language.
 *
 * ── The folders are listed, not probed ───────────────────────────────────
 *
 * The server renders the `<img>` before any request for it is made, and the
 * client must render the same address, so the choice cannot wait for a 404. So
 * the languages whose captures exist are written down here, and
 * `tests/unit/landing-assets.test.ts` holds this list to the disk: every file
 * below, in both themes, in every folder listed. A new capture run adds its
 * language to the list in the same change as its folder.
 *
 * Pure and leaf-level: strings only, no React, no catalog.
 */
import type { LanguageCode } from '#app/i18n/language-prefs';

/** The languages with a capture folder under `public/landing/`. English first: it is the fallback. */
export const LANDING_SHOT_LANGUAGES = ['en', 'de'] as const satisfies readonly LanguageCode[];

/** A language whose captures exist. */
export type LandingShotLanguage = (typeof LANDING_SHOT_LANGUAGES)[number];

/** Every capture the open landing draws, each in a `-dark` and a `-light` twin, in every folder listed above. */
export const LANDING_SHOT_FILES = [
  'diary-mobile-dark.webp',
  'diary-mobile-light.webp',
  'diary-desktop-dark.webp',
  'diary-desktop-light.webp',
  'diary-desktop-dark-1080.webp',
  'diary-desktop-light-1080.webp',
  'scan-mobile-dark.webp',
  'scan-mobile-light.webp',
  'add-mobile-dark.webp',
  'add-mobile-light.webp',
  'overview-mobile-dark.webp',
  'overview-mobile-light.webp',
  'goals-mobile-dark.webp',
  'goals-mobile-light.webp',
  'sync-mobile-dark.webp',
  'sync-mobile-light.webp',
] as const;

/** One capture's file name. */
export type LandingShotFile = (typeof LANDING_SHOT_FILES)[number];

const SHOT_LANGUAGE_SET: ReadonlySet<LanguageCode> = new Set<LanguageCode>(LANDING_SHOT_LANGUAGES);

/** Narrows a language to one with a capture folder. */
function hasShotFolder(language: LanguageCode): language is LandingShotLanguage {
  return SHOT_LANGUAGE_SET.has(language);
}

/**
 * The folder a reader's landing draws from: their own where it exists, English otherwise.
 *
 * @param language - the language the page is drawn in.
 * @returns a language whose captures are on disk.
 */
export function landingShotLanguage(language: LanguageCode): LandingShotLanguage {
  return hasShotFolder(language) ? language : 'en';
}

/**
 * The public address of one capture.
 *
 * @param input.language - a language with a capture folder, from {@link landingShotLanguage}.
 * @param input.file - the capture.
 * @returns the root-relative URL, for example `/landing/de/diary-mobile-dark.webp`.
 */
export function landingShotUrl({ language, file }: { language: LandingShotLanguage; file: LandingShotFile }): string {
  return `/landing/${language}/${file}`;
}
