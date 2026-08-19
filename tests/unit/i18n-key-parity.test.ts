/**
 * Key parity between the shipped locales.
 *
 * `fallbackLng: 'en'` means a missing German key doesn't crash — it silently
 * renders English, which is exactly the kind of half-translated page nobody
 * notices in review and every German user notices immediately. There is no
 * cloud CI on this repo (see the workspace CLAUDE.md), so this test is the
 * gate: a key added to `en/common.json` without its German counterpart fails
 * the local pre-push run.
 *
 * The assertion is one-directional on purpose — `de ⊇ en`. English is the
 * source catalog, so an extra German key is dead weight rather than a bug,
 * and it gets its own softer check below.
 *
 * It also compares the SHAPE, not just the leaf paths: a key that is an object
 * in one locale and a string in the other is a bug i18next reports only as a
 * missing translation at runtime.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
type Catalog = { [key: string]: string | Catalog };

/** The on-disk catalog, parsed rather than asserted — a stray non-string leaf fails loudly here. */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), catalogSchema])),
);

const leafSchema = z.string();

function loadCatalog(locale: string): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
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

const en = loadCatalog('en');
const de = loadCatalog('de');

describe('locale catalogs', () => {
  it('translates every English key into German — no silent English fallback', () => {
    const enPaths = leafPaths(en);
    const dePaths = new Set(leafPaths(de));
    const missing = enPaths.filter((path) => !dePaths.has(path));

    assert.deepEqual(
      missing,
      [],
      `Missing German translations for ${missing.length} key(s):\n  ${missing.join('\n  ')}`,
    );
  });

  it('has no orphaned German keys — every one traces back to an English source string', () => {
    const enPaths = new Set(leafPaths(en));
    const orphans = leafPaths(de).filter((path) => !enPaths.has(path));

    assert.deepEqual(orphans, [], `German keys with no English counterpart:\n  ${orphans.join('\n  ')}`);
  });

  it('has no untranslated English SENTENCE sitting in the German catalog', () => {
    // Plenty of entries are legitimately identical in both languages — proper
    // nouns (OpenRouter, Keto, Anthropic), words German borrowed outright
    // (Name, Snack, System, Admin), and templates that are nothing but
    // placeholders and punctuation ("{{where}} — {{when}}"). Flagging those
    // would make this test noise, and noise gets its threshold bumped until it
    // catches nothing.
    //
    // So the bar is a SENTENCE: three or more substantial words once the
    // placeholders are stripped. No real sentence survives translation
    // byte-identical, which makes this a zero-tolerance check on the failure it
    // actually exists to catch — someone copying `en/common.json` over `de/`
    // and calling the locale done.
    const untranslated = leafPaths(en).filter((path) => {
      const source = read(en, path);
      if (source === undefined || source !== read(de, path)) return false;
      const words = source.replace(/\{\{\w+\}\}/g, ' ').match(/\p{L}{4,}/gu) ?? [];
      return words.length >= 3;
    });

    assert.deepEqual(
      untranslated,
      [],
      `${untranslated.length} German values are byte-identical English sentences:\n  ${untranslated.join('\n  ')}`,
    );
  });

  it('keeps interpolation placeholders intact in every translation', () => {
    // `{{name}}` dropped or misspelled during translation renders the raw
    // token to the user, or silently omits the value — both invisible in an
    // English-only review.
    const mismatched = leafPaths(en).filter((path) => {
      const source = read(en, path);
      const target = read(de, path);
      if (source === undefined || target === undefined) return false;
      return placeholders(source).join(',') !== placeholders(target).join(',');
    });

    assert.deepEqual(mismatched, [], `Interpolation placeholders differ between en and de:\n  ${mismatched.join('\n  ')}`);
  });
});
