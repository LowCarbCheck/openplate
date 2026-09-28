/**
 * A food's name in every app language, as an AI answer carries it (M251 spec 02).
 *
 * ── Why every answer carries one ─────────────────────────────────────────
 *
 * The diary stores the name a food arrived with, and before this a photo
 * answer arrived mostly in English and a typed one in whatever language the
 * person typed. A German screen then showed English food names. Every photo,
 * text and pantry answer now names each food in the app language AND returns
 * `translations`, one short name per app language, so a later reader in
 * another language (spec 03) and LowCarbCheck (spec 04) have a name to use.
 *
 * ── Asked for strictly, read leniently ───────────────────────────────────
 *
 * The WIRE shape (`RawFoodTranslationsSchema`) demands every key, so a strict
 * structured-output provider always sends all six. The PARSE shape
 * (`LenientFoodTranslationsSchema`) accepts anything: a weak BYOK model that
 * drops the object, drops a key, or sends a number where a name belongs must
 * not fail a scan the person already paid for. `normalizeFoodTranslations`
 * then keeps only real, non-blank names and always fills the app language
 * from `name`, so a consumer never meets an answer without the language it
 * was asked in.
 *
 * ── One list of languages ────────────────────────────────────────────────
 *
 * Every key list here is derived from `SUPPORTED_LANGUAGES`. A seventh app
 * language is asked for, parsed and kept without an edit to this file.
 */
import { z } from 'zod';

import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type LanguageCode } from '#app/i18n/language-prefs';

/**
 * A food's name per app language, as the app holds it. Partial because a
 * model may leave a language out; never empty, because the app language is
 * always present (see {@link normalizeFoodTranslations}).
 */
export type FoodTranslations = Partial<Record<LanguageCode, string>>;

/**
 * One Zod schema per app language, keyed by the codes in `SUPPORTED_LANGUAGES`.
 * The keys are only known at run time, so the type is an index signature and
 * every read below is written for a key that may be absent.
 */
function perLanguage<TValue extends z.ZodType>(value: TValue) {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map((code) => [code, value]));
}

/**
 * THE WIRE SHAPE: what every provider is told to return. Every key required,
 * no nullable, because a missing translation is exactly what the field
 * exists to prevent and strict structured output can enforce it.
 */
export const RawFoodTranslationsSchema = z.object(perLanguage(z.string()));

/**
 * THE PARSE SHAPE: whatever arrived. Each key may be missing, null or the
 * wrong type, and the whole object may be missing or not an object at all;
 * every one of those parses, to `undefined` for that key or for the object.
 */
export const LenientFoodTranslationsSchema = z
  .object(perLanguage(z.string().nullish().catch(undefined)))
  .nullish()
  .catch(undefined);

type ArrivedFoodTranslations = z.infer<typeof LenientFoodTranslationsSchema>;

/**
 * The arrived translations to the app-facing shape: trimmed, blanks dropped,
 * unknown keys already dropped by the schema, and the app language always
 * present.
 *
 * WHICH NAME FILLS THE GAP. When the model left out the app language, `name`
 * is used, because the prompt asked for `name` in that same language. When
 * the model DID send one, it is kept as sent: it is the model's answer to the
 * translation question, and `name` stays the model's answer to the naming one.
 *
 * @param options.arrived - the parsed, lenient `translations`, or its absence.
 * @param options.name - the item's `name`, used for the app language when it is missing.
 * @param options.language - the app language the call was made in.
 * @returns one trimmed name per language the model gave, plus the app language.
 */
export function normalizeFoodTranslations(options: {
  arrived: ArrivedFoodTranslations;
  name: string;
  language: LanguageCode;
}): FoodTranslations {
  const kept = SUPPORTED_LANGUAGES.flatMap((code) => {
    const value = options.arrived?.[code]?.trim() ?? '';
    return value === '' ? [] : [[code, value] as const];
  });
  const hasAppLanguage = kept.some(([code]) => code === options.language);
  const entries = hasAppLanguage ? kept : [...kept, [options.language, options.name.trim()] as const];
  return Object.fromEntries(entries);
}

/** How a prompt names a language: its own name and its code, so neither can be misread. */
function languageForPrompt(language: LanguageCode): string {
  return `${LANGUAGE_LABELS[language]} (language code "${language}")`;
}

/**
 * The prompt paragraph that asks for names in the app language and for
 * `translations`. One paragraph for every food prompt, so the photo, text and
 * pantry prompts cannot ask the question in three different ways.
 *
 * @param language - the app language the answer's `name` must be written in.
 * @returns the paragraph, without a trailing newline.
 */
export function describeNamesForPrompt(language: LanguageCode): string {
  const codes = SUPPORTED_LANGUAGES.map((code) => `"${code}"`).join(', ');
  return `NAMES AND TRANSLATIONS:
- Write every "name" in ${languageForPrompt(language)}, whatever language the input, a package or the person uses.
- Also fill "translations" for every item: one short, natural name for the same food in each of these languages, keyed by language code: ${codes}. Write each one the way a food label in that country would name the food, not a word-for-word translation. The "${language}" entry is the same food as "name".
- A brand name stays as printed in every language. The field names stay in English.`;
}

/**
 * The `translations` member of a prompt's example JSON shape, one line per
 * app language, indented to sit inside an item at `indent` spaces.
 *
 * @param indent - how many spaces the `"translations"` key is indented by.
 * @returns the member, without a trailing comma or newline.
 */
export function translationsExampleForPrompt(indent: number): string {
  const outer = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);
  const lines = SUPPORTED_LANGUAGES.map((code) => `${inner}"${code}": "string"`).join(',\n');
  return `${outer}"translations": {\n${lines}\n${outer}}`;
}
