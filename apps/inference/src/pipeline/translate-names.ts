/**
 * Food names in the language the request asked for: a SECOND, text-only model
 * call, made after identification and only for a language other than English.
 *
 * WHY A SECOND CALL. The identification prompt and grammar are frozen and
 * measured (`terse-contract.ts`, guarded by `terse-contract-frozen.test.ts`).
 * Asking that call for a second language would change what it sends and move a
 * recall number nobody has re-measured. So identification stays English, and
 * this call turns the English names into the request's language afterwards.
 *
 * WHAT IT NEVER CHANGES. `name` stays the model's English name. Nutrition
 * resolution searches an English food database with it, so a translated name
 * there would lose matches. The translation goes only into `translations`, as
 * `{ en: <name>, [language]: <translated> }`.
 *
 * IT FAILS OPEN, AND ALL AT ONCE. Any error, a timeout past
 * {@link TRANSLATE_TIMEOUT_MS}, a list of the wrong length, an empty name or a
 * name longer than {@link MAX_TRANSLATED_NAME_LENGTH} drops the translation for
 * EVERY food and keeps the response valid with no `translations` key. Half a
 * plate translated is not offered: one bad entry in a list says the model lost
 * the order, and then the good-looking entries may sit on the wrong food.
 *
 * The outcome carries a reason code and a count, never a name: a food log is
 * personal data, and the caller logs only what this returns.
 */
import type { AppLanguage, IdentifiedFood, JsonSchemaNode, PlateIdentification } from '../contract/plate-identification.js';
import type { ChatMessage } from './terse-contract.js';

/**
 * The bound on the translation call, milliseconds. A plate is at most eight
 * short names, so a healthy runtime answers in a second or two; this is a
 * liveness bound that stops a stuck call from holding a worker slot, not a
 * latency target.
 */
export const TRANSLATE_TIMEOUT_MS = 20_000;

/** A translated food name longer than this is treated as a failed answer. */
export const MAX_TRANSLATED_NAME_LENGTH = 80;

/** Decode headroom per name, tokens. Generous for a name of a few words plus its quotes; not measured. */
const TOKENS_PER_NAME = 32;

/** Fixed headroom for the brackets, quotes and commas of the array. */
const TOKENS_FOR_ARRAY = 64;

/** Translation is a lookup, not a creative task: no sampling variance. */
export const TRANSLATE_TEMPERATURE = 0;

/** How the system prompt names each language. English names, because the prompt is English. */
const LANGUAGE_NAMES_IN_ENGLISH = {
  en: 'English',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  tr: 'Turkish',
} as const satisfies Record<AppLanguage, string>;

/**
 * `max_tokens` for one translation call. Headroom over the expected answer,
 * never a thinking budget: on a runtime served with reasoning on, a token cap
 * truncates mid-thought and returns empty content, which fails open here.
 */
export function translateMaxTokens(nameCount: number): number {
  return nameCount * TOKENS_PER_NAME + TOKENS_FOR_ARRAY;
}

/** The system prompt for one language. Fixed text; only the language name varies. */
export function translateSystemPrompt(language: AppLanguage): string {
  const languageName = LANGUAGE_NAMES_IN_ENGLISH[language];
  return (
    `Translate each food name in the JSON array into ${languageName}. ` +
    'Keep each one a natural, everyday food name, the way a menu or a food label in that language would say it, not a literal word for word translation. ' +
    'Return a JSON array with exactly as many strings as there are names, in the same order. JSON only, no commentary.'
  );
}

/** A `json_schema` response format, as llama-server reads it and compiles it into a grammar. */
export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  json_schema: { name: string; strict: boolean; schema: JsonSchemaNode };
}

/**
 * The `response_format` for `nameCount` names. `minItems` and `maxItems` are
 * both the count, so llama-server's grammar forces an array of exactly that
 * length: the model cannot drop or add a name.
 */
export function translateResponseFormat(nameCount: number): JsonSchemaResponseFormat {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'food_name_translations',
      strict: true,
      schema: { type: 'array', items: { type: 'string' }, minItems: nameCount, maxItems: nameCount },
    },
  };
}

/** The two messages of one translation call: the fixed prompt, then the names as a JSON array. */
export function buildTranslateMessages(options: { names: string[]; language: AppLanguage }): ChatMessage[] {
  return [
    { role: 'system', content: translateSystemPrompt(options.language) },
    { role: 'user', content: JSON.stringify(options.names) },
  ];
}

/** Why a translation was dropped. Safe to log: a code, never a name. */
export type TranslationFailureReason = 'runtime-error' | 'timeout' | 'wrong-length' | 'empty-name' | 'name-too-long';

export type TranslationOutcome =
  /** No call was made: English, no language signal, or no foods. */
  | { kind: 'skipped' }
  | { kind: 'translated'; items: number }
  | { kind: 'failed'; reason: TranslationFailureReason; items: number };

/** The one runtime method this step needs. A narrow seam, so a test fake implements one function. */
export interface NameTranslator {
  translateNames(names: string[], language: AppLanguage, options?: { signal?: AbortSignal }): Promise<string[]>;
}

export interface TranslatePlateNamesOptions {
  runtime: NameTranslator;
  plate: PlateIdentification;
  /** `null` for English or no signal: no call is made. See `server/request-language.ts`. */
  language: AppLanguage | null;
  /** Test seam. Defaults to {@link TRANSLATE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface TranslatedPlate {
  plate: PlateIdentification;
  outcome: TranslationOutcome;
}

/**
 * Rejects when `signal` aborts. Raced against the runtime call, so the bound
 * holds even for a runtime that ignores the signal it was given.
 */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Name translation timed out.')), { once: true });
  });
}

/** The first reason `translated` cannot be used for `names`, or `null` when it can. */
function findAnswerProblem(options: { names: string[]; translated: string[] }): TranslationFailureReason | null {
  if (options.translated.length !== options.names.length) return 'wrong-length';
  const trimmed = options.translated.map((name) => name.trim());
  if (trimmed.some((name) => name.length === 0)) return 'empty-name';
  if (trimmed.some((name) => name.length > MAX_TRANSLATED_NAME_LENGTH)) return 'name-too-long';
  return null;
}

function withTranslation(options: { food: IdentifiedFood; language: AppLanguage; translated: string }): IdentifiedFood {
  return {
    ...options.food,
    translations: { en: options.food.name, [options.language]: options.translated.trim() },
  };
}

/**
 * Adds `translations` to every food on `plate`, or to none.
 *
 * Never throws: every failure is an outcome, and the plate comes back as it
 * went in. `name` is never changed.
 */
export async function translatePlateNames(options: TranslatePlateNamesOptions): Promise<TranslatedPlate> {
  const { plate, language } = options;
  if (language === null || plate.foods.length === 0) return { plate, outcome: { kind: 'skipped' } };

  const names = plate.foods.map((food) => food.name);
  const items = names.length;
  const signal = AbortSignal.timeout(options.timeoutMs ?? TRANSLATE_TIMEOUT_MS);

  let translated: string[];
  try {
    translated = await Promise.race([
      options.runtime.translateNames(names, language, { signal }),
      rejectOnAbort(signal),
    ]);
  } catch {
    // The error itself is not kept: a runtime or parse error can quote the
    // names it was sent, and a food name is personal data.
    const reason: TranslationFailureReason = signal.aborted ? 'timeout' : 'runtime-error';
    return { plate, outcome: { kind: 'failed', reason, items } };
  }

  const problem = findAnswerProblem({ names, translated });
  if (problem !== null) return { plate, outcome: { kind: 'failed', reason: problem, items } };

  const foods = plate.foods.map((food, index) =>
    withTranslation({ food, language, translated: translated[index] }),
  );
  return { plate: { ...plate, foods }, outcome: { kind: 'translated', items } };
}
