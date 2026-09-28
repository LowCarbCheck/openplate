/**
 * The lexical half of hybrid retrieval: pure string similarity, no model, no I/O,
 * no dependencies. This is the signal that always exists — the embedding half
 * (`embedding.ts`) is opt-in and best-effort, so if this file is wrong,
 * resolution is wrong on every default install.
 *
 * WHY FOUR COMPONENTS RATHER THAN ONE. The corpus is USDA-shaped: short queries
 * ("scrambled eggs") against long comma-delimited descriptions ("Egg, whole,
 * cooked, scrambled"). Each component covers a failure of the others, and every
 * one of the examples below is a measured ranking from the committed dataset, not
 * a hypothetical.
 *
 *  - `coverage` — how much of the QUERY the row accounts for, length-weighted.
 *    Asymmetric on purpose: a row may say more than the query ("Egg, whole,
 *    cooked, scrambled" fully covers "scrambled eggs"), but a row that misses a
 *    query word has missed the food. Alone it ties "Egg, raw" with "Egg, whole,
 *    dried, stabilized, glucose reduced" on the query "egg".
 *  - `brevity` — of the row's own words, how many the query accounted for. Breaks
 *    that tie toward the plain row, which is what a plate photo means. Alone it
 *    would prefer any two-word row to the correct five-word one.
 *  - `trigram` — character-level Dice similarity: the only component that
 *    survives a typo, an inflection the stemmer misses, or a compound
 *    ("cheeseburger" vs "cheese burger"). Alone it matches "chicken" to "chick
 *    peas".
 *  - `head` — does the row's FIRST word name the food the query is about? USDA
 *    descriptions are a comma hierarchy, identity first and qualifiers after
 *    ("Rice, white, steamed" vs "Flour, rice, white"), so the first token is not
 *    just another token. Without it, "Flour, rice, white" outranks "Rice, white,
 *    steamed" for "white rice".
 *
 * TWO DEMOTIONS, BOTH CORPUS-SHAPED, BOTH MULTIPLICATIVE AND MILD. They reorder
 * plausible rows; they never exclude one, because every row here is real USDA
 * data and a demotion that hid rows would just move the failure somewhere less
 * visible.
 *
 *  - BRAND. SR Legacy writes brands and chains in ALL CAPS and generic foods in
 *    sentence case ("DENNY'S, french fries" vs "Potatoes, french fried"). A plate
 *    photo is a generic food, so an unrequested ALL-CAPS token is evidence
 *    against the row.
 *  - DISH. "Potato pancakes" is not a potato either — see {@link DISH_QUALIFIERS}.
 *  - FORM. "Potato flour" is not a potato: 80 g carbs per 100 g against 17 g.
 *    Dehydration, milling, extraction and imitation change a food's identity AND
 *    its macros by up to an order of magnitude, so a row carrying one of those
 *    qualifiers when the query did not ask for it is a DIFFERENT FOOD. This is
 *    the single highest-value rule in the file: without it, "potato" resolves to
 *    potato flour and "banana" to banana powder — a confidently wrong macro,
 *    which is worse than the null a fail-open would have produced.
 *
 * PREFIX MATCHES GET PARTIAL CREDIT, NOT FULL. `apple` prefix-matches `applebee`,
 * and with full credit the query "apple" resolved to "APPLEBEE'S, chili". Credit
 * is now the length ratio, so a prefix that swallows the token scores near 1 and
 * a prefix that is a fragment of a longer, different word scores low.
 *
 * The weights are tuned against the committed FDC dataset (see `eval/BASELINE.md`,
 * spec 04 section), and the accept threshold in `search-foods.ts` is calibrated to
 * them — change one and re-check the other.
 *
 * STEMMING IS DELIBERATELY CRUDE. English plural stripping only, guarded by
 * length. A real stemmer (Porter/Snowball) is a dependency and a behaviour change
 * on German input, where it would mangle exactly the words the alias table exists
 * to handle.
 */

/** Anything that is not a letter or a digit is a separator. Unicode-aware: `Rührei` keeps its `ü`. */
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/**
 * Words that carry no discriminating power in a food name and would otherwise
 * inflate `coverage` for free. Kept SHORT: in a food corpus almost every word is
 * meaningful ("raw", "cooked" and "canned" all matter), so this list is
 * grammatical filler only, in both shipped languages.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'with',
  'without',
  'in',
  'on',
  'to',
  'und',
  'mit',
  'ohne',
  'der',
  'die',
  'das',
  'ein',
  'eine',
]);

/**
 * Qualifiers that make a row a DIFFERENT FOOD from the bare query, not a variant
 * of it — see the FORM demotion in the module header. Stemmed forms, because that
 * is what they are compared against.
 */
const FORM_QUALIFIERS = new Set([
  'flour',
  'powder',
  'powdered',
  'dried',
  'dehydrated',
  'dry',
  'concentrate',
  'concentrated',
  'extract',
  'syrup',
  'juice',
  'oil',
  'paste',
  'puree',
  'meatless',
  'vegetarian',
  'imitation',
  'substitute',
  'formula',
  'infant',
  'babyfood',
  // Milling by-products: bran, germ and hulls are fractions SEPARATED from the
  // grain, with macros nothing like it. Measured: "rice" resolved to "Rice bran,
  // crude" (a 20 g-fibre, 20 g-fat row) instead of a rice row.
  'bran',
  'germ',
  'hull',
  'husk',
  // A dressing is not the salad it dresses. This one sits in the FORM list rather
  // than the DISH list on purpose: measured, "caesar salad" resolved to "Salad
  // dressing, caesar" — a 500 kcal/100 g condiment standing in for a salad, which
  // is exactly the confidently-wrong macro the accept threshold exists to refuse.
  'dressing',
]);

/**
 * Words naming a COMPOSITE DISH rather than the food itself. Same
 * unrequested-only logic as {@link FORM_QUALIFIERS} and the same rationale one
 * step milder: "Potato pancakes" and "Potato salad with egg" are dishes made
 * FROM a potato, so for the bare query "potato" they are the wrong row — but a
 * plate genuinely can hold potato salad, and when the query says so the token is
 * requested and nothing is demoted.
 *
 * Measured: without this, "potato" resolved to "Potato pancakes" and "milk" to
 * "Milk and cereal bar".
 */
const DISH_QUALIFIERS = new Set([
  'pancake',
  'salad',
  'soup',
  'sauce',
  'chip',
  'nugget',
  'stick',
  'pie',
  'cake',
  'sandwich',
  'pizza',
  'burger',
  'casserole',
  'stew',
  'entree',
  'dinner',
  'bar',
  'roll',
  'cracker',
  'cookie',
  'muffin',
]);

/** Minimum token length that survives tokenization. Single letters are noise. */
const MIN_TOKEN_LENGTH = 2;

/** Shortest prefix that may count as a token match at all ("chick" must not reach "chicken"). */
const MIN_PREFIX_MATCH = 4;

/** Component weights. They sum to 1 so a perfect match on all four scores 1.0. */
const WEIGHT_COVERAGE = 0.55;
const WEIGHT_BREVITY = 0.15;
const WEIGHT_TRIGRAM = 0.18;
const WEIGHT_HEAD = 0.12;

/** Multiplier for an unrequested ALL-CAPS brand token. */
const BRAND_PENALTY = 0.9;

/** Multiplier for an unrequested form qualifier. Harder than the brand one — it is a different food. */
const FORM_PENALTY = 0.75;

/** Multiplier for an unrequested composite-dish word. Milder than FORM — the food is still in there. */
const DISH_PENALTY = 0.82;

/** Shortest run treated as a brand marker (`SILK`, `DENNY'S`; not `II` or `NY`). */
const MIN_BRAND_TOKEN_LENGTH = 3;

/**
 * Fraction of a token's letters that must be upper case for it to read as a
 * brand. Not "all caps": USDA writes `McDONALD'S`, which has a lower-case `c`
 * and would slip through a strict all-caps test — measured, it kept
 * "McDONALD'S, french fries" as the top hit for "french fries".
 */
const BRAND_UPPERCASE_RATIO = 0.6;

/** Lowercases and collapses everything non-alphanumeric to single spaces. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(SEPARATORS, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Crude English plural → singular. The length guards keep it off short words
 * where a trailing `s` is structural.
 */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  // `potatoes` → `potato`, `tomatoes` → `tomato`. Without this rule the plural
  // stems to `potatoe`, which only PREFIX-matches `potato` (partial credit) and
  // measurably ranked "Potato pancakes" above "Potatoes, raw" for "potato".
  if (token.length > 4 && token.endsWith('oes')) return token.slice(0, -2);
  if (token.length > 4 && (token.endsWith('ses') || token.endsWith('hes') || token.endsWith('xes'))) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Normalized, stopworded, stemmed, de-duplicated tokens. Order preserved. */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of normalizeText(text).split(' ')) {
    if (raw.length < MIN_TOKEN_LENGTH) continue;
    if (STOPWORDS.has(raw)) continue;
    const stemmed = stem(raw);
    if (stemmed.length < MIN_TOKEN_LENGTH || seen.has(stemmed)) continue;
    seen.add(stemmed);
    tokens.push(stemmed);
  }
  return tokens;
}

/** Padded character trigrams of a normalized string. */
export function trigrams(text: string): Set<string> {
  const padded = `  ${normalizeText(text)}  `;
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    grams.add(padded.slice(index, index + 3));
  }
  return grams;
}

/** Sørensen–Dice coefficient over two trigram sets, 0..1. */
function diceCoefficient(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/** Dice similarity between two raw strings. */
export function trigramSimilarity(left: string, right: string): number {
  return diceCoefficient(trigrams(left), trigrams(right));
}

/**
 * Match strength between a query token and a document token, 0..1. Exact stems
 * score 1; a prefix relationship scores the length ratio — see the module header
 * for the `apple`/`applebee` failure that rule exists to fix.
 */
function matchStrength(queryToken: string, docToken: string): number {
  if (queryToken === docToken) return 1;
  const shorter = queryToken.length <= docToken.length ? queryToken : docToken;
  const longer = shorter === queryToken ? docToken : queryToken;
  if (shorter.length < MIN_PREFIX_MATCH) return 0;
  if (!longer.startsWith(shorter)) return 0;
  return shorter.length / longer.length;
}

/**
 * A corpus row prepared for scoring. Built ONCE per row when a backend loads its
 * dataset, because re-tokenizing 8 000 names per query cost ~60 ms and this
 * brings a full scan to single-digit milliseconds.
 */
export interface LexicalDocument {
  name: string;
  tokens: string[];
  trigrams: Set<string>;
  normalized: string;
  /** Lower-cased upper-case-dominant tokens from the RAW name — the brand-demotion evidence. */
  brandTokens: string[];
}

export interface LexicalQuery {
  text: string;
  normalized: string;
  tokens: string[];
  trigrams: Set<string>;
}

export function prepareDocument(name: string): LexicalDocument {
  const brandTokens: string[] = [];
  for (const raw of name.split(SEPARATORS)) {
    if (raw.length < MIN_BRAND_TOKEN_LENGTH) continue;
    const letters = [...raw].filter((char) => char.toLowerCase() !== char.toUpperCase());
    if (letters.length < MIN_BRAND_TOKEN_LENGTH) continue;
    const upper = letters.filter((char) => char === char.toUpperCase()).length;
    if (upper < MIN_BRAND_TOKEN_LENGTH) continue;
    if (upper / letters.length <= BRAND_UPPERCASE_RATIO) continue;
    brandTokens.push(stem(raw.toLowerCase()));
  }
  return {
    name,
    tokens: tokenize(name),
    trigrams: trigrams(name),
    normalized: normalizeText(name),
    brandTokens,
  };
}

export function prepareQuery(query: string): LexicalQuery {
  return {
    text: query,
    normalized: normalizeText(query),
    tokens: tokenize(query),
    trigrams: trigrams(query),
  };
}

export interface LexicalBreakdown {
  score: number;
  /** Length-weighted share of query tokens the document accounts for, 0..1. */
  coverage: number;
  /** Share of document tokens the query accounted for, 0..1. */
  brevity: number;
  trigram: number;
  /** 0, 0.5 or 1 — see the `head` bullet in the module header. */
  head: number;
  brandDemoted: boolean;
  formDemoted: boolean;
  dishDemoted: boolean;
}

function emptyBreakdown(trigram: number): LexicalBreakdown {
  return {
    score: WEIGHT_TRIGRAM * trigram,
    coverage: 0,
    brevity: 0,
    trigram,
    head: 0,
    brandDemoted: false,
    formDemoted: false,
    dishDemoted: false,
  };
}

/** True when the query asked for nothing that matches `token`. */
function unrequested(token: string, queryTokens: readonly string[]): boolean {
  return !queryTokens.some((queryToken) => matchStrength(queryToken, token) > 0);
}

/**
 * Scores the row's identity token against the query. The query's LAST token is
 * checked separately because English puts the head noun last ("white rice" →
 * "rice") exactly where USDA puts it first ("Rice, white, ...").
 */
function scoreHead(queryTokens: readonly string[], docTokens: readonly string[]): number {
  const docHead = docTokens[0];
  if (docHead === undefined) return 0;
  const queryHead = queryTokens[queryTokens.length - 1];
  if (queryHead !== undefined && matchStrength(queryHead, docHead) > 0.7) return 1;
  if (queryTokens.some((token) => matchStrength(token, docHead) > 0.7)) return 0.5;
  return 0;
}

/** Scores a prepared query against a prepared document. Pure; ~1 µs. */
export function scorePrepared(query: LexicalQuery, document: LexicalDocument): LexicalBreakdown {
  const trigram = diceCoefficient(query.trigrams, document.trigrams);

  if (query.normalized.length === 0 || document.normalized.length === 0) {
    return { ...emptyBreakdown(trigram), score: 0, trigram };
  }
  // An exact name match is not a similarity question.
  if (query.normalized === document.normalized) {
    return {
      score: 1,
      coverage: 1,
      brevity: 1,
      trigram: 1,
      head: 1,
      brandDemoted: false,
      formDemoted: false,
      dishDemoted: false,
    };
  }
  if (query.tokens.length === 0 || document.tokens.length === 0) return emptyBreakdown(trigram);

  let queryWeight = 0;
  let matchedQueryWeight = 0;
  const matchedDocTokens = new Set<string>();

  for (const queryToken of query.tokens) {
    // Longer words discriminate more: matching "chicken" is worth more than
    // matching "raw". Plain length is a rough stand-in for IDF, which would need
    // corpus statistics this function deliberately does not have.
    const weight = queryToken.length;
    queryWeight += weight;
    let best = 0;
    for (const docToken of document.tokens) {
      const strength = matchStrength(queryToken, docToken);
      if (strength === 0) continue;
      if (strength > best) best = strength;
      matchedDocTokens.add(docToken);
    }
    matchedQueryWeight += weight * best;
  }

  const coverage = queryWeight === 0 ? 0 : matchedQueryWeight / queryWeight;
  const brevity = matchedDocTokens.size / document.tokens.length;
  const head = scoreHead(query.tokens, document.tokens);
  const brandDemoted = document.brandTokens.some((token) => unrequested(token, query.tokens));
  const formDemoted = document.tokens.some(
    (token) => FORM_QUALIFIERS.has(token) && unrequested(token, query.tokens),
  );
  const dishDemoted = document.tokens.some(
    (token) => DISH_QUALIFIERS.has(token) && unrequested(token, query.tokens),
  );

  let score =
    WEIGHT_COVERAGE * coverage +
    WEIGHT_BREVITY * brevity +
    WEIGHT_TRIGRAM * trigram +
    WEIGHT_HEAD * head;
  if (brandDemoted) score *= BRAND_PENALTY;
  if (formDemoted) score *= FORM_PENALTY;
  if (dishDemoted) score *= DISH_PENALTY;

  return { score, coverage, brevity, trigram, head, brandDemoted, formDemoted, dishDemoted };
}

/**
 * Convenience wrapper for callers with a handful of names and nothing to cache —
 * the remote backends, which get ≤10 rows back from an API, and the unit tests.
 * The FDC backend prepares its documents once at load and calls `scorePrepared`.
 */
export function scoreLexical(query: string, documentName: string): LexicalBreakdown {
  return scorePrepared(prepareQuery(query), prepareDocument(documentName));
}
