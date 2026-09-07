/**
 * The goals page's protein suggestion: which method produces it, what the
 * screen says about that, and what happens when neither method can answer
 * (M200 spec 03).
 *
 * The point of the fallback is that changing the basis must cost nobody a
 * number they already had. Height and sex are both optional, and "prefer not to
 * say" stores nothing, so a person can be a legitimate, fully set-up user with
 * neither of them. That person keeps the rule this page has always used, 1.6 g
 * per kg of the latest weigh-in, and the tests below pin the exact figure that
 * rule produced before the change.
 *
 * The rest is render wiring, checked against the route source rather than a
 * browser: the chip stays a tap, the method is named next to the number, and
 * the whole block is replaced by one sentence when there is nothing to suggest.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInstance } from 'i18next';
import { z } from 'zod';

import { PROTEIN_PER_KG, suggestProteinFloor } from '../../app/models/body-metrics';

/** The copy this file makes claims about, parsed out of the shipped catalogs at read time. */
const Catalog = z.looseObject({
  goals: z.looseObject({
    protein: z.looseObject({
      basis: z.looseObject({ height: z.string(), weight: z.string() }),
      method: z.string(),
      recommended: z.string(),
      suggestionUnavailable: z.string(),
    }),
  }),
});

function loadCatalog(locale: string) {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
  return Catalog.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

const CATALOGS = { en: loadCatalog('en'), de: loadCatalog('de') };

/** A translator over one shipped catalog, so the assertions read what a user reads. */
function translatorFor(locale: 'en' | 'de') {
  const instance = createInstance();
  void instance.init({
    lng: locale,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common'],
    resources: { [locale]: { common: CATALOGS[locale] } },
    interpolation: { escapeValue: false },
  });
  // SAFETY: every key reached below is a string leaf of the catalog parsed above.
  return (key: string, params?: Record<string, string | number>): string =>
    instance.t(key, params ? { ...params } : undefined) as string;
}

const routeSource = readFileSync(
  fileURLToPath(new URL('../../app/routes/settings.goals.tsx', import.meta.url)),
  'utf8',
);

describe('the protein suggestion the goals chip offers', () => {
  it('uses height and sex when both are on file, and names that method', () => {
    const suggestion = suggestProteinFloor({ heightCm: 180, biologicalSex: 'male', latestWeighInKg: 95 });
    assert.deepEqual(suggestion, { grams: 120, method: 'height' });
  });

  it('prefers height and sex over the weigh-in, which is the whole change', () => {
    // The same person under the old rule: 1.6 x 95 kg = 152 g. The point of the
    // spec is that a protein floor must not rise with fat mass, so the two
    // numbers differ and the height one wins.
    const suggestion = suggestProteinFloor({ heightCm: 180, biologicalSex: 'male', latestWeighInKg: 95 });
    assert.ok(suggestion !== null);
    assert.notEqual(suggestion.grams, Math.round(PROTEIN_PER_KG * 95));
  });

  it('falls back to the latest weigh-in when there is no height, so nobody loses a working number', () => {
    // Today's rule, unchanged: 1.6 x 82 kg = 131.2 g, rounded to 131.
    const suggestion = suggestProteinFloor({ heightCm: null, biologicalSex: 'male', latestWeighInKg: 82 });
    assert.deepEqual(suggestion, { grams: 131, method: 'weight' });
    assert.equal(suggestion?.grams, Math.round(PROTEIN_PER_KG * 82));
  });

  it('falls back when there is no sex, the answer "prefer not to say" stores', () => {
    const suggestion = suggestProteinFloor({ heightCm: 180, biologicalSex: null, latestWeighInKg: 82 });
    assert.deepEqual(suggestion, { grams: 131, method: 'weight' });
  });

  it('falls back when the height is below the range Devine is defined for', () => {
    const suggestion = suggestProteinFloor({ heightCm: 150, biologicalSex: 'female', latestWeighInKg: 82 });
    assert.deepEqual(suggestion, { grams: 131, method: 'weight' });
  });

  it('offers nothing at all when neither method has anything to work from', () => {
    assert.equal(suggestProteinFloor({ heightCm: null, biologicalSex: null, latestWeighInKg: null }), null);
    assert.equal(suggestProteinFloor({ heightCm: 180, biologicalSex: null, latestWeighInKg: null }), null);
    assert.equal(suggestProteinFloor({ heightCm: null, biologicalSex: 'female', latestWeighInKg: null }), null);
  });

  it('offers nothing rather than a zero for a weigh-in that is not a weight', () => {
    assert.equal(suggestProteinFloor({ heightCm: null, biologicalSex: null, latestWeighInKg: 0 }), null);
    assert.equal(suggestProteinFloor({ heightCm: null, biologicalSex: null, latestWeighInKg: -5 }), null);
  });
});

describe('what the goals screen says about the number', () => {
  it('names the method and calls the number an estimate, in both languages', () => {
    for (const locale of ['en', 'de'] as const) {
      const t = translatorFor(locale);
      for (const method of ['height', 'weight'] as const) {
        const basis = t(`goals.protein.basis.${method}`);
        const line = t('goals.protein.method', { basis });
        assert.ok(basis.length > 0, `${locale}/${method}: the basis is empty`);
        assert.ok(line.includes(basis), `${locale}/${method}: the method line drops the basis`);
        assert.ok(!line.includes('{{'), `${locale}/${method}: an interpolation was left unresolved`);
      }
    }
  });

  it('says "estimate" in the English source copy, which is the claim the spec makes', () => {
    // English is hand-written and is the source of truth for the translations.
    // A rewrite that drops the word turns a suggestion back into a verdict.
    assert.match(CATALOGS.en.goals.protein.method, /estimate/i);
    assert.match(CATALOGS.en.goals.protein.recommended, /estimate/i);
  });

  it('the two bases read differently, so a change of method is visible', () => {
    for (const locale of ['en', 'de'] as const) {
      const protein = CATALOGS[locale].goals.protein;
      assert.notEqual(protein.basis.height, protein.basis.weight);
    }
  });

  it('the empty state asks for both a height and a weight, since either would do', () => {
    assert.match(CATALOGS.en.goals.protein.suggestionUnavailable, /height/i);
    assert.match(CATALOGS.en.goals.protein.suggestionUnavailable, /weight/i);
  });
});

describe('the goals route wires the suggestion up', () => {
  it('renders the method line beside the chip', () => {
    assert.ok(routeSource.includes("t('goals.protein.method'"));
    assert.ok(routeSource.includes('goals.protein.basis.${proteinSuggestion.method}'));
  });

  it('renders the empty-state sentence instead of an empty or zero chip', () => {
    assert.ok(routeSource.includes("t('goals.protein.suggestionUnavailable')"));
    // The chip and its method line only exist inside the non-null branch.
    assert.ok(routeSource.includes('{proteinSuggestion !== null ?'));
  });

  it('keeps the chip a tap: the field is only ever written from a click handler', () => {
    const writes = routeSource.match(/setProteinFloor\([^)]*proteinSuggestion[^)]*\)/g) ?? [];
    assert.equal(writes.length, 1);
    assert.ok(routeSource.includes('onClick={() => setProteinFloor(String(proteinSuggestion.grams))}'));
    // No effect is CALLED anywhere on this page, so nothing can fill the field
    // on load. The prose reference to `useEffect` in a comment is not a call.
    assert.ok(!routeSource.includes('useEffect('));
  });

  it('reads the suggestion from the pure model rather than doing arithmetic in the route', () => {
    assert.ok(routeSource.includes('suggestProteinFloor'));
    assert.ok(!routeSource.includes('PROTEIN_PER_KG'));
  });
});
