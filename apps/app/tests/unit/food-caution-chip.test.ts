/**
 * The food caution chip and the flags' journey into the log (M219/03).
 *
 * Three things, each with a control:
 *
 *  1. THE FLAGS SURVIVE THE CONFIRM STEP. The real `ConfirmDraftForm` is
 *     rendered with an identification whose foods carry flags; the hidden
 *     input it emits is read back off the markup; that posted value goes
 *     through the real `ConfirmDraftSchema` and the real `buildConfirmedBatch`;
 *     and the written row carries the identification's flags. Deleting the
 *     input, the schema field or the builder line breaks the run. The control
 *     is an item the model flagged with nothing, whose row keeps an EMPTY flags
 *     object, and a posted blank, whose row has no flags at all.
 *  2. A DATABASE-SEARCH FOOD HAS NO FLAGS AND RENDERS NO CHIP. `/add`'s real
 *     `PortionStep` + `LogSchema` + `buildLoggedEntry` path over a curated
 *     match, the apply-match snapshot of that match, and the entry receipt
 *     rendered for a pregnant person who listed the food's own allergen: no
 *     chip anywhere, because nothing on that path carries a flag (a named
 *     v1 gap, not a bug). The control is the same receipt over a scan row
 *     with flags, which draws two.
 *  3. THE CHIP ITSELF: its slot, its kind, its tier, the key it read, the
 *     icon per kind, and the classes it must not carry. Asserted by
 *     STRUCTURE, never by a phrase: the copy is read out of the catalog, and
 *     `cautions.` never appears raw in a working render.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';
import i18next from 'i18next';
import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import {
  FOOD_CAUTION_CHIP_SLOT,
  FoodCautionChip,
  FoodCautionChips,
  cautionTextKey,
} from '../../app/components/food-caution-chip';
import { NO_CAUTION_PROFILE, cautionKey, decideCautions } from '../../app/lib/food-cautions';
import type { CautionProfile, FoodCaution } from '../../app/lib/food-cautions';
import { ConfirmDraftForm, ConfirmDraftSchema, buildConfirmedBatch } from '../../app/routes/add.photo';
import { EntryReceipt } from '../../app/routes/diary.entry.$id';
import { PortionStep, buildLoggedEntry, createLogSchema } from '../../app/routes/add.search';
import type { AddSearchCandidate } from '../../app/routes/add.search';
import { localCuratedMatchToCandidate } from '../../app/lib/local-store/local-quick-add';
import { resolveAppliedMatchSnapshot } from '../../app/services/food-resolution/apply-match';
import { matchTier } from '../../app/lib/match-quality';
import { ALLERGENS, PREGNANCY_CATEGORIES } from '../../app/services/vision/schema';
import type { FoodFlags } from '../../app/services/vision/schema';
import type { PlateIdentification } from '../../app/services/vision';
import type { FoodMatch } from '../../app/services/food-resolution';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';

const DAY_KEY = '2026-09-21';
const NOW_MS = Date.parse(`${DAY_KEY}T18:30:00Z`);

/** Chips render `cautions.*` keys; the sentences are read from the catalog, never typed here. */
const copySchema = z.object({
  cautions: z.object({
    contains: z.object(Object.fromEntries(ALLERGENS.map((value) => [value, z.string()]))),
    mayContain: z.object(Object.fromEntries(ALLERGENS.map((value) => [value, z.string()]))),
    pregnancy: z.object(Object.fromEntries(PREGNANCY_CATEGORIES.map((value) => [value, z.string()]))),
    guidance: z.string(),
    source: z.string(),
  }),
});
const copy = copySchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
).cautions;

const NO_FLAGS: FoodFlags = { pregnancy: [], allergens: [], mayContain: [] };
const CHEESE_FLAGS: FoodFlags = { pregnancy: ['raw-dairy'], allergens: ['milk'], mayContain: ['nuts'] };
const PREGNANT_WITH_MILK: CautionProfile = { reproductiveStatus: 'pregnant', allergens: ['milk', 'nuts'] };

/** A two-item plate: a flagged cheese board and an unflagged salad, the control beside the subject. */
const IDENTIFICATION: PlateIdentification = {
  unreadable: false,
  foods: [
    {
      name: 'Cheese board',
      translations: { en: 'Cheese board' },
      estimatedGrams: 120,
      confidence: 'high',
      macroSource: 'estimated',
      flags: CHEESE_FLAGS,
      macrosPer100g: { carbs: 2, protein: 25, fat: 30, kcal: 380 },
    },
    {
      name: 'Green salad',
      translations: { en: 'Green salad' },
      estimatedGrams: 80,
      confidence: 'medium',
      macroSource: 'estimated',
      flags: NO_FLAGS,
      macrosPer100g: { carbs: 3, protein: 1 },
    },
  ],
};

function renderUnderRouter(path: string, element: ReturnType<typeof createElement>): string {
  const router = createMemoryRouter([{ path, element: withI18n(element) }], { initialEntries: [path] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function renderReview(cautionProfile: CautionProfile): string {
  return renderUnderRouter(
    '/scan',
    createElement(ConfirmDraftForm, {
      cautionProfile,
      identification: IDENTIFICATION,
      intakeSource: 'photo',
      foodDb: undefined,
      modelId: 'test-model',
      lastResult: undefined,
      logDate: null,
      logDateLabel: null,
      photoFile: null,
      userId: 0,
      defaultMealType: 'dinner',
      typedText: null,
    }),
  );
}

/** Every `<... data-slot="food-caution-chip" ...>` tag in document order. */
function chipTags(markup: string): string[] {
  return [...markup.matchAll(new RegExp(`<span[^>]*data-slot="${FOOD_CAUTION_CHIP_SLOT}"[^>]*>`, 'g'))].map(
    (match) => match[0],
  );
}

/** The class list of the first `<svg>` in a render, empty when there is none. */
function iconOf(markup: string): string {
  return /<svg[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? '';
}

/** One attribute off one tag. */
function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
}

/** The hidden `items[n].flags` input's value as the review emits it, HTML-decoded. */
function emittedFlags(markup: string, index: number): string {
  const tag = new RegExp(`<input[^>]*name="items\\[${index}\\]\\.flags"[^>]*>`).exec(markup)?.[0];
  assert.ok(tag, `the confirm step emitted no flags input for item ${index}`);
  assert.equal(attribute(tag, 'type'), 'hidden');
  return (attribute(tag, 'value') ?? '').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

/** Posts the rendered review the way the browser would, with the flags value read off the markup, and builds the rows. */
function writtenRows(postedFlags: readonly string[]): LocalFoodLog[] {
  const formData = new FormData();
  formData.set('mealType', 'dinner');
  IDENTIFICATION.foods.forEach((food, index) => {
    formData.set(`items[${index}].include`, 'on');
    formData.set(`items[${index}].name`, food.name);
    formData.set(`items[${index}].estimatedGrams`, String(food.estimatedGrams));
    formData.set(`items[${index}].macros.carbs`, String(food.macrosPer100g?.carbs ?? 0));
    formData.set(`items[${index}].macroSource`, food.macroSource);
    formData.set(`items[${index}].flags`, postedFlags[index] ?? '');
  });
  const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
  assert.equal(submission.status, 'success', 'ConfirmDraftSchema rejected the confirm-step submission');
  if (submission.status !== 'success') throw new Error('unreachable');
  let counter = 0;
  return buildConfirmedBatch({
    items: submission.value.items,
    mealType: 'dinner',
    loggedAtMs: NOW_MS,
    dayKey: DAY_KEY,
    createdAtMs: NOW_MS,
    logBatchId: 'batch-1',
    newId: () => `id-${(counter += 1)}`,
  }).map((pair) => pair.entry);
}

describe('the flags survive from the identification result into the logged row', () => {
  it('emits the raw flags as one hidden input per item, and the confirm mapping writes them onto the row', () => {
    const markup = renderReview(NO_CAUTION_PROFILE);
    const posted = [emittedFlags(markup, 0), emittedFlags(markup, 1)];
    assert.notEqual(posted[0], '', 'the flagged item posted a blank');

    const rows = writtenRows(posted);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0]?.flags, CHEESE_FLAGS);
    // The control: an item the model flagged with nothing keeps an EMPTY
    // flags object, "looked and found nothing", which is not the same fact as
    // "never had flags".
    assert.deepEqual(rows[1]?.flags, NO_FLAGS);
    // And no decided field rides along, on either row.
    for (const row of rows) {
      assert.equal('cautions' in row, false);
      assert.equal('decidedCautions' in row, false);
    }
  });

  it('a posted blank, which is what a draft without an identification carries, writes a row with no flags at all', () => {
    const rows = writtenRows(['', '']);
    assert.equal(rows[0]?.flags, undefined);
    assert.equal('flags' in (rows[0] ?? {}), true, 'the key is written as undefined, not dropped by the builder');
  });

  it('a tampered value fails open to no flags and never refuses the log', () => {
    const rows = writtenRows(['{not json', '"nope"']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.flags, undefined);
    assert.equal(rows[1]?.flags, undefined);
  });
});

describe('the review list draws the chips before confirming', () => {
  it('draws the cheese board its three chips for a pregnant person who listed milk and nuts, and the salad none', () => {
    const markup = renderReview(PREGNANT_WITH_MILK);
    const tags = chipTags(markup);
    assert.deepEqual(
      tags.map((tag) => [attribute(tag, 'data-caution-kind'), attribute(tag, 'data-caution-tier')]),
      [
        ['pregnancy', 'avoid'],
        ['allergen', 'avoid'],
        ['allergen', 'avoid'],
      ],
    );
    // The sentences are the catalog's, in the decided order, and no raw key leaks.
    assert.equal(markup.includes(copy.pregnancy['raw-dairy']), true);
    assert.equal(markup.includes(copy.contains.milk), true);
    assert.equal(markup.includes(copy.mayContain.nuts), true);
    assert.equal(markup.includes('cautions.'), false);
    // The chips sit inside the FIRST item's card and before the second's.
    const firstCard = markup.indexOf('Cheese board');
    const secondCard = markup.indexOf('Green salad');
    const lastChip = markup.lastIndexOf('data-slot="food-caution-chip"');
    assert.ok(firstCard < lastChip && lastChip < secondCard, 'a chip landed outside the flagged item');
  });

  it('draws no chip for a person with nothing on the profile, the control', () => {
    const markup = renderReview(NO_CAUTION_PROFILE);
    assert.equal(chipTags(markup).length, 0);
    assert.equal(markup.includes(copy.pregnancy['raw-dairy']), false);
  });

  it('draws only the allergen chips for a person with status none who listed milk', () => {
    const markup = renderReview({ reproductiveStatus: 'none', allergens: ['milk'] });
    const tags = chipTags(markup);
    assert.deepEqual(
      tags.map((tag) => attribute(tag, 'data-caution-kind')),
      ['allergen'],
    );
    assert.equal(markup.includes(copy.contains.milk), true);
    assert.equal(markup.includes(copy.mayContain.nuts), false);
  });
});

////////////////////////////////////////////////////////////////////////////////
// A database-search food, with no flags, through /add and onto the receipt
////////////////////////////////////////////////////////////////////////////////

function curatedMatch(): FoodMatch {
  return {
    slug: 'camembert',
    locale: 'en',
    title: 'Camembert',
    canonicalName: 'Camembert',
    url: null,
    imageUrl: null,
    macrosPer100g: { kcal: 300, protein: 20, fat: 24, carbs: 0.5, fiber: 0, sugars: 0.5, polyols: null },
    netCarbsPer100g: 0.5,
    attribution: null,
    score: 0.95,
    origin: 'bls',
    portionSize: 30,
  };
}

/** `/add`'s real path: the real `PortionStep`, the real `LogSchema`, the real `buildLoggedEntry`. */
function logCandidate(candidate: AddSearchCandidate): LocalFoodLog {
  const element = createElement(PortionStep, {
    candidate,
    defaultMealType: 'lunch',
    returnTo: '/diary',
    logContext: { date: null, label: null, switchToTodayHref: '/add' },
    lastResult: undefined,
    onBack: () => undefined,
  });
  const html = renderUnderRouter('/add', element);
  const formData = new FormData();
  for (const [tag] of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = attribute(tag, 'name');
    if (name === undefined) continue;
    formData.set(name, (attribute(tag, 'value') ?? '').replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  }
  formData.set('name', candidate.name);
  formData.set('quantityGrams', '30');
  for (const [key, value] of Object.entries(candidate.macrosPer100g)) {
    formData.set(key, value === null ? '' : String(value));
  }
  const submission = parseWithZod(formData, { schema: createLogSchema(i18next.t) });
  assert.equal(submission.status, 'success', 'LogSchema rejected the portion-step submission');
  if (submission.status !== 'success') throw new Error('unreachable');
  return buildLoggedEntry({
    data: submission.value,
    id: 'log-db',
    loggedAtMs: NOW_MS,
    dayKey: DAY_KEY,
    createdAtMs: NOW_MS,
  });
}

/** A scan row, exactly as `buildConfirmedEntry` writes one, for the control. */
function scanRow(flags: FoodFlags | undefined): LocalFoodLog {
  return {
    id: 'log-scan',
    name: 'Cheese board',
    quantityGrams: 120,
    macros: { carbs: 2, fiber: 0, sugars: 1, polyols: null, protein: 25, fat: 30, kcal: 380 },
    mealType: 'dinner',
    source: 'plate_ai',
    aiEstimated: true,
    curatedSource: null,
    foodId: null,
    dayKey: DAY_KEY,
    loggedAt: NOW_MS,
    createdAt: NOW_MS,
    logBatchId: 'batch-1',
    flags,
  };
}

/** The entry receipt, as `clientLoader` shapes its data for an unlinked entry, for one person. */
function renderReceipt(log: LocalFoodLog, cautionProfile: CautionProfile): string {
  const siblings: LocalFoodLog[] = [];
  const element = createElement(EntryReceipt, {
    loaderData: {
      userId: 0,
      log,
      siblings,
      cautionProfile,
      grams: log.quantityGrams,
      snapshotMacros: log.macros,
      basisPer100g: log.macros,
      loggedAtDate: 'Mon, Sep 21, 2026',
      loggedAtTime: '6:30 PM',
      loggedAtDateValue: DAY_KEY,
      loggedAtTimeValue: '18:30',
      todayValue: DAY_KEY,
      backTo: '/diary',
    },
  });
  return renderUnderRouter('/diary/entry/1', element);
}

describe('a database-search food, which has no flags, still logs and renders with no chip', () => {
  it('the apply-match snapshot carries no flags, and neither does the row /add writes for it', () => {
    const match = curatedMatch();
    const snapshot = resolveAppliedMatchSnapshot({
      appliedCuratedSource: 'lowcarbcheck:camembert',
      matches: [match],
      editedMacrosPer100g: { ...match.macrosPer100g },
    });
    assert.equal(
      'flags' in snapshot,
      false,
      'apply-match grew a flags field, so this named gap is closed and this test is stale',
    );

    const logged = logCandidate({ ...localCuratedMatchToCandidate(match), matchTier: matchTier(match.score) });
    assert.equal(logged.curatedSource, 'lowcarbcheck:camembert');
    assert.equal(logged.flags, undefined);
    assert.deepEqual(decideCautions({ flags: logged.flags, ...PREGNANT_WITH_MILK }), []);
  });

  it('renders the receipt of that row with no chip for a pregnant person who listed milk, the very case a scan would flag', () => {
    const logged = logCandidate({ ...localCuratedMatchToCandidate(curatedMatch()), matchTier: matchTier(0.95) });
    const markup = renderReceipt(logged, PREGNANT_WITH_MILK);
    assert.equal(chipTags(markup).length, 0);
    assert.equal(markup.includes('Camembert'), true, 'the receipt did not render');
  });

  it('renders two chips on the receipt of a scan row with flags for the same person, the control', () => {
    const markup = renderReceipt(
      scanRow({ pregnancy: ['raw-dairy'], allergens: ['milk'], mayContain: [] }),
      PREGNANT_WITH_MILK,
    );
    const tags = chipTags(markup);
    assert.deepEqual(
      tags.map((tag) => attribute(tag, 'data-caution-kind')),
      ['pregnancy', 'allergen'],
    );
    // The chips sit in the header, before the hero card's first figure.
    const header = markup.indexOf('Cheese board');
    const hero = markup.indexOf('data-slot="card"');
    const chip = markup.indexOf('data-slot="food-caution-chip"');
    assert.ok(header < chip && chip < hero, 'the chips are not in the header');
  });

  it('renders no chip on the receipt of the same scan row for a person with status none and no list, the render-time control', () => {
    const markup = renderReceipt(
      scanRow({ pregnancy: ['raw-dairy'], allergens: ['milk'], mayContain: [] }),
      NO_CAUTION_PROFILE,
    );
    assert.equal(chipTags(markup).length, 0);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The chip itself
////////////////////////////////////////////////////////////////////////////////

function renderChip(caution: FoodCaution): string {
  return renderToStaticMarkup(withI18n(createElement(FoodCautionChip, { caution })));
}

const CAFFEINE: FoodCaution = { kind: 'pregnancy', category: 'caffeine', tier: 'limit' };
const RAW_DAIRY: FoodCaution = { kind: 'pregnancy', category: 'raw-dairy', tier: 'avoid' };
const CONTAINS_MILK: FoodCaution = { kind: 'allergen', allergen: 'milk', tier: 'avoid', certainty: 'contains' };
const MAY_CONTAIN_MILK: FoodCaution = { kind: 'allergen', allergen: 'milk', tier: 'avoid', certainty: 'may-contain' };

describe('FoodCautionChip', () => {
  it('is a span with the slot, not a button and not a link, and tapping it opens nothing', () => {
    const markup = renderChip(RAW_DAIRY);
    assert.equal(chipTags(markup).length, 1);
    assert.equal(markup.includes('<button'), false);
    assert.equal(markup.includes('<a '), false);
    assert.equal(markup.includes('role='), false);
    assert.equal(markup.includes('onClick'), false);
  });

  it('paints the tone from the tier: avoid is the warning pair, limit is the muted pair', () => {
    const avoid = chipTags(renderChip(RAW_DAIRY))[0] ?? '';
    const limit = chipTags(renderChip(CAFFEINE))[0] ?? '';
    assert.equal(attribute(avoid, 'data-caution-tier'), 'avoid');
    assert.equal(attribute(limit, 'data-caution-tier'), 'limit');
    assert.equal(avoid.includes('bg-accent-amber-surface'), true);
    assert.equal(avoid.includes('text-accent-amber'), true);
    assert.equal(limit.includes('bg-accent-amber-surface'), false);
    assert.equal(limit.includes('bg-muted'), true);
  });

  it('wraps: no truncate, no max width, no nowrap, no overflow-hidden, and no thick left border', () => {
    for (const caution of [RAW_DAIRY, CAFFEINE, CONTAINS_MILK, MAY_CONTAIN_MILK]) {
      const tag = chipTags(renderChip(caution))[0] ?? '';
      const classes = attribute(tag, 'class') ?? '';
      assert.equal(/\btruncate\b/.test(classes), false, classes);
      assert.equal(/\bmax-w-/.test(classes), false, classes);
      assert.equal(/whitespace-nowrap/.test(classes), false, classes);
      assert.equal(/overflow-hidden/.test(classes), false, classes);
      assert.equal(/border-l-[248]/.test(classes), false, classes);
    }
  });

  it('carries a different icon for an allergen than for a pregnancy category', () => {
    const pregnancy = renderChip(RAW_DAIRY);
    const allergen = renderChip(CONTAINS_MILK);
    assert.notEqual(iconOf(pregnancy), '', 'the pregnancy chip has no icon');
    assert.notEqual(iconOf(allergen), '', 'the allergen chip has no icon');
    assert.notEqual(iconOf(pregnancy), iconOf(allergen));
    // Lucide names its icons in the class list, so the two names differ.
    assert.equal(/lucide-baby/.test(pregnancy), true);
    assert.equal(/lucide-triangle-alert/.test(allergen), true);
    // The icon is decoration: the sentence carries the meaning.
    assert.equal(/<svg[^>]*aria-hidden="true"/.test(pregnancy), true);
  });

  it('reads the sentence from the catalog by kind and certainty, and leaks no raw key', () => {
    assert.equal(cautionTextKey(RAW_DAIRY), 'cautions.pregnancy.raw-dairy');
    assert.equal(cautionTextKey(CAFFEINE), 'cautions.pregnancy.caffeine');
    assert.equal(cautionTextKey(CONTAINS_MILK), 'cautions.contains.milk');
    assert.equal(cautionTextKey(MAY_CONTAIN_MILK), 'cautions.mayContain.milk');
    assert.equal(renderChip(RAW_DAIRY).includes(`>${copy.pregnancy['raw-dairy']}<`), true);
    assert.equal(renderChip(CONTAINS_MILK).includes(`>${copy.contains.milk}<`), true);
    assert.equal(renderChip(MAY_CONTAIN_MILK).includes(`>${copy.mayContain.milk}<`), true);
    // The control on the certainty: the two milk chips say different things.
    assert.notEqual(copy.contains.milk, copy.mayContain.milk);
    for (const caution of [RAW_DAIRY, CAFFEINE, CONTAINS_MILK, MAY_CONTAIN_MILK]) {
      assert.equal(renderChip(caution).includes('cautions.'), false);
    }
  });

  it('is a chip the reader of the catalog can check: the English hedges, and the caffeine line names the 200 mg', () => {
    // Content pins on the SOURCE strings (D5b), not wording pins: a rewording
    // keeps the hedge and the figure or fails.
    assert.equal(copy.pregnancy['raw-dairy'].toLowerCase().includes('may be'), true);
    assert.equal(copy.pregnancy['raw-meat'].toLowerCase().includes('may be'), true);
    assert.equal(copy.pregnancy.caffeine.includes('200 mg'), true);
    assert.equal(copy.mayContain.milk.toLowerCase().startsWith('may contain'), true);
    assert.equal(copy.contains.milk.toLowerCase().startsWith('contains'), true);
    for (const allergen of ALLERGENS) {
      assert.notEqual(copy.contains[allergen], copy.mayContain[allergen], allergen);
    }
    // The guidance sentence on the life phase page names the three bodies and the limit.
    for (const body of ['NHS', 'BfR', 'ACOG']) assert.equal(copy.guidance.includes(body), true, body);
    assert.equal(copy.guidance.toLowerCase().includes('do not replace'), true);
  });

  it('a row of chips renders nothing at all for no cautions, and one chip per caution otherwise', () => {
    assert.equal(renderToStaticMarkup(withI18n(createElement(FoodCautionChips, { cautions: [] }))), '');
    const markup = renderToStaticMarkup(
      withI18n(createElement(FoodCautionChips, { cautions: [RAW_DAIRY, CAFFEINE, CONTAINS_MILK] })),
    );
    assert.equal(chipTags(markup).length, 3);
    assert.equal(markup.includes('flex-wrap'), true);
    assert.deepEqual([RAW_DAIRY, CAFFEINE, CONTAINS_MILK].map(cautionKey).length, 3);
  });
});
