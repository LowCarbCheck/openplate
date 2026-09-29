/**
 * The app language the page is drawn in, as a code.
 *
 * For a component that picks a URL by language (a project site page, a
 * screenshot folder). It reads i18next, which the root loader has already set
 * to the request's language on the server and to the same language on the
 * client, so the server markup and the hydrated page agree.
 */
import { useTranslation } from 'react-i18next';

import { toLanguageCode, type LanguageCode } from '#app/i18n/language-prefs';

export function useReaderLanguage(): LanguageCode {
  const { i18n } = useTranslation();
  return toLanguageCode(i18n.resolvedLanguage ?? i18n.language);
}
