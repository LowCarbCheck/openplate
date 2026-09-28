/**
 * A frozen set of catalog keys whose value must NOT still be the English one,
 * in any translated language.
 *
 * WHY THIS EXISTS. `trends.range.threeMonths` shipped as the literal "3 months"
 * in de, fr, it, es and tr from the day the 90-day chart window was added. Key
 * parity did not see it: the key was present everywhere, and its value was a
 * perfectly valid string. The cause was an identity entry in each translation
 * memory (`app/i18n/memory/<locale>.json`), written by a `translate-ui --adopt`
 * run that took the placeholder English sitting in the target catalog and
 * recorded it as a hand-written translation. From then on the key was never a
 * miss again, so no run ever bought it, and the chip read "3 months" beside
 * "Woche" and "Hafta" for weeks.
 *
 * WHY A FROZEN LIST AND NOT A SWEEP. Plenty of leaves are legitimately
 * identical across languages (a unit symbol, a product name, "OK"), so a
 * blanket "no value may equal English" check would be noise. This names the
 * keys that are ordinary prose, short enough to look already-translated, and
 * therefore the ones an adopt run can quietly freeze.
 *
 * THE CHECK IS A FUNCTION so the block at the bottom can hand it a catalog
 * pair built to trip it. An assertion that cannot fail is the failure mode
 * this repo has met before.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';

/** The source catalog the others are compared against. */
const SOURCE = 'en';

/** Every language that is translated, which is every one that is not the source. */
const TARGETS = SUPPORTED_LANGUAGES.filter((code) => code !== SOURCE);

/**
 * The keys under watch, as dotted paths into `common.json`.
 *
 * The four chart-window chips sit in one strip, so one of them left in English
 * is visible beside three that are not. That is the shape of the bug this
 * guards, and freezing the whole strip rather than the single key that broke
 * means the next window added to it is covered on the day it lands.
 */
const MUST_BE_TRANSLATED = [
  'trends.range.week',
  'trends.range.twoWeeks',
  'trends.range.month',
  'trends.range.threeMonths',
];

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
interface Catalog {
  [key: string]: string | Catalog;
}

/** The on-disk catalog, parsed rather than asserted, the same way the parity suite reads one. */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

const leafSchema = z.string();

function loadCatalog(locale: string): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
  return catalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

/** The string at a dotted path, or null when the path does not reach one. */
function valueAt(catalog: Catalog, path: string): string | null {
  let here: string | Catalog | undefined = catalog;
  for (const part of path.split('.')) {
    const branch = catalogSchema.safeParse(here);
    if (!branch.success) return null;
    here = branch.data[part];
  }
  const leaf = leafSchema.safeParse(here);
  return leaf.success ? leaf.data : null;
}

/**
 * Every watched path whose target value is still the English one.
 *
 * @param english - the source catalog.
 * @param target - the catalog for one translated language.
 * @param paths - the watched dotted paths.
 * @returns the offending paths, empty when every one of them was translated.
 */
function untranslatedPaths({
  english,
  target,
  paths,
}: {
  english: Catalog;
  target: Catalog;
  paths: readonly string[];
}): string[] {
  const offenders: string[] = [];
  for (const path of paths) {
    const source = valueAt(english, path);
    const translated = valueAt(target, path);
    if (source === null || translated === null) continue;
    if (source === translated) offenders.push(path);
  }
  return offenders;
}

describe('watched catalog keys are translated, not copied from English', () => {
  const english = loadCatalog(SOURCE);

  it('names several keys, so an empty list cannot pass vacuously', () => {
    assert.ok(MUST_BE_TRANSLATED.length > 1);
    for (const path of MUST_BE_TRANSLATED) {
      assert.notEqual(valueAt(english, path), null, `${path} must exist in the English catalog`);
    }
  });

  for (const locale of TARGETS) {
    it(`${locale} translates every watched key`, () => {
      const offenders = untranslatedPaths({
        english,
        target: loadCatalog(locale),
        paths: MUST_BE_TRANSLATED,
      });
      assert.deepEqual(
        offenders,
        [],
        `${locale} still carries the English value for: ${offenders.join(', ')}. ` +
          'Check for an identity entry in app/i18n/memory/' +
          locale +
          '.json, delete it, and re-run translate:ui.',
      );
    });
  }

  it('reports a key whose target value equals the English one', () => {
    const offenders = untranslatedPaths({
      english: { trends: { range: { threeMonths: '3 months' } } },
      target: { trends: { range: { threeMonths: '3 months' } } },
      paths: ['trends.range.threeMonths'],
    });
    assert.deepEqual(offenders, ['trends.range.threeMonths']);
  });

  it('accepts a key whose target value is a real translation', () => {
    const offenders = untranslatedPaths({
      english: { trends: { range: { threeMonths: '3 months' } } },
      target: { trends: { range: { threeMonths: '3 Monate' } } },
      paths: ['trends.range.threeMonths'],
    });
    assert.deepEqual(offenders, []);
  });
});
