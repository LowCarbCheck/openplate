import bundle from './suggestion-foods.json';

/**
 * High-level food group used to organize suggestion foods in the UI.
 */
export type SuggestionCategory =
  | 'meat-fish'
  | 'eggs-dairy'
  | 'nuts-seeds'
  | 'vegetables'
  | 'legumes'
  | 'fruit';

/**
 * Macro breakdown per 100g for a suggestion food.
 */
export interface SuggestionFoodMacros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  netCarbs: number;
}

/**
 * A single curated food entry used to power quick-add suggestions.
 */
export interface SuggestionFood {
  slug: string;
  name: string;
  category: SuggestionCategory;
  /** Typical single serving in grams — LCC's `portionSize` where available, else a curated fallback from the generation script's seed list. */
  servingGrams: number;
  per100g: SuggestionFoodMacros;
  /** Public lowcarbcheck.org page, or null for sources with no public page (e.g. BLS imports). */
  url: string | null;
  /** Source/licence credit that must be shown wherever this food's numbers are displayed. Null for curated foods. */
  attribution: string | null;
}

/**
 * The generated bundle shape written to `suggestion-foods.json`.
 */
export interface SuggestionFoodBundle {
  generatedAt: string;
  source: string;
  foods: SuggestionFood[];
}

// SAFETY: every entry is emitted by our own generation script against the `SuggestionFoodBundle` contract, so each `category` is one of the `SuggestionCategory` members this narrows back to.
const generatedFoods = bundle.foods as SuggestionFood[];

export const SUGGESTION_FOODS: readonly SuggestionFood[] = generatedFoods;
export const SUGGESTION_FOODS_GENERATED_AT = bundle.generatedAt;
