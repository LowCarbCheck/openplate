/**
 * The wire schema for a RECIPE PROPOSAL, and the JSON Schema derived from it
 * (M233/04).
 *
 * A proposal is the third shape this service asks a model for, after a plate
 * and a pantry, and it is a third shape rather than a variation on the pantry
 * because it carries the two things a pantry row never does: an instruction
 * (the steps) and a nutrition claim (`perServing`). Those are what the screen
 * renders against the rest of the day, so they are required fields with no
 * null escape hatch: a recipe whose calories the model would not commit to is
 * a recipe nobody can weigh against a budget.
 *
 * Same LLM rules as `./schema` and `./pantry-schema`: every field a provider
 * is ASKED for is REQUIRED, with `.nullable()` standing in for "the model does
 * not know" (see the `zod-llm-schemas` skill). Exactly two fields are nullable,
 * and both are genuinely unknowable rather than merely awkward: an ingredient
 * amount ("salt to taste") and the preparation time.
 *
 * ── Why the bounds live off the wire schema ──────────────────────────────
 *
 * `RecipeProposalsSchema` requires two or three recipes, because one is not a
 * choice and four is a list nobody reads on a phone. That bound is a
 * VALIDATION rule, and it is deliberately absent from the JSON Schema handed
 * to a provider: OpenAI's strict structured output accepts neither `minItems`
 * nor `maxItems`, so a schema derived straight from the bounded array would be
 * rejected before the model ever saw the prompt. The count is asked for in
 * words in `./recipe-prompt` and enforced here on the way back, which is the
 * same division `./schema` already makes between its wire schema and its
 * widened parse schema.
 */
import { z } from 'zod';
import { VisionProviderError, type ScanResultBase } from './types';
import { toStrictJsonSchema, type JsonSchemaNode, type UnvalidatedProviderJson } from './schema';

/**
 * The units a recipe ingredient may carry.
 *
 * The pantry's four minus `pack` (a recipe uses an amount, never a package)
 * plus the two spoon measures every domestic recipe is written in. Anything
 * else ("a pinch") belongs in the name, exactly as it does on a pantry row.
 */
export const RECIPE_UNITS = ['g', 'ml', 'piece', 'tbsp', 'tsp'] as const;
export type RecipeUnitValue = (typeof RECIPE_UNITS)[number];

/** How few recipes are a choice, and how many are a list. Both enforced by `RecipeProposalsSchema`. */
export const MIN_RECIPE_PROPOSALS = 2;
export const MAX_RECIPE_PROPOSALS = 3;

/** One ingredient of one recipe. `fromPantry` is what the card marks, so it is never optional. */
const RawRecipeIngredientSchema = z.object({
  /** Plain everyday name, in the language the answer is written in. */
  name: z.string(),
  /** How much of it. Null for an ingredient measured by taste. */
  amount: z.number().nullable(),
  /** What the amount is measured in. Null whenever `amount` is null. */
  unit: z.enum(RECIPE_UNITS).nullable(),
  /** Whether this came off the person's own shelf. False marks a staple the recipe assumes. */
  fromPantry: z.boolean(),
});

/** What one serving is worth. Every figure required: this is what the screen weighs against the day. */
const RawRecipePerServingSchema = z.object({
  kcal: z.number(),
  proteinG: z.number(),
  /** NET carbs, fibre already excluded. The prompt says so in those words. */
  carbsG: z.number(),
  fiberG: z.number(),
  fatG: z.number(),
});

const RawRecipeSchema = z.object({
  title: z.string(),
  servings: z.number(),
  ingredients: z.array(RawRecipeIngredientSchema),
  steps: z.array(z.string()),
  perServing: RawRecipePerServingSchema,
  /** One sentence naming the nutrient this recipe leans on or avoids. */
  whyItFits: z.string(),
  /** Minutes of preparation, or null when the model will not commit to one. */
  prepMinutes: z.number().nullable(),
});

/**
 * THE VALIDATING CONTRACT: what a provider's answer must be for this screen to
 * render it. Two or three recipes, never one and never four.
 */
export const RecipeProposalsSchema = z.object({
  recipes: z.array(RawRecipeSchema).min(MIN_RECIPE_PROPOSALS).max(MAX_RECIPE_PROPOSALS),
});

/**
 * The same shape with the count bound removed, and the ONLY schema a provider
 * is ever handed. See the header: strict structured output rejects `minItems`
 * and `maxItems`, so the bound is asked for in the prompt and checked above.
 */
const RecipeProposalsWireSchema = z.object({
  recipes: z.array(RawRecipeSchema),
});

/** One ingredient as the app holds it. Null still means unknown, never zero. */
export interface RecipeIngredient {
  name: string;
  amount: number | null;
  unit: RecipeUnitValue | null;
  fromPantry: boolean;
}

/** One serving's macros, as the card renders them against `RemainingDay`. */
export interface RecipePerServing {
  kcal: number;
  proteinG: number;
  /** Net carbs. */
  carbsG: number;
  fiberG: number;
  fatG: number;
}

/** One proposed recipe, as the app holds it. */
export interface RecipeProposal {
  title: string;
  servings: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  perServing: RecipePerServing;
  whyItFits: string;
  prepMinutes: number | null;
}

/**
 * A whole set of proposals, the result type `RECIPE_PROPOSAL_TASK` answers
 * with. `extends ScanResultBase` is what lets the shared transport attach
 * token usage without knowing anything else about the shape (see `./task`).
 */
export interface RecipeProposals extends ScanResultBase {
  recipes: RecipeProposal[];
}

type RawRecipeProposals = z.infer<typeof RecipeProposalsSchema>;

/**
 * The raw shape to the app-facing one.
 *
 * A UNIT WITH NO AMOUNT IS NOT A UNIT, the same rule the pantry applies: both
 * go together or neither does, so an ingredient can never render "tbsp" alone.
 * Nothing else is transformed; a macro figure is passed through exactly as the
 * model gave it, because rounding here would make the card and the log
 * disagree about the same serving.
 */
export function normalizeRecipeProposals(raw: RawRecipeProposals): RecipeProposals {
  return {
    recipes: raw.recipes.map((recipe) => ({
      title: recipe.title.trim(),
      servings: recipe.servings,
      ingredients: recipe.ingredients.map((ingredient) => ({
        name: ingredient.name.trim(),
        amount: ingredient.amount,
        unit: ingredient.amount === null ? null : ingredient.unit,
        fromPantry: ingredient.fromPantry,
      })),
      steps: recipe.steps.map((step) => step.trim()).filter((step) => step !== ''),
      perServing: recipe.perServing,
      whyItFits: recipe.whyItFits.trim(),
      prepMinutes: recipe.prepMinutes,
    })),
  };
}

/**
 * Validates an already-parsed value against the recipe schema.
 *
 * @throws {VisionProviderError} when `value` does not match the expected shape.
 */
export function validateRecipeProposals(value: UnvalidatedProviderJson): RecipeProposals {
  const result = RecipeProposalsSchema.safeParse(value);
  if (!result.success) {
    throw new VisionProviderError('Vision provider response did not match the expected recipe shape', {
      cause: result.error,
    });
  }
  return normalizeRecipeProposals(result.data);
}

/** Strips a leading/trailing markdown code fence, exactly as the plate and pantry paths do. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Parses raw model output text into validated proposals. The universal
 * fallback for a provider without enforced structured output.
 *
 * @throws {VisionProviderError} on non-JSON input or a shape mismatch.
 */
export function parseRecipeProposalsJson(rawText: string): RecipeProposals {
  const jsonText = stripCodeFence(rawText);

  let parsedJson: UnvalidatedProviderJson;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (error) {
    throw new VisionProviderError('Vision provider returned a response that was not valid JSON', { cause: error });
  }

  return validateRecipeProposals(parsedJson);
}

/**
 * JSON Schema (draft 2020-12) for provider-enforced structured output, derived
 * from the UNBOUNDED twin. See the header for why the count bound is not in it.
 */
export const RECIPE_PROPOSALS_JSON_SCHEMA: JsonSchemaNode = toStrictJsonSchema(RecipeProposalsWireSchema);
