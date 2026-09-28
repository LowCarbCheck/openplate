/**
 * The allergen list on the profile (M219/02): the parse helper, the store
 * round trip through the real normaliser, the form reader, and the shared
 * fieldset rendered for real.
 *
 * EVERY ASSERTION HAS A CONTROL. The parse tests carry an unknown string
 * beside the known ones; the round trip reads through the BACKUP schema,
 * with an unknown entry that must be dropped rather than refused (the sync
 * merge casts the profile entity without a parse, so it is not what this
 * file proves); and the fieldset is asserted by STRUCTURE,
 * never by wording, so a rewording in `en/common.json` does not redden this
 * file but a disclaimer that moved out of the fieldset does. The copy is read
 * out of the catalog rather than typed in here, and `allergens.` never
 * appears raw in the markup of a working render.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import { ALLERGEN_DISCLAIMER_SLOT, AllergenFields } from '../../app/components/allergen-fields';
import { ALLERGENS } from '../../app/services/vision/schema';
import {
  ALLERGEN_VALUES,
  ALLERGENS_FIELD,
  isAllergen,
  parseAllergens,
  readAllergensField,
} from '../../app/models/allergens';
import type { Allergen } from '../../app/models/allergens';
import { createPrimaryStore } from '../../app/lib/local-store/store';
import { exportBackup, shareableSnapshotSchema } from '../../app/lib/local-store/backup';
import {
  getLocalAllergens,
  getLocalProfileGoals,
  putLocalAllergens,
  putLocalProfileGoals,
} from '../../app/lib/local-store/primary-store';

/** The EU 14 as Annex II of Regulation 1169/2011 lists them, transcribed rather than read off the module under test. */
const EU_14 = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
];

/**
 * The shipped copy this file compares against, parsed rather than indexed, so
 * a key renamed in the catalog but not in the component fails HERE instead of
 * shipping a raw `allergens.name.milk` to a person.
 */
const copySchema = z.object({
  allergens: z.object({
    legend: z.string(),
    hint: z.string(),
    disclaimer: z.string(),
    name: z.object(Object.fromEntries(EU_14.map((value) => [value, z.string()]))),
  }),
});

const copy = copySchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
).allergens;

/** A profile row with everything the store needs and nothing about allergens. */
const PROFILE = {
  timezone: 'Europe/Berlin',
  goalNetCarbsCeilingG: 50,
  goalProteinFloorG: 110,
  goalKcalTarget: null,
  targetWeightKg: 70,
  trackingFocus: 'net-carbs',
  onboardingCompletedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
} as const;

function render(value: readonly Allergen[]): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(AllergenFields, {
        value,
        onChange: () => {},
        name: ALLERGENS_FIELD,
        chipClassName: (isSelected) => (isSelected ? 'chip-selected' : 'chip'),
      }),
    ),
  );
}

/** The whole `<...>` tag that carries `needle`, from its opening angle bracket to its close. */
function tagContaining(markup: string, needle: string): string {
  const hit = markup.indexOf(needle);
  assert.notEqual(hit, -1, `no tag carries ${needle}`);
  const start = markup.lastIndexOf('<', hit);
  return markup.slice(start, markup.indexOf('>', hit) + 1);
}

/** Every `<input ...>` tag under the allergen field name, in document order. */
function chipInputs(markup: string): string[] {
  return [...markup.matchAll(/<input [^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(`name="${ALLERGENS_FIELD}"`));
}

describe('the EU 14', () => {
  it('are exactly the fourteen substances Annex II names, in its order', () => {
    assert.deepEqual([...ALLERGEN_VALUES], EU_14);
  });

  it('are ONE array at runtime: the profile export and the vision export are the same reference (D8)', () => {
    // Reference equality, not deep equality: two hand-kept copies with the
    // same fourteen would pass a deepEqual and still drift on the fifteenth.
    assert.strictEqual(ALLERGEN_VALUES, ALLERGENS);
    // The control: a copy with the same members is NOT the same reference,
    // so the line above is asserting identity and not content.
    const twin = [...ALLERGENS];
    assert.deepEqual(twin, [...ALLERGEN_VALUES]);
    assert.notStrictEqual(twin, ALLERGEN_VALUES);
  });

  it('narrows by name, and a near miss is not one of them', () => {
    assert.equal(isAllergen('molluscs'), true);
    assert.equal(isAllergen('lupin'), true);
    assert.equal(isAllergen('mollusc'), false);
    assert.equal(isAllergen('Milk'), false);
    assert.equal(isAllergen(''), false);
  });
});

describe('parseAllergens', () => {
  it('keeps the known ones and drops an unknown string, the control', () => {
    assert.deepEqual(parseAllergens(['milk', 'kryptonite', 'sesame']), ['milk', 'sesame']);
  });

  it('collapses a duplicate to one entry', () => {
    assert.deepEqual(parseAllergens(['milk', 'milk', 'eggs', 'milk']), ['milk', 'eggs']);
  });

  it('answers the empty list for nothing, and for nothing it knows', () => {
    assert.deepEqual(parseAllergens([]), []);
    assert.deepEqual(parseAllergens(['pollen', 'dust']), []);
  });

  it('accepts all fourteen at once', () => {
    assert.deepEqual(parseAllergens(EU_14), EU_14);
  });
});

describe('readAllergensField', () => {
  it('reads every checked chip under the one field name, and nothing under another', () => {
    const form = new FormData();
    form.append(ALLERGENS_FIELD, 'milk');
    form.append(ALLERGENS_FIELD, 'nuts');
    form.append('biologicalSex', 'female');
    form.append('notAllergens', 'eggs');
    assert.deepEqual(readAllergensField(form), ['milk', 'nuts']);
  });

  it('reads no chip as the empty list, which is what Skip and an unticked card submit', () => {
    const form = new FormData();
    form.append('heightCm', '170');
    assert.deepEqual(readAllergensField(form), []);
  });

  it('drops a file and an unknown value under the field name, the control', () => {
    const form = new FormData();
    form.append(ALLERGENS_FIELD, new File(['x'], 'milk.txt'));
    form.append(ALLERGENS_FIELD, 'kryptonite');
    form.append(ALLERGENS_FIELD, 'celery');
    assert.deepEqual(readAllergensField(form), ['celery']);
  });
});

describe('the store round trip', () => {
  it('puts a profile with allergens and reads the list back intact', async () => {
    const store = createPrimaryStore();
    await putLocalProfileGoals({ ...PROFILE, allergens: ['milk', 'peanuts'] }, { store });

    assert.deepEqual(await getLocalAllergens({ store }), ['milk', 'peanuts']);
    // The row itself carries the field, not only the accessor's view of it.
    assert.deepEqual((await getLocalProfileGoals({ store }))?.allergens, ['milk', 'peanuts']);
  });

  it('reads the empty list off a row that never carried the field, and off no row at all', async () => {
    const store = createPrimaryStore();
    assert.deepEqual(await getLocalAllergens({ store }), []);
    await putLocalProfileGoals({ ...PROFILE }, { store });
    assert.deepEqual(await getLocalAllergens({ store }), []);
  });

  it('round trips through the BACKUP schema, list intact', async () => {
    const store = createPrimaryStore();
    await putLocalProfileGoals({ ...PROFILE }, { store });
    await putLocalAllergens(['gluten', 'molluscs'], { store });

    const exported = await exportBackup({ store, now: () => new Date('2026-09-21T09:00:00.000Z') });
    // The export/import schema, over the row the store wrote. This proves the
    // BACKUP path only: `app/lib/sync/snapshot-sync.ts` casts the merged
    // profile entity without parsing it, so nothing here speaks for sync.
    const normalised = shareableSnapshotSchema.parse(exported.data);
    assert.deepEqual(normalised.profile?.allergens, ['gluten', 'molluscs']);
  });

  it('drops an unknown entry on the way through the backup schema and keeps the known ones, the control', () => {
    const normalised = shareableSnapshotSchema.parse({
      foods: [],
      foodLogs: [],
      weightEntries: [],
      profile: { ...PROFILE, allergens: ['fish', 'kryptonite', 'fish'] },
    });
    assert.deepEqual(normalised.profile?.allergens, ['fish']);
  });

  it('writes the whole list, so a later put with fewer entries takes the missing ones back', async () => {
    const store = createPrimaryStore();
    await putLocalAllergens(['milk', 'eggs', 'kryptonite'], { store });
    assert.deepEqual(await getLocalAllergens({ store }), ['milk', 'eggs']);
    await putLocalAllergens([], { store });
    assert.deepEqual(await getLocalAllergens({ store }), []);
    assert.deepEqual((await getLocalProfileGoals({ store }))?.allergens, []);
  });
});

describe('AllergenFields, the chips', () => {
  it('renders one checkbox per EU 14 allergen under the one field name, in catalog order', () => {
    const inputs = chipInputs(render([]));
    assert.equal(inputs.length, 14);
    assert.deepEqual(
      inputs.map((tag) => /value="([a-z]+)"/.exec(tag)?.[1]),
      EU_14,
    );
    for (const tag of inputs) assert.equal(tag.includes('type="checkbox"'), true, tag);
  });

  it('checks exactly the chosen chips, and paints them with the host class', () => {
    const markup = render(['milk', 'lupin']);
    for (const value of EU_14) {
      const tag = tagContaining(markup, `value="${value}"`);
      const isChosen = value === 'milk' || value === 'lupin';
      assert.equal(tag.includes('checked=""'), isChosen, tag);
    }
    assert.equal(markup.split('chip-selected').length - 1, 2);
    assert.equal(markup.split('"chip"').length - 1, 12);
  });

  it('names every chip from the catalog, and never leaks a raw key', () => {
    const markup = render([]);
    for (const value of EU_14) assert.equal(markup.includes(`>${copy.name[value]}</label>`), true, value);
    assert.equal(markup.includes(copy.legend), true);
    assert.equal(markup.includes('allergens.'), false);
  });
});

describe('AllergenFields, the disclaimer', () => {
  it('renders the disclaimer inside the same fieldset as the chips, after the last of them', () => {
    const markup = render(['milk']);
    const fieldsetOpen = markup.indexOf('<fieldset');
    const fieldsetClose = markup.indexOf('</fieldset>');
    const disclaimer = markup.indexOf(`data-slot="${ALLERGEN_DISCLAIMER_SLOT}"`);
    const lastChip = markup.lastIndexOf(`name="${ALLERGENS_FIELD}"`);
    assert.notEqual(fieldsetOpen, -1);
    assert.notEqual(disclaimer, -1, 'no element carries the disclaimer slot');
    assert.ok(fieldsetOpen < lastChip, 'the chips are inside the fieldset');
    assert.ok(lastChip < disclaimer, 'the disclaimer follows the last chip');
    assert.ok(disclaimer < fieldsetClose, 'the disclaimer is inside the fieldset');
    // Exactly one disclaimer, and no second fieldset that could hold it.
    assert.equal(markup.split(`data-slot="${ALLERGEN_DISCLAIMER_SLOT}"`).length - 1, 1);
    assert.equal(markup.split('<fieldset').length - 1, 1);
  });

  it('says the catalog sentence in that slot, whichever chips are chosen, and never the raw key', () => {
    const none: Allergen[] = [];
    const one: Allergen[] = ['milk'];
    for (const value of [none, one, parseAllergens(EU_14)]) {
      const markup = render(value);
      const slot = markup.indexOf(`data-slot="${ALLERGEN_DISCLAIMER_SLOT}"`);
      const text = markup.slice(markup.indexOf('>', slot) + 1, markup.indexOf('</p>', slot));
      assert.equal(text, copy.disclaimer);
      assert.equal(markup.includes('allergens.disclaimer'), false);
    }
  });

  it('is a disclaimer the reader of the catalog can check: the English names the three limits', () => {
    // Not a wording pin, a CONTENT pin on the source string (D4a): the
    // sentence must say what is checked, that ingredients can be missed, and
    // that it is no safety check. A rewording keeps these three or fails.
    const sentence = copy.disclaimer.toLowerCase();
    assert.equal(sentence.includes('photo'), true);
    assert.equal(sentence.includes('description'), true);
    assert.equal(sentence.includes('hidden'), true);
    assert.equal(sentence.includes('not a safety check'), true);
  });
});
