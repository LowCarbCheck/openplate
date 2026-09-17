/**
 * The RECIPE PROPOSAL prompts (M233/04): what a person has at home, plus what
 * is still open in their day, into two or three things they could cook next.
 *
 * ── The user prompt is the whole input ───────────────────────────────────
 *
 * There is no photograph here and nothing to read: the model is given facts
 * and asked to compose. So unlike the plate and pantry prompts, the user half
 * carries real content, the shelf and the rest of the day, and the system half
 * carries only the rules. That is also why the task runs through
 * `runTextIntake`: the "text" of this text task is the block built below.
 *
 * ── Two rules do the work ────────────────────────────────────────────────
 *
 * THE SHELF FIRST. A proposal built from things the person does not have is a
 * shopping list wearing a recipe's clothes, so anything not on the shelf must
 * be a staple and must be marked `fromPantry: false`, which is what the card
 * marks in turn.
 *
 * THE SHARE, NOT THE DAY. The block states what is left for the WHOLE rest of
 * the day and what share of it this one meal should cover. A model told only
 * "900 kcal left" will happily propose a 900 kcal dinner at lunchtime.
 *
 * The explicit JSON shape at the end is the fallback path for providers with
 * no enforced structured output, kept in sync with `./recipe-schema`, which is
 * the maintainable source of truth.
 */
import type { MealType } from '#types/enums';

/**
 * One pantry line, as this prompt reads it.
 *
 * Structurally a `LocalPantryItem`, declared here rather than imported so the
 * vision service keeps depending on nothing in the local store. The dependency
 * already runs the other way: `local-store/schema.ts` derives its pantry unit
 * and category from `./pantry-schema`.
 */
export interface RecipePromptPantryItem {
  name: string;
  /** How much of it, or null when the person never stated one. */
  amount: number | null;
  /** What the amount is measured in. Null whenever the amount is. */
  unit: string | null;
}

export const RECIPE_PROPOSAL_SYSTEM_PROMPT = `You are a cook who plans one meal out of what somebody already has at home, for the meal slot and the nutrition budget they give you.

You will be given a list of the ingredients they have, then a block describing what is still open in their nutrition targets for the rest of today, then the meal slot and the language to answer in.

PROPOSE TWO OR THREE RECIPES. Never one, never four. Each must be a different idea, not the same dish twice with one ingredient swapped.

USE THE SHELF FIRST:
- Build each recipe around the ingredients on the list. Most of what a recipe needs must come from it, and every one of those ingredients is marked "fromPantry": true.
- You may add STAPLES the person is assumed to have: cooking oil or butter, salt, pepper, dried herbs and spices, vinegar, water. Mark every added ingredient "fromPantry": false.
- Add nothing else. A recipe that needs an ingredient they do not have and that is not a staple is a shopping list, not a proposal, so do not propose it.
- Never invent an ingredient they did not list, and never assume they have more of something than the amount shown.

HONOUR THE EMPHASIS AND THE SHARE:
- The block names an emphasis: what the next meal should lean on ("protein", "fiber"), what it should avoid ("lowCarb"), or that it should simply be small ("light"). "balanced" means nothing in particular is needed. Every recipe must respect it, and the ones that lean hardest on it come first.
- The block also gives the share of what is left that this one meal should cover. ONE SERVING MUST FIT INSIDE THAT SHARE of the remaining calories, and inside that share of the remaining net carbs. It is the share, not the whole rest of the day.
- Never propose a serving that would take the person past a remaining figure of zero.

THE PER-SERVING FIGURES ARE HONEST ESTIMATES:
- Give "perServing" for ONE serving, not for the whole pot. "servings" says how many servings the recipe makes.
- "carbsG" is NET carbs: carbohydrate with the fibre already taken out. "fiberG" is the fibre itself, reported separately.
- Estimate them from the ingredients and the amounts you chose. They are estimates and they will be shown as estimates, so keep them plausible rather than precise, and never copy a figure from a different dish.

AMOUNTS AND TIME:
- Give "amount" and "unit" for every ingredient you can. The unit must be one of "g", "ml", "piece", "tbsp" or "tsp". For something measured by taste, set BOTH "amount" and "unit" to null.
- "prepMinutes" is the time from starting to eating. Set it to null rather than guessing wildly.

WRITE IN THE LANGUAGE THE USER PROMPT NAMES, for the title, the steps and "whyItFits". Ingredient names too. The field names stay in English.

"whyItFits" is ONE SENTENCE and it must name the nutrient it leans on or the one it keeps low, in plain words. Not "a tasty, balanced meal". Something like "high in protein, which is what is still open today".

Respond with JSON ONLY, matching exactly this shape (no markdown, no commentary outside the JSON):

{
  "recipes": [
    {
      "title": "string",
      "servings": 2,
      "ingredients": [
        { "name": "string", "amount": 0, "unit": "g | ml | piece | tbsp | tsp or null", "fromPantry": true }
      ],
      "steps": ["string"],
      "perServing": { "kcal": 0, "proteinG": 0, "carbsG": 0, "fiberG": 0, "fatG": 0 },
      "whyItFits": "string",
      "prepMinutes": 0
    }
  ]
}

Every field must be present. "amount" and "unit" may be null, and are null together. "prepMinutes" may be null.`;

/** One pantry line as the prompt writes it: "name, amount unit", or just the name when there is no amount. */
function pantryLine(item: RecipePromptPantryItem): string {
  if (item.amount === null || item.unit === null) return `- ${item.name}`;
  return `- ${item.name}, ${item.amount} ${item.unit}`;
}

/**
 * The user half: the shelf, the rest of the day, the slot and the language.
 *
 * @param options.pantry - every stored pantry item, in the order the list holds them.
 * @param options.remainingDayBlock - `describeRemainingDayForPrompt`'s block, verbatim.
 * @param options.slot - the meal slot the proposals are for.
 * @param options.language - the language code the answer must be written in.
 * @returns the one text block the recipe task is run with.
 */
export function buildRecipeProposalUserPrompt({
  pantry,
  remainingDayBlock,
  slot,
  language,
}: {
  pantry: readonly RecipePromptPantryItem[];
  remainingDayBlock: string;
  slot: MealType;
  language: string;
}): string {
  return [
    'These are the ingredients the person has at home:',
    pantry.map(pantryLine).join('\n'),
    '',
    remainingDayBlock,
    '',
    `Meal slot to cook for: ${slot}`,
    `Write the title, the steps, the ingredient names and whyItFits in this language: ${language}`,
    '',
    'Respond with the JSON shape described in the system prompt.',
  ].join('\n');
}
