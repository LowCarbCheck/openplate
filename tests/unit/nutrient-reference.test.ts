/**
 * Unit tests for the `/nutrients` model (M135/06): `app/lib/nutrient-reference`
 * plus the window aggregate it consumes
 * (`app/lib/local-store/aggregates`'s `computeMicronutrientsInWindow`).
 *
 * Every case here pins one of the screen's two refusals — the places where the
 * honest answer is "no number":
 *
 *  - **Below the coverage threshold** the window reports `hasEnoughData: false`
 *    and no amount, so no row can render a partial sum, a percentage or a bar.
 *  - **With no body metrics** there is no fallback band, no default band and no
 *    assumed person: `resolveReferenceAmount` refuses rather than guessing.
 *  - **Below the youngest published band** the age is refused outright and NEVER
 *    clamped up into `14-18`.
 *  - **Pregnancy / lactation** override the sex + age band when published, and
 *    report which segment the number came from.
 *  - **Beta-carotene** never becomes a target of its own — it is a component of
 *    the vitamin A figure, so it renders as context inside that row.
 *
 * And one refusal of a different shape: **a ceiling is not a goal.** A nutrient
 * upstream classifies as `kind: 'ceiling'` (sodium) is never ranked as a gap
 * and never feeds the food suggestions, and an absent or unknown `kind` always
 * degrades to `'target'` rather than the reverse.
 *
 * Pure arrays and plain objects in, plain objects out — no store, no browser.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { computeMicronutrientsInWindow } from '../../app/lib/local-store/aggregates';
import type { NutrientDayIntake } from '../../app/lib/local-store/aggregates';
import { MINERAL_KEYS, NUTRIENT_KEYS, VITAMIN_KEYS } from '../../app/lib/micronutrients';
import type { MicronutrientsPer100g, NutrientKey } from '../../app/lib/micronutrients';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';
import type { BodyMetrics } from '../../app/models/body-metrics';
import {
  DISPLAYED_NUTRIENT_KEYS,
  KNOWN_NUTRIENT_SLUGS,
  NUTRIENT_SLUGS,
  buildNutrientRows,
  filterSuggestions,
  isAboveReferenceLimit,
  normalizeNutrientKind,
  parseNutrientReferences,
  parseNutrientSourceFoods,
  pickLightestNutrients,
  resolveReferenceAmount,
  NutrientReferenceParseError,
} from '../../app/lib/nutrient-reference';
import type { NutrientKind, NutrientReference, NutrientSourceFood } from '../../app/lib/nutrient-reference';

const FROM = '2026-08-01';
const TO = '2026-08-07';
const CURRENT_YEAR = 2026;

/** The nutrient copy the ceiling render path reaches for — every key must exist in every shipped locale. */
const nutrientLimitCopySchema = z.object({
  nutrients: z.object({
    amount: z.object({ ofLimit: z.string() }),
    limit: z.object({ badge: z.string(), under: z.string(), over: z.string() }),
  }),
});

/** Reads a shipped locale's message catalog off disk, unparsed. */
function readLocaleCatalogJson(locale: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url)), 'utf8');
}

////////////////////////////////////////////////////////////////////////////////
// Fixtures
////////////////////////////////////////////////////////////////////////////////

function minerals(values: Partial<Record<(typeof MINERAL_KEYS)[number], number>>) {
  // SAFETY: the entries are built from MINERAL_KEYS itself, so every key the
  // block declares is present (a missing value becomes an explicit `null`,
  // never an absent key) — only `Object.fromEntries` widens that back to a
  // string index signature.
  return Object.fromEntries(
    MINERAL_KEYS.map((key) => [key, key in values ? values[key] : null]),
  ) as MicronutrientsPer100g['minerals'];
}

function vitamins(values: Partial<Record<(typeof VITAMIN_KEYS)[number], number>>) {
  // SAFETY: the entries are built from VITAMIN_KEYS itself, so every key the
  // block declares is present (a missing value becomes an explicit `null`,
  // never an absent key) — only `Object.fromEntries` widens that back to a
  // string index signature.
  return Object.fromEntries(
    VITAMIN_KEYS.map((key) => [key, key in values ? values[key] : null]),
  ) as MicronutrientsPer100g['vitamins'];
}

/** A food log on `dayKey`. Omitting the micronutrients models a manual entry or an AI plate. */
function foodLog(
  id: string,
  dayKey: string,
  quantityGrams: number,
  micronutrientsPer100g?: MicronutrientsPer100g,
): LocalFoodLog {
  const log: LocalFoodLog = {
    id,
    name: id,
    quantityGrams,
    macros: { carbs: 5, fiber: 1, sugars: null, polyols: null, protein: 2, fat: 1, kcal: 40 },
    mealType: null,
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey,
    loggedAt: Date.parse(`${dayKey}T12:00:00Z`),
    createdAt: Date.parse(`${dayKey}T12:00:00Z`),
    logBatchId: null,
  };
  // Absent, not `undefined`: an omitted block models a manual entry or an AI
  // plate, which is a different state from a consulted-but-empty source.
  if (micronutrientsPer100g) log.micronutrientsPer100g = micronutrientsPer100g;
  return log;
}

const NO_BODY_METRICS: BodyMetrics = {
  heightCm: null,
  birthYear: null,
  biologicalSex: null,
  reproductiveStatus: null,
};

function metricsFor(overrides: Partial<BodyMetrics>): BodyMetrics {
  return { ...NO_BODY_METRICS, ...overrides };
}

/** A reference with distinct values per segment, so a test can tell which one was picked. */
function referenceFor(key: NutrientKey, { kind = 'target' }: { kind?: NutrientKind } = {}): NutrientReference {
  return {
    key,
    slug: 'magnesium',
    unit: 'mg',
    kind,
    rda: {
      source: 'EFSA Dietary Reference Values',
      male: { '14-18': 300, '19-30': 350, '31-50': 350, '51-70': 350, over_70: 350 },
      female: { '14-18': 250, '19-30': 300, '31-50': 300, '51-70': 300, over_70: 300 },
      pregnancy: 400,
      lactation: 420,
    },
  };
}

function intake(overrides: Partial<NutrientDayIntake> = {}): NutrientDayIntake {
  // SAFETY: `NutrientDayIntake` is discriminated on `hasEnoughData`, and
  // spreading a Partial over the base loses that correlation for the compiler.
  // Every call site here passes a coherent pair (`hasEnoughData: false` only
  // ever together with `amount: null`), which is what the union encodes.
  return {
    hasEnoughData: true,
    amount: 700,
    coveredFraction: 1,
    coveredGrams: 700,
    totalGrams: 700,
    contributingEntries: 7,
    totalEntries: 7,
    ...overrides,
  } as NutrientDayIntake;
}

const NOT_ENOUGH: NutrientDayIntake = {
  hasEnoughData: false,
  amount: null,
  coveredFraction: 0.1,
  coveredGrams: 10,
  totalGrams: 100,
  contributingEntries: 1,
  totalEntries: 3,
};

/** Every nutrient set to one intake, then selectively overridden. */
function byNutrient(base: NutrientDayIntake, overrides: Partial<Record<NutrientKey, NutrientDayIntake>> = {}) {
  // SAFETY: the loop below assigns every member of NUTRIENT_KEYS before the
  // record escapes, so the record is total by the time any caller reads it.
  const record = {} as Record<NutrientKey, NutrientDayIntake>;
  for (const key of NUTRIENT_KEYS) record[key] = overrides[key] ?? base;
  return record;
}

////////////////////////////////////////////////////////////////////////////////
// The window aggregate — the "not enough data" branch
////////////////////////////////////////////////////////////////////////////////

describe('computeMicronutrientsInWindow', () => {
  it('reports notEnoughData with no amount when coverage is below the threshold', () => {
    // 50 g of a food that knows magnesium, 450 g of food that does not: 10%
    // coverage, well below the 0.6 bar.
    const logs = [
      foodLog('rich', '2026-08-02', 50, { minerals: minerals({ magnesium: 80 }) }),
      foodLog('ai-plate', '2026-08-02', 450),
    ];

    const result = computeMicronutrientsInWindow(logs, { fromDate: FROM, toDate: TO });
    const magnesium = result.byNutrient.magnesium;

    assert.equal(magnesium.hasEnoughData, false);
    assert.equal(magnesium.amount, null);
    assert.ok(magnesium.coveredFraction < 0.6);
  });

  it('sums across the whole window and counts only days that carry an entry', () => {
    const logs = [
      foodLog('a', '2026-08-02', 100, { minerals: minerals({ magnesium: 50 }) }),
      foodLog('b', '2026-08-04', 100, { minerals: minerals({ magnesium: 50 }) }),
      foodLog('c', '2026-08-04', 100, { minerals: minerals({ magnesium: 50 }) }),
    ];

    const result = computeMicronutrientsInWindow(logs, { fromDate: FROM, toDate: TO });

    assert.equal(result.loggedDays, 2);
    assert.equal(result.totalEntries, 3);
    const magnesium = result.byNutrient.magnesium;
    assert.equal(magnesium.hasEnoughData, true);
    assert.equal(magnesium.hasEnoughData && magnesium.amount, 150);
  });

  it('keeps beta-carotene and vitamin A as two separate sums — nothing adds one into the other', () => {
    // The real RAE relationship from the curated corpus: 4872 µg β-carotene ÷ 12
    // = 406 µg vitamin A. The aggregation reports both verbatim; it is the
    // SCREEN that decides only one of them is a target (see `NUTRIENT_CONTEXT_OF`).
    const logs = [foodLog('seaweed', '2026-08-02', 100, { vitamins: vitamins({ vitaminA: 406, betaCarotene: 4872 }) })];

    const result = computeMicronutrientsInWindow(logs, { fromDate: FROM, toDate: TO });

    assert.equal(result.byNutrient.vitaminA.hasEnoughData && result.byNutrient.vitaminA.amount, 406);
    assert.equal(result.byNutrient.betaCarotene.hasEnoughData && result.byNutrient.betaCarotene.amount, 4872);
  });

  it('ignores logs outside the window entirely', () => {
    const logs = [foodLog('old', '2026-07-01', 100, { minerals: minerals({ magnesium: 50 }) })];
    const result = computeMicronutrientsInWindow(logs, { fromDate: FROM, toDate: TO });

    assert.equal(result.totalEntries, 0);
    assert.equal(result.loggedDays, 0);
    assert.equal(result.byNutrient.magnesium.hasEnoughData, false);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Reference resolution
////////////////////////////////////////////////////////////////////////////////

describe('resolveReferenceAmount', () => {
  it('refuses with no body metrics — there is no fallback band and no default band', () => {
    const result = resolveReferenceAmount({
      reference: referenceFor('magnesium'),
      metrics: NO_BODY_METRICS,
      currentYear: CURRENT_YEAR,
    });

    assert.equal(result.kind, 'no-body-metrics');
  });

  it('refuses when only one of sex and birth year is known', () => {
    const sexOnly = resolveReferenceAmount({
      reference: referenceFor('magnesium'),
      metrics: metricsFor({ biologicalSex: 'female' }),
      currentYear: CURRENT_YEAR,
    });
    const yearOnly = resolveReferenceAmount({
      reference: referenceFor('magnesium'),
      metrics: metricsFor({ birthYear: 1990 }),
      currentYear: CURRENT_YEAR,
    });

    assert.equal(sexOnly.kind, 'no-body-metrics');
    assert.equal(yearOnly.kind, 'no-body-metrics');
  });

  it('picks the sex and age band, and names the segment it used', () => {
    const result = resolveReferenceAmount({
      reference: referenceFor('magnesium'),
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1990 }),
      currentYear: CURRENT_YEAR,
    });

    assert.equal(result.kind, 'available');
    assert.equal(result.kind === 'available' && result.amount, 300);
    assert.deepEqual(result.kind === 'available' && result.segment, {
      kind: 'sex-age',
      sex: 'female',
      band: '31-50',
    });
    assert.equal(result.kind === 'available' && result.source, 'EFSA Dietary Reference Values');
  });

  it('uses the pregnancy value over the sex and age band', () => {
    const result = resolveReferenceAmount({
      reference: referenceFor('magnesium'),
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1995, reproductiveStatus: 'pregnant' }),
      currentYear: CURRENT_YEAR,
    });

    assert.equal(result.kind === 'available' && result.amount, 400);
    assert.deepEqual(result.kind === 'available' && result.segment, { kind: 'pregnancy' });
  });

  it('uses the lactation value over the sex and age band', () => {
    const result = resolveReferenceAmount({
      reference: referenceFor('magnesium'),
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1995, reproductiveStatus: 'lactating' }),
      currentYear: CURRENT_YEAR,
    });

    assert.equal(result.kind === 'available' && result.amount, 420);
    assert.deepEqual(result.kind === 'available' && result.segment, { kind: 'lactation' });
  });

  it('falls back to the sex and age band when pregnancy has no published value, and says so', () => {
    const reference = referenceFor('magnesium');
    const withoutPregnancy: NutrientReference = {
      ...reference,
      rda: reference.rda === null ? null : { ...reference.rda, pregnancy: null },
    };

    const result = resolveReferenceAmount({
      reference: withoutPregnancy,
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1995, reproductiveStatus: 'pregnant' }),
      currentYear: CURRENT_YEAR,
    });

    assert.equal(result.kind === 'available' && result.amount, 300);
    assert.equal(result.kind === 'available' && result.segment.kind, 'sex-age');
  });

  it('refuses an age below the youngest published band instead of clamping it into 14-18', () => {
    const reference = referenceFor('magnesium');
    const result = resolveReferenceAmount({
      reference,
      // Eleven years old — younger than every published band.
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 2015 }),
      currentYear: CURRENT_YEAR,
    });

    assert.equal(result.kind, 'age-out-of-bands');
    // The 14-18 value must not have leaked out under another arm.
    assert.notEqual(result.kind, 'available');
    assert.equal(reference.rda?.female['14-18'], 250);
  });

  it('reports notPublished when the nutrient has no reference at all', () => {
    const result = resolveReferenceAmount({
      reference: null,
      metrics: metricsFor({ biologicalSex: 'male', birthYear: 1980 }),
      currentYear: CURRENT_YEAR,
    });

    assert.equal(result.kind, 'not-published');
  });
});

////////////////////////////////////////////////////////////////////////////////
// Rows
////////////////////////////////////////////////////////////////////////////////

describe('buildNutrientRows', () => {
  it('gives beta-carotene no row of its own and renders it as context on vitamin A', () => {
    assert.equal(DISPLAYED_NUTRIENT_KEYS.includes('betaCarotene'), false);

    const rows = buildNutrientRows({
      byNutrient: byNutrient(intake({ amount: 1400 })),
      loggedDays: 7,
      references: [],
      metrics: NO_BODY_METRICS,
      currentYear: CURRENT_YEAR,
    });

    const vitaminA = rows.find((row) => row.key === 'vitaminA');
    assert.ok(vitaminA);
    assert.deepEqual(
      vitaminA.context.map((entry) => entry.key),
      ['betaCarotene'],
    );
    assert.equal(vitaminA.context[0].perDayAmount, 200);
  });

  it('leaves salt off the screen entirely — no published reference, no declared unit', () => {
    assert.equal(DISPLAYED_NUTRIENT_KEYS.includes('nacl'), false);
  });

  it('carries no per-day amount and no share for a nutrient below the coverage bar', () => {
    const rows = buildNutrientRows({
      byNutrient: byNutrient(intake(), { magnesium: NOT_ENOUGH }),
      loggedDays: 7,
      references: [referenceFor('magnesium')],
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1990 }),
      currentYear: CURRENT_YEAR,
    });

    const magnesium = rows.find((row) => row.key === 'magnesium');
    assert.ok(magnesium);
    assert.equal(magnesium.intake.hasEnoughData, false);
    assert.equal(magnesium.perDayAmount, null);
    assert.equal(magnesium.share, null);
  });

  it('carries an intake but no share when the reference is unavailable (the offline path)', () => {
    const rows = buildNutrientRows({
      byNutrient: byNutrient(intake({ amount: 700 })),
      loggedDays: 7,
      references: [],
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1990 }),
      currentYear: CURRENT_YEAR,
    });

    for (const row of rows) {
      assert.equal(row.perDayAmount, 100);
      assert.equal(row.reference.kind, 'not-published');
      assert.equal(row.share, null);
    }
  });

  it('reports a share above one as-is rather than clamping it', () => {
    const rows = buildNutrientRows({
      byNutrient: byNutrient(intake({ amount: 4200 })),
      loggedDays: 7,
      references: [referenceFor('magnesium')],
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1990 }),
      currentYear: CURRENT_YEAR,
    });

    const magnesium = rows.find((row) => row.key === 'magnesium');
    assert.equal(magnesium?.share, 2);
  });
});

describe('pickLightestNutrients', () => {
  it('only ever offers nutrients whose share is known', () => {
    const rows = buildNutrientRows({
      byNutrient: byNutrient(NOT_ENOUGH),
      loggedDays: 7,
      references: [referenceFor('magnesium')],
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1990 }),
      currentYear: CURRENT_YEAR,
    });

    assert.deepEqual(pickLightestNutrients(rows, { limit: 3 }), []);
  });

  it('returns the lowest shares first, capped at the limit', () => {
    const rows = buildNutrientRows({
      byNutrient: byNutrient(intake({ amount: 700 }), { magnesium: intake({ amount: 70 }) }),
      loggedDays: 7,
      references: [referenceFor('magnesium'), { ...referenceFor('zinc'), key: 'zinc', slug: 'zinc' }],
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1990 }),
      currentYear: CURRENT_YEAR,
    });

    const lightest = pickLightestNutrients(rows, { limit: 1 });
    assert.deepEqual(
      lightest.map((row) => row.key),
      ['magnesium'],
    );
  });
});

////////////////////////////////////////////////////////////////////////////////
// Ceilings — the reference amounts that are limits, not goals
////////////////////////////////////////////////////////////////////////////////

/** Every nutrient at 700 in the window (100/day over 7 days), sodium selectively overridden. */
function ceilingRows(sodiumIntake: NutrientDayIntake, { kind = 'ceiling' }: { kind?: NutrientKind } = {}) {
  return buildNutrientRows({
    byNutrient: byNutrient(intake({ amount: 700 }), { sodium: sodiumIntake }),
    loggedDays: 7,
    references: [referenceFor('sodium', { kind })],
    metrics: metricsFor({ biologicalSex: 'female', birthYear: 1990 }),
    currentYear: CURRENT_YEAR,
  });
}

describe('nutrient kind', () => {
  it('defaults an absent or unrecognised kind to target — a stale build never invents a ceiling', () => {
    for (const value of [undefined, null, '', 'TARGET', 'maximum', 42, {}]) {
      assert.equal(normalizeNutrientKind(value), 'target');
    }
    assert.equal(normalizeNutrientKind('ceiling'), 'ceiling');
  });

  it('reads the wire field, and treats an older response with no field at all as a target', () => {
    const [withKind] = parseNutrientReferences({
      nutrients: [{ slug: 'sodium', unit: 'mg', foodKey: 'sodium', kind: 'ceiling', rdaEu: null }],
    });
    assert.equal(withKind.kind, 'ceiling');

    const [withoutKind] = parseNutrientReferences({
      nutrients: [{ slug: 'sodium', unit: 'mg', foodKey: 'sodium', rdaEu: null }],
    });
    assert.equal(withoutKind.kind, 'target');
  });

  it('does not fail the whole envelope on a kind this build has never heard of', () => {
    // Fail-open matters more than strictness here: rejecting the body would
    // blank every reference amount on the screen over one unknown string.
    const [reference] = parseNutrientReferences({
      nutrients: [{ slug: 'sodium', unit: 'mg', foodKey: 'sodium', kind: 'guideline-daily-amount', rdaEu: null }],
    });
    assert.equal(reference.kind, 'target');
  });
});

describe('ceiling rows', () => {
  it('carries the classification, the limit amount and an under-the-limit reading', () => {
    const sodium = ceilingRows(intake({ amount: 700 })).find((row) => row.key === 'sodium');

    assert.ok(sodium);
    assert.equal(sodium.referenceKind, 'ceiling');
    assert.equal(sodium.reference.kind, 'available');
    assert.equal(sodium.reference.kind === 'available' && sodium.reference.amount, 300);
    assert.equal(sodium.perDayAmount, 100);
    // The ratio is still computed — it is what the under/over reading reads —
    // but the screen renders no percentage and no bar for it.
    assert.equal(sodium.share, 100 / 300);
    assert.equal(isAboveReferenceLimit(sodium), false);
  });

  it('reports being over the limit as a fact about the log, with no tier and no clamping', () => {
    const sodium = ceilingRows(intake({ amount: 4200 })).find((row) => row.key === 'sodium');

    assert.ok(sodium);
    assert.equal(sodium.perDayAmount, 600);
    assert.equal(sodium.share, 2);
    assert.equal(isAboveReferenceLimit(sodium), true);
  });

  it('is not "above the limit" when there is no figure to compare', () => {
    const sodium = ceilingRows(NOT_ENOUGH).find((row) => row.key === 'sodium');

    assert.ok(sodium);
    assert.equal(sodium.referenceKind, 'ceiling');
    assert.equal(sodium.share, null);
    assert.equal(isAboveReferenceLimit(sodium), false);
  });

  it('falls back to a target when the cached client response predates the field', () => {
    // `#app/lib/nutrient-reference-client` CASTS the resource route's JSON
    // rather than re-validating it, so a body with no `kind` really can reach
    // the row builder.
    // SAFETY: a full `NutrientReference` satisfies `Partial<NutrientReference>`;
    // the widening is what makes `kind` deletable, modelling the pre-field body.
    const stale = { ...referenceFor('sodium') } as Partial<NutrientReference>;
    delete stale.kind;

    const rows = buildNutrientRows({
      byNutrient: byNutrient(intake({ amount: 700 })),
      loggedDays: 7,
      // SAFETY: `stale` is a complete reference minus `kind` — exactly the body
      // the client casts today, which is the state this test pins.
      references: [stale as NutrientReference],
      metrics: metricsFor({ biologicalSex: 'female', birthYear: 1990 }),
      currentYear: CURRENT_YEAR,
    });

    const sodium = rows.find((row) => row.key === 'sodium');
    assert.ok(sodium);
    assert.equal(sodium.referenceKind, 'target');
    assert.equal(isAboveReferenceLimit(sodium), false);
  });

  it('never enters the lightest-on ranking, however far under the limit the log is', () => {
    // 100 mg/day against a 300 mg limit is a share of 0.33 — comfortably below
    // SUGGESTION_SHARE_CEILING, so this row WOULD rank first if the kind were
    // ignored. Suggestions are derived from this list, so excluding it here is
    // what keeps the screen from recommending the saltiest foods in the corpus.
    const rows = ceilingRows(intake({ amount: 700 }));
    const asTarget = ceilingRows(intake({ amount: 700 }), { kind: 'target' });

    assert.deepEqual(
      pickLightestNutrients(rows, { limit: 5 }).map((row) => row.key),
      [],
    );
    assert.deepEqual(
      pickLightestNutrients(asTarget, { limit: 5 }).map((row) => row.key),
      ['sodium'],
    );
  });

  it('has its copy translated in both shipped locales', () => {
    // The render path reaches for these four keys; a missing one renders the
    // raw dotted path to the reader, and the parity test can only see keys
    // that made it into `en`.
    for (const locale of ['en', 'de']) {
      const parsed = nutrientLimitCopySchema.safeParse(JSON.parse(readLocaleCatalogJson(locale)));
      if (!parsed.success) {
        assert.fail(`${locale}: missing nutrient limit copy — ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
      }
    }
  });
});

////////////////////////////////////////////////////////////////////////////////
// Suggestions
////////////////////////////////////////////////////////////////////////////////

function sourceFood(slug: string, netCarbsPer100g: number | null): NutrientSourceFood {
  return { slug, title: slug, url: null, imageUrl: null, value: 100, netCarbsPer100g, attribution: null };
}

describe('filterSuggestions', () => {
  it('withholds high-carb foods from someone tracking a carb ceiling', () => {
    const foods = [sourceFood('pumpkin-seeds', 4), sourceFood('oats', 55)];

    const filtered = filterSuggestions(foods, { trackingFocus: 'net-carbs' });

    assert.deepEqual(
      filtered.map((food) => food.slug),
      ['pumpkin-seeds'],
    );
  });

  it('keeps every food for a calorie or habit tracker, and when the focus is unset', () => {
    const foods = [sourceFood('pumpkin-seeds', 4), sourceFood('oats', 55), sourceFood('unknown', null)];

    for (const trackingFocus of ['calories', 'habit', null] as const) {
      assert.equal(filterSuggestions(foods, { trackingFocus }).length, 3);
    }
  });
});

////////////////////////////////////////////////////////////////////////////////
// Wire parsing
////////////////////////////////////////////////////////////////////////////////

describe('parseNutrientReferences', () => {
  it('maps a slug onto this app’s nutrient key and keeps the source', () => {
    const references = parseNutrientReferences({
      nutrients: [
        {
          slug: 'magnesium',
          name: 'Magnesium',
          type: 'mineral',
          unit: 'mg',
          foodKey: 'magnesium',
          rdaEu: {
            source: 'EFSA DRV',
            male: { '14-18': 300, '19-30': 350, '31-50': 350, '51-70': 350, over_70: 350 },
            female: { '14-18': 250, '19-30': 300, '31-50': 300, '51-70': 300, over_70: 300 },
            pregnancy: null,
            lactation: null,
          },
          rdaUs: null,
        },
      ],
    });

    assert.equal(references.length, 1);
    assert.equal(references[0].key, 'magnesium');
    assert.equal(references[0].unit, 'mg');
    assert.equal(references[0].rda?.source, 'EFSA DRV');
    assert.equal(references[0].rda?.pregnancy, null);
  });

  it('drops entries this app has no nutrient key for rather than failing the parse', () => {
    const references = parseNutrientReferences({
      nutrients: [
        { slug: 'protein', name: 'Protein', type: 'macro', unit: 'g', foodKey: null, rdaEu: null, rdaUs: null },
      ],
    });

    assert.deepEqual(references, []);
  });

  it('keeps a nutrient with no published reference, so the row can say so', () => {
    const references = parseNutrientReferences({
      nutrients: [{ slug: 'vitamin-d', unit: 'µg', foodKey: 'vitaminD', rdaEu: null }],
    });

    assert.equal(references[0].key, 'vitaminD');
    assert.equal(references[0].rda, null);
  });

  it('throws on an unrecognisable envelope, for the fail-open shell to swallow', () => {
    assert.throws(() => parseNutrientReferences({ oops: true }), NutrientReferenceParseError);
  });
});

describe('parseNutrientSourceFoods', () => {
  it('maps the ranked foods and preserves upstream order', () => {
    const foods = parseNutrientSourceFoods({
      nutrient: 'magnesium',
      foodKey: 'magnesium',
      unit: 'mg',
      foods: [
        { slug: 'pumpkin-seeds', title: 'Pumpkin seeds', url: null, imageUrl: null, netCarbsPer100g: 4, value: 550 },
        { slug: 'almonds', title: 'Almonds', url: null, imageUrl: null, netCarbsPer100g: 5, value: 270 },
      ],
    });

    assert.deepEqual(
      foods.map((food) => food.slug),
      ['pumpkin-seeds', 'almonds'],
    );
    assert.equal(foods[0].value, 550);
  });

  it('throws on an unrecognisable envelope', () => {
    assert.throws(() => parseNutrientSourceFoods({ foods: [{ slug: 'x' }] }), NutrientReferenceParseError);
  });
});

describe('NUTRIENT_SLUGS', () => {
  it('joins vitaminB9 and vitaminE to their real production slugs, not the intuitive-looking ones', () => {
    // LowCarbCheck's live content_nutrients.slug values are `folic-acid-folate`
    // and `vitamin-e-tocopherole` — both are also live URL segments for those
    // nutrients' content pages. This table is the inverse of remix-lcc's
    // `NUTRIENT_SLUG_TO_FOOD_KEY` (app/lib/nutrient-api/keys.ts) and the two
    // must stay in sync.
    assert.equal(NUTRIENT_SLUGS.vitaminB9, 'folic-acid-folate');
    assert.equal(NUTRIENT_SLUGS.vitaminE, 'vitamin-e-tocopherole');
  });

  it('includes the corrected slugs in the resource route allowlist', () => {
    assert.ok(KNOWN_NUTRIENT_SLUGS.includes('folic-acid-folate'));
    assert.ok(KNOWN_NUTRIENT_SLUGS.includes('vitamin-e-tocopherole'));
    assert.ok(!KNOWN_NUTRIENT_SLUGS.includes('vitamin-b-9-folic-acid'));
    assert.ok(!KNOWN_NUTRIENT_SLUGS.includes('vitamin-e'));
  });
});
