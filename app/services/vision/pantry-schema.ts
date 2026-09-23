/**
 * The wire schema for a PANTRY reading, and the JSON Schema derived from it.
 *
 * A pantry reading is not a plate reading with different words. A plate says
 * what somebody ATE, in grams, with macros; a pantry says what somebody HAS,
 * often with no amount at all, and carries no macros anywhere. Folding the two
 * into one schema would oblige a model looking at a fridge shelf to invent a
 * portion and a set of macros per item, which is exactly the fabrication the
 * plate prompt spends half its length preventing.
 *
 * Same LLM rules as `./schema`, and for the same reason: every field a
 * provider is ASKED for is REQUIRED, with `.nullable()` standing in for "the
 * model does not know" (see the `zod-llm-schemas` skill). `amount` and `unit`
 * are the two that are genuinely unknown most of the time, because a tub of
 * yoghurt in a photograph has no legible weight, and a null there is the
 * honest answer a person can then type over.
 *
 * `toStrictJsonSchema` is reused from `./schema` rather than copied: the
 * strict-mode rules OpenAI enforces are a property of the provider, not of the
 * task, and two copies of them would be two places to drift.
 */
import { z } from 'zod';
import { VisionProviderError, type ScanResultBase } from './types';
import { toStrictJsonSchema, type JsonSchemaNode, type UnvalidatedProviderJson } from './schema';
import {
  LenientFoodTranslationsSchema,
  RawFoodTranslationsSchema,
  normalizeFoodTranslations,
  type FoodTranslations,
} from './translations';
import type { LanguageCode } from '#app/i18n/language-prefs';

/**
 * The units a pantry row may carry, and there are only four.
 *
 * A weight, a volume, a countable thing and a sealed package. Anything a
 * person writes that is none of these ("a handful") belongs in the NAME, not
 * in a fifth unit member nothing can render consistently.
 */
export const PANTRY_UNITS = ['g', 'ml', 'piece', 'pack'] as const;
export type PantryUnitValue = (typeof PANTRY_UNITS)[number];

/**
 * The shelf an item belongs on, as a fixed, closed list.
 *
 * It exists so the list can be GROUPED and so a recipe proposal (spec 04) can
 * reason about what kind of thing it is holding without a second lookup. It is
 * never shown as a claim about nutrition; `other` is a perfectly good answer
 * and the prompt says so.
 */
export const PANTRY_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'fish',
  'egg',
  'grain',
  'legume',
  'nut',
  'condiment',
  'beverage',
  'other',
] as const;
export type PantryCategoryValue = (typeof PANTRY_CATEGORIES)[number];

/** One ingredient the model says is present. All-required, nullable where it cannot know. */
const RawPantryItemSchema = z.object({
  /** Plain everyday name, in the app language the call was made in (M251 spec 02). */
  name: z.string(),
  /** How much, when it is readable or countable. Null rather than a guess. */
  amount: z.number().nullable(),
  /** What the amount is measured in. Null whenever `amount` is null. */
  unit: z.enum(PANTRY_UNITS).nullable(),
  category: z.enum(PANTRY_CATEGORIES),
  confidence: z.enum(['high', 'medium', 'low']),
  /** The same ingredient named in every app language. See `./translations`. */
  translations: RawFoodTranslationsSchema,
});

/** THE WIRE CONTRACT: what every provider is told to return for a pantry reading. */
export const PantryIdentificationSchema = z.object({
  items: z.array(RawPantryItemSchema),
  /** Anything worth saying about the reading as a whole. Null when there is nothing. */
  notes: z.string().nullable(),
});

/**
 * What a pantry reading is PARSED against: the wire shape with a lenient
 * `translations`, the plate path's rule. A model that drops the translations,
 * or one key of them, still gives the person their shelf. Never handed to a
 * provider; `PANTRY_IDENTIFICATION_JSON_SCHEMA` is derived from the wire shape.
 */
const PantryIdentificationParseSchema = z.object({
  items: z.array(RawPantryItemSchema.extend({ translations: LenientFoodTranslationsSchema })),
  notes: z.string().nullable(),
});

/** One item as the app holds it: null still means "unknown", never zero. */
export interface PantryItemReading {
  name: string;
  amount: number | null;
  unit: PantryUnitValue | null;
  category: PantryCategoryValue;
  confidence: 'high' | 'medium' | 'low';
  /** The same ingredient per app language, always carrying the call's language. See `./translations`. */
  translations: FoodTranslations;
}

/**
 * A whole pantry reading, the result type both pantry tasks answer with.
 *
 * `extends ScanResultBase` is what lets the shared transport attach token
 * usage to it without knowing anything else about the shape (see `./task`).
 */
export interface PantryIdentification extends ScanResultBase {
  items: PantryItemReading[];
  notes?: string;
}

type RawPantryIdentification = z.infer<typeof PantryIdentificationParseSchema>;

/**
 * The raw shape to the app-facing one. NULL BECOMES NULL for `amount`/`unit`
 * and ABSENT for `notes`, which is the same convention `./schema` uses: a
 * stored amount is a three-state fact a person can fill in, while a note is
 * either said or not said.
 *
 * @param raw - the parsed, lenient reading.
 * @param language - the app language the call was made in; see `normalizeFoodTranslations`.
 */
export function normalizePantryIdentification(raw: RawPantryIdentification, language: LanguageCode): PantryIdentification {
  const normalized: PantryIdentification = {
    items: raw.items.map((item) => ({
      name: item.name.trim(),
      // A unit with no amount is not a unit, it is a stray enum member. Both
      // go together or neither does, so a row can never render "ml" alone.
      amount: item.amount,
      unit: item.amount === null ? null : item.unit,
      category: item.category,
      confidence: item.confidence,
      translations: normalizeFoodTranslations({ arrived: item.translations, name: item.name, language }),
    })),
  };
  if (raw.notes !== null && raw.notes.trim() !== '') normalized.notes = raw.notes.trim();
  return normalized;
}

/**
 * Validates an already-parsed value against the pantry schema.
 *
 * @param value - the provider's answer, already parsed as JSON.
 * @param language - the app language the call was made in.
 * @throws {VisionProviderError} when `value` does not match the expected shape.
 */
export function validatePantryIdentification(value: UnvalidatedProviderJson, language: LanguageCode): PantryIdentification {
  const result = PantryIdentificationParseSchema.safeParse(value);
  if (!result.success) {
    throw new VisionProviderError('Vision provider response did not match the expected pantry shape', {
      cause: result.error,
    });
  }
  return normalizePantryIdentification(result.data, language);
}

/** Strips a leading/trailing markdown code fence, exactly as the plate path does. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Parses raw model output text into a validated `PantryIdentification`. The
 * universal fallback for a provider without enforced structured output.
 *
 * @param rawText - the provider's answer as text.
 * @param language - the app language the call was made in.
 * @throws {VisionProviderError} on non-JSON input or a shape mismatch.
 */
export function parsePantryIdentificationJson(rawText: string, language: LanguageCode): PantryIdentification {
  const jsonText = stripCodeFence(rawText);

  let parsedJson: UnvalidatedProviderJson;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (error) {
    throw new VisionProviderError('Vision provider returned a response that was not valid JSON', { cause: error });
  }

  return validatePantryIdentification(parsedJson, language);
}

/**
 * JSON Schema (draft 2020-12) derived from `PantryIdentificationSchema`, for
 * provider-enforced structured output. One source of truth, same as the
 * plate's.
 */
export const PANTRY_IDENTIFICATION_JSON_SCHEMA: JsonSchemaNode = toStrictJsonSchema(PantryIdentificationSchema);
