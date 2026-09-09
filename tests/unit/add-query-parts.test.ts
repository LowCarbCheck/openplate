/**
 * The parts chips on the /add search (M208/04).
 *
 * The defect: "Kaffee mit Hafermilch" is a real drink and no database row. As
 * one phrase it finds nothing usable, and the screen used to leave the person
 * there. Both of its foods are in the catalog, so the query is split on the
 * connector word and each part is offered as a chip.
 *
 * Every claim below is paired with a CONTROL, an input that must NOT produce
 * chips. A split rule with no control is worthless: a function that returned
 * the words of any query at all would satisfy "Kaffee mit Hafermilch yields
 * two parts" and still be wrong about every other sentence a person types.
 * The controls that matter most are the negation ("Salat ohne Hähnchen" must
 * never offer the chicken the person said they did not eat) and the confident
 * match (a search that worked gets no chips).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';

import {
  CONNECTOR_WORDS,
  DEFAULT_CONNECTOR_WORDS,
  queryPartsToOffer,
  resolveConnectorWords,
  splitQueryIntoParts,
} from '../../app/lib/query-parts';
import { QueryPartChips, SEARCH_CHIP_CLASS } from '../../app/components/add/query-part-chips';
import { hasConfidentSearchMatch, type AddSearchCandidate } from '../../app/routes/add';
import type { Macros } from '../../app/lib/macros';

function macros(): Macros {
  return { carbs: 5, fiber: 1, sugars: null, polyols: null, protein: 10, fat: 2, kcal: 80 };
}

function candidate(overrides: Partial<AddSearchCandidate> = {}): AddSearchCandidate {
  return {
    source: 'curated',
    name: 'Coffee',
    macrosPer100g: macros(),
    authoritativeNetCarbsPer100g: 4,
    defaultGrams: 100,
    defaultPortion: null,
    curatedSource: 'lowcarbcheck:coffee',
    foodId: null,
    aiEstimated: false,
    imageUrl: null,
    timesLogged: 0,
    url: null,
    attribution: null,
    matchTier: 'weak',
    ...overrides,
  };
}

describe('the connector list mirrors LowCarbCheck', () => {
  /**
   * Frozen against `apps/remix-lcc/app/lib/food-api/connectors.ts` in the
   * lowcarbcheck repository, read 2026-09-09. The two files live in different
   * repositories, so nothing but this test notices when one moves: if the
   * backend list changed, change it HERE too rather than deleting the claim.
   */
  it('holds exactly the backend words, per language', () => {
    assert.deepEqual(CONNECTOR_WORDS.de, ['mit', 'und', 'in', 'im']);
    assert.deepEqual(CONNECTOR_WORDS.en, ['with', 'and', 'in', 'of']);
  });

  it('never admits a negation, in either language', () => {
    // CONTROL for the list above: a negation changes which food is meant, so
    // it is a content word. If one ever lands in the list, this fails.
    const negations = ['ohne', 'kein', 'keine', 'without', 'no', 'free'];
    // Widened on purpose: the lists are `as const`, and a narrowed `includes`
    // would refuse the very words this test is here to look for.
    const german: readonly string[] = CONNECTOR_WORDS.de;
    const english: readonly string[] = CONNECTOR_WORDS.en;
    for (const word of negations) {
      assert.equal(german.includes(word), false, `de list admitted the negation "${word}"`);
      assert.equal(english.includes(word), false, `en list admitted the negation "${word}"`);
      assert.equal(DEFAULT_CONNECTOR_WORDS.includes(word), false, `the fallback admitted the negation "${word}"`);
    }
  });

  it('resolves a language tag to its own list, and anything else to the union', () => {
    assert.deepEqual([...resolveConnectorWords('de')].toSorted(), ['im', 'in', 'mit', 'und']);
    assert.deepEqual([...resolveConnectorWords('de-DE')].toSorted(), ['im', 'in', 'mit', 'und']);
    assert.deepEqual([...resolveConnectorWords('en-GB')].toSorted(), ['and', 'in', 'of', 'with']);
    // CONTROL: an unpopulated language must not silently become English-only.
    assert.deepEqual([...resolveConnectorWords('es')].toSorted(), [...DEFAULT_CONNECTOR_WORDS].toSorted());
    assert.deepEqual([...resolveConnectorWords(undefined)].toSorted(), [...DEFAULT_CONNECTOR_WORDS].toSorted());
  });
});

describe('splitQueryIntoParts finds the content parts', () => {
  it('splits the reported query on its connector', () => {
    assert.deepEqual(splitQueryIntoParts({ query: 'Kaffee mit Hafermilch', language: 'de' }), [
      'Kaffee',
      'Hafermilch',
    ]);
    assert.deepEqual(splitQueryIntoParts({ query: 'chicken with rice', language: 'en' }), ['chicken', 'rice']);
  });

  it('keeps the person their own spelling, including case', () => {
    assert.deepEqual(splitQueryIntoParts({ query: 'HAFERMILCH und Müsli', language: 'de' }), ['HAFERMILCH', 'Müsli']);
  });

  it('keeps a multi-word part whole', () => {
    assert.deepEqual(splitQueryIntoParts({ query: 'griechischer Joghurt mit Beeren', language: 'de' }), [
      'griechischer Joghurt',
      'Beeren',
    ]);
  });

  it('splits on every connector in the query', () => {
    assert.deepEqual(splitQueryIntoParts({ query: 'Brot mit Butter und Käse', language: 'de' }), [
      'Brot',
      'Butter',
      'Käse',
    ]);
  });

  it('offers nothing for a query with no connector at all', () => {
    // CONTROL for every claim above: without a connector there is no split to
    // make, so the whole feature stays out of the way.
    assert.deepEqual(splitQueryIntoParts({ query: 'Hafermilch', language: 'de' }), []);
    assert.deepEqual(splitQueryIntoParts({ query: 'griechischer Joghurt', language: 'de' }), []);
    assert.deepEqual(splitQueryIntoParts({ query: '', language: 'de' }), []);
    assert.deepEqual(splitQueryIntoParts({ query: '   ', language: 'de' }), []);
  });

  it('treats a negation as a content word, never as a connector', () => {
    // CONTROL, and the one that would hurt a person: splitting here would
    // offer "Hähnchen" to somebody who typed that they did not eat it.
    assert.deepEqual(splitQueryIntoParts({ query: 'Salat ohne Hähnchen', language: 'de' }), []);
    assert.deepEqual(splitQueryIntoParts({ query: 'salad without chicken', language: 'en' }), []);
    assert.deepEqual(splitQueryIntoParts({ query: 'Joghurt ohne Zucker', language: 'de' }), []);
  });

  it('matches a connector only as a whole word', () => {
    // CONTROL for the word-boundary rule: these all CONTAIN a connector as a
    // substring, and none of them is one.
    for (const query of ['Mitte Kuchen', 'Hafermilch Mittagessen', 'Indian curry', 'Undine Wasser']) {
      assert.deepEqual(splitQueryIntoParts({ query, language: 'de' }), [], `"${query}" was split`);
    }
    // And the positive case that proves the check above can fail.
    assert.deepEqual(splitQueryIntoParts({ query: 'Kuchen mit Sahne', language: 'de' }), ['Kuchen', 'Sahne']);
  });

  it('trims edge punctuation off a part', () => {
    assert.deepEqual(splitQueryIntoParts({ query: 'Kaffee, mit Hafermilch.', language: 'de' }), [
      'Kaffee',
      'Hafermilch',
    ]);
  });

  it('deduplicates parts case-insensitively', () => {
    assert.deepEqual(splitQueryIntoParts({ query: 'Reis mit Reis und Bohnen', language: 'de' }), ['Reis', 'Bohnen']);
    assert.deepEqual(splitQueryIntoParts({ query: 'Reis mit reis', language: 'de' }), []);
  });

  it('offers nothing when the connector leaves fewer than two parts', () => {
    // CONTROL: one chip would just re-run a search the person already ran.
    assert.deepEqual(splitQueryIntoParts({ query: 'mit Hafermilch', language: 'de' }), []);
    assert.deepEqual(splitQueryIntoParts({ query: 'Hafermilch mit', language: 'de' }), []);
    assert.deepEqual(splitQueryIntoParts({ query: 'a mit b', language: 'de' }), [], 'one-letter parts are unsearchable');
  });

  it('caps a long sentence at four chips', () => {
    const parts = splitQueryIntoParts({
      query: 'Brot mit Butter und Käse und Tomaten und Gurke und Ei',
      language: 'de',
    });
    assert.deepEqual(parts, ['Brot', 'Butter', 'Käse', 'Tomaten']);
  });
});

describe('queryPartsToOffer stays silent when the search worked', () => {
  it('offers the parts when the whole query found nothing confident', () => {
    assert.deepEqual(queryPartsToOffer({ query: 'Kaffee mit Hafermilch', language: 'de', hasConfidentMatch: false }), [
      'Kaffee',
      'Hafermilch',
    ]);
  });

  it('offers nothing when the whole query has a strong or likely match', () => {
    // CONTROL for the claim above, on the same input: only the flag differs.
    assert.deepEqual(queryPartsToOffer({ query: 'Kaffee mit Hafermilch', language: 'de', hasConfidentMatch: true }), []);
  });
});

describe('hasConfidentSearchMatch reads the result list', () => {
  it('is true for a strong or a likely curated match', () => {
    assert.equal(hasConfidentSearchMatch([candidate({ matchTier: 'strong' })]), true);
    assert.equal(hasConfidentSearchMatch([candidate({ matchTier: 'likely' })]), true);
  });

  it('is true for the person’s own recent or saved food, which carries no score', () => {
    assert.equal(hasConfidentSearchMatch([candidate({ source: 'recent', matchTier: null })]), true);
    assert.equal(hasConfidentSearchMatch([candidate({ source: 'custom', matchTier: null })]), true);
  });

  it('is false for a weak guess and for no results at all', () => {
    // CONTROL: without these two the predicate could return a constant true.
    assert.equal(hasConfidentSearchMatch([candidate({ matchTier: 'weak' })]), false);
    assert.equal(hasConfidentSearchMatch([candidate({ matchTier: 'weak' }), candidate({ matchTier: 'weak' })]), false);
    assert.equal(hasConfidentSearchMatch([]), false);
  });
});

/** The chip row on its own: no i18next instance, no router, no store. */
function render(parts: readonly string[]): string {
  return renderToStaticMarkup(
    createElement(QueryPartChips, { parts, label: 'Search each part instead:', onSelect: () => {} }),
  );
}

describe('the chips render as reachable buttons', () => {
  it('renders one button per part, carrying the part as its label', () => {
    const markup = render(['Kaffee', 'Hafermilch']);
    assert.equal(markup.match(/<button/g)?.length, 2, markup);
    assert.match(markup, />Kaffee</);
    assert.match(markup, />Hafermilch</);
    assert.match(markup, /Search each part instead:/);
  });

  it('renders nothing at all when there are no parts', () => {
    // CONTROL for the count above: an empty list must not leave a lead-in line
    // hanging over no chips.
    assert.equal(render([]), '');
  });

  it('uses real buttons of type button, so tab and Enter reach them', () => {
    const markup = render(['Kaffee', 'Hafermilch']);
    // A `<div role="button">` or a submit button would both defeat this: the
    // first is not keyboard reachable without extra handling, the second would
    // submit whatever form the chips end up inside.
    assert.equal(markup.includes('role="button"'), false, markup);
    assert.equal(markup.match(/type="button"/g)?.length, 2, markup);
    assert.equal(markup.includes('<a '), false, 'a chip is an action on this screen, not a link');
  });

  it('wears the same pill as the starter suggestions on the same screen', () => {
    const addSource = readFileSync(fileURLToPath(new URL('../../app/routes/add.tsx', import.meta.url)), 'utf8');
    // The starter chips now take the class from this very constant, so the two
    // rows cannot drift apart. A hand-written class list here would fail.
    assert.match(addSource, /className=\{SEARCH_CHIP_CLASS\}/);
    assert.equal(addSource.includes('min-h-9 items-center justify-center rounded-full'), false, 'chip class inlined');
    assert.equal(render(['Kaffee']).includes(SEARCH_CHIP_CLASS), true, 'the rendered chip lost the shared class');
  });
});

describe('the search step wires the chips to a real search', () => {
  const addSource = readFileSync(fileURLToPath(new URL('../../app/routes/add.tsx', import.meta.url)), 'utf8');

  it('derives the chips from the searched query, the UI language and the result list', () => {
    assert.match(
      addSource,
      /queryPartsToOffer\(\{\s*query,\s*language: i18n\.language,\s*hasConfidentMatch: hasConfidentSearchMatch\(candidates\),\s*\}\)/,
    );
  });

  it('taps a chip into the search box, which is what re-runs the search', () => {
    // `setSearchValue` is the same handle the typed input and the starter
    // chips use; the debounced effect below it navigates to `/add?q=…`.
    assert.match(addSource, /<QueryPartChips parts=\{queryParts\} label=\{t\('add\.search\.parts\.lead'\)\} onSelect=\{setSearchValue\}/);
    // …and `setSearchValue` is what the debounced effect turns into `?q=`.
    assert.match(addSource, /const trimmed = searchValue\.trim\(\);[\s\S]{0,400}params\.set\('q', trimmed\)/);
  });

  it('stays out of the way while the search is throttled', () => {
    // CONTROL against offering a split for a search that never ran: a
    // rate-limited lookup is not a no-match.
    const block = addSource.slice(addSource.indexOf('<QueryPartChips') - 200, addSource.indexOf('<QueryPartChips'));
    assert.match(block, /!throttled &&/);
  });
});

describe('the lead-in string ships in both catalogs', () => {
  const Catalog = z.looseObject({
    add: z.looseObject({ search: z.looseObject({ parts: z.looseObject({ lead: z.string() }) }) }),
  });

  function lead(locale: string): string {
    const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
    return Catalog.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8'))).add.search.parts.lead;
  }

  it('has one non-empty line per locale, and they are not the same sentence', () => {
    // Wording is wordsmith's, not this test's: the claims are that the key
    // exists, is translated, and interpolates nothing.
    assert.equal(lead('en').trim().length > 0, true);
    assert.equal(lead('de').trim().length > 0, true);
    assert.notEqual(lead('de'), lead('en'), 'the German line is still the English one');
  });

  it('takes no interpolation and carries no dash', () => {
    for (const locale of ['en', 'de']) {
      assert.doesNotMatch(lead(locale), /\{\{/, `${locale} lead interpolates a value the caller does not pass`);
      assert.doesNotMatch(lead(locale), /[–—]/, `${locale} lead carries an em or en dash`);
    }
  });
});
