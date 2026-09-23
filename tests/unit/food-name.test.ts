/**
 * A food's name in the reader's language (M251 spec 03).
 *
 * Four claims, each with a control that goes red:
 *   1. `displayFoodName` picks the reader's language, and a row with no
 *      `nameTranslations` renders its own `name` in every language.
 *   2. The review screen carries the model's name and translations through
 *      the REAL rendered form, the real schema and the real row builders, and
 *      a hand-edited name drops them from both rows.
 *   3. Every path that copies a logged food copies its names.
 *   4. The field survives a backup round trip, a v24 envelope imports with it
 *      absent, and the pantry keeps it for an untouched row only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { parseWithZod } from '@conform-to/zod/v4';

import { withI18n } from './trends-i18n-harness';
import {
  applyFoodNameEdit,
  decodeNameTranslations,
  displayFoodName,
  pinShownFoodName,
  resolveConfirmedNameTranslations,
} from '../../app/lib/food-name';
import { ConfirmDraftForm, ConfirmDraftSchema, buildConfirmedBatch } from '../../app/routes/add.photo';
import { buildCopiedEntry, buildRecentLogEntry, buildRestoredEntry, LogRecentSchema, RestoreLogSchema } from '../../app/routes/diary';
import { buildRestorePayload } from '../../app/routes/diary.entry.$id';
import { NO_CAUTION_PROFILE } from '../../app/lib/food-cautions';
import { buildLogsFromSavedMealItems, savedMealItemFromLog } from '../../app/lib/local-store/saved-meals';
import { computeLocalRecentFoods, localFoodToCandidate } from '../../app/lib/local-store/local-quick-add';
import { migrateEnvelopeForward } from '../../app/lib/local-store/backup';
import { nextPantry } from '../../app/lib/pantry-merge';
import { SCHEMA_VERSION, type LocalFoodLog, type LocalPantryItem } from '../../app/lib/local-store/schema';
import type { PlateIdentification } from '../../app/services/vision/types';

const NAMES = { en: 'Apple', de: 'Apfel', fr: 'Pomme', it: 'Mela', es: 'Manzana', tr: 'Elma' };
const NOW_MS = Date.parse('2026-09-23T12:00:00Z');

/** One logged food, AI-named, with every translation. */
function translatedLog(): LocalFoodLog {
  return {
    id: 'log-1',
    name: 'Apfel',
    nameTranslations: NAMES,
    quantityGrams: 150,
    macros: { carbs: 20, fiber: 3, sugars: 15, polyols: null, protein: 0.5, fat: 0.2, kcal: 80 },
    mealType: 'snack',
    source: 'plate_ai',
    aiEstimated: true,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-09-23',
    loggedAt: NOW_MS,
    createdAt: NOW_MS,
    logBatchId: null,
  };
}

describe('displayFoodName', () => {
  it('shows the reader’s language', () => {
    assert.equal(displayFoodName(translatedLog(), 'fr'), 'Pomme');
    assert.equal(displayFoodName(translatedLog(), 'tr'), 'Elma');
  });

  it('control: a row with no nameTranslations renders its name in every language', () => {
    const { nameTranslations: _dropped, ...legacy } = translatedLog();
    for (const language of ['en', 'de', 'fr', 'it', 'es', 'tr']) assert.equal(displayFoodName(legacy, language), 'Apfel');
  });

  it('falls back to the name for a missing or blank language, and for a language the app does not ship', () => {
    const partial = { name: 'Apfel', nameTranslations: { de: 'Apfel', fr: '   ' } };
    assert.equal(displayFoodName(partial, 'fr'), 'Apfel');
    assert.equal(displayFoodName(partial, 'es'), 'Apfel');
    assert.equal(displayFoodName(translatedLog(), 'nl'), 'Apfel');
  });
});

describe('the hand-edit rule', () => {
  it('keeps the translations when the confirmed name is the model’s, whitespace aside', () => {
    const kept = resolveConfirmedNameTranslations({ name: ' Apfel ', aiName: 'Apfel', translations: NAMES });
    assert.deepEqual(kept, NAMES);
  });

  it('drops them when the person typed their own name (control for the case above)', () => {
    assert.equal(resolveConfirmedNameTranslations({ name: 'Omas Apfel', aiName: 'Apfel', translations: NAMES }), undefined);
  });

  it('an editor that saves the name it showed is not a rename, one that changes it is', () => {
    const unchanged = applyFoodNameEdit({ food: translatedLog(), submittedName: 'Pomme', language: 'fr' });
    assert.deepEqual(unchanged, { name: 'Apfel', nameTranslations: NAMES });
    const renamed = applyFoodNameEdit({ food: translatedLog(), submittedName: 'Pomme verte', language: 'fr' });
    assert.deepEqual(renamed, { name: 'Pomme verte', nameTranslations: undefined });
  });

  it('pins the language on screen to the name the review shows', () => {
    const pinned = pinShownFoodName({ translations: { ...NAMES, de: 'Äpfel' }, name: 'Apfel', language: 'de' });
    assert.equal(pinned.de, 'Apfel');
    assert.equal(pinned.fr, 'Pomme');
  });
});

/** An AI answer that named one food in German with every translation. */
const IDENTIFICATION: PlateIdentification = {
  unreadable: false,
  foods: [
    {
      name: 'Apfel',
      translations: NAMES,
      estimatedGrams: 150,
      confidence: 'high',
      macroSource: 'estimated',
      flags: { pregnancy: [], allergens: [], mayContain: [] },
      macrosPer100g: { carbs: 12 },
    },
  ],
};

/** The value of one hidden input in the rendered review, HTML entities undone. */
function hiddenValue(html: string, name: string): string {
  const pattern = new RegExp(`<input[^>]*name="${name.replaceAll(/[.[\]]/g, String.raw`\$&`)}"[^>]*value="([^"]*)"`);
  const match = pattern.exec(html);
  assert.ok(match, `the review rendered no ${name} input`);
  return (match[1] ?? '').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

/** Renders the real review screen, posts what it emitted with `name` typed in, and builds the rows. */
function confirmWithName(name: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/add/photo',
        element: withI18n(
          createElement(ConfirmDraftForm, {
            cautionProfile: NO_CAUTION_PROFILE,
            intakeSource: 'photo',
            identification: IDENTIFICATION,
            foodDb: undefined,
            modelId: 'test-model',
            lastResult: undefined,
            logDate: null,
            logDateLabel: null,
            photoFile: null,
            userId: 0,
            defaultMealType: null,
            typedText: null,
          }),
        ),
      },
    ],
    { initialEntries: ['/add/photo'] },
  );
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  const formData = new FormData();
  formData.set('items[0].include', 'on');
  formData.set('items[0].name', name);
  formData.set('items[0].estimatedGrams', '150');
  formData.set('items[0].macros.carbs', '12');
  formData.set('items[0].aiName', hiddenValue(html, 'items[0].aiName'));
  formData.set('items[0].nameTranslations', hiddenValue(html, 'items[0].nameTranslations'));
  const submission = parseWithZod(formData, { schema: ConfirmDraftSchema });
  if (submission.status !== 'success') throw new Error('the confirm schema refused the review’s own submission');
  let counter = 0;
  const [row] = buildConfirmedBatch({
    items: submission.value.items,
    mealType: null,
    loggedAtMs: NOW_MS,
    dayKey: '2026-09-23',
    createdAtMs: NOW_MS,
    logBatchId: 'batch-1',
    newId: () => `id-${(counter += 1)}`,
  });
  if (row === undefined) throw new Error('the batch wrote no row');
  return row;
}

describe('the review screen to the stored rows', () => {
  it('stores the model’s names on the log AND the personal food when the name is accepted', () => {
    const { entry, food } = confirmWithName('Apfel');
    // The review renders in English here, so the English entry is pinned to
    // the name the screen showed.
    assert.deepEqual(entry.nameTranslations, { ...NAMES, en: 'Apfel' });
    assert.deepEqual(food.nameTranslations, entry.nameTranslations);
    assert.equal(displayFoodName(entry, 'fr'), 'Pomme');
  });

  it('control: a hand-edited name stores no translations on either row', () => {
    const { entry, food } = confirmWithName('Omas Apfel');
    assert.equal(entry.nameTranslations, undefined);
    assert.equal(food.nameTranslations, undefined);
    assert.equal(displayFoodName(entry, 'fr'), 'Omas Apfel');
  });

  it('a malformed hidden value reads as no translations, never a refused log', () => {
    assert.equal(decodeNameTranslations('{not json'), undefined);
    assert.equal(decodeNameTranslations(''), undefined);
  });
});

describe('every copy of a logged food copies its names', () => {
  it('copy-day, saved meals, recents, chips, Undo and custom-food candidates', () => {
    const log = translatedLog();
    const copied = buildCopiedEntry({ log, id: 'c', dayKey: '2026-09-24', loggedAtMs: NOW_MS, createdAtMs: NOW_MS, logBatchId: 'b' });
    assert.deepEqual(copied.nameTranslations, NAMES);

    const item = savedMealItemFromLog(log);
    assert.deepEqual(item.nameTranslations, NAMES);
    const [relogged] = buildLogsFromSavedMealItems({
      items: [item],
      makeId: () => 'r',
      dayKey: '2026-09-24',
      loggedAtMs: NOW_MS,
      mealType: null,
      logBatchId: 'b',
      createdAtMs: NOW_MS,
    });
    assert.deepEqual(relogged?.nameTranslations, NAMES);

    const [recent] = computeLocalRecentFoods([log], { limit: 5 });
    assert.deepEqual(recent?.nameTranslations, NAMES);

    const restored = RestoreLogSchema.parse(buildRestorePayload(log));
    const undone = buildRestoredEntry({ value: restored, id: 'u', loggedAtMs: NOW_MS, dayKey: '2026-09-23', createdAtMs: NOW_MS });
    assert.deepEqual(undone.nameTranslations, NAMES);

    const chip = LogRecentSchema.parse({
      name: 'Apfel',
      quantityGrams: '150',
      date: '2026-09-23',
      aiEstimated: 'true',
      nameTranslations: JSON.stringify(NAMES),
    });
    const chipEntry = buildRecentLogEntry({ value: chip, id: 'k', loggedAtMs: NOW_MS, mealType: null, createdAtMs: NOW_MS });
    assert.deepEqual(chipEntry.nameTranslations, NAMES);

    const candidate = localFoodToCandidate({
      id: 'f',
      name: 'Apfel',
      nameTranslations: NAMES,
      brand: null,
      macrosPer100g: log.macros,
      source: 'plate_ai',
      createdAt: NOW_MS,
    });
    assert.deepEqual(candidate.nameTranslations, NAMES);
  });

  it('control: a copy of a row without translations carries none', () => {
    const { nameTranslations: _dropped, ...legacy } = translatedLog();
    const copied = buildCopiedEntry({ log: legacy, id: 'c', dayKey: '2026-09-24', loggedAtMs: NOW_MS, createdAtMs: NOW_MS, logBatchId: 'b' });
    assert.equal(copied.nameTranslations, undefined);
  });
});

/** A food log as a file may hold it: any language key, including one this build does not ship. */
type FiledFoodLog = Omit<LocalFoodLog, 'nameTranslations'> & { nameTranslations?: Readonly<Record<string, string>> };

/** A backup envelope at `schemaVersion` holding one food log. */
function envelopeWith(schemaVersion: number, foodLog: FiledFoodLog) {
  return {
    schemaVersion,
    exportedAt: '2026-09-23T12:00:00.000Z',
    data: {
      foods: [],
      foodLogs: [foodLog],
      weightEntries: [],
      profile: null,
      fasts: [],
      savedMeals: [],
      pantryItems: [],
      activityMarks: [],
      awards: [],
      fastingSettings: null,
      shareIdentity: null,
      sharePeers: [],
      researchIdentity: null,
      studyEnrolments: [],
    },
  };
}

describe('the stored field', () => {
  it('is at schema v25', () => {
    assert.equal(SCHEMA_VERSION, 25);
  });

  it('survives a backup round trip, an unknown language dropped', () => {
    const migrated = migrateEnvelopeForward(envelopeWith(25, { ...translatedLog(), nameTranslations: { ...NAMES, nl: 'Appel' } }));
    assert.deepEqual(migrated.data.foodLogs[0]?.nameTranslations, NAMES);
  });

  it('control: a v24 row without the key imports with it absent, and renders its name', () => {
    const { nameTranslations: _dropped, ...legacy } = translatedLog();
    const migrated = migrateEnvelopeForward(envelopeWith(24, legacy));
    const row = migrated.data.foodLogs[0];
    assert.ok(row);
    assert.equal(row.nameTranslations, undefined);
    assert.equal(displayFoodName(row, 'fr'), 'Apfel');
  });
});

describe('the pantry', () => {
  const stored: LocalPantryItem = {
    id: 'p1',
    name: 'Eier',
    nameTranslations: { de: 'Eier', en: 'Eggs', fr: 'Œufs' },
    amount: 6,
    unit: 'piece',
    category: 'dairy',
    source: 'photo',
    createdAt: NOW_MS,
    updatedAt: NOW_MS,
  };
  const shownInEnglish = {
    key: 'p1',
    name: 'Eggs',
    amount: '6',
    unit: 'piece' as const,
    category: 'dairy' as const,
    nameOrigin: { storedName: 'Eier', shownName: 'Eggs', nameTranslations: stored.nameTranslations },
  };

  it('an untouched row shown in another language saves back onto itself with its names', () => {
    const [row, ...rest] = nextPantry({ stored: [stored], rows: [shownInEnglish], path: 'manual', now: NOW_MS });
    assert.equal(rest.length, 0);
    assert.equal(row?.id, 'p1');
    assert.equal(row?.name, 'Eier');
    assert.deepEqual(row?.nameTranslations, stored.nameTranslations);
  });

  it('control: a renamed row is the person’s words, with no translations', () => {
    const [row] = nextPantry({
      stored: [stored],
      rows: [{ ...shownInEnglish, name: 'Free-range eggs' }],
      path: 'manual',
      now: NOW_MS,
    });
    assert.equal(row?.name, 'Free-range eggs');
    assert.equal(row?.nameTranslations, undefined);
  });
});
