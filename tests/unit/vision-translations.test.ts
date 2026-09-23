/**
 * Every AI food answer names its foods in the app language and carries
 * `translations` (M251 spec 02).
 *
 * WHAT IS PINNED HERE IS STRUCTURE, never a translated phrase. The names in
 * the fixtures are input data; no assertion checks what a model or a
 * translator would call a food, only which keys arrive, which survive, and
 * which language fills a gap. The phrase checks on the prompts read the
 * language code the prompt names, which is data this app owns.
 *
 * Every claim has a control that goes red: an answer in another language, a
 * prompt for another language, or a schema with a key removed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { buildPantryPhotoSystemPrompt, buildPantryTextSystemPrompt } from '../../app/services/vision/pantry-prompt';
import { PANTRY_IDENTIFICATION_JSON_SCHEMA, validatePantryIdentification } from '../../app/services/vision/pantry-schema';
import { buildPlateIdentificationSystemPrompt, buildTextIntakeSystemPrompt } from '../../app/services/vision/prompt';
import { PLATE_IDENTIFICATION_JSON_SCHEMA, validatePlateIdentification } from '../../app/services/vision/schema';
import type { JsonSchemaNode, UnvalidatedProviderJson } from '../../app/services/vision/schema';
import { pantryPhotoTask, photoIntakeTask } from '../../app/services/vision/task';
import { normalizeFoodTranslations } from '../../app/services/vision/translations';

/** One plate food, everything but `translations`. */
const FOOD_WITHOUT_TRANSLATIONS = {
  name: '  Name as sent  ',
  estimatedGrams: 100,
  confidence: 'high',
  portionHint: null,
  macroSource: 'estimated',
  brand: null,
  servingSize: null,
  carbBasis: null,
  macrosPer100g: null,
  flags: { pregnancy: [], allergens: [], mayContain: [] },
};

/** One pantry item, everything but `translations`. */
const ITEM_WITHOUT_TRANSLATIONS = {
  name: 'Item as sent',
  amount: null,
  unit: null,
  category: 'other',
  confidence: 'high',
};

/** A plate answer around one food. */
function plateAnswer(food: UnvalidatedProviderJson) {
  return { unreadable: false, unreadableReason: null, notes: null, foods: [food] };
}

/** A plate answer whose one food carries this `translations` value. */
function plateAnswerWith(translations: UnvalidatedProviderJson) {
  return plateAnswer({ ...FOOD_WITHOUT_TRANSLATIONS, translations });
}

/** A pantry answer around one item. */
function pantryAnswer(item: UnvalidatedProviderJson) {
  return { items: [item], notes: null };
}

/** A complete `translations` object: one distinct marker per app language, so a key that moved is visible. */
function everyLanguage() {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map((code) => [code, `name-${code}`]));
}

/** The translations of the first food in a plate answer read in `language`. */
function firstFoodTranslations(answer: UnvalidatedProviderJson, language: LanguageCode) {
  return validatePlateIdentification(answer, language).foods[0]?.translations;
}

/** The `required` list of the translations object inside a strict JSON Schema item. */
function translationKeysOf(item: JsonSchemaNode | undefined): string[] {
  return [...(item?.properties?.translations?.required ?? [])].toSorted();
}

describe('the translations a plate answer carries', () => {
  it('keeps every language a model sent, one entry per app language', () => {
    const translations = firstFoodTranslations(plateAnswerWith(everyLanguage()), 'de');
    assert.deepEqual(Object.keys(translations ?? {}).toSorted(), [...SUPPORTED_LANGUAGES].toSorted());
    assert.equal(translations?.de, 'name-de');
  });

  it('control: an answer WITHOUT translations still parses, and yields the app language from the name', () => {
    const translations = firstFoodTranslations(plateAnswer(FOOD_WITHOUT_TRANSLATIONS), 'de');
    assert.deepEqual(translations, { de: 'Name as sent' });
  });

  it('fills the language the call was made in, not a fixed one', () => {
    // THE CONTROL for the case above: the same answer read in French fills
    // French, so the German key there was the app language and not a default.
    assert.deepEqual(firstFoodTranslations(plateAnswer(FOOD_WITHOUT_TRANSLATIONS), 'fr'), { fr: 'Name as sent' });
  });

  it('drops blank, missing, wrong-typed and unknown keys, and never fails the plate over them', () => {
    const translations = firstFoodTranslations(
      plateAnswerWith({ en: '  trimmed  ', de: '   ', fr: 42, it: null, xx: 'not an app language' }),
      'es',
    );
    assert.deepEqual(translations, { en: 'trimmed', es: 'Name as sent' });
  });

  it('survives a translations value that is not an object at all', () => {
    assert.deepEqual(firstFoodTranslations(plateAnswerWith('Banane'), 'de'), { de: 'Name as sent' });
    assert.deepEqual(firstFoodTranslations(plateAnswerWith(null), 'de'), { de: 'Name as sent' });
  });

  it("keeps the model's own entry for the app language rather than overwriting it with the name", () => {
    const translations = firstFoodTranslations(plateAnswerWith({ de: 'from the model' }), 'de');
    assert.equal(translations?.de, 'from the model');
  });

  it('reaches the result through the task, built for the language of the call', () => {
    const german = photoIntakeTask('de').validate(plateAnswer(FOOD_WITHOUT_TRANSLATIONS));
    const french = photoIntakeTask('fr').validate(plateAnswer(FOOD_WITHOUT_TRANSLATIONS));
    assert.deepEqual(german.foods[0]?.translations, { de: 'Name as sent' });
    // Control: the other language's task fills its own key, and not the German one.
    assert.deepEqual(french.foods[0]?.translations, { fr: 'Name as sent' });
  });
});

describe('the translations a pantry answer carries', () => {
  it('fills the app language from the name when the model sent none', () => {
    const result = validatePantryIdentification(pantryAnswer(ITEM_WITHOUT_TRANSLATIONS), 'it');
    assert.deepEqual(result.items[0]?.translations, { it: 'Item as sent' });
  });

  it('keeps the languages the model sent', () => {
    const result = pantryPhotoTask('tr').validate(pantryAnswer({ ...ITEM_WITHOUT_TRANSLATIONS, translations: everyLanguage() }));
    assert.deepEqual(Object.keys(result.items[0]?.translations ?? {}).toSorted(), [...SUPPORTED_LANGUAGES].toSorted());
  });
});

describe('normalizeFoodTranslations', () => {
  it('always carries the app language, even when the model sent every other one', () => {
    const others = Object.fromEntries(SUPPORTED_LANGUAGES.filter((code) => code !== 'tr').map((code) => [code, code]));
    const translations = normalizeFoodTranslations({ arrived: others, name: 'name', language: 'tr' });
    assert.equal(translations.tr, 'name');
    assert.equal(Object.keys(translations).length, SUPPORTED_LANGUAGES.length);
  });
});

describe('the translations every provider is asked for', () => {
  it('demands one key per app language on a plate item, derived from SUPPORTED_LANGUAGES', () => {
    const item = PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items;
    assert.deepEqual(translationKeysOf(item), [...SUPPORTED_LANGUAGES].toSorted());
    assert.equal(item?.properties?.translations?.additionalProperties, false);
  });

  it('demands one key per app language on a pantry item', () => {
    const item = PANTRY_IDENTIFICATION_JSON_SCHEMA.properties?.items?.items;
    assert.deepEqual(translationKeysOf(item), [...SUPPORTED_LANGUAGES].toSorted());
  });

  it('control: a schema missing one language does not pass that check', () => {
    const item = structuredClone(PLATE_IDENTIFICATION_JSON_SCHEMA.properties?.foods?.items);
    const translations = item?.properties?.translations;
    if (translations?.required !== undefined) translations.required = translations.required.filter((key) => key !== 'tr');
    assert.notDeepEqual(translationKeysOf(item), [...SUPPORTED_LANGUAGES].toSorted());
  });
});

describe('the prompts name the app language', () => {
  const BUILDERS = {
    photo: buildPlateIdentificationSystemPrompt,
    text: buildTextIntakeSystemPrompt,
    pantryPhoto: buildPantryPhotoSystemPrompt,
    pantryText: buildPantryTextSystemPrompt,
  } satisfies Record<string, (language: LanguageCode) => string>;

  for (const [kind, build] of Object.entries(BUILDERS)) {
    it(`${kind}: names the call's language for "name", and no other`, () => {
      for (const language of SUPPORTED_LANGUAGES) {
        const prompt = build(language);
        assert.ok(prompt.includes(`(language code "${language}")`), `${kind} in ${language}`);
        // THE CONTROL: no other language is named as the one to write in.
        for (const other of SUPPORTED_LANGUAGES.filter((code) => code !== language)) {
          assert.ok(!prompt.includes(`(language code "${other}")`), `${kind} in ${language} also names ${other}`);
        }
      }
    });

    it(`${kind}: shows every app language as a translations key in its JSON shape`, () => {
      const prompt = build('en');
      assert.ok(prompt.includes('"translations": {'));
      for (const code of SUPPORTED_LANGUAGES) assert.ok(prompt.includes(`"${code}": "string"`), `${kind} lacks ${code}`);
    });
  }
});
