/**
 * WHAT A MANAGED INSTANCE MAY NOT SAY.
 *
 * ── Why a lint over the catalogs and not a review ────────────────────────
 *
 * The owner walked the invite path as an end user on 2026-09-04 and hit a scan
 * card demanding an OpenRouter key on an instance where nobody brings a key,
 * an onboarding step describing "an AI service you set up yourself", and an
 * account form offering optional syncing on a screen where syncing is not
 * optional. Every one of those strings was correct when it was written, for
 * the instance it was written for, and stayed behind when the other kind of
 * instance arrived.
 *
 * A review catches that once. This catches it every time somebody adds a
 * string to one of the screens a managed instance shows.
 *
 * ── The two rules, and why they are different in kind ────────────────────
 *
 *  1. NO SERVICE NAMES on a managed branch. "Sync", "Gateway" and "OpenRouter"
 *     are true of an open instance and meaningless on a managed one: there is
 *     no second service to name, and a person there never picks a provider.
 *     `service` and `account link` are here for the same reason — they are the
 *     operator's words, not a person's.
 *  2. NO EM OR EN DASH, anywhere in these namespaces. A workspace rule
 *     (`CLAUDE.md`), and this is where it becomes enforceable rather than a
 *     thing somebody remembers during review.
 *
 * The BANNED-WORD rule is scoped to the namespaces a managed instance shows,
 * because the words are correct elsewhere: `settingsAi.*` names OpenRouter on
 * purpose, and `landing.*` describes bring-your-own-key at length. The DASH
 * rule applies to all the same namespaces, and is checked in both locales
 * because a translation is where a dash is most likely to reappear.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
type Catalog = { [key: string]: string | Catalog };

/**
 * The on-disk catalog, PARSED rather than asserted — the same schema
 * `i18n-key-parity.test.ts` uses, written the same way. A stray non-string
 * leaf fails loudly here rather than slipping through this file's walk as a
 * key it silently skipped.
 */
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

const EN = flatten(loadCatalog('en'));
const DE = flatten(loadCatalog('de'));

/**
 * The namespaces a managed instance shows, whole.
 *
 * `join`, `signIn`, `forgot`, `reset`, `account` and `admin` exist ONLY on an
 * instance with accounts, so every string under them is a managed-branch
 * string and the ban applies to all of them.
 */
const MANAGED_ONLY_PREFIXES = ['join.', 'signIn.', 'forgot.', 'reset.', 'account.', 'admin.'];

/**
 * The managed BRANCHES of two shared namespaces.
 *
 * `onboarding.*` and `scan.setup.*` are drawn on both kinds of instance, and
 * the open branch legitimately names OpenRouter. Only the keys a managed
 * instance actually renders are banned, and they are listed by name rather
 * than by prefix so that adding a managed key is a deliberate act that has to
 * appear here too.
 */
const MANAGED_BRANCH_KEYS = [
  'onboarding.firstFood.managedNote',
  'scan.setup.managed.description',
  'scan.setup.managedMissing.body',
  'scan.setup.managedMissing.askAdmin',
  'scan.capture.managedDescription',
  'account.allowance.title',
  'account.allowance.body',
  'account.allowance.none',
  'account.allowance.askAdmin',
];

/**
 * The words a managed-branch string may not carry.
 *
 * Matched case-insensitively and as whole words, so "Diensteanbieter" in some
 * unrelated legal string could never be caught by the `service` entry and
 * "Gateway" in a code comment is not a string at all.
 *
 * `member` and `token` joined the list with the admin page (M192/06). Both are
 * the OLD console's vocabulary: it listed "members" and "tokens" because it
 * administered a gateway. This page administers people and invitations, and
 * the word for the second role is "Standard" — `member` is what the wire calls
 * it, and the wire is not copy.
 */
const BANNED_WORDS = ['sync', 'gateway', 'openrouter', 'service', 'account link', 'member', 'token'];

/** Every managed-branch key in one catalog, resolved to its text. */
function managedStringsOf(catalog: Map<string, string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const [path, text] of catalog) {
    if (MANAGED_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) found.set(path, text);
  }
  for (const key of MANAGED_BRANCH_KEYS) {
    const text = catalog.get(key);
    if (text !== undefined) found.set(key, text);
  }
  return found;
}

describe('managed-branch copy names no service', () => {
  for (const [locale, catalog] of Object.entries({ en: EN, de: DE })) {
    it(`carries none of the banned words in ${locale}`, () => {
      const offenders: string[] = [];
      for (const [path, text] of managedStringsOf(catalog)) {
        for (const word of BANNED_WORDS) {
          if (new RegExp(`\\b${word}\\b`, 'i').test(text)) offenders.push(`${path}: "${word}" in ${text}`);
        }
      }
      assert.deepEqual(offenders, [], 'a managed instance has one server and no provider to name');
    });
  }

  // NON-VACUITY. Every assertion above passes on an empty set, and an empty
  // set is exactly what a renamed namespace or a typo'd prefix produces.
  it('is checking a real, populated set of keys', () => {
    assert.ok(managedStringsOf(EN).size > 120, `only ${managedStringsOf(EN).size} managed strings were found`);
    assert.equal(managedStringsOf(EN).size, managedStringsOf(DE).size, 'both locales must carry the same set');
    for (const key of MANAGED_BRANCH_KEYS) {
      assert.ok(EN.has(key), `${key} is listed as a managed branch and does not exist`);
    }
  });
});

describe('managed-branch copy uses no em or en dash', () => {
  for (const [locale, catalog] of Object.entries({ en: EN, de: DE })) {
    it(`is free of both dashes in ${locale}`, () => {
      const offenders: string[] = [];
      for (const [path, text] of managedStringsOf(catalog)) {
        // U+2014 EM DASH and U+2013 EN DASH. A hyphen is fine and is used in
        // ordinary German compounds.
        if (/[–—]/.test(text)) offenders.push(`${path}: ${text}`);
      }
      assert.deepEqual(offenders, [], 'the workspace rule is a comma, never a dash');
    });
  }
});
