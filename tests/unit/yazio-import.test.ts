/**
 * Unit tests for `#app/lib/yazio-import` (M254/01), the pure reader of a
 * `yazio-exporter` export. The fixture numbers are per ONE base unit, so every
 * expected macro below is `per-unit value × amount`, worked out by hand in the
 * comment beside it. Each assertion sits next to a control that makes it fail
 * when the rule it pins is broken.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import daysFixture from '../fixtures/yazio/days.json';
import productsFixture from '../fixtures/yazio/products.json';
import { computeNetCarbsFromParts } from '../../app/lib/net-carbs';
import type { LocalFoodLog } from '../../app/lib/local-store/schema';
import { identifyYazioFile, parseYazioExport, YazioFileError, type YazioImport } from '../../app/lib/yazio-import';

const NOW = Date.UTC(2026, 8, 24, 12, 0);
const BERLIN = 'Europe/Berlin';

/** Float products like 0.663 × 40 are not exact; a nanogram of tolerance is still a pin. */
const TOLERANCE = 1e-9;

function assertClose(actual: number | null, expected: number): void {
  assert.notStrictEqual(actual, null, `expected ${expected}, got null`);
  assert.ok(Math.abs((actual ?? Number.NaN) - expected) < TOLERANCE, `expected ${expected}, got ${actual}`);
}

function importFixture(): YazioImport {
  return parseYazioExport({ days: daysFixture, products: productsFixture, timeZone: BERLIN, now: NOW });
}

function fixtureEntry(consumedId: string): LocalFoodLog {
  const entry = importFixture().entries.find((each) => each.id === `yazio-${consumedId}`);
  assert.ok(entry, `no entry for ${consumedId}`);
  return entry;
}

// Consumed-item ids in tests/fixtures/yazio/days.json.
const OATS_40G = '9c2a1a2e-0001-4a10-8a10-000000000001';
const MILK_200ML = '9c2a1a2e-0001-4a10-8a10-000000000002';
const RICE_150G = '9c2a1a2e-0001-4a10-8a10-000000000003';
const OATS_50G = '9c2a1a2e-0001-4a10-8a10-000000000005';
const MILK_250ML = '9c2a1a2e-0001-4a10-8a10-000000000007';
const SOUP_2_PORTIONS = '9c2a1a2e-0002-4a10-8a10-000000000001';
const SOUP_1_PORTION = '9c2a1a2e-0002-4a10-8a10-000000000002';

// Small inline exports for the rules the fixture cannot vary on its own.
const PRODUCTS = {
  products: {
    'prod-1': { name: 'Test Oats', base_unit: 'g', nutrients: { 'energy.energy': 4, 'nutrient.carb': 0.5 } },
  },
  recipes: {
    'recipe-1': {
      name: 'Test Stew',
      portion_count: 2,
      nutrients: { 'energy.energy': 300, 'nutrient.carb': 20 },
      servings: [{ amount: 300, base_unit: 'g' }],
    },
  },
};
const PRODUCT_ITEM = {
  id: 'item-1',
  date: '2026-09-10 12:00:00',
  daytime: 'lunch',
  type: 'product',
  product_id: 'prod-1',
  amount: 100,
  serving: 'gram',
  serving_quantity: 100,
};
const RECIPE_ITEM = {
  id: 'item-2',
  date: '2026-09-10 13:00:00',
  daytime: 'lunch',
  type: 'recipe_portion',
  recipe_id: 'recipe-1',
  portion_count: 1,
};

function oneDay({
  products = [],
  recipePortions = [],
  simpleProducts = [],
}: {
  products?: readonly object[];
  recipePortions?: readonly object[];
  simpleProducts?: readonly object[];
}) {
  return { '2026-09-10': { consumed: { products, recipe_portions: recipePortions, simple_products: simpleProducts } } };
}

function importInline({
  days,
  products = PRODUCTS,
  timeZone = BERLIN,
}: {
  days: object;
  products?: object;
  timeZone?: string;
}): YazioImport {
  return parseYazioExport({ days, products, timeZone, now: NOW });
}

describe('identifyYazioFile', () => {
  it('recognises each exporter file by its content', () => {
    assert.strictEqual(identifyYazioFile({ json: daysFixture }), 'days');
    assert.strictEqual(identifyYazioFile({ json: productsFixture }), 'products');
  });

  it('recognises nothing else', () => {
    // Controls: an openplate backup, an empty object, an array, a string, and a dictionary whose keys are not dates.
    assert.strictEqual(identifyYazioFile({ json: { version: 24, foodLogs: [] } }), null);
    assert.strictEqual(identifyYazioFile({ json: {} }), null);
    assert.strictEqual(identifyYazioFile({ json: [] }), null);
    assert.strictEqual(identifyYazioFile({ json: 'days' }), null);
    assert.strictEqual(identifyYazioFile({ json: { yesterday: { consumed: {} } } }), null);
  });
});

describe('parseYazioExport: a product', () => {
  it('scales per-gram nutrients by the amount, fibre and sugar included', () => {
    const oats = fixtureEntry(OATS_40G);
    assert.strictEqual(oats.name, 'Rolled Oats');
    assert.strictEqual(oats.quantityGrams, 40);
    assertClose(oats.macros.kcal, 155.6); // 3.89 × 40
    assertClose(oats.macros.carbs, 26.52); // 0.663 × 40
    assertClose(oats.macros.fiber, 4.08); // 0.102 × 40
    assertClose(oats.macros.sugars, 0.44); // 0.011 × 40
    assertClose(oats.macros.protein, 6.76); // 0.169 × 40
    assertClose(oats.macros.fat, 2.76); // 0.069 × 40
    assert.strictEqual(oats.macros.polyols, null);
  });

  it('scales the same product differently for a different amount (control)', () => {
    const oats = fixtureEntry(OATS_50G);
    assertClose(oats.macros.kcal, 194.5); // 3.89 × 50
    assertClose(oats.macros.fiber, 5.1); // 0.102 × 50
    assert.strictEqual(oats.quantityGrams, 50);
  });

  it('leaves a nutrient YAZIO does not carry as null, never 0', () => {
    const rice = fixtureEntry(RICE_150G);
    assert.strictEqual(rice.macros.fiber, null);
    assert.strictEqual(rice.macros.sugars, null);
    assert.strictEqual(rice.macros.polyols, null);
    assertClose(rice.macros.kcal, 195); // 1.3 × 150
    assertClose(rice.macros.carbs, 42); // 0.28 × 150
    assertClose(rice.macros.protein, 4.05); // 0.027 × 150
    assertClose(rice.macros.fat, 0.45); // 0.003 × 150
    // Control: the same reader gives a number where the key exists.
    assert.notStrictEqual(fixtureEntry(OATS_40G).macros.fiber, null);
  });

  it('reads a nutrient that is not a number as null, never 0', () => {
    const products = {
      ...PRODUCTS,
      products: {
        'prod-1': { name: 'Odd', base_unit: 'g', nutrients: { 'nutrient.carb': 'n/a', 'nutrient.fat': 0.1 } },
      },
    };
    const [entry] = importInline({ days: oneDay({ products: [PRODUCT_ITEM] }), products }).entries;
    assert.ok(entry);
    assert.strictEqual(entry.macros.carbs, null);
    assertClose(entry.macros.fat, 10); // 0.1 × 100, the control in the same product
  });

  it('counts a millilitre as a gram', () => {
    const milk = fixtureEntry(MILK_200ML);
    assert.strictEqual(milk.quantityGrams, 200);
    assertClose(milk.macros.kcal, 128); // 0.64 × 200
    assertClose(milk.macros.carbs, 9.6); // 0.048 × 200
    assertClose(milk.macros.sugars, 9.6); // 0.048 × 200
    assertClose(milk.macros.protein, 6.4); // 0.032 × 200
    assertClose(milk.macros.fat, 7.2); // 0.036 × 200
    assert.strictEqual(milk.macros.fiber, null);
    // Control: another amount of the same milk.
    assert.strictEqual(fixtureEntry(MILK_250ML).quantityGrams, 250);
    assertClose(fixtureEntry(MILK_250ML).macros.kcal, 160); // 0.64 × 250
  });

  it('writes the fixed fields of a manual, non-AI entry', () => {
    const { macros: _macros, ...rest } = fixtureEntry(OATS_40G);
    assert.deepStrictEqual(rest, {
      id: `yazio-${OATS_40G}`,
      name: 'Rolled Oats',
      quantityGrams: 40,
      mealType: 'breakfast',
      source: 'manual',
      aiEstimated: false,
      curatedSource: null,
      foodId: null,
      dayKey: '2026-09-01',
      loggedAt: Date.UTC(2026, 8, 1, 6, 15), // 08:15 CEST
      createdAt: NOW,
      logBatchId: null,
      carbBasis: 'available',
    });
  });
});

describe('parseYazioExport: a recipe portion', () => {
  it('multiplies per-portion nutrients by the portions eaten, and divides the weight by the recipe portion count', () => {
    const soup = fixtureEntry(SOUP_2_PORTIONS);
    assert.strictEqual(soup.name, 'Lentil Soup');
    // Ingredients 200 g + 100 g make 4 portions: 75 g each, 2 eaten = 150 g.
    // Without the division by the recipe's portion_count it would read 600 g.
    assertClose(soup.quantityGrams, 150);
    assertClose(soup.macros.kcal, 290.4); // 145.2 × 2
    assertClose(soup.macros.carbs, 42.8); // 21.4 × 2
    assertClose(soup.macros.fiber, 13); // 6.5 × 2
    assertClose(soup.macros.sugars, 4.2); // 2.1 × 2
    assertClose(soup.macros.protein, 16.2); // 8.1 × 2
    assertClose(soup.macros.fat, 6.4); // 3.2 × 2
    assert.strictEqual(soup.macros.polyols, null);
  });

  it('scales with the portions eaten (control)', () => {
    const soup = fixtureEntry(SOUP_1_PORTION);
    assertClose(soup.quantityGrams, 75); // 300 g / 4 × 1
    assertClose(soup.macros.kcal, 145.2); // 145.2 × 1
  });
});

describe('parseYazioExport: carb basis', () => {
  it('marks every entry available, so fibre is not subtracted a second time', () => {
    const { entries } = importFixture();
    assert.ok(entries.length > 0);
    assert.ok(entries.every((entry) => entry.carbBasis === 'available'));
    const oats = fixtureEntry(OATS_40G);
    assertClose(computeNetCarbsFromParts(oats.macros, oats.carbBasis), 26.52); // carbs only
    // Control: with no basis the same parts read 26.52 minus 4.08, 22.44.
    assertClose(computeNetCarbsFromParts(oats.macros), 22.44);
  });
});

describe('parseYazioExport: entry ids', () => {
  it('derives the id from the consumed item, so a second import writes the same ids', () => {
    const first = importFixture().entries.map((entry) => entry.id);
    const second = parseYazioExport({
      days: daysFixture,
      products: productsFixture,
      timeZone: 'UTC',
      now: NOW + 1,
    }).entries.map((entry) => entry.id);
    assert.deepStrictEqual(second, first);
    assert.ok(first.includes(`yazio-${OATS_40G}`));
    // Control: every consumed item gets its own id.
    assert.strictEqual(new Set(first).size, first.length);
  });

  it('gives a different consumed item a different id (control)', () => {
    const [a] = importInline({ days: oneDay({ products: [PRODUCT_ITEM] }) }).entries;
    const [b] = importInline({ days: oneDay({ products: [{ ...PRODUCT_ITEM, id: 'item-9' }] }) }).entries;
    assert.strictEqual(a?.id, 'yazio-item-1');
    assert.strictEqual(b?.id, 'yazio-item-9');
  });
});

describe('parseYazioExport: day and time', () => {
  it('reads the wall clock in the given zone, across a DST change', () => {
    const products = [
      { ...PRODUCT_ITEM, id: 'winter', date: '2026-03-28 08:15:00' },
      { ...PRODUCT_ITEM, id: 'summer', date: '2026-03-29 08:15:00' },
    ];
    const days = { '2026-03-28': { consumed: { products } } };
    const berlin = importInline({ days }).entries;
    // The day before the change is CET (UTC+1), the day of it CEST (UTC+2).
    assert.deepStrictEqual(
      berlin.map((entry) => [entry.dayKey, entry.loggedAt]),
      [
        ['2026-03-28', Date.UTC(2026, 2, 28, 7, 15)],
        ['2026-03-29', Date.UTC(2026, 2, 29, 6, 15)],
      ],
    );
    // Control: the same export read in UTC lands two different instants.
    const utc = importInline({ days, timeZone: 'UTC' }).entries;
    assert.deepStrictEqual(
      utc.map((entry) => entry.loggedAt),
      [Date.UTC(2026, 2, 28, 8, 15), Date.UTC(2026, 2, 29, 8, 15)],
    );
  });

  it('takes the day from the item date, not from the day it is filed under', () => {
    const days = { '2026-09-10': { consumed: { products: [{ ...PRODUCT_ITEM, date: '2026-09-11 00:30:00' }] } } };
    assert.strictEqual(importInline({ days }).entries[0]?.dayKey, '2026-09-11');
    // Control: the ordinary case files it on its own day.
    assert.strictEqual(importInline({ days: oneDay({ products: [PRODUCT_ITEM] }) }).entries[0]?.dayKey, '2026-09-10');
  });

  it('keeps the YAZIO meal, and reads an unknown one from the clock', () => {
    const known = { ...PRODUCT_ITEM, id: 'known', daytime: 'breakfast', date: '2026-09-10 19:30:00' };
    const unknown = { ...PRODUCT_ITEM, id: 'unknown', daytime: 'brunch', date: '2026-09-10 19:30:00' };
    const entries = importInline({ days: oneDay({ products: [known, unknown] }) }).entries;
    // 19:30 is in the dinner window of `mealTypeForMinutes`; a known daytime wins over the clock.
    assert.deepStrictEqual(
      entries.map((entry) => entry.mealType),
      ['breakfast', 'dinner'],
    );
  });
});

describe('parseYazioExport: skip reasons', () => {
  it('skips an item whose product is not in products.json', () => {
    const missing = importInline({ days: oneDay({ products: [{ ...PRODUCT_ITEM, product_id: 'prod-gone' }] }) });
    assert.strictEqual(missing.entries.length, 0);
    assert.strictEqual(missing.report.skipped['missing-product'], 1);
    // Control: the same item with a known product becomes an entry.
    const present = importInline({ days: oneDay({ products: [PRODUCT_ITEM] }) });
    assert.strictEqual(present.entries.length, 1);
    assert.strictEqual(present.report.skipped['missing-product'], 0);
  });

  it('skips a portion whose recipe is not in products.json', () => {
    const missing = importInline({ days: oneDay({ recipePortions: [{ ...RECIPE_ITEM, recipe_id: 'recipe-gone' }] }) });
    assert.strictEqual(missing.entries.length, 0);
    assert.strictEqual(missing.report.skipped['missing-recipe'], 1);
    const present = importInline({ days: oneDay({ recipePortions: [RECIPE_ITEM] }) });
    assert.strictEqual(present.entries.length, 1);
    assert.strictEqual(present.report.skipped['missing-recipe'], 0);
    assertClose(present.entries[0]?.quantityGrams ?? null, 150); // 300 g / 2 portions × 1
  });

  it('skips a recipe whose weight cannot be computed', () => {
    const recipe = PRODUCTS.recipes['recipe-1'];
    const broken = [
      { ...recipe, servings: [] },
      { ...recipe, servings: [{ amount: 'lots', base_unit: 'g' }] },
      { ...recipe, servings: [{ amount: 0, base_unit: 'g' }] },
      { ...recipe, servings: [{ amount: 300, base_unit: 'piece' }] },
      { ...recipe, portion_count: 0 },
    ];
    for (const each of broken) {
      const result = importInline({
        days: oneDay({ recipePortions: [RECIPE_ITEM] }),
        products: { ...PRODUCTS, recipes: { 'recipe-1': each } },
      });
      assert.strictEqual(result.entries.length, 0);
      assert.strictEqual(result.report.skipped['recipe-without-weight'], 1);
    }
    // Control: the intact recipe has a weight.
    assert.strictEqual(
      importInline({ days: oneDay({ recipePortions: [RECIPE_ITEM] }) }).report.skipped['recipe-without-weight'],
      0,
    );
  });

  it('counts a quick entry and never reads it', () => {
    const quick = importInline({
      days: oneDay({ simpleProducts: [{ name: 'Almonds', nutrients: { 'energy.energy': 90 } }, {}] }),
    });
    assert.strictEqual(quick.entries.length, 0);
    assert.strictEqual(quick.report.skipped['quick-entry'], 2);
    assert.strictEqual(quick.report.skipped['invalid-item'], 0);
    // Control: no quick entries, no count.
    assert.strictEqual(importInline({ days: oneDay({}) }).report.skipped['quick-entry'], 0);
  });

  it('skips an item that fails its schema, and keeps the rest of the file', () => {
    const bad = { ...PRODUCT_ITEM, id: 'bad', amount: 'a handful' };
    const good = { ...PRODUCT_ITEM, id: 'good' };
    const result = importInline({ days: oneDay({ products: [bad, good] }) });
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.id),
      ['yazio-good'],
    );
    assert.strictEqual(result.report.skipped['invalid-item'], 1);
    // Control: a numeric amount makes the same item valid.
    assert.strictEqual(
      importInline({ days: oneDay({ products: [{ ...bad, amount: 30 }] }) }).report.skipped['invalid-item'],
      0,
    );
  });

  it('skips an impossible date and a second item with an id already taken', () => {
    const products = [
      { ...PRODUCT_ITEM, id: 'bad-date', date: '2026-02-30 12:00:00' },
      { ...PRODUCT_ITEM, id: 'twice' },
      { ...PRODUCT_ITEM, id: 'twice', amount: 50 },
    ];
    const result = importInline({ days: oneDay({ products }) });
    assert.deepStrictEqual(
      result.entries.map((entry) => [entry.id, entry.quantityGrams]),
      [['yazio-twice', 100]],
    );
    assert.strictEqual(result.report.skipped['invalid-item'], 2);
  });
});

describe('parseYazioExport: the report', () => {
  it('summarises the fixture', () => {
    // Entries: 09-01 oats, milk, rice, soup; 09-02 oats, rice; 09-03 milk, soup.
    // Skipped: the ghost product (09-01), the ghost recipe (09-02), the string amount (09-02),
    // the recipe without ingredients (09-03) and two quick entries (09-01, 09-02).
    assert.deepStrictEqual(importFixture().report, {
      entryCount: 8,
      dayCount: 3,
      firstDay: '2026-09-01',
      lastDay: '2026-09-03',
      skipped: {
        'missing-product': 1,
        'missing-recipe': 1,
        'recipe-without-weight': 1,
        'quick-entry': 2,
        'invalid-item': 1,
      },
    });
    assert.strictEqual(importFixture().entries.length, 8);
  });

  it('reports no days for an export with nothing to import (control)', () => {
    assert.deepStrictEqual(importInline({ days: oneDay({ simpleProducts: [{}] }) }).report, {
      entryCount: 0,
      dayCount: 0,
      firstDay: null,
      lastDay: null,
      skipped: {
        'missing-product': 0,
        'missing-recipe': 0,
        'recipe-without-weight': 0,
        'quick-entry': 1,
        'invalid-item': 0,
      },
    });
  });
});

describe('parseYazioExport: the wrong file', () => {
  it('throws, naming the file, when the two are swapped', () => {
    assert.throws(
      () => parseYazioExport({ days: productsFixture, products: daysFixture, timeZone: BERLIN, now: NOW }),
      (cause) => cause instanceof YazioFileError && cause.file === 'days',
    );
    assert.throws(
      () => parseYazioExport({ days: daysFixture, products: { recipes: {} }, timeZone: BERLIN, now: NOW }),
      (cause) => cause instanceof YazioFileError && cause.file === 'products',
    );
    // Control: the right order does not throw (every fixture test above).
    assert.doesNotThrow(() => importFixture());
  });

  it('throws on a zone that does not exist', () => {
    assert.throws(() =>
      parseYazioExport({ days: daysFixture, products: productsFixture, timeZone: 'Mars/Base', now: NOW }),
    );
  });
});
