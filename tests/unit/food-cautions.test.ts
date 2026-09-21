/**
 * The food caution decision (M219/03): the D3 table, the two allergen
 * certainties, the two tiers, the render-time re-evaluation of one stored
 * row, and the two codecs that carry the raw flags through a form and a
 * backup file.
 *
 * EVERY ASSERTION HAS A CONTROL. Each "shows" row of the table sits beside
 * the row that differs by one input and does not show: pregnant against none
 * and against lactating on the same flag, a listed allergen against an empty
 * list on the same flag, `mayContain` against `allergens` on the same
 * profile. The render-time proof writes ONE row to a real store and reads it
 * back twice, once per status, so the row itself cannot be carrying the
 * answer. Nothing here reads a catalog: the chip's words are another file's
 * subject, this one owns the facts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import SettingsLifePhase from '../../app/routes/settings.life-phase';
import { EMPTY_BODY_METRICS } from '../../app/models/body-metrics';

import {
  NO_CAUTION_PROFILE,
  cautionKey,
  cautionProfileOf,
  cautionTier,
  decideCautions,
  decodeFoodFlags,
  encodeFoodFlags,
  foodFlagsField,
} from '../../app/lib/food-cautions';
import type { FoodCaution } from '../../app/lib/food-cautions';
import { ALLERGENS, PREGNANCY_CATEGORIES } from '../../app/services/vision/schema';
import type { FoodFlags } from '../../app/services/vision/schema';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { getLocalFoodLog, putLocalFoodLog } from '../../app/lib/local-store/primary-store';
import { exportBackup, shareableSnapshotSchema } from '../../app/lib/local-store/backup';
import type { LocalFoodLog, ReproductiveStatus } from '../../app/lib/local-store/schema';

/** Flags with nothing in them, the "model looked and found nothing" answer. */
const NO_FLAGS: FoodFlags = { pregnancy: [], allergens: [], mayContain: [] };

/** The flags of a raw-milk cheese board, one category, one certain allergen. */
const RAW_DAIRY_MILK: FoodFlags = { pregnancy: ['raw-dairy'], allergens: ['milk'], mayContain: [] };

/** A stored row, exactly as the confirm step writes one, carrying the raw flags. */
function loggedRow(flags: FoodFlags | undefined): LocalFoodLog {
  return {
    id: 'log-1',
    name: 'Cheese board',
    quantityGrams: 120,
    macros: { carbs: 2, fiber: 0, sugars: 1, polyols: null, protein: 25, fat: 30, kcal: 380 },
    mealType: 'dinner',
    source: 'plate_ai',
    aiEstimated: true,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-09-21',
    loggedAt: Date.parse('2026-09-21T18:30:00Z'),
    createdAt: Date.parse('2026-09-21T18:30:00Z'),
    logBatchId: 'batch-1',
    flags,
  };
}

/** The keys of the cautions one call answers, so a table row reads as one line. */
function decidedKeys(
  flags: FoodFlags | undefined,
  reproductiveStatus: ReproductiveStatus | null | undefined,
  allergens: readonly (typeof ALLERGENS)[number][] = [],
): string[] {
  return decideCautions({ flags, reproductiveStatus, allergens }).map(cautionKey);
}

describe('decideCautions, the D3 table for the pregnancy categories', () => {
  it('pregnant plus raw-dairy shows the raw-dairy caution', () => {
    assert.deepEqual(decidedKeys(RAW_DAIRY_MILK, 'pregnant'), ['pregnancy:raw-dairy']);
  });

  it('none plus raw-dairy shows nothing, the control on the status', () => {
    assert.deepEqual(decidedKeys(RAW_DAIRY_MILK, 'none'), []);
  });

  it('an unset or null status plus raw-dairy shows nothing either', () => {
    assert.deepEqual(decidedKeys(RAW_DAIRY_MILK, null), []);
    assert.deepEqual(decidedKeys(RAW_DAIRY_MILK, undefined), []);
  });

  it('lactating plus raw-dairy shows nothing: breastfeeding is not pregnancy', () => {
    assert.deepEqual(decidedKeys(RAW_DAIRY_MILK, 'lactating'), []);
  });

  it('lactating plus alcohol shows the alcohol caution, the control on the category', () => {
    const flags: FoodFlags = { pregnancy: ['alcohol'], allergens: [], mayContain: [] };
    assert.deepEqual(decidedKeys(flags, 'lactating'), ['pregnancy:alcohol']);
  });

  it('lactating sees exactly alcohol, caffeine and high-mercury-fish out of every category', () => {
    const everything: FoodFlags = { pregnancy: [...PREGNANCY_CATEGORIES], allergens: [], mayContain: [] };
    assert.deepEqual(decidedKeys(everything, 'lactating'), [
      'pregnancy:alcohol',
      'pregnancy:caffeine',
      'pregnancy:high-mercury-fish',
    ]);
  });

  it('pregnant sees every category, in the order the vocabulary defines them', () => {
    // Flagged in reverse on purpose: the ORDER of the chips is the vocabulary's,
    // never the model's, so two foods with the same flags read the same way.
    const reversed: FoodFlags = { pregnancy: PREGNANCY_CATEGORIES.toReversed(), allergens: [], mayContain: [] };
    assert.deepEqual(
      decidedKeys(reversed, 'pregnant'),
      PREGNANCY_CATEGORIES.map((category) => `pregnancy:${category}`),
    );
  });

  it('a food with no flags at all, and one with empty flags, earns nothing for anybody', () => {
    for (const status of ['pregnant', 'lactating', 'none', null] as const) {
      assert.deepEqual(decidedKeys(undefined, status, ['milk']), []);
      assert.deepEqual(decidedKeys(NO_FLAGS, status, ['milk']), []);
    }
  });
});

describe('decideCautions, the allergen chips follow the profile list', () => {
  it('allergens [milk] plus a food that contains milk shows the caution, for every status including none', () => {
    for (const status of ['pregnant', 'lactating', 'none', null, undefined] as const) {
      assert.deepEqual(decidedKeys({ ...NO_FLAGS, allergens: ['milk'] }, status, ['milk']), ['allergen:milk:contains']);
    }
  });

  it('allergens [] plus a food that contains milk shows nothing, the control on the list', () => {
    assert.deepEqual(decidedKeys({ ...NO_FLAGS, allergens: ['milk'] }, 'pregnant', []), []);
  });

  it('a listed allergen the food does not carry shows nothing, the control on the flag', () => {
    assert.deepEqual(decidedKeys({ ...NO_FLAGS, allergens: ['eggs'] }, 'none', ['milk']), []);
  });

  it('orders the allergen chips by the EU 14, not by the order the person ticked them', () => {
    const flags: FoodFlags = { ...NO_FLAGS, allergens: ['nuts', 'gluten', 'milk'] };
    assert.deepEqual(decidedKeys(flags, 'none', ['nuts', 'milk', 'gluten']), [
      'allergen:gluten:contains',
      'allergen:milk:contains',
      'allergen:nuts:contains',
    ]);
  });

  it('puts the pregnancy chips before the allergen chips on one food', () => {
    assert.deepEqual(decidedKeys(RAW_DAIRY_MILK, 'pregnant', ['milk']), [
      'pregnancy:raw-dairy',
      'allergen:milk:contains',
    ]);
  });
});

describe('decideCautions, the two allergen certainties (may-contain against contains)', () => {
  it('mayContain [milk] with profile [milk] yields a may-contain caution', () => {
    const cautions = decideCautions({
      flags: { ...NO_FLAGS, mayContain: ['milk'] },
      reproductiveStatus: 'none',
      allergens: ['milk'],
    });
    assert.deepEqual(cautions, [{ kind: 'allergen', allergen: 'milk', tier: 'avoid', certainty: 'may-contain' }]);
  });

  it('allergens [milk] with profile [milk] yields a contains caution, the control on the certainty', () => {
    const cautions = decideCautions({
      flags: { ...NO_FLAGS, allergens: ['milk'] },
      reproductiveStatus: 'none',
      allergens: ['milk'],
    });
    assert.deepEqual(cautions, [{ kind: 'allergen', allergen: 'milk', tier: 'avoid', certainty: 'contains' }]);
  });

  it('mayContain [milk] with profile [] yields nothing, the control on the list', () => {
    assert.deepEqual(decidedKeys({ ...NO_FLAGS, mayContain: ['milk'] }, 'none', []), []);
  });

  it('lists the contains chips before the may-contain chips', () => {
    const flags: FoodFlags = { ...NO_FLAGS, allergens: ['nuts'], mayContain: ['gluten'] };
    assert.deepEqual(decidedKeys(flags, 'none', ['gluten', 'nuts']), [
      'allergen:nuts:contains',
      'allergen:gluten:may-contain',
    ]);
  });
});

describe('cautionTier, the tier split', () => {
  it('caffeine is the one limit', () => {
    assert.equal(cautionTier('caffeine'), 'limit');
  });

  it('raw-fish is avoid, the control, and so is every other category', () => {
    assert.equal(cautionTier('raw-fish'), 'avoid');
    for (const category of PREGNANCY_CATEGORIES) {
      assert.equal(cautionTier(category), category === 'caffeine' ? 'limit' : 'avoid', category);
    }
  });

  it('the decided caution carries the tier: caffeine limit, raw-fish avoid, an allergen avoid', () => {
    const flags: FoodFlags = { pregnancy: ['caffeine', 'raw-fish'], allergens: ['fish'], mayContain: [] };
    const tiers = new Map(
      decideCautions({ flags, reproductiveStatus: 'pregnant', allergens: ['fish'] }).map((caution) => [
        cautionKey(caution),
        caution.tier,
      ]),
    );
    assert.equal(tiers.get('pregnancy:caffeine'), 'limit');
    assert.equal(tiers.get('pregnancy:raw-fish'), 'avoid');
    assert.equal(tiers.get('allergen:fish:contains'), 'avoid');
    assert.equal(tiers.size, 3);
  });
});

describe('cautionKey', () => {
  it('names every caution one food can earn without a collision', () => {
    const cautions: FoodCaution[] = [
      ...PREGNANCY_CATEGORIES.map((category): FoodCaution => ({
        kind: 'pregnancy',
        category,
        tier: cautionTier(category),
      })),
      ...ALLERGENS.map((allergen): FoodCaution => ({
        kind: 'allergen',
        allergen,
        tier: 'avoid',
        certainty: 'contains',
      })),
      ...ALLERGENS.map((allergen): FoodCaution => ({
        kind: 'allergen',
        allergen,
        tier: 'avoid',
        certainty: 'may-contain',
      })),
    ];
    const keys = cautions.map(cautionKey);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(keys.length, PREGNANCY_CATEGORIES.length + 2 * ALLERGENS.length);
  });
});

describe('the decision is computed at render time, never stored', () => {
  it('one stored log row, read once as pregnant and once as none, yields a different chip set', async () => {
    const store = createPrimaryStore();
    await putLocalFoodLog(loggedRow(RAW_DAIRY_MILK), { store });

    const stored = await getLocalFoodLog('log-1', { store });
    assert.ok(stored, 'the row was not written');
    // The row carries the RAW flags and no decided field of any kind.
    assert.deepEqual(stored.flags, RAW_DAIRY_MILK);
    assert.equal('cautions' in stored, false);
    assert.equal('decidedCautions' in stored, false);

    const asPregnant = decideCautions({ flags: stored.flags, reproductiveStatus: 'pregnant', allergens: [] });
    const asNone = decideCautions({ flags: stored.flags, reproductiveStatus: 'none', allergens: [] });
    assert.deepEqual(asPregnant.map(cautionKey), ['pregnancy:raw-dairy']);
    assert.deepEqual(asNone.map(cautionKey), []);

    // The same row, read a third time by somebody who just listed milk: the
    // allergen chip appears with no write to the row in between.
    const stillStored = await getLocalFoodLog('log-1', { store });
    assert.deepEqual(stillStored?.flags, RAW_DAIRY_MILK);
    const asNoneWithMilk = decideCautions({
      flags: stillStored?.flags,
      reproductiveStatus: 'none',
      allergens: ['milk'],
    });
    assert.deepEqual(asNoneWithMilk.map(cautionKey), ['allergen:milk:contains']);
  });

  it('a lactating reader of the same raw-dairy row sees no pregnancy chip, the control on the status', async () => {
    const store = createPrimaryStore();
    await putLocalFoodLog(loggedRow(RAW_DAIRY_MILK), { store });
    const stored = await getLocalFoodLog('log-1', { store });
    assert.deepEqual(decideCautions({ flags: stored?.flags, reproductiveStatus: 'lactating', allergens: [] }), []);
  });
});

describe('cautionProfileOf, the two facts off a profile row', () => {
  it('reads the status and the list, and answers the empty profile for none', () => {
    assert.deepEqual(cautionProfileOf({ reproductiveStatus: 'pregnant', allergens: ['milk'] }), {
      reproductiveStatus: 'pregnant',
      allergens: ['milk'],
    });
    assert.deepEqual(cautionProfileOf({ reproductiveStatus: undefined, allergens: undefined }), NO_CAUTION_PROFILE);
    assert.deepEqual(cautionProfileOf(null), NO_CAUTION_PROFILE);
    assert.deepEqual(cautionProfileOf(undefined), NO_CAUTION_PROFILE);
  });
});

describe('the hidden-field codec', () => {
  it('round trips the raw flags, and keeps an empty flags object distinct from no flags', () => {
    assert.deepEqual(decodeFoodFlags(encodeFoodFlags(RAW_DAIRY_MILK)), RAW_DAIRY_MILK);
    assert.deepEqual(decodeFoodFlags(encodeFoodFlags(NO_FLAGS)), NO_FLAGS);
    assert.equal(encodeFoodFlags(undefined), '');
    assert.equal(decodeFoodFlags(''), undefined);
    assert.equal(decodeFoodFlags(null), undefined);
    assert.equal(decodeFoodFlags(undefined), undefined);
  });

  it('fails open on a malformed value and drops an unknown word, never the log', () => {
    assert.equal(decodeFoodFlags('{not json'), undefined);
    assert.equal(decodeFoodFlags('"a string"'), undefined);
    assert.equal(decodeFoodFlags('{"pregnancy": "raw-dairy"}'), undefined);
    assert.deepEqual(
      decodeFoodFlags('{"pregnancy": ["raw-dairy", "kryptonite"], "allergens": ["milk"]}'),
      RAW_DAIRY_MILK,
    );
  });

  it('the zod field reads the posted value the same way, and an absent field is no flags', () => {
    assert.deepEqual(foodFlagsField.parse(encodeFoodFlags(RAW_DAIRY_MILK)), RAW_DAIRY_MILK);
    assert.equal(foodFlagsField.parse(''), undefined);
    assert.equal(foodFlagsField.parse(undefined), undefined);
    assert.equal(foodFlagsField.parse('{oops'), undefined);
  });
});

describe('the backup round trip keeps the raw flags on the log', () => {
  it('exports and re-parses a logged row with its flags intact, and a row without flags stays without', async () => {
    const store = createPrimaryStore();
    await putLocalFoodLog(loggedRow(RAW_DAIRY_MILK), { store });
    await putLocalFoodLog({ ...loggedRow(undefined), id: 'log-2' }, { store });

    const exported = await exportBackup({ store, now: () => new Date('2026-09-21T20:00:00.000Z') });
    const normalised = shareableSnapshotSchema.parse(exported.data);
    const byId = new Map(normalised.foodLogs.map((log) => [log.id, log]));
    assert.deepEqual(byId.get('log-1')?.flags, RAW_DAIRY_MILK);
    assert.equal(byId.get('log-2')?.flags, undefined);
    assert.equal(byId.size, 2);
  });

  it('drops an unknown category from a file written by a longer list and keeps the known ones, the control', () => {
    const normalised = shareableSnapshotSchema.parse({
      foods: [],
      foodLogs: [
        {
          ...loggedRow(undefined),
          flags: { pregnancy: ['raw-dairy', 'quinine'], allergens: ['milk', 'kryptonite'], mayContain: null },
        },
      ],
      weightEntries: [],
      profile: null,
    });
    assert.deepEqual(normalised.foodLogs[0]?.flags, RAW_DAIRY_MILK);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The life phase page names where the hints come from (D7)
////////////////////////////////////////////////////////////////////////////////

/** The two sentences, read off the catalog rather than typed here. */
const lifePhaseCopy = z
  .object({ cautions: z.object({ guidance: z.string(), source: z.string() }) })
  .parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')))
  .cautions;

/** The real page, over the "told us nothing" record; `useFetcher` wants a data router. */
function renderLifePhasePage(): string {
  // SAFETY: the page reads only `loaderData`; the router props it never touches are absent on purpose.
  const props = { loaderData: { bodyMetrics: EMPTY_BODY_METRICS, today: '2026-09-22' } } as Parameters<
    typeof SettingsLifePhase
  >[0];
  const element = createElement(SettingsLifePhase, props);
  const router = createMemoryRouter([{ path: '/settings/life-phase', element: withI18n(element) }], {
    initialEntries: ['/settings/life-phase'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** The text inside the one `<p data-slot="...">`, or `undefined` when no paragraph carries the slot. */
function slotText(markup: string, slot: string): string | undefined {
  const match = new RegExp(`<p[^>]*data-slot="${slot}"[^>]*>([^<]*)</p>`).exec(markup);
  return match?.[1];
}

describe('the life phase page', () => {
  it('renders the guidance sentence and, directly under it, the source line, each in its own slot', () => {
    const markup = renderLifePhasePage();
    assert.equal(slotText(markup, 'cautions-guidance'), lifePhaseCopy.guidance);
    assert.equal(slotText(markup, 'cautions-source'), lifePhaseCopy.source);
    assert.ok(markup.indexOf('data-slot="cautions-guidance"') < markup.indexOf('data-slot="cautions-source"'));
    assert.equal(markup.split('data-slot="cautions-source"').length - 1, 1);
    assert.equal(markup.includes('cautions.'), false);
  });

  it('carries no third caution slot, the control that the reader above is looking at real slots', () => {
    const markup = renderLifePhasePage();
    assert.equal(slotText(markup, 'cautions-nonexistent'), undefined);
    assert.equal(markup.includes('data-slot="cautions-nonexistent"'), false);
  });
});
