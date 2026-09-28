/**
 * The export's sentences, resolved from the SHIPPED English catalog (M161/05).
 *
 * `RESEARCH_EXPORT_STRINGS` used to be an object in `research/export.ts`, so
 * the tests that assert what a researcher reads could import it. The wording
 * moved into the `research` i18n namespace, and this harness is what keeps
 * those assertions honest: it renders the real catalog through real i18next
 * interpolation, so a key that stops resolving fails the assertion instead of
 * quietly printing the key.
 *
 * Deliberately NOT a stub translator. A key-echo double would keep every
 * sentence assertion green while the shipped file said nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInstance } from 'i18next';
import { z } from 'zod';

import {
  buildResearchExportStrings,
  type ResearchExportStrings,
  type Translate,
} from '../../app/lib/sync/research/export';

/**
 * The shipped catalog, with the two groups this harness needs NAMED so a
 * rename fails here at import. `looseObject` keeps every other key, so the
 * same parsed value is i18next's whole resource bundle.
 */
const EnglishCatalog = z.looseObject({
  research: z.looseObject({ export: z.looseObject({}), anomaly: z.looseObject({}) }),
});

const englishCatalog = EnglishCatalog.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
);

/** Translator over the real shipped English catalog. */
export const englishT: Translate = (() => {
  const instance = createInstance();
  void instance.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common'],
    resources: { en: { common: englishCatalog } },
    interpolation: { escapeValue: false },
  });
  // SAFETY: every key reached here is a leaf of the catalog parsed above, and
  // i18next returns the interpolated string for a string-valued leaf.
  return (key, params) => instance.t(key, params ? { ...params } : undefined) as string;
})();

/** The export's strings in English — what a researcher opening the file actually reads. */
export const englishExportStrings: ResearchExportStrings = buildResearchExportStrings(englishT);
