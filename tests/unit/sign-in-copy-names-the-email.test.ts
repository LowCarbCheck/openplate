/**
 * SYNC'S SIGN-IN COPY MAY NOT SPEAK OF A "SIGN-IN NAME" OR A USERNAME.
 *
 * There are no handles here: the server knows an account only by its email
 * address, and `canonicalizeEmail` lowercases it before it ever leaves the
 * browser. `sync.signIn.failed` used to read "Check the sign-in name and
 * password", wording left over from an era when accounts had a chosen name,
 * and it told nobody that letter case in the address does not matter. This
 * file pins the fix and stops the old wording, or its German twins, from
 * reappearing under `sync.signIn`, `sync.signOut` or `sync.recover`. The
 * last two no longer exist as of this pass, since every key under them was
 * unreferenced and was deleted along with its now-empty parent, but the sweep
 * stays scoped to all three in case one is reintroduced.
 *
 * The flatten helper is the same shape `shipped-copy-no-dash.test.ts` and
 * `managed-copy-bans.test.ts` already use; this file does not import theirs,
 * following the house convention of a small local copy per sweep rather than
 * a shared utility module.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
type Catalog = { [key: string]: string | Catalog };

const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));
const leafSchema = z.string();

function loadCatalog(locale: string): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
  return catalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

/** Every leaf string in a catalog, keyed by its dotted path. */
function flatten(catalog: Catalog, prefix = ''): Map<string, string> {
  const found = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const leaf = leafSchema.safeParse(value);
    if (leaf.success) {
      found.set(path, leaf.data);
      continue;
    }
    for (const [nested, text] of flatten(catalogSchema.parse(value), path)) found.set(nested, text);
  }
  return found;
}

/** The three namespaces this defect could hide in, sign-in itself and its two now-deleted neighbours. */
const SCOPED_PREFIXES = ['sync.signIn.', 'sync.signOut.', 'sync.recover.'];

/** Every string under one of `SCOPED_PREFIXES`, from an already-flattened catalog. */
function scopedStringsOf(catalog: Map<string, string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const [path, text] of catalog) {
    if (SCOPED_PREFIXES.some((prefix) => path.startsWith(prefix))) found.set(path, text);
  }
  return found;
}

/**
 * The words a handle-era leftover would use. Matched as a case-insensitive
 * substring: "Anmeldename" is a substring of "Anmeldenamen", so the shorter
 * form alone would already catch both, but both are named because both were
 * present in the wording this file replaces.
 */
const BANNED_TERMS = ['sign-in name', 'anmeldename', 'anmeldenamen', 'username', 'benutzername'];

/** Every `path: term` pairing where a string in `strings` carries a banned term. */
function bannedTermOffenses(strings: Map<string, string>): string[] {
  const offenders: string[] = [];
  for (const [path, text] of strings) {
    const lower = text.toLowerCase();
    for (const term of BANNED_TERMS) {
      if (lower.includes(term)) offenders.push(`${path}: "${term}" in "${text}"`);
    }
  }
  return offenders;
}

const EN = flatten(loadCatalog('en'));
const DE = flatten(loadCatalog('de'));

describe('sync sign-in/sign-out/recover copy carries no handle-era wording', () => {
  for (const [locale, catalog] of Object.entries({ en: EN, de: DE })) {
    it(`is free of every banned term in ${locale}`, () => {
      const offenses = bannedTermOffenses(scopedStringsOf(catalog));
      assert.deepEqual(offenses, [], offenses.join('\n'));
    });
  }

  // NON-VACUITY. A renamed namespace or a typo'd prefix leaves this scoped set
  // empty, which would pass the check above having examined nothing.
  it('is checking a real, populated set of keys in both locales', () => {
    assert.ok(scopedStringsOf(EN).size > 0, 'sync.signIn.* yielded no strings to check');
    assert.equal(scopedStringsOf(EN).size, scopedStringsOf(DE).size, 'both locales must carry the same keys');
  });

  it('names the email address in the rejected sign-in message, in both locales', () => {
    assert.match(EN.get('sync.signIn.failed') ?? '', /email/i);
    assert.match(DE.get('sync.signIn.failed') ?? '', /e-mail/i);
  });

  // CONTROL. The same checker, run over a fixture that DOES carry the banned
  // wording, must report it, otherwise the empty result above could just as
  // well mean the checker never runs.
  it('the checker itself catches a fixture containing "sign-in name"', () => {
    const fixture = flatten({
      sync: { signIn: { failed: 'Check the sign-in name and password and try again.' } },
    });
    const offenses = bannedTermOffenses(scopedStringsOf(fixture));
    assert.ok(offenses.length > 0, 'the checker missed a fixture that names a "sign-in name"');
  });
});
