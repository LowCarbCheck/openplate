import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SuggestionCategory, SuggestionFood, SuggestionFoodMacros } from '../app/data/suggestion-foods';

const DEFAULT_BASE_URL = 'https://lowcarbcheck.org';
const SEARCH_TIMEOUT_MS = 10_000;
const REQUEST_DELAY_MS = 800;
const SEARCH_RESULT_LIMIT = 5;
const RATE_LIMIT_MAX_ATTEMPTS = 8;
const RATE_LIMIT_BASE_DELAY_MS = 2000;
const RATE_LIMIT_MAX_DELAY_MS = 30_000;

/** Gap-filler pool ceiling: reject anything above this net-carbs-per-100g. */
const MAX_NET_CARBS_PER_100G = 25;
/** Tolerance for the netCarbs <= carbs coherence check. */
const CARB_COHERENCE_TOLERANCE = 0.5;
/** Max allowed relative deviation between reported kcal and macro-derived kcal. */
const MAX_KCAL_DEVIATION_RATIO = 0.4;
/** Minimum protein (g/100g) required for meat-fish / eggs-dairy candidates. */
const MIN_PROTEIN_DENSE_CATEGORY = 5;
/** Minimum protein (g/100g) required for nuts-seeds / vegetables / fruit / legumes candidates (fiber alternative below). */
const MIN_PROTEIN_LIGHT_CATEGORY = 1;
/** Minimum fiber (g/100g) alternative to the protein floor for lighter categories. */
const MIN_FIBER_LIGHT_CATEGORY = 1.5;
/** Minimum accepted foods per category before a loud floor-breach warning is printed. */
const MIN_CATEGORY_FLOOR = 5;

/**
 * Title substrings (case-insensitive) that disqualify a candidate outright —
 * prepared/sweetened/composite dishes that don't belong in a generic
 * gap-filler suggestion pool.
 */
const BANNED_TITLE_TOKENS: readonly string[] = [
  'sugared',
  'syrup',
  'restaurant',
  'stew',
  'tart',
  'cocktail',
  'muesli',
  'bread',
  'roll',
  'pate',
  'chobani',
  'w/ ',
  '(w/',
  'with mayonnaise',
  'sauce',
  'salad',
  'pizza',
  'soup',
  'cake',
  'bar',
  'drink',
  'beverages',
  'sweetened',
  'candied',
  'breaded',
  'fried',
  'pasta',
  'juice',
  'cream',
  'marinade',
  'meatless',
  'pickled',
  'tossed',
  'chorizo',
  'smoothie',
  'puree',
  'powder',
  'flavored',
  'flavoured',
  'with fat',
  'with salt',
  'and salt',
  'in butter',
  'in oil',
  'balm',
  'tamarillo',
];

interface SeedFood {
  query: string;
  category: SuggestionCategory;
  servingGrams: number;
  /** Lowercase substrings that must ALL appear in a candidate's lowercased title. */
  requireTokens: string[];
}

interface FoodSearchMacros {
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
}

interface FoodSearchResult {
  slug: string;
  locale: string;
  title: string;
  canonicalName: string;
  origin: string | null;
  url: string | null;
  imageUrl: string | null;
  portionSize: number | null;
  macrosPer100g: FoodSearchMacros | null;
  netCarbsPer100g: number | null;
  attribution: string | null;
  score: number;
}

interface FoodSearchResponse {
  results: FoodSearchResult[];
}

/**
 * A search result that passed `hasCompleteMacros` — every macro field the
 * builder reads is known non-null, so no downstream cast is needed.
 */
interface CompleteFoodSearchMacros extends FoodSearchMacros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
}

interface CompleteFoodSearchResult extends FoodSearchResult {
  macrosPer100g: CompleteFoodSearchMacros;
  netCarbsPer100g: number;
}

const SEED_FOODS: SeedFood[] = [
  // meat-fish
  { query: 'chicken breast', category: 'meat-fish', servingGrams: 150, requireTokens: ['chicken', 'breast'] },
  { query: 'chicken thigh', category: 'meat-fish', servingGrams: 130, requireTokens: ['chicken', 'thigh'] },
  { query: 'turkey breast', category: 'meat-fish', servingGrams: 150, requireTokens: ['turkey', 'breast'] },
  { query: 'beef mince', category: 'meat-fish', servingGrams: 120, requireTokens: ['beef'] },
  { query: 'sirloin steak', category: 'meat-fish', servingGrams: 180, requireTokens: ['sirloin'] },
  { query: 'pork chop', category: 'meat-fish', servingGrams: 150, requireTokens: ['pork', 'chop'] },
  { query: 'bacon', category: 'meat-fish', servingGrams: 30, requireTokens: ['bacon'] },
  { query: 'ham', category: 'meat-fish', servingGrams: 60, requireTokens: ['ham'] },
  { query: 'salmon', category: 'meat-fish', servingGrams: 120, requireTokens: ['salmon'] },
  { query: 'tuna steak', category: 'meat-fish', servingGrams: 120, requireTokens: ['tuna'] },
  { query: 'canned tuna', category: 'meat-fish', servingGrams: 90, requireTokens: ['tuna'] },
  { query: 'cod', category: 'meat-fish', servingGrams: 130, requireTokens: ['cod'] },
  { query: 'prawns', category: 'meat-fish', servingGrams: 100, requireTokens: ['prawn'] },
  { query: 'shrimp', category: 'meat-fish', servingGrams: 100, requireTokens: ['shrimp'] },
  { query: 'sardines', category: 'meat-fish', servingGrams: 90, requireTokens: ['sardine'] },
  { query: 'mackerel', category: 'meat-fish', servingGrams: 120, requireTokens: ['mackerel'] },
  { query: 'lamb chop', category: 'meat-fish', servingGrams: 150, requireTokens: ['lamb'] },
  { query: 'duck breast', category: 'meat-fish', servingGrams: 150, requireTokens: ['duck', 'breast'] },
  { query: 'salami', category: 'meat-fish', servingGrams: 30, requireTokens: ['salami'] },
  { query: 'chorizo', category: 'meat-fish', servingGrams: 40, requireTokens: ['chorizo'] },
  { query: 'anchovies', category: 'meat-fish', servingGrams: 15, requireTokens: ['anchov'] },
  { query: 'crab meat', category: 'meat-fish', servingGrams: 100, requireTokens: ['crab'] },
  { query: 'chicken liver', category: 'meat-fish', servingGrams: 100, requireTokens: ['chicken', 'liver'] },
  { query: 'beef sausage', category: 'meat-fish', servingGrams: 80, requireTokens: ['beef', 'sausage'] },

  // eggs-dairy
  { query: 'egg', category: 'eggs-dairy', servingGrams: 50, requireTokens: ['egg'] },
  { query: 'egg white', category: 'eggs-dairy', servingGrams: 33, requireTokens: ['egg', 'white'] },
  { query: 'plain greek yogurt', category: 'eggs-dairy', servingGrams: 170, requireTokens: ['yogurt'] },
  { query: 'skyr', category: 'eggs-dairy', servingGrams: 170, requireTokens: ['skyr'] },
  { query: 'cottage cheese', category: 'eggs-dairy', servingGrams: 150, requireTokens: ['cottage'] },
  { query: 'quark', category: 'eggs-dairy', servingGrams: 150, requireTokens: ['quark'] },
  { query: 'cheddar cheese', category: 'eggs-dairy', servingGrams: 30, requireTokens: ['cheddar'] },
  { query: 'mozzarella', category: 'eggs-dairy', servingGrams: 40, requireTokens: ['mozzarella'] },
  { query: 'feta cheese', category: 'eggs-dairy', servingGrams: 40, requireTokens: ['feta'] },
  { query: 'parmesan', category: 'eggs-dairy', servingGrams: 20, requireTokens: ['parmesan'] },
  { query: 'whey protein powder', category: 'eggs-dairy', servingGrams: 30, requireTokens: ['whey'] },
  { query: 'brie cheese', category: 'eggs-dairy', servingGrams: 30, requireTokens: ['brie'] },
  { query: 'goat cheese', category: 'eggs-dairy', servingGrams: 30, requireTokens: ['goat'] },
  { query: 'ricotta', category: 'eggs-dairy', servingGrams: 100, requireTokens: ['ricotta'] },
  { query: 'kefir', category: 'eggs-dairy', servingGrams: 170, requireTokens: ['kefir'] },
  { query: 'gouda cheese', category: 'eggs-dairy', servingGrams: 30, requireTokens: ['gouda'] },

  // nuts-seeds
  { query: 'raw almonds', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['almond'] },
  { query: 'walnuts', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['walnut'] },
  { query: 'pecans', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['pecan'] },
  { query: 'macadamia nuts', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['macadamia'] },
  { query: 'peanut butter', category: 'nuts-seeds', servingGrams: 32, requireTokens: ['peanut'] },
  { query: 'almond butter', category: 'nuts-seeds', servingGrams: 32, requireTokens: ['almond'] },
  { query: 'chia seeds', category: 'nuts-seeds', servingGrams: 15, requireTokens: ['chia'] },
  { query: 'flaxseed', category: 'nuts-seeds', servingGrams: 15, requireTokens: ['flax'] },
  { query: 'sunflower seeds', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['sunflower'] },
  { query: 'pumpkin seeds', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['pumpkin'] },
  { query: 'hemp seeds', category: 'nuts-seeds', servingGrams: 15, requireTokens: ['hemp'] },
  { query: 'psyllium husk', category: 'nuts-seeds', servingGrams: 10, requireTokens: ['psyllium'] },
  { query: 'pistachios', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['pistachio'] },
  { query: 'brazil nuts', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['brazil'] },
  { query: 'cashews', category: 'nuts-seeds', servingGrams: 28, requireTokens: ['cashew'] },
  { query: 'sesame seeds', category: 'nuts-seeds', servingGrams: 15, requireTokens: ['sesame'] },

  // vegetables
  { query: 'broccoli', category: 'vegetables', servingGrams: 90, requireTokens: ['broccoli'] },
  { query: 'raw broccoli', category: 'vegetables', servingGrams: 90, requireTokens: ['broccoli'] },
  { query: 'spinach', category: 'vegetables', servingGrams: 60, requireTokens: ['spinach'] },
  { query: 'raw spinach', category: 'vegetables', servingGrams: 60, requireTokens: ['spinach'] },
  { query: 'kale', category: 'vegetables', servingGrams: 60, requireTokens: ['kale'] },
  { query: 'cauliflower', category: 'vegetables', servingGrams: 100, requireTokens: ['cauliflower'] },
  { query: 'brussels sprouts', category: 'vegetables', servingGrams: 90, requireTokens: ['brussels'] },
  { query: 'asparagus', category: 'vegetables', servingGrams: 90, requireTokens: ['asparagus'] },
  { query: 'green beans', category: 'vegetables', servingGrams: 90, requireTokens: ['green', 'bean'] },
  { query: 'zucchini', category: 'vegetables', servingGrams: 100, requireTokens: ['zucchini'] },
  { query: 'mushrooms', category: 'vegetables', servingGrams: 80, requireTokens: ['mushroom'] },
  { query: 'cabbage', category: 'vegetables', servingGrams: 100, requireTokens: ['cabbage'] },
  { query: 'avocado', category: 'vegetables', servingGrams: 100, requireTokens: ['avocado'] },
  { query: 'bell pepper', category: 'vegetables', servingGrams: 100, requireTokens: ['pepper'] },
  { query: 'artichoke', category: 'vegetables', servingGrams: 120, requireTokens: ['artichoke'] },
  { query: 'cucumber', category: 'vegetables', servingGrams: 100, requireTokens: ['cucumber'] },
  { query: 'celery', category: 'vegetables', servingGrams: 60, requireTokens: ['celery'] },
  { query: 'lettuce', category: 'vegetables', servingGrams: 50, requireTokens: ['lettuce'] },
  { query: 'radish', category: 'vegetables', servingGrams: 60, requireTokens: ['radish'] },
  { query: 'tomato', category: 'vegetables', servingGrams: 100, requireTokens: ['tomato'] },
  { query: 'raw tomato', category: 'vegetables', servingGrams: 100, requireTokens: ['tomato'] },
  { query: 'eggplant', category: 'vegetables', servingGrams: 100, requireTokens: ['eggplant'] },
  { query: 'leek', category: 'vegetables', servingGrams: 80, requireTokens: ['leek'] },
  { query: 'fennel', category: 'vegetables', servingGrams: 90, requireTokens: ['fennel'] },
  { query: 'onion', category: 'vegetables', servingGrams: 60, requireTokens: ['onion'] },

  // legumes
  { query: 'edamame', category: 'legumes', servingGrams: 100, requireTokens: ['edamame'] },
  { query: 'cooked lentils', category: 'legumes', servingGrams: 100, requireTokens: ['lentil'] },
  { query: 'black soybeans', category: 'legumes', servingGrams: 100, requireTokens: ['soybean'] },
  { query: 'chickpeas', category: 'legumes', servingGrams: 100, requireTokens: ['chickpea'] },
  { query: 'tofu', category: 'legumes', servingGrams: 100, requireTokens: ['tofu'] },
  { query: 'tempeh', category: 'legumes', servingGrams: 100, requireTokens: ['tempeh'] },
  { query: 'black beans', category: 'legumes', servingGrams: 100, requireTokens: ['black', 'bean'] },
  { query: 'kidney beans', category: 'legumes', servingGrams: 100, requireTokens: ['kidney', 'bean'] },
  { query: 'green peas', category: 'legumes', servingGrams: 80, requireTokens: ['pea'] },
  { query: 'pinto beans', category: 'legumes', servingGrams: 100, requireTokens: ['pinto', 'bean'] },
  { query: 'split peas', category: 'legumes', servingGrams: 80, requireTokens: ['split', 'pea'] },
  { query: 'natto', category: 'legumes', servingGrams: 50, requireTokens: ['natto'] },
  { query: 'lima beans cooked', category: 'legumes', servingGrams: 100, requireTokens: ['lima'] },
  { query: 'black-eyed peas cooked', category: 'legumes', servingGrams: 100, requireTokens: ['eyed'] },
  { query: 'soybeans cooked', category: 'legumes', servingGrams: 90, requireTokens: ['soybean'] },

  // fruit
  { query: 'raspberries', category: 'fruit', servingGrams: 100, requireTokens: ['raspberr'] },
  { query: 'fresh raspberries', category: 'fruit', servingGrams: 100, requireTokens: ['raspberr'] },
  { query: 'blackberries', category: 'fruit', servingGrams: 100, requireTokens: ['blackberr'] },
  { query: 'strawberries', category: 'fruit', servingGrams: 100, requireTokens: ['strawberr'] },
  { query: 'olives', category: 'fruit', servingGrams: 30, requireTokens: ['olive'] },
  { query: 'coconut', category: 'fruit', servingGrams: 30, requireTokens: ['coconut'] },
  { query: 'blueberries', category: 'fruit', servingGrams: 100, requireTokens: ['blueberr'] },
  { query: 'lemon', category: 'fruit', servingGrams: 50, requireTokens: ['lemon'] },
  { query: 'kiwi', category: 'fruit', servingGrams: 80, requireTokens: ['kiwi'] },
  { query: 'passion fruit', category: 'fruit', servingGrams: 50, requireTokens: ['passion'] },
  { query: 'guava', category: 'fruit', servingGrams: 90, requireTokens: ['guava'] },
  { query: 'pomegranate', category: 'fruit', servingGrams: 90, requireTokens: ['pomegranate'] },
  { query: 'cherimoya', category: 'fruit', servingGrams: 100, requireTokens: ['cherimoya'] },
  { query: 'cranberries', category: 'fruit', servingGrams: 100, requireTokens: ['cranberr'] },
  { query: 'grapefruit', category: 'fruit', servingGrams: 150, requireTokens: ['grapefruit'] },
  { query: 'cantaloupe', category: 'fruit', servingGrams: 150, requireTokens: ['cantaloup'] },
  { query: 'peach', category: 'fruit', servingGrams: 150, requireTokens: ['peach'] },
  { query: 'plum', category: 'fruit', servingGrams: 100, requireTokens: ['plum'] },
];

/**
 * Sleeps for the given number of milliseconds. Used to throttle sequential API calls.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rounds a number to at most two decimal places.
 */
function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Normalizes a candidate's title for display. Sentence-cases titles that are
 * either ALL-CAPS or Title-Cased word-by-word, leaving genuine mixed-case
 * titles untouched. The portion of the title from the first `(` onward
 * (parenthetical qualifiers) is always preserved exactly as LCC wrote it.
 * Single-word ALL-CAPS heads (e.g. plausible acronyms/abbreviations) are also
 * left untouched rather than being folded into sentence case.
 */
function normalizeTitleCase(title: string): string {
  const parenIndex = title.indexOf('(');
  const head = parenIndex === -1 ? title : title.slice(0, parenIndex);
  const tail = parenIndex === -1 ? '' : title.slice(parenIndex);

  const trimmedHead = head.trim();
  if (trimmedHead.length === 0) return title;

  const words = trimmedHead.split(/\s+/);
  const isWholeUpperCase = trimmedHead === trimmedHead.toUpperCase() && trimmedHead !== trimmedHead.toLowerCase();
  const isTitleCaseWordByWord = words.length > 1 && words.every((word) => /^[A-Z]/.test(word));
  const isLikelyAcronym = isWholeUpperCase && words.length === 1;

  if (isLikelyAcronym || (!isWholeUpperCase && !isTitleCaseWordByWord)) {
    return title;
  }

  const lowered = trimmedHead.toLowerCase();
  const sentenceCased = lowered.charAt(0).toUpperCase() + lowered.slice(1);
  const leadingSpace = head.slice(0, head.length - head.trimStart().length);
  const trailingSpace = head.slice(head.trimEnd().length);
  return `${leadingSpace}${sentenceCased}${trailingSpace}${tail}`;
}

/**
 * Queries the LowCarbCheck food search API for a single seed query.
 * Retries with exponential backoff on 429 (rate limited) responses; any other
 * non-ok response is thrown immediately.
 */
async function searchFoods(baseUrl: string, query: string): Promise<FoodSearchResult[]> {
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${baseUrl}/api/v1/foods/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, locale: 'en', limit: SEARCH_RESULT_LIMIT }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (response.ok) {
      // SAFETY: the endpoint is LowCarbCheck's `/api/v1/foods/search`, whose 200
      // body is `{ results: [...] }`. Every field this script reads off a result
      // is gated by `hasCompleteMacros` before use, so a drifted payload is
      // rejected as an incomplete candidate rather than silently trusted.
      const data = (await response.json()) as FoodSearchResponse;
      return data.results;
    }

    if (response.status !== 429) {
      throw new Error(`Food search request failed for "${query}": ${response.status} ${response.statusText}`);
    }

    if (attempt === RATE_LIMIT_MAX_ATTEMPTS) {
      throw new Error(`Food search request for "${query}" was rate limited after ${RATE_LIMIT_MAX_ATTEMPTS} attempts`);
    }

    const backoffMs = Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1), RATE_LIMIT_MAX_DELAY_MS);
    console.error(`WARN: rate limited on "${query}", retrying in ${backoffMs}ms (attempt ${attempt}/${RATE_LIMIT_MAX_ATTEMPTS})`);
    await delay(backoffMs);
  }

  throw new Error(`Food search request for "${query}" was rate limited after ${RATE_LIMIT_MAX_ATTEMPTS} attempts`);
}

/**
 * Returns true when a search result has all macro fields required to build a SuggestionFood.
 */
function hasCompleteMacros(result: FoodSearchResult): result is CompleteFoodSearchResult {
  if (!result.macrosPer100g) return false;
  const { kcal, protein, fat, carbs, fiber } = result.macrosPer100g;
  return kcal !== null && protein !== null && fat !== null && carbs !== null && fiber !== null && result.netCarbsPer100g !== null;
}

/**
 * Returns the first banned title token found in a candidate's title, or null if none match.
 */
function findBannedToken(title: string): string | null {
  const lowerTitle = title.toLowerCase();
  return BANNED_TITLE_TOKENS.find((token) => lowerTitle.includes(token)) ?? null;
}

/**
 * Returns the require-tokens that are missing from a candidate's title, or an
 * empty array when all required tokens are present.
 */
function findMissingRequireTokens(title: string, requireTokens: string[]): string[] {
  const lowerTitle = title.toLowerCase();
  return requireTokens.filter((token) => !lowerTitle.includes(token));
}

/**
 * Counts the words in a title after stripping parenthetical qualifiers
 * (including the parens themselves). Used both as a word-budget gate and as
 * the ranking tie-breaker — plainer, shorter titles win over composite/
 * prepared variants.
 */
function countWordsAfterStrippingParens(title: string): number {
  const stripped = title.replace(/\([^)]*\)/g, '');
  return stripped
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((word) => word.length > 0).length;
}

/**
 * Checks the numeric plausibility of a candidate's macros: carb-budget ceiling,
 * internal coherence (netCarbs/fiber vs carbs, kcal vs macro-derived kcal), and
 * a category-appropriate minimum protein/fiber floor. Assumes hasCompleteMacros
 * already passed, so all macro fields are non-null.
 */
function checkPlausibility(result: CompleteFoodSearchResult, category: SuggestionCategory): string | null {
  const { kcal, protein, fat, carbs, fiber } = result.macrosPer100g;
  const netCarbs = result.netCarbsPer100g;

  if (netCarbs > MAX_NET_CARBS_PER_100G) {
    return `netCarbsPer100g ${netCarbs} exceeds the ${MAX_NET_CARBS_PER_100G}g gap-filler ceiling`;
  }
  if (netCarbs > carbs + CARB_COHERENCE_TOLERANCE) {
    return `netCarbsPer100g ${netCarbs} exceeds carbs ${carbs} (incoherent)`;
  }

  // Use netCarbsPer100g (not the raw carbs field) for the kcal formula: the
  // API's `carbs` field is already net for curated/bls-origin rows but total
  // (including fiber) for fdc-origin rows, so it isn't a consistent input
  // across origins. netCarbsPer100g is. Fiber contributes ~2 kcal/g (not
  // fully absorbed, but not free either).
  const expectedKcal = 4 * protein + 4 * netCarbs + 2 * fiber + 9 * fat;
  if (expectedKcal > 0) {
    const deviationRatio = Math.abs(kcal - expectedKcal) / expectedKcal;
    if (deviationRatio > MAX_KCAL_DEVIATION_RATIO) {
      return `reported kcal ${kcal} deviates ${Math.round(deviationRatio * 100)}% from macro-derived kcal ${roundTo2(expectedKcal)}`;
    }
  }

  const isProteinDenseCategory = category === 'meat-fish' || category === 'eggs-dairy';
  if (isProteinDenseCategory && protein < MIN_PROTEIN_DENSE_CATEGORY) {
    return `protein ${protein} below the ${MIN_PROTEIN_DENSE_CATEGORY}g minimum for ${category}`;
  }
  if (!isProteinDenseCategory && protein < MIN_PROTEIN_LIGHT_CATEGORY && fiber < MIN_FIBER_LIGHT_CATEGORY) {
    return `protein ${protein} and fiber ${fiber} both below the minimum for ${category}`;
  }

  return null;
}

/**
 * Evaluates a single candidate against every gate in order, returning a
 * rejection reason string, or null when the candidate qualifies.
 */
function evaluateCandidate(result: FoodSearchResult, seed: SeedFood): string | null {
  const bannedToken = findBannedToken(result.title);
  if (bannedToken) {
    return `banned title token "${bannedToken}"`;
  }

  const missingTokens = findMissingRequireTokens(result.title, seed.requireTokens);
  if (missingTokens.length > 0) {
    return `missing required token(s): ${missingTokens.join(', ')}`;
  }

  const candidateWordCount = countWordsAfterStrippingParens(result.title);
  const seedWordCount = countWordsAfterStrippingParens(seed.query);
  const wordBudget = seedWordCount + 2;
  if (candidateWordCount > wordBudget) {
    return `word budget exceeded: ${candidateWordCount} words vs seed's ${seedWordCount}+2`;
  }

  if (!hasCompleteMacros(result)) {
    return 'incomplete macros';
  }

  return checkPlausibility(result, seed.category);
}

/**
 * Picks the best qualifying candidate for a seed from its search results,
 * logging a specific rejection reason for every candidate that doesn't
 * qualify. Prefers curated-origin entries, then shortest title, then highest score.
 */
function selectBestCandidate(seed: SeedFood, results: FoodSearchResult[]): CompleteFoodSearchResult | null {
  const qualifying: CompleteFoodSearchResult[] = [];

  for (const result of results) {
    const rejectionReason = evaluateCandidate(result, seed);
    if (rejectionReason) {
      console.error(`REJECTED candidate "${result.title}" (${result.slug}) for "${seed.query}": ${rejectionReason}`);
      continue;
    }
    // `evaluateCandidate` already ran this gate; re-running the predicate is how
    // that guarantee reaches the type system.
    if (!hasCompleteMacros(result)) continue;
    qualifying.push(result);
  }

  if (qualifying.length === 0) return null;

  const curated = qualifying.filter((candidate) => candidate.origin === 'curated');
  const pool = curated.length > 0 ? curated : qualifying;

  return pool.reduce((best, candidate) => {
    const candidateWordCount = countWordsAfterStrippingParens(candidate.title);
    const bestWordCount = countWordsAfterStrippingParens(best.title);
    if (candidateWordCount !== bestWordCount) {
      return candidateWordCount < bestWordCount ? candidate : best;
    }
    return candidate.score > best.score ? candidate : best;
  });
}

/**
 * Builds a SuggestionFood from a qualifying search result and its seed metadata.
 */
function buildSuggestionFood(result: CompleteFoodSearchResult, seed: SeedFood): SuggestionFood {
  const macros: SuggestionFoodMacros = {
    kcal: roundTo2(result.macrosPer100g.kcal),
    protein: roundTo2(result.macrosPer100g.protein),
    fat: roundTo2(result.macrosPer100g.fat),
    carbs: roundTo2(result.macrosPer100g.carbs),
    fiber: roundTo2(result.macrosPer100g.fiber),
    netCarbs: roundTo2(result.netCarbsPer100g),
  };

  const servingGrams = result.portionSize && result.portionSize > 0 ? result.portionSize : seed.servingGrams;

  return {
    slug: result.slug,
    name: normalizeTitleCase(result.title),
    category: seed.category,
    servingGrams,
    per100g: macros,
    url: result.url,
    attribution: result.attribution,
  };
}

/**
 * Resolves the seed list into a deduped, qualifying set of SuggestionFood entries.
 */
async function collectSuggestionFoods(baseUrl: string): Promise<SuggestionFood[]> {
  const foods: SuggestionFood[] = [];
  const usedSlugs = new Set<string>();

  for (const seed of SEED_FOODS) {
    const results = await searchFoods(baseUrl, seed.query);
    const candidate = selectBestCandidate(seed, results);

    if (!candidate) {
      console.error(`WARN: skipping "${seed.query}" — no qualifying result`);
      await delay(REQUEST_DELAY_MS);
      continue;
    }

    if (usedSlugs.has(candidate.slug)) {
      console.error(`WARN: skipping "${seed.query}" — duplicate slug "${candidate.slug}"`);
      await delay(REQUEST_DELAY_MS);
      continue;
    }

    usedSlugs.add(candidate.slug);
    foods.push(buildSuggestionFood(candidate, seed));
    await delay(REQUEST_DELAY_MS);
  }

  return foods;
}

/**
 * Prints the full accepted-food table plus a per-category count breakdown.
 */
function printReport(foods: SuggestionFood[]): void {
  const counts = new Map<SuggestionCategory, number>();
  for (const food of foods) {
    counts.set(food.category, (counts.get(food.category) ?? 0) + 1);
  }

  console.log('\n=== Accepted foods ===');
  const slugWidth = Math.max(4, ...foods.map((f) => f.slug.length));
  const categoryWidth = Math.max(8, ...foods.map((f) => f.category.length));
  for (const food of foods) {
    const slugCol = food.slug.padEnd(slugWidth);
    const categoryCol = food.category.padEnd(categoryWidth);
    console.log(
      `${slugCol}  ${categoryCol}  serving=${food.servingGrams}g  protein=${food.per100g.protein}  fiber=${food.per100g.fiber}  netCarbs=${food.per100g.netCarbs}`,
    );
  }

  console.log('\n=== Summary ===');
  console.log(`Total foods: ${foods.length}`);
  for (const [category, count] of [...counts.entries()].toSorted()) {
    console.log(`  ${category}: ${count}`);
  }

  const allCategories = new Set(SEED_FOODS.map((seed) => seed.category));
  for (const category of [...allCategories].toSorted()) {
    const count = counts.get(category) ?? 0;
    if (count < MIN_CATEGORY_FLOOR) {
      console.error(`!!! CATEGORY FLOOR BREACH: ${category} has only ${count} foods (minimum ${MIN_CATEGORY_FLOOR}) !!!`);
    }
  }
}

async function main(): Promise<void> {
  const baseUrl = process.env.FOOD_DB_API_URL ?? DEFAULT_BASE_URL;
  const foods = await collectSuggestionFoods(baseUrl);
  foods.sort((a, b) => a.slug.localeCompare(b.slug));

  const bundle = {
    generatedAt: new Date().toISOString(),
    source: 'lowcarbcheck.org /api/v1/foods/search (locale en)',
    foods,
  };

  const outputPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/data/suggestion-foods.json');
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf-8');

  printReport(foods);
}

await main();
