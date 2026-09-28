/**
 * Test harness for the trends/weight components after M129/05 string
 * extraction. Not a `*.test.ts` file, so `node --test tests/unit/**\/*.test.ts`
 * never picks it up as a suite.
 *
 * The components now render through `useTranslation()`, which resolves against
 * whatever i18next instance is in React context. These tests render with
 * `renderToStaticMarkup` (no DOM, no `I18nProvider`), so they need an instance
 * of their own — and it is built from the REAL shipped English catalog rather
 * than a fixture. That is the point: the assertions below pin actual product
 * copy, so a key renamed in a component but not in `en/common.json` fails here
 * instead of shipping a raw `trends.legend.noEntry` to a user.
 *
 * `app/i18n/i18n.ts` itself is deliberately not imported — it wires the browser
 * language detector, which wants `document`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { createInstance, type i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';

/** A nested i18next JSON catalog: leaves are copy strings, branches are namespaces. */
type TranslationCatalog = { [key: string]: string | TranslationCatalog };

/** The shipped English catalog, read from disk. */
function loadEnglishCatalog(): TranslationCatalog {
  const url = new URL('../../app/i18n/locales/en/common.json', import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

/**
 * A synchronously-initialised i18next instance holding the English catalog.
 * `init` resolves immediately here because the resources are inline — there is
 * no backend plugin to await.
 */
function createTestI18n(): I18n {
  const instance = createInstance();
  void instance.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common'],
    resources: { en: { common: loadEnglishCatalog() } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}

const testI18n = createTestI18n();

/** Wraps an element so `useTranslation()` inside it resolves real English copy. */
export function withI18n(children: ReactElement): ReactElement {
  return createElement(I18nextProvider, { i18n: testI18n }, children);
}
