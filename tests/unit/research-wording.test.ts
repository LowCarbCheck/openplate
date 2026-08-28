/**
 * THE WORDING PASS, AS A TEST (M161/05, `openplate-sync` ADR-0003
 * prohibition 5).
 *
 * A review of copy is stale the next time someone edits a string, and this
 * feature's copy will be edited by people who were not in this milestone. So
 * the rule is executable, it walks the WHOLE `research` namespace, and it runs
 * in BOTH shipped locales — a wording rule that only holds in English holds
 * nowhere.
 *
 * ── The negative half: nothing here is called anonymous ──────────────────
 *
 * The stem `anonym` covers English *anonymous* and German *anonym* in one
 * rule. It is a stem and not a word list on purpose: *anonymised*,
 * *anonymisiert* and *effectively anonymous* all carry the same false promise,
 * and a pseudonymous longitudinal series re-identifies against any auxiliary
 * dataset its holder happens to have.
 *
 * ONE escape hatch, and it is deliberately the narrowest shape that still
 * lets the copy do its job: the export's first line may say "not anonymous",
 * once, in that key only. A blanket ban would force the weaker sentence — a
 * reader defaults to assuming anonymity, and the sentence that best corrects
 * that assumption is the one that names it and denies it, which is also what
 * `research-export.test.ts` has asserted since slice 04. The hatch is keyed,
 * phrase-checked and counted, so "not anonymous, well, effectively anonymous"
 * fails on the second occurrence and any other key fails on the first.
 *
 * ── The positive half: the caveats are actually there ────────────────────
 *
 * Without it the negative rule is satisfied by an empty namespace, a missing
 * one, or a German stub. So three sentences are asserted by key: the
 * pseudonymised wording, ADR-0003's first-ranked auxiliary-join caveat, and
 * the disclosure that re-joining is not a fresh identity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
type Catalog = { [key: string]: string | Catalog };

/** Parsed rather than asserted — a stray non-string leaf fails loudly here, as it does in `i18n-key-parity.test.ts`. */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

const leafSchema = z.string();

/** The two shipped locales. A rule that runs on one of them is not a rule. */
const LOCALES = ['en', 'de'] as const;

type Locale = (typeof LOCALES)[number];

/**
 * The ONE key that may carry the stem, and the exact refusal it must be inside.
 *
 * Per locale, because the refusal is a sentence and sentences are translated.
 * A German value asserting the English phrase would pass this rule while
 * saying nothing.
 */
const REFUSAL_PHRASE = { en: 'not anonymous', de: 'nicht anonym' } satisfies Record<Locale, string>;
const REFUSAL_KEY = 'research.export.pseudonymisedNotice';

/** The `research` namespace, as shipped. Missing or non-object fails here rather than silently passing every rule below. */
function researchNamespace(locale: Locale): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
  const catalog = catalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
  const research = catalog['research'];
  assert.ok(research !== undefined, `${locale} has no research namespace at all`);
  return catalogSchema.parse(research);
}

/** One translated sentence and the dotted key it lives at. Named, so the walk below needs no assertion to build a pair. */
interface Sentence {
  key: string;
  value: string;
}

/** Every leaf in the namespace. The walk is total: a group added later is covered the day it is added. */
function leaves(catalog: Catalog, prefix: string): Sentence[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = `${prefix}.${key}`;
    const leaf = leafSchema.safeParse(value);
    return leaf.success ? [{ key: path, value: leaf.data }] : leaves(catalogSchema.parse(value), path);
  });
}

/** How many times the stem appears, case-insensitively. A count, not a boolean — the hatch is "exactly one". */
function countStem(value: string): number {
  return value.split(/anonym/i).length - 1;
}

test('the research copy never calls a contribution anonymous, in either locale', async () => {
  for (const locale of LOCALES) {
    const namespace = researchNamespace(locale);
    const all = leaves(namespace, 'research');
    assert.ok(all.length > 0, `${locale}'s research namespace is empty`);

    for (const { key, value } of all) {
      const occurrences = countStem(value);
      if (key !== REFUSAL_KEY) {
        assert.equal(occurrences, 0, `${locale} ${key} uses the stem "anonym": ${value}`);
        continue;
      }
      // The hatch, spent: exactly one occurrence, and it has to be inside the
      // sentence that refuses the word.
      assert.equal(
        occurrences,
        1,
        `${locale} ${key} may use the stem "anonym" exactly once, and uses it ${occurrences}×`,
      );
      assert.ok(
        value.toLowerCase().includes(REFUSAL_PHRASE[locale]),
        `${locale} ${key} may only use the stem inside "${REFUSAL_PHRASE[locale]}": ${value}`,
      );
    }
  }
});

test('the research copy states the caveat in every locale', async () => {
  for (const locale of LOCALES) {
    const all = new Map(
      leaves(researchNamespace(locale), 'research').map((sentence) => [sentence.key, sentence.value]),
    );

    /** Asserts a keyed sentence exists, is a real sentence, and contains the thing that makes it that sentence. */
    function requireSentence(key: string, mustContain: RegExp): void {
      const value = all.get(key);
      assert.ok(value !== undefined, `${locale} is missing ${key}`);
      assert.ok(value.trim().length > 20, `${locale} ${key} is a stub: ${value}`);
      assert.match(value, mustContain, `${locale} ${key} does not carry what it is for`);
    }

    // The word itself, in the sentence a researcher reads first.
    requireSentence(REFUSAL_KEY, /pseudonym/i);
    // ADR-0003's FIRST-ranked attack: a cohort plus one outside dataset
    // re-identifies people. Ranked first because it shapes what may be
    // promised, so its absence is not a copy nit.
    requireSentence('research.caveats.auxiliaryJoin', /identif/i);
    // Withdrawal does not mint a new root, so re-joining presents the same
    // pseudonym. The disclosure has to survive a re-wording of the screen.
    requireSentence('research.withdrawal.samePseudonymOnRejoin', /pseudonym/i);
    // The three sentences the confirmation owes the person, and the middle one
    // is the one that gets softened.
    requireSentence('research.withdrawal.alreadyDownloaded', /./);
    requireSentence('research.withdrawal.instructedToDelete', /./);
    requireSentence('research.withdrawal.noNewData', /./);
    // Load-bearing on the researcher's side: an unknown macro contributes
    // nothing to a day total, and `loggedEntryCount` is the only thing that
    // tells "unknown" from "low intake" apart.
    requireSentence('research.export.unknownMacroCaveat', /loggedEntryCount/);
  }
});
