/**
 * Makes a `lang` parameter the device's interface language, on the logged-out
 * screens a link can open: the landing, `/welcome`, `/sign-up` and `/sign-in`
 * (openplate.de links to `/sign-in?lang=<code>` too, M265/02). `/join`
 * reads it inside its own mount effect instead, because it must read the
 * fragment before that effect strips it. The rules are in
 * `app/i18n/language-link.ts`.
 *
 * AN EFFECT, not a render-time read: the cookie, the storage mirror and the
 * address all belong to the browser, and the server renders the document
 * before any of them can be read here.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addressWithoutLanguage,
  applyLanguageLink,
  decideLanguageLink,
  languageParamOf,
  type LanguageLinkEffects,
} from '#app/i18n/language-link';
import { writeLanguageCookie, writeStoredLanguage } from '#app/i18n/language-prefs';

/** The browser's own effects for a language link. Only call inside an effect or a handler. */
export function browserLanguageLinkEffects(): LanguageLinkEffects {
  return {
    writeCookie: writeLanguageCookie,
    writeStorage: writeStoredLanguage,
    replaceAddress: (address) => globalThis.window.history.replaceState(globalThis.window.history.state, '', address),
    reload: () => globalThis.window.location.reload(),
  };
}

export function useLanguageFromLink(): void {
  const { i18n } = useTranslation();
  const shownLanguage = i18n.resolvedLanguage ?? i18n.language;

  useEffect(() => {
    const { pathname, search, hash } = globalThis.window.location;
    const action = decideLanguageLink({
      code: languageParamOf({ search, hash }),
      shownLanguage,
      address: addressWithoutLanguage({ pathname, search, hash }),
    });
    applyLanguageLink(action, browserLanguageLinkEffects());
  }, [shownLanguage]);
}
