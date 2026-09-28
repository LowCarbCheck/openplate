/**
 * THE BANNED WORD LIST, as a test rather than as a guideline.
 *
 * The catch-up is the one thing in this app that speaks first. Everything else
 * waits to be opened. A sentence that lectures is therefore not a style
 * complaint here, it is the reason somebody turns notifications off and never
 * turns them back on.
 *
 * Two sweeps, and both matter:
 *
 *  1. Every shipped string under `catchUp.*`, in English and, once the German
 *     block exists, in German too. A translation can reintroduce a lecture the
 *     English source avoided, so the assertion runs on the output, not on the
 *     source.
 *  2. Every line `buildCatchUp` actually produces, across a fixture matrix that
 *     covers with and without goals, a fasting day, an empty day, a protein
 *     nudge, a fiber nudge, own foods and fallback foods. A catalog can be
 *     clean while a composed sentence is not.
 *
 * The control at the bottom is a deliberately lecturing string the same
 * assertion has to reject. Without it this file would pass against an
 * assertion that can never fail, which is the quieter way a gate goes green
 * while saying nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import i18next from '../../app/i18n/i18n';
import { buildCatchUp, resolveFallbackFoods } from '../../app/models/catch-up';
import type { CatchUpDay, CatchUpFood, CatchUpFast, CatchUpGoals, CatchUpInput } from '../../app/models/catch-up';
import type { Translate } from '../../app/models/fasting';

/**
 * The words a catch-up never uses. Matched as WHOLE words, case-insensitively,
 * so "consider" is caught and "considerable" is not, and "kg" is caught while
 * "kgs" in some future food name is not.
 */
const BANNED_WORDS = [
  'should',
  'must',
  'only',
  'again',
  'missed',
  'failed',
  "don't forget",
  'recommend',
  'consider',
  'try to',
  'remember',
  'weight',
  'kg',
] as const;

/** Every banned word found in `text`, plus the exclamation mark, which is its own kind of shouting. */
function offencesIn(text: string): string[] {
  const found = BANNED_WORDS.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, 'iu').test(text);
  });
  return text.includes('!') ? [...found, '!'] : [...found];
}

/** A translation catalog: nested groups of keys bottoming out in translated strings. */
type Catalog = { [key: string]: string | Catalog };

/** The on-disk catalog, parsed rather than asserted, exactly as `i18n-key-parity` reads it. */
const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

const leafSchema = z.string();

function loadCatalog(locale: string): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
  return catalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

/** One translated string, with the dotted key it is filed under. */
interface CatalogEntry {
  key: string;
  value: string;
}

/** Every leaf under `node`. */
function leaves(node: Catalog, prefix: string): CatalogEntry[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = `${prefix}.${key}`;
    const leaf = leafSchema.safeParse(value);
    return leaf.success ? [{ key: path, value: leaf.data }] : leaves(catalogSchema.parse(value), path);
  });
}

/** Every `catchUp.*` leaf in one catalog. Empty when the block does not exist yet. */
function catchUpStrings(catalog: Catalog): CatalogEntry[] {
  const block = catalogSchema.safeParse(catalog['catchUp']);
  return block.success ? leaves(block.data, 'catchUp') : [];
}

const t: Translate = (key, params) => i18next.t(key, params ?? {});

////////////////////////////////////////////////////////////////////////////////
// The fixture matrix
////////////////////////////////////////////////////////////////////////////////

const TODAY = '2026-09-12';
const DAY_KEYS = ['2026-09-11', '2026-09-10', '2026-09-09'] as const;

function days(protein: [number, number, number], fiber: [number, number, number], meals = 3): CatchUpDay[] {
  return DAY_KEYS.map((dayKey, index) => ({
    dayKey,
    meals,
    netCarbsG: 30,
    proteinG: protein[index] ?? 0,
    kcal: 1800,
    fatG: 60,
    fiberG: fiber[index] ?? 0,
  }));
}

const BOTH_GOALS: CatchUpGoals = { netCarbsCeiling: 50, proteinFloor: 90, kcalTarget: 1800 };
const NO_GOALS: CatchUpGoals = { netCarbsCeiling: null, proteinFloor: null, kcalTarget: null };
const NO_FAST: CatchUpFast = { status: 'none', coveredYesterday: false };

const OWN_FOODS: CatchUpFood[] = [
  { name: 'Chicken breast', proteinPer100g: 31, fiberPer100g: 0 },
  { name: 'Raspberries', proteinPer100g: 1, fiberPer100g: 6.5 },
  { name: 'Skyr', proteinPer100g: 11, fiberPer100g: 0 },
];

function input(overrides: Partial<CatchUpInput>): CatchUpInput {
  return {
    days: days([120, 120, 120], [30, 30, 30]),
    goals: BOTH_GOALS,
    fast: NO_FAST,
    recentFoods: [],
    fallbackFoods: resolveFallbackFoods(t),
    today: TODAY,
    locale: 'en',
    t,
    ...overrides,
  };
}

/** Every shape the catch-up can take, named so a failure says which one lectured. */
const FIXTURES: { name: string; input: CatchUpInput }[] = [
  { name: 'a normal day with both goals', input: input({}) },
  { name: 'a normal day with no goals at all', input: input({ goals: NO_GOALS }) },
  { name: 'a single meal', input: input({ days: days([120, 120, 120], [30, 30, 30], 1) }) },
  {
    name: 'an empty yesterday',
    input: input({ days: days([0, 120, 120], [0, 30, 30], 0) }),
  },
  {
    name: 'a fasting yesterday',
    input: input({
      days: days([0, 120, 120], [0, 30, 30], 0),
      fast: { status: 'none', coveredYesterday: true },
    }),
  },
  {
    name: 'a fast in progress',
    input: input({ fast: { status: 'active', elapsedLabel: '14 h', coveredYesterday: false } }),
  },
  {
    name: 'a scheduled fast',
    input: input({ fast: { status: 'scheduled', startsAtLabel: '20:00', coveredYesterday: false } }),
  },
  {
    name: 'a routine',
    input: input({ fast: { status: 'none', routineStartLabel: '20:00', coveredYesterday: false } }),
  },
  {
    name: 'a protein nudge on the fallback foods',
    input: input({ days: days([40, 50, 130], [30, 30, 30]) }),
  },
  {
    name: 'a protein nudge on the person’s own foods',
    input: input({ days: days([40, 50, 130], [30, 30, 30]), recentFoods: OWN_FOODS }),
  },
  {
    name: 'a fiber nudge on the fallback foods',
    input: input({ goals: { ...BOTH_GOALS, proteinFloor: null }, days: days([120, 120, 120], [2, 3, 30]) }),
  },
  {
    name: 'a fiber nudge on the person’s own foods',
    input: input({
      goals: { ...BOTH_GOALS, proteinFloor: null },
      days: days([120, 120, 120], [2, 3, 30]),
      recentFoods: OWN_FOODS,
    }),
  },
];

////////////////////////////////////////////////////////////////////////////////
// The sweeps
////////////////////////////////////////////////////////////////////////////////

describe('the banned word assertion itself', () => {
  it('rejects a deliberately lecturing string, the control', () => {
    const control = 'You should remember your weight, and try to not miss your protein again!';
    const offences = offencesIn(control);

    assert.ok(offences.includes('should'), 'the control must trip "should"');
    assert.ok(offences.includes('remember'), 'the control must trip "remember"');
    assert.ok(offences.includes('weight'), 'the control must trip "weight"');
    assert.ok(offences.includes('try to'), 'the control must trip "try to"');
    assert.ok(offences.includes('again'), 'the control must trip "again"');
    assert.ok(offences.includes('!'), 'the control must trip the exclamation mark');
  });

  it('lets an ordinary catch-up sentence through', () => {
    assert.deepEqual(offencesIn('Yesterday: 3 meals, 42 g net carbs of your 50 g ceiling.'), []);
  });

  it('matches whole words only, so "considerable" is not "consider"', () => {
    assert.deepEqual(offencesIn('A considerable amount of broccoli.'), []);
  });
});

describe('the shipped catchUp strings', () => {
  it('carries no banned word and no exclamation mark in English', () => {
    const offenders = catchUpStrings(loadCatalog('en'))
      .map((entry) => ({ key: entry.key, offences: offencesIn(entry.value) }))
      .filter((entry) => entry.offences.length > 0);

    assert.deepEqual(
      offenders,
      [],
      `English catchUp strings that lecture:\n  ${offenders.map((entry) => `${entry.key}: ${entry.offences.join(', ')}`).join('\n  ')}`,
    );
  });

  it('carries no banned word and no exclamation mark in German', (context) => {
    const german = catchUpStrings(loadCatalog('de'));
    if (german.length === 0) {
      // The German block is translated in its own round (wordsmith owns every
      // non-English string). Skipping is the honest answer while it is absent;
      // this assertion turns on by itself the moment the keys land.
      context.skip('the German catchUp block does not exist yet');
      return;
    }
    const offenders = german
      .map((entry) => ({ key: entry.key, offences: offencesIn(entry.value) }))
      .filter((entry) => entry.offences.length > 0);

    assert.deepEqual(
      offenders,
      [],
      `German catchUp strings that lecture:\n  ${offenders.map((entry) => `${entry.key}: ${entry.offences.join(', ')}`).join('\n  ')}`,
    );
  });
});

describe('every line buildCatchUp produces', () => {
  for (const fixture of FIXTURES) {
    it(`stays factual for ${fixture.name}`, () => {
      const built = buildCatchUp(fixture.input);

      for (const line of [built.title, built.body, ...built.lines]) {
        assert.deepEqual(offencesIn(line), [], `${fixture.name} produced: ${line}`);
      }
    });
  }

  it('covers every case, so the matrix is not silently empty', () => {
    const lineCounts = new Set(FIXTURES.map((fixture) => buildCatchUp(fixture.input).lines.length));

    assert.ok(FIXTURES.length >= 12, 'the matrix must carry every case the spec names');
    assert.ok(
      lineCounts.has(1) && lineCounts.has(2),
      'the matrix must produce both one-line and multi-line catch-ups',
    );
  });
});
