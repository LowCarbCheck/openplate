/**
 * i18n.ts — the shared i18next singleton.
 *
 * Every locale bundle is an inline ESM import, so they are part of the app
 * bundle: no runtime fetch, no async loading state, and — the reason it
 * matters here, the PWA keeps working fully offline in every language
 * without a separate cache entry for the translations.
 *
 * TWO NAMESPACES. `common` is the UI, loaded on every page. `legal` is the
 * long prose of the three legal routes and is kept separate so ~600 lines of
 * policy text in two languages are not carried into the bundle every page
 * downloads. Both are still inline, for the offline reason above — the split
 * is about keeping `common` honest, not about lazy loading.
 *
 * Detection is pinned to the COOKIE ONLY, which is a deliberate deviation from
 * tgl's `['cookie', 'localStorage', 'navigator']`. The server renders from
 * that same cookie and nothing else (see `app/i18n/language-prefs.ts`), so any
 * additional client-side source could resolve to a different language than the
 * markup being hydrated. `caches` is empty for the same reason: writing the
 * preference is the switcher's job (`selectLanguage`), and it is followed by a
 * full reload — the detector must never quietly persist a guess of its own.
 */
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, SUPPORTED_LANGUAGES, type LanguageCode } from './language-prefs';
import enCommon from './locales/en/common.json';
import deCommon from './locales/de/common.json';
import frCommon from './locales/fr/common.json';
import itCommon from './locales/it/common.json';
import esCommon from './locales/es/common.json';
import trCommon from './locales/tr/common.json';
import enLegal from './locales/en/legal.json';
import deLegal from './locales/de/legal.json';
import frLegal from './locales/fr/legal.json';
import itLegal from './locales/it/legal.json';
import esLegal from './locales/es/legal.json';
import trLegal from './locales/tr/legal.json';

/** A translation catalog: nested objects bottoming out in strings. */
interface Catalog {
  readonly [key: string]: string | Catalog;
}

/**
 * Every shipped catalog, keyed by language. The keys are an object literal, which no grep for a
 * language code finds, so `satisfies` is what makes a language added to `SUPPORTED_LANGUAGES`
 * without a catalog here a typecheck failure rather than a silently English UI.
 */
const RESOURCES = {
  en: { common: enCommon, legal: enLegal },
  de: { common: deCommon, legal: deLegal },
  fr: { common: frCommon, legal: frLegal },
  it: { common: itCommon, legal: itLegal },
  es: { common: esCommon, legal: esLegal },
  tr: { common: trCommon, legal: trLegal },
} satisfies Record<LanguageCode, { common: Catalog; legal: Catalog }>;

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: RESOURCES,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'common',
    ns: ['common', 'legal'],
    detection: {
      order: ['cookie'],
      lookupCookie: LANGUAGE_COOKIE,
      caches: [],
    },
    interpolation: {
      // React escapes for us.
      escapeValue: false,
    },
    react: {
      // Nothing loads asynchronously (see the module doc), so there is never a
      // suspending moment to fall back from.
      useSuspense: false,
    },
  });

export default i18next;
