/**
 * The screen glossary the UI translator sends, and the report that asks whether it was kept.
 *
 * ── THE NAMES ARE READ, NEVER TYPED ──
 * Every per-locale case below reads `app/i18n/locales/<locale>/common.json` off disk and asserts
 * the glossary line carries that file's own value. Nothing here writes a German, French, Italian,
 * Spanish or Turkish screen name into the test: a test that typed them would pass on its own copy
 * while the catalog said something else, which is the defect the glossary exists to stop. The
 * locales come from `SUPPORTED_LANGUAGES` minus `SOURCE_LANGUAGE`, so a sixth language is covered
 * the day it is added.
 *
 * ── THE LINE IS ASSERTED WHOLE, NOT AS A SUBSTRING ──
 * The pair is checked as the exact prefix `  <en> -> <target> (` of the ONE line that ends in that
 * key, not as a substring of the joined prompt. One English name stands for two screens and some
 * languages give both the same word, so a substring check over the joined prompt would pass on
 * either line and prove nothing about the one under test.
 *
 * ── THE CONTROLS ──
 * The cases marked CONTROL mutate the input and assert the check notices: a dropped key stops being
 * named and is counted as missing, a changed value stops matching the line, a lead that misses the
 * catalog's word is reported and the same lead carrying it is not. The mechanism cases use a
 * stand-in catalog whose values are no language's, so passing them cannot depend on a real name.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolve } from 'node:path';

import { SOURCE_LANGUAGE } from '../../scripts/lib/translate-bundles';
import { type Memo, type Memory } from '../../scripts/lib/translate-shims/docs-i18n.server';
import { type CatalogTree, catalogPath, leaves, readCatalog } from '../../scripts/lib/translate-ui';
import { SCREEN_KEYS, SCREEN_NAMESPACE, screenGlossary, screenOffenders } from '../../scripts/translate-glossary';
import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';

const ROOT = resolve(import.meta.dirname, '../..');

/** Every language whose catalog is translated, which is every one the glossary must serve. */
const TARGETS = SUPPORTED_LANGUAGES.filter((language) => language !== SOURCE_LANGUAGE);

function commonOf(locale: string): CatalogTree {
  return readCatalog(catalogPath(ROOT, locale, SCREEN_NAMESPACE));
}

/** One catalog value by its dotted key, refusing a missing one rather than asserting on `undefined`. */
function nameOf(tree: CatalogTree, key: string): string {
  const found = leaves(tree).find((leaf) => leaf.key === key);
  assert.ok(found !== undefined, `${key} is missing from the catalog under test`);
  return found.value;
}

/** The one glossary line that names a key, or `undefined` when no line does. */
function lineFor(lines: readonly string[], key: string): string | undefined {
  return lines.find((line) => line.endsWith(`, ${key})`));
}

/** One memory entry as a run writes it: the English, the path it was bought under, and the answer. */
function lead(entry: { en: string; path: string; fr: string }): Memo {
  return { en: entry.en, path: entry.path, model: 'google/gemini-3.8-flash', at: '2026-09-20', fr: entry.fr };
}

const ENGLISH = commonOf(SOURCE_LANGUAGE);

/**
 * A stand-in for both catalogs, with values no language uses, so a case that passes here passed on
 * the mechanism. `dashboard.title` and `trends.tabs.overview` share one English name and take two
 * target names, which is the real shape of "Overview" in French.
 */
const STAND_IN_EN: CatalogTree = {
  nav: { trends: 'Alpha', pantry: 'Bravo' },
  dashboard: { title: 'Charlie' },
  about: { title: 'Delta' },
  add: { custom: { title: 'Echo' } },
  trends: { tabs: { overview: 'Charlie', nutrition: 'Foxtrot', meals: 'Golf', goals: 'Hotel' } },
};

const STAND_IN_TARGET: CatalogTree = {
  nav: { trends: 'Alphaziel', pantry: 'Bravoziel' },
  dashboard: { title: 'Charliezwei' },
  about: { title: 'Deltaziel' },
  add: { custom: { title: 'Echoziel' } },
  trends: { tabs: { overview: 'Charlievier', nutrition: 'Foxtrotziel', meals: 'Golfziel', goals: 'Hotelziel' } },
};

describe('the screens the glossary names', () => {
  it('is the nine keys a release lead can name', () => {
    assert.deepEqual(
      [...SCREEN_KEYS].toSorted((a, b) => (a < b ? -1 : 1)),
      [
        'about.title',
        'add.custom.title',
        'dashboard.title',
        'nav.pantry',
        'nav.trends',
        'trends.tabs.goals',
        'trends.tabs.meals',
        'trends.tabs.nutrition',
        'trends.tabs.overview',
      ],
    );
  });

  it('names every one of them in the English catalog this repo ships', () => {
    for (const key of SCREEN_KEYS) assert.ok(nameOf(ENGLISH, key) !== '', `${key} is empty in the English catalog`);
  });
});

for (const locale of TARGETS) {
  describe(`the ${locale} glossary`, () => {
    const target = commonOf(locale);
    const glossary = screenGlossary({ english: ENGLISH, target });

    it('gives every screen the value that catalog holds, and nothing typed here', () => {
      for (const key of SCREEN_KEYS) {
        const lines = glossary.lines.filter((line) => line.endsWith(`, ${key})`));
        assert.equal(lines.length, 1, `${locale}: ${key} is named ${lines.length} times`);
        assert.ok(
          lines[0].startsWith(`  ${nameOf(ENGLISH, key)} -> ${nameOf(target, key)} (`),
          `${locale}: ${key} reads ${lines[0]}`,
        );
      }
    });

    it('counts all nine as named, and says which screen each line is', () => {
      assert.equal(glossary.named, SCREEN_KEYS.length);
      assert.equal(glossary.of, SCREEN_KEYS.length);
      assert.equal(glossary.lines.filter((line) => line.startsWith('  ')).length, SCREEN_KEYS.length);
    });

    it('tells the model to use them and nothing else', () => {
      assert.ok(glossary.lines.at(-1)?.includes('never a synonym'), glossary.lines.at(-1));
    });
  });
}

describe('a key the catalogs disagree about', () => {
  it('CONTROL: a key dropped from the target is skipped, counted, and its line is gone', () => {
    const short: CatalogTree = { ...STAND_IN_TARGET, dashboard: {} };
    const glossary = screenGlossary({ english: STAND_IN_EN, target: short });

    assert.equal(glossary.named, SCREEN_KEYS.length - 1);
    assert.equal(glossary.of, SCREEN_KEYS.length);
    assert.deepEqual(
      glossary.lines.filter((line) => line.endsWith(', dashboard.title)')),
      [],
    );
    // The other screen with the same English name is untouched, so the skip is per key.
    assert.equal(glossary.lines.filter((line) => line.endsWith(', trends.tabs.overview)')).length, 1);
  });

  it('CONTROL: a changed target value changes the line, so the per-locale check can go red', () => {
    const whole = screenGlossary({ english: STAND_IN_EN, target: STAND_IN_TARGET });
    const edited: CatalogTree = { ...STAND_IN_TARGET, nav: { trends: 'Etwasanderes', pantry: 'Bravoziel' } };
    const after = screenGlossary({ english: STAND_IN_EN, target: edited });

    assert.equal(lineFor(whole.lines, 'nav.trends'), '  Alpha -> Alphaziel (the charts screen, nav.trends)');
    assert.equal(lineFor(after.lines, 'nav.trends'), '  Alpha -> Etwasanderes (the charts screen, nav.trends)');
    assert.notEqual(lineFor(after.lines, 'nav.trends'), lineFor(whole.lines, 'nav.trends'));
  });

  it('throws and names the key when the English catalog lost it', () => {
    const renamed: CatalogTree = { ...STAND_IN_EN, about: { heading: 'Delta' } };
    assert.throws(() => screenGlossary({ english: renamed, target: STAND_IN_TARGET }), /about\.title/);
  });

  it('throws when the key a tab sits inside is gone, which its own line and four others need', () => {
    const renamed: CatalogTree = { ...STAND_IN_EN, nav: { charts: 'Alpha', pantry: 'Bravo' } };
    assert.throws(() => screenGlossary({ english: renamed, target: STAND_IN_TARGET }), /nav\.trends/);
  });

  it('gives an untranslated locale no lines at all rather than English ones', () => {
    assert.deepEqual(screenGlossary({ english: STAND_IN_EN, target: {} }), {
      lines: [],
      named: 0,
      of: SCREEN_KEYS.length,
    });
  });
});

describe('the report over the remembered release leads', () => {
  const FRENCH = commonOf('fr');
  const insights = nameOf(ENGLISH, 'nav.trends');
  const overview = nameOf(ENGLISH, 'dashboard.title');
  const analyses = nameOf(FRENCH, 'nav.trends');
  const home = nameOf(FRENCH, 'dashboard.title');
  const tab = nameOf(FRENCH, 'trends.tabs.overview');

  const MEMORY: Memory = {
    missed: lead({
      en: `The ${insights} charts and their filters fit a phone.`,
      path: 'releases:v0_36_0.fixed.13',
      fr: 'Les graphiques Statistiques et leurs filtres tiennent sur un téléphone.',
    }),
    kept: lead({
      en: `The ${insights} charts and their filters fit a phone.`,
      path: 'releases:v0_35_0.fixed.01',
      fr: `Les graphiques ${analyses} et leurs filtres tiennent sur un téléphone.`,
    }),
    tabbed: lead({
      en: `The ${overview} tab now opens on the day you were reading.`,
      path: 'releases:v0_35_0.added.01',
      fr: `L'onglet ${tab} s'ouvre maintenant sur le jour que tu lisais.`,
    }),
    homed: lead({
      en: `The ${overview} screen now counts your streak.`,
      path: 'releases:v0_35_0.added.02',
      fr: `L'écran ${home} compte maintenant ta série.`,
    }),
    curly: lead({
      en: `The ${overview} screen now counts your streak.`,
      path: 'releases:v0_35_0.added.03',
      fr: `L'écran ${home.replaceAll("'", '’')} compte maintenant ta série.`,
    }),
    neither: lead({
      en: `The ${overview} screen now counts your streak.`,
      path: 'releases:v0_35_0.added.04',
      fr: 'Le panneau général compte maintenant ta série.',
    }),
    elsewhere: lead({
      en: `The ${insights} charts and their filters fit a phone.`,
      path: 'common:trends.empty.body',
      fr: 'Les graphiques Statistiques et leurs filtres tiennent sur un téléphone.',
    }),
    lowercase: lead({
      en: 'Your pantry now follows you to your other devices.',
      path: 'releases:v0_36_0.changed.02',
      fr: 'Ton placard te suit maintenant sur tes autres appareils.',
    }),
  };

  const reported = screenOffenders({ memory: MEMORY, locale: 'fr', english: ENGLISH, target: FRENCH })
    .map((offender) => offender.hash)
    .toSorted((a, b) => (a < b ? -1 : 1));

  it('CONTROL: reports the lead that answers a screen with another word, and not the one that keeps it', () => {
    assert.ok(reported.includes('missed'), 'a lead that drops the catalog word is not reported');
    assert.ok(!reported.includes('kept'), 'a lead that carries the catalog word is reported');
  });

  it('leaves an ambiguous English name alone when either screen answers it', () => {
    assert.ok(!reported.includes('tabbed'), 'the tab name was taken for a miss');
    assert.ok(!reported.includes('homed'), 'the home screen name was taken for a miss');
    assert.ok(!reported.includes('curly'), 'a typographic apostrophe was taken for a miss');
    assert.ok(reported.includes('neither'), 'a lead with neither name was not reported');
  });

  it('reads the releases namespace only, and a lower-case noun is not a screen', () => {
    assert.ok(!reported.includes('elsewhere'), 'a common.json string was read as a release lead');
    assert.ok(!reported.includes('lowercase'), 'a lower-case noun was read as a screen name');
  });

  it('reports exactly those two, so a new flag is a change somebody chose', () => {
    assert.deepEqual(reported, ['missed', 'neither']);
  });

  it('names the hash, the path and every name that would have answered', () => {
    const offenders = screenOffenders({ memory: MEMORY, locale: 'fr', english: ENGLISH, target: FRENCH });
    const flagged = offenders.find((offender) => offender.hash === 'neither');
    assert.ok(flagged !== undefined);
    assert.equal(flagged.path, 'releases:v0_35_0.added.04');
    assert.equal(flagged.screen, overview);
    assert.deepEqual(
      flagged.expected.toSorted((a, b) => (a < b ? -1 : 1)),
      [home, tab].toSorted((a, b) => (a < b ? -1 : 1)),
    );
  });

  it('says nothing about a locale whose catalog names no screen yet', () => {
    assert.deepEqual(screenOffenders({ memory: MEMORY, locale: 'fr', english: ENGLISH, target: {} }), []);
  });
});
