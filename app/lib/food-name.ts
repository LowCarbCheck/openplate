/**
 * A logged food's name in the reader's language (M251 spec 03).
 *
 * ── What is stored ───────────────────────────────────────────────────────
 *
 * Every entity that names a food keeps `name`, the name the person confirmed,
 * and since M251 an OPTIONAL `nameTranslations`: the same food in each app
 * language an AI answer gave (`FoodTranslations`, spec 02). A row saved before
 * M251, a hand-typed food and a food whose name the person edited have no
 * `nameTranslations` at all, and they render `name` in every language.
 *
 * ── One reader ───────────────────────────────────────────────────────────
 *
 * {@link displayFoodName} is the only way a screen turns a stored food into
 * text. A render that reads `.name` directly shows the language the food was
 * logged in, which is the defect this milestone exists to remove.
 *
 * ── Their words win ──────────────────────────────────────────────────────
 *
 * A name the person typed or edited is theirs in every language, so every edit
 * path goes through {@link applyFoodNameEdit}: an unchanged name keeps the
 * translations, a changed one drops them. Nothing ever retranslates a name.
 */
import { z } from 'zod';

import { SUPPORTED_LANGUAGES, isLanguageCode } from '#app/i18n/language-prefs';
import { LenientFoodTranslationsSchema, type FoodTranslations } from '#app/services/vision/translations';

/** Anything that names a food and may carry its translations. */
export interface NamedFood {
  name: string;
  nameTranslations?: FoodTranslations;
}

/**
 * The name to show a reader in `language`: the translation for that language
 * when the food carries one, the stored `name` otherwise.
 *
 * @param food - the stored food, log, saved-meal item, pantry row or anything derived from one.
 * @param language - the reader's language, as i18next reports it (`i18n.language`).
 * @returns the name to render.
 */
export function displayFoodName(food: NamedFood, language: string): string {
  if (!isLanguageCode(language)) return food.name;
  const translated = food.nameTranslations?.[language]?.trim();
  return translated === undefined || translated === '' ? food.name : translated;
}

/**
 * Cleans a translations map for storage: trimmed, blanks and unknown keys
 * dropped, and `undefined` when nothing is left, so an entity never stores an
 * empty object that reads as "has translations".
 *
 * @param translations - the map to clean, or its absence.
 * @returns the cleaned map, or `undefined` when no name survived.
 */
export function cleanNameTranslations(translations: FoodTranslations | undefined): FoodTranslations | undefined {
  if (translations === undefined) return undefined;
  const entries = SUPPORTED_LANGUAGES.flatMap((code) => {
    const value = translations[code]?.trim() ?? '';
    return value === '' ? [] : [[code, value] as const];
  });
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/**
 * An AI answer's translations as the review screen offers them, with the
 * entry for the language the screen is read in pinned to the name it shows.
 *
 * WHAT THEY SAW IS WHAT THEY GET. The model answers `name` and `translations`
 * as two questions, and may spell the app language differently in each. The
 * person confirms `name`, so that is the word the diary must show them.
 *
 * @param options.translations - the model's translations.
 * @param options.name - the name the review screen shows.
 * @param options.language - the language the review screen is rendered in.
 * @returns the translations to carry on the form.
 */
export function pinShownFoodName(options: {
  translations: FoodTranslations;
  name: string;
  language: string;
}): FoodTranslations {
  const cleaned = cleanNameTranslations(options.translations) ?? {};
  const trimmed = options.name.trim();
  if (!isLanguageCode(options.language) || trimmed === '') return cleaned;
  return { ...cleaned, [options.language]: trimmed };
}

/**
 * The translations an AI-named food is saved with, after the review screen.
 *
 * THE HAND-EDIT RULE. `aiName` is the name the model gave; `name` is what the
 * person confirmed. When they differ, the person typed their own words, and
 * the translations describe a food they renamed, so none are kept.
 *
 * @param options.name - the confirmed name.
 * @param options.aiName - the name the model gave, or `undefined` when the item had none.
 * @param options.translations - the translations the form carried, or `undefined`.
 * @returns the translations to store, or `undefined` for a renamed or untranslated item.
 */
export function resolveConfirmedNameTranslations(options: {
  name: string;
  aiName: string | undefined;
  translations: FoodTranslations | undefined;
}): FoodTranslations | undefined {
  if (options.aiName === undefined) return undefined;
  if (normalizeName(options.name) !== normalizeName(options.aiName)) return undefined;
  return cleanNameTranslations(options.translations);
}

/** What a name edit stores: the name, and its translations or an explicit `undefined` that drops them. */
export interface FoodNameEdit {
  name: string;
  nameTranslations: FoodTranslations | undefined;
}

/**
 * The name and translations after a person edits a name field that showed
 * {@link displayFoodName} in `language`.
 *
 * Unchanged (the field still holds what it showed): the stored name and its
 * translations stay exactly as they were, so opening an editor and saving is
 * never a rename. Changed: the typed words become the name in every language,
 * and the translations are dropped.
 *
 * @param options.food - the stored entity before the edit.
 * @param options.submittedName - what the name field held on save.
 * @param options.language - the language the editor was rendered in.
 * @returns the name and translations to store.
 */
export function applyFoodNameEdit(options: {
  food: NamedFood;
  submittedName: string;
  language: string;
}): FoodNameEdit {
  const shown = displayFoodName(options.food, options.language);
  if (normalizeName(options.submittedName) === normalizeName(shown)) {
    return { name: options.food.name, nameTranslations: options.food.nameTranslations };
  }
  return { name: options.submittedName.trim(), nameTranslations: undefined };
}

/** Whitespace-insensitive comparison key: a trailing space is not a rename. */
function normalizeName(value: string): string {
  return value.trim().replaceAll(/\s+/g, ' ');
}

/**
 * The stored value as a Zod schema, for the backup file and the sync blob.
 *
 * LENIENT, like `flags`, and through the SAME per-language schema the AI
 * answer is parsed with: a key this build does not know (a file written by a
 * build with a seventh language) is dropped, a value that is not a string
 * reads as absent for that language, and a map left empty reads as absent.
 * Zod strips unknown object keys, so without this line on each entity schema
 * the translations would vanish on every export and every sync round trip.
 */
export const storedNameTranslationsSchema = LenientFoodTranslationsSchema.transform((raw) =>
  cleanNameTranslations(raw ?? undefined),
).optional();

/**
 * Decodes the review form's hidden value back into translations. FAILS OPEN,
 * never throws, the `decodeFoodFlags` rule: every writer of this field is our
 * own hidden input, and a malformed value must never refuse a log.
 *
 * @param raw - the submitted value, or nothing.
 * @returns the translations, or `undefined` for none.
 */
export function decodeNameTranslations(raw: string | null | undefined): FoodTranslations | undefined {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const result = storedNameTranslationsSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** The hidden input as it arrives from a form submission; anything else reads as absent. */
const submittedFieldValue = z.string().nullish().catch(undefined);

/** The review form's hidden field, decoded leniently: a blank or malformed value reads as "no translations". */
export const nameTranslationsFormField = z.preprocess(
  (raw) => decodeNameTranslations(submittedFieldValue.parse(raw)),
  storedNameTranslationsSchema,
);

/** Encodes translations for the review form's hidden field. Blank for none. */
export function encodeNameTranslations(translations: FoodTranslations | undefined): string {
  const cleaned = cleanNameTranslations(translations);
  return cleaned === undefined ? '' : JSON.stringify(cleaned);
}
