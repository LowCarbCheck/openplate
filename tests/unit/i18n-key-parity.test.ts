/**
 * Key parity between the shipped locales, over every namespace and every
 * translated language in `SUPPORTED_LANGUAGES` (M230: de, fr, it, es, tr).
 *
 * `fallbackLng: 'en'` means a missing key doesn't crash, it silently
 * renders English, which is exactly the kind of half-translated page nobody
 * notices in review and every reader of that language notices immediately.
 * There is no cloud CI on this repo (see the workspace CLAUDE.md), so this
 * test is the gate: a key added to `en/common.json` or `en/legal.json`
 * without its counterparts fails the local pre-push run.
 *
 * The assertion is one-directional on purpose, `target ⊇ en`. English is the
 * source catalog, so an extra translated key is dead weight rather than a bug,
 * and it gets its own softer check below.
 *
 * It also compares the SHAPE, not just the leaf paths: a key that is an object
 * in one locale and a string in the other is a bug i18next reports only as a
 * missing translation at runtime.
 *
 * ── THE FOUR CHECKS ARE FUNCTIONS, SO THEY CAN BE PROVEN TO FAIL ──
 * Each check returns the offending paths, the suite asserts that list is empty
 * for every namespace, and the last block hands each check a catalog pair built
 * to trip it. An assertion that cannot fail is the failure mode this repo has
 * met before (`markup.includes('disabled')`), and a parity test is the easiest
 * kind to write that way: two identical files pass every comparison.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';

/** The source catalog, which the others are checked against. */
const SOURCE = 'en';

/** Every language that is translated, which is every one that is not the source. */
const TARGETS = SUPPORTED_LANGUAGES.filter((code) => code !== SOURCE);

/** Every catalog the app ships, `app/i18n/locales/<locale>/<namespace>.json`. */
const NAMESPACES = ['common', 'legal'] as const;

/**
 * Dotted paths whose value is mandated German statutory wording (§312k and
 * §356a BGB, the Button-Lösung), not a translation gap (M214/09). For these
 * three the "English" source itself holds the same German text on purpose, so
 * it is byte-identical in every locale, including German — the SENTENCE
 * heuristic below has no way to tell "the law names this exact phrase" from
 * a copy-paste, so they are named here instead. `legal-locales.test.ts`
 * carries the fuller set (its allowlist also covers the two-word labels this
 * heuristic's length threshold never reaches).
 */
const STATUTORY_TEXT = new Set(['chrome.cancelContract', 'chrome.withdrawContract', 'declarations.cancel.title']);

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
interface Catalog {
  [key: string]: string | Catalog;
}

/** The on-disk catalog, parsed rather than asserted — a stray non-string leaf fails loudly here. */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

const leafSchema = z.string();

function loadCatalog(locale: string, namespace: string): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/${namespace}.json`, import.meta.url);
  return catalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

/** Every leaf path in the catalog, as dotted keys ("diary.hero.left"). */
function leafPaths(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const leaf = leafSchema.safeParse(value);
    return leaf.success ? [path] : leafPaths(catalogSchema.parse(value), path);
  });
}

/** The translated string at a dotted path, or `undefined` for a miss or a non-leaf. */
function read(catalog: Catalog, path: string): string | undefined {
  let node: string | Catalog | undefined = catalog;
  for (const part of path.split('.')) {
    const group = catalogSchema.safeParse(node);
    if (!group.success) return undefined;
    node = group.data[part];
  }
  const leaf = leafSchema.safeParse(node);
  return leaf.success ? leaf.data : undefined;
}

/** The `{{name}}` placeholders in a template, sorted so order can't matter. */
function placeholders(value: string): (string | undefined)[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).toSorted();
}

// ── the four checks ──────────────────────────────────────────────────────────

/** English keys the German catalog does not answer. */
function missingKeys(en: Catalog, de: Catalog): string[] {
  const dePaths = new Set(leafPaths(de));
  return leafPaths(en).filter((path) => !dePaths.has(path));
}

/** German keys with no English source string. */
function orphanKeys(en: Catalog, de: Catalog): string[] {
  const enPaths = new Set(leafPaths(en));
  return leafPaths(de).filter((path) => !enPaths.has(path));
}

/**
 * English SENTENCES sitting byte-identical in the German catalog.
 *
 * Plenty of entries are legitimately identical in both languages — proper
 * nouns (OpenRouter, Keto, Anthropic), words German borrowed outright
 * (Name, Snack, System, Admin), and templates that are nothing but
 * placeholders and punctuation ("{{where}} — {{when}}"). Flagging those
 * would make this test noise, and noise gets its threshold bumped until it
 * catches nothing.
 *
 * So the bar is a SENTENCE: three or more substantial words once the
 * placeholders are stripped. No real sentence survives translation
 * byte-identical, which makes this a zero-tolerance check on the failure it
 * actually exists to catch — someone copying `en/common.json` over `de/`
 * and calling the locale done.
 */
function untranslatedSentences(en: Catalog, de: Catalog): string[] {
  return leafPaths(en).filter((path) => {
    if (STATUTORY_TEXT.has(path)) return false;
    const source = read(en, path);
    if (source === undefined || source !== read(de, path)) return false;
    const words = source.replace(/\{\{\w+\}\}/g, ' ').match(/\p{L}{4,}/gu) ?? [];
    return words.length >= 3;
  });
}

/**
 * Keys whose `{{name}}` placeholders differ between the two languages. A
 * placeholder dropped or misspelled during translation renders the raw token to
 * the user, or silently omits the value — both invisible in an English-only
 * review.
 */
function placeholderMismatches(en: Catalog, de: Catalog): string[] {
  return leafPaths(en).filter((path) => {
    const source = read(en, path);
    const target = read(de, path);
    if (source === undefined || target === undefined) return false;
    return placeholders(source).join(',') !== placeholders(target).join(',');
  });
}

// ── over the shipped catalogs ────────────────────────────────────────────────

describe('the language list', () => {
  it('names several translated languages, so the loop below is not over an empty list', () => {
    assert.ok(TARGETS.length >= 5, `only ${TARGETS.length} translated language(s)`);
    assert.ok(TARGETS.includes('de'));
  });
});

for (const locale of TARGETS) {
  for (const namespace of NAMESPACES) {
    const en = loadCatalog(SOURCE, namespace);
    const target = loadCatalog(locale, namespace);

    describe(`${locale}/${namespace}.json`, () => {
      it('holds enough strings that the checks below are not passing on an empty file', () => {
        assert.ok(leafPaths(en).length >= 50, `${namespace}.json has ${leafPaths(en).length} English strings`);
      });

      it(`translates every English key into ${locale}, no silent English fallback`, () => {
        const missing = missingKeys(en, target);
        assert.deepEqual(
          missing,
          [],
          `Missing ${locale} translations for ${missing.length} key(s) in ${namespace}.json:\n  ${missing.join('\n  ')}`,
        );
      });

      it(`has no orphaned ${locale} keys, every one traces back to an English source string`, () => {
        const orphans = orphanKeys(en, target);
        assert.deepEqual(
          orphans,
          [],
          `${locale} keys with no English counterpart in ${namespace}.json:\n  ${orphans.join('\n  ')}`,
        );
      });

      it(`has no untranslated English SENTENCE sitting in the ${locale} catalog`, () => {
        const untranslated = untranslatedSentences(en, target);
        assert.deepEqual(
          untranslated,
          [],
          `${untranslated.length} ${locale} values in ${namespace}.json are byte-identical English sentences:\n  ${untranslated.join('\n  ')}`,
        );
      });

      it('keeps interpolation placeholders intact in every translation', () => {
        const mismatched = placeholderMismatches(en, target);
        assert.deepEqual(
          mismatched,
          [],
          `Interpolation placeholders differ between en and ${locale} in ${namespace}.json:\n  ${mismatched.join('\n  ')}`,
        );
      });
    });
  }
}

// ── the checks themselves ────────────────────────────────────────────────────

describe('the checks themselves', () => {
  const EN_BODY = 'A food diary that stays on your own device.';
  const DE_BODY = 'Ein Tagebuch, das auf deinem Gerät bleibt.';
  const DE_PRICE = '{{price}} pro {{period}}';
  const en: Catalog = {
    nav: { diary: 'Diary', fasting: 'Fasting' },
    hero: { body: EN_BODY, price: '{{price}} per {{period}}' },
  };
  const de: Catalog = {
    nav: { diary: 'Tagebuch', fasting: 'Fasten' },
    hero: { body: DE_BODY, price: DE_PRICE },
  };

  it('pass a faithful translation, so the failures below are the checks and not the fixture', () => {
    assert.deepEqual(missingKeys(en, de), []);
    assert.deepEqual(orphanKeys(en, de), []);
    assert.deepEqual(untranslatedSentences(en, de), []);
    assert.deepEqual(placeholderMismatches(en, de), []);
  });

  it('would fail on a missing key, and only in the direction en to de', () => {
    const short: Catalog = { nav: { diary: 'Tagebuch', fasting: 'Fasten' }, hero: { body: DE_BODY } };
    assert.deepEqual(missingKeys(en, short), ['hero.price']);
    assert.deepEqual(orphanKeys(en, short), []);
  });

  it('would fail on an orphaned German key, and only in the direction de to en', () => {
    const grown: Catalog = { ...de, footer: { legal: 'Impressum' } };
    assert.deepEqual(orphanKeys(en, grown), ['footer.legal']);
    assert.deepEqual(missingKeys(en, grown), []);
  });

  it('would fail on a key that is a string in one locale and a group in the other', () => {
    const collapsed: Catalog = { ...de, nav: 'Navigation' };
    assert.deepEqual(missingKeys(en, collapsed), ['nav.diary', 'nav.fasting']);
  });

  it('would fail on an English sentence left in the German catalog, and pass a short label left in it', () => {
    const copied: Catalog = { ...de, hero: { body: EN_BODY, price: DE_PRICE } };
    assert.deepEqual(untranslatedSentences(en, copied), ['hero.body']);
    const label: Catalog = { ...de, nav: { diary: 'Diary', fasting: 'Fasten' } };
    assert.deepEqual(untranslatedSentences(en, label), []);
  });

  it('would fail on a renamed placeholder and on a dropped one, and pass a moved one', () => {
    const renamed: Catalog = { ...de, hero: { body: DE_BODY, price: '{{preis}} pro {{period}}' } };
    assert.deepEqual(placeholderMismatches(en, renamed), ['hero.price']);
    const dropped: Catalog = { ...de, hero: { body: DE_BODY, price: 'pro {{period}}' } };
    assert.deepEqual(placeholderMismatches(en, dropped), ['hero.price']);
    const moved: Catalog = { ...de, hero: { body: DE_BODY, price: 'pro {{period}}: {{price}}' } };
    assert.deepEqual(placeholderMismatches(en, moved), []);
  });
});
