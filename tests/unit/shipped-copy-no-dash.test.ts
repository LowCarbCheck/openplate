/**
 * NO EM DASH, NO EN DASH, ANYWHERE IN THE SHIPPED COPY.
 *
 * The workspace rule (`~/projects/openplate-workspace/CLAUDE.md`, "No em
 * dashes and no en dashes in prose, in code comments, or in copy") already
 * applied to these four bundles. Nothing enforced it: a 2026-09 pass removed
 * every em dash (—, U+2014) and en dash (–, U+2013) from `en/common.json`,
 * `en/legal.json`, `de/common.json` and `de/legal.json` by hand, and one of
 * them had already drifted back into a test assertion
 * (`legal-pages.test.ts`, the "neither the key nor the photo" claim) before
 * this file existed. `managed-copy-bans.test.ts` checks the same two
 * characters, but only across the managed-instance branch of `common.json`;
 * this file is the repo-wide backstop over all four SHIPPED bundles, so a
 * dash reintroduced anywhere else in copy fails here first.
 *
 * SCOPE: this covers the shipped copy bundles only, not code comments. The
 * workspace rule also bans the dash in comments, but sweeping every source
 * file for one is a separate, unmade decision, not something this test does.
 *
 * A hyphen (-, U+002D) is untouched: ordinary compounds and number ranges
 * ("14-18") use it and are fine.
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
 * `i18n-key-parity.test.ts` and `managed-copy-bans.test.ts` use. A stray
 * non-string leaf fails loudly here rather than being silently skipped by
 * this file's walk.
 */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));
const leafSchema = z.string();

function loadCatalog({ locale, namespace }: { locale: string; namespace: string }): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/${namespace}.json`, import.meta.url);
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

/** U+2014 EM DASH and U+2013 EN DASH. A hyphen is fine. */
const DASH_PATTERN = /[–—]/;

const BUNDLES = [
  { locale: 'en', namespace: 'common' },
  { locale: 'en', namespace: 'legal' },
  { locale: 'de', namespace: 'common' },
  { locale: 'de', namespace: 'legal' },
] as const;

describe('shipped copy carries no em dash and no en dash', () => {
  for (const { locale, namespace } of BUNDLES) {
    it(`is free of both dashes in ${locale}/${namespace}.json`, () => {
      const strings = flatten(loadCatalog({ locale, namespace }));
      const offenders = [...strings].filter(([, text]) => DASH_PATTERN.test(text));

      assert.deepEqual(
        offenders,
        [],
        offenders
          .map(([path, text]) => `${locale}/${namespace}.json → "${path}": ${text}`)
          .join('\n'),
      );
    });
  }

  // NON-VACUITY. The check above passes on an empty bundle just as readily as
  // on a clean one, so pin that each file actually has a substantial number
  // of strings to walk.
  it('is checking a real, populated set of strings in every bundle', () => {
    for (const { locale, namespace } of BUNDLES) {
      const count = flatten(loadCatalog({ locale, namespace })).size;
      assert.ok(count > 50, `${locale}/${namespace}.json only yielded ${count} strings`);
    }
  });
});
