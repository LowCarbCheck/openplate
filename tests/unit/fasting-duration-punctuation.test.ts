/**
 * Doubled-punctuation guard for the fasting copy, against the REAL catalogs.
 *
 * The bug this exists to stop shipped once already: German abbreviates the
 * duration units with a period ("0 Min."), and `fasting.toast.ended` places
 * `{{achieved}}` immediately before the sentence's own period — so a saved fast
 * announced itself as "Fasten gespeichert — 0 Min..". The same collision was
 * latent in four more templates, and only for a CUSTOM protocol, whose
 * `fastTargetLabel` is a duration ("9 Std") where a preset's is "16:8".
 *
 * The fix was to drop the periods from `fasting.duration.*`, which is a
 * property of the catalog rather than of any function — so this test asserts
 * the catalog, and asserts it the way the app renders it: every `fasting.*`
 * template that takes a duration-valued placeholder, filled with real
 * `formatFastDuration` output. `tests/unit/fasting-model.test.ts` deliberately
 * uses a `fakeT` that echoes "9h", and structurally cannot see any of this.
 *
 * Both shipped locales are checked, so a future translator who reaches for
 * "Std." again fails here rather than in production.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { formatFastDuration, formatFastOvertime } from '../../app/models/fasting';
import type { Translate } from '../../app/models/fasting';

const LOCALES = ['en', 'de'] as const;
const MINUTE = 60_000;
const HOUR = 3_600_000;

/** A translation catalog: nested groups of keys bottoming out in template strings. */
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

/** A catalog-backed `Translate` — dotted lookup plus `{{name}}` substitution, no i18next instance. */
function makeTranslate(catalog: Catalog): Translate {
  return (key, params) => {
    let node: string | Catalog | undefined = catalog;
    for (const part of key.split('.')) {
      const group = catalogSchema.safeParse(node);
      if (!group.success) {
        node = undefined;
        break;
      }
      node = group.data[part];
    }
    const leaf = leafSchema.safeParse(node);
    assert.ok(leaf.success, `Missing catalog string for ${key}`);
    return leaf.data.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params?.[name] ?? ''));
  };
}

/** Every leaf under `node`, as `[dotted key, template]`. */
function walk(node: Catalog, prefix: string): [string, string][] {
  return Object.entries(node).flatMap(([key, value]): [string, string][] => {
    const path = `${prefix}.${key}`;
    const leaf = leafSchema.safeParse(value);
    return leaf.success ? [[path, leaf.data]] : walk(catalogSchema.parse(value), path);
  });
}

/** Every `fasting.*` leaf, as `[dotted key, template]`. */
function fastingTemplates(catalog: Catalog): [string, string][] {
  const fasting = catalogSchema.safeParse(catalog.fasting);
  assert.ok(fasting.success, 'No `fasting` subtree in the catalog');
  return walk(fasting.data, 'fasting');
}

/**
 * Placeholders whose value is a formatted DURATION at some call site. `target`
 * is the subtle one: `fastTargetLabel` returns "16:8" for a preset and a
 * duration for a custom protocol, so a template is only safe if it is safe for
 * the duration case.
 */
const DURATION_PLACEHOLDERS = new Set(['achieved', 'duration', 'elapsed', 'overtime', 'remaining', 'target']);

describe('fasting duration copy', () => {
  for (const locale of LOCALES) {
    const catalog = loadCatalog(locale);
    const t = makeTranslate(catalog);

    it(`[${locale}] renders no duration unit that ends in a period`, () => {
      // The units are interpolated at sentence ends, so an abbreviation period
      // here is a doubled period there. Use the SI-style symbol or a bare
      // abbreviation instead.
      const dotted = fastingTemplates(catalog).filter(
        ([key, value]) => key.startsWith('fasting.duration.') && value.trimEnd().endsWith('.'),
      );
      assert.deepEqual(dotted, [], `Duration units must not end in a period: ${JSON.stringify(dotted)}`);
    });

    it(`[${locale}] never doubles a period when a duration lands at a sentence end`, () => {
      const samples = [
        formatFastDuration(0, t),
        formatFastDuration(42 * MINUTE, t),
        formatFastDuration(9 * HOUR, t),
        formatFastDuration(16 * HOUR + 4 * MINUTE, t),
        formatFastOvertime(2 * HOUR + 14 * MINUTE, t),
      ];

      const offenders: string[] = [];
      for (const [key, template] of fastingTemplates(catalog)) {
        for (const sample of samples) {
          const rendered = template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
            DURATION_PLACEHOLDERS.has(name) ? sample : 'X',
          );
          if (rendered.includes('..')) offenders.push(`${key} => ${rendered}`);
        }
      }

      assert.deepEqual(offenders, [], `Doubled period(s):\n  ${offenders.join('\n  ')}`);
    });
  }

  it('[de] the once-broken toast now reads with a single period', () => {
    // The literal that shipped wrong, pinned as the regression it was.
    const t = makeTranslate(loadCatalog('de'));
    assert.equal(t('fasting.toast.ended', { achieved: formatFastDuration(0, t) }), 'Fastenzeit gespeichert, 0 Min.');
    assert.equal(t('fasting.summary.targetWas', { target: formatFastDuration(9 * HOUR, t) }), 'Dein Ziel waren 9 Std.');
  });
});
