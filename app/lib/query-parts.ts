/**
 * Splitting a typed food search into its content parts (M208/04).
 *
 * The defect this closes: "Kaffee mit Hafermilch" is a real thing a person
 * drinks, but it is not a row in any food database. Searched as one phrase it
 * finds nothing usable, and the screen leaves the person with a dead end and a
 * full text field. The two foods they actually want, "Kaffee" and
 * "Hafermilch", are both in the catalog and both one tap away once the query
 * is split on the word that glues them together.
 *
 * Pure and React-free, so the rule is unit-testable on its own.
 *
 * THE CONNECTOR LIST IS A MIRROR, not an original. It is copied from
 * LowCarbCheck's `apps/remix-lcc/app/lib/food-api/connectors.ts` (read
 * 2026-09-09), which is the list the search backend itself uses to decide
 * which query tokens name a food. The two live in different repositories, so
 * nothing but this comment and `tests/unit/add-query-parts.test.ts` keeps them
 * together: a word added there has to be added here in the same change, and a
 * word added here that the backend does not know is a defect.
 *
 * NEGATIONS ARE DELIBERATELY ABSENT, for the same reason they are absent from
 * the backend list. "ohne", "without", "no" and friends CHANGE which food is
 * meant. "Salat ohne Hähnchen" split into "Salat" and "Hähnchen" would offer
 * the person exactly the food they said they did not eat, so a negation is a
 * content word here and always will be.
 */

/** UI languages with a connector list. Any other language gets the union fallback. */
export type ConnectorLanguage = 'de' | 'en';

/** Connector words per language, mirroring LowCarbCheck's `connectors.ts`. */
export const CONNECTOR_WORDS = {
  de: ['mit', 'und', 'in', 'im'],
  en: ['with', 'and', 'in', 'of'],
} as const satisfies Readonly<Record<ConnectorLanguage, readonly string[]>>;

/**
 * The set used when the active UI language has no list of its own: the union
 * of every populated list. A person reading the app in Spanish can still type
 * a German or English query, and none of these words names a food in any of
 * those languages, so the union costs nothing and the rule stays on.
 */
export const DEFAULT_CONNECTOR_WORDS: readonly string[] = [
  ...new Set([...CONNECTOR_WORDS.de, ...CONNECTOR_WORDS.en]),
];

/** Shortest part worth offering. Below this the curated lookup is not even attempted (`MIN_CURATED_QUERY_LENGTH` in `add.tsx`). */
const MIN_PART_LENGTH = 2;

/** How many chips to offer at most, so a long sentence cannot fill the screen with them. */
const MAX_PARTS = 4;

/** Punctuation trimmed off the edge of a token or a part, never from inside one (a "3,5 %" stays whole). */
const EDGE_PUNCTUATION = /^[\s,;.:!?]+|[\s,;.:!?]+$/g;

/**
 * Resolves the connector set for an i18next language tag.
 *
 * @param language - the active UI language, for example `de`, `de-DE` or
 *   `undefined`. Only the base subtag is read.
 * @returns that language's connectors, or the union fallback.
 */
export function resolveConnectorWords(language?: string): ReadonlySet<string> {
  const base = (language ?? '').split('-')[0].toLowerCase();
  if (base === 'de' || base === 'en') return new Set(CONNECTOR_WORDS[base]);
  return new Set(DEFAULT_CONNECTOR_WORDS);
}

/** A token stripped of edge punctuation and case, for comparison against the connector set only. */
function normalizeToken(token: string): string {
  return token.replace(EDGE_PUNCTUATION, '').toLowerCase();
}

/**
 * Splits a query into the content parts a connector word joins.
 *
 * Whole words only: "Mitte" is a food, not the connector "mit". The parts keep
 * the person's own spelling and capitalisation, because each one is going
 * straight back into the search box where they will read it.
 *
 * @param query - the raw typed query.
 * @param language - the active UI language, see `resolveConnectorWords`.
 * @returns the parts to offer, in the order they were typed, deduplicated
 *   case-insensitively; an EMPTY array whenever there is nothing useful to
 *   offer (no connector, or fewer than two parts left after trimming).
 */
export function splitQueryIntoParts({ query, language }: { query: string; language?: string }): string[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const connectors = resolveConnectorWords(language);
  if (!tokens.some((token) => connectors.has(normalizeToken(token)))) return [];

  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (connectors.has(normalizeToken(token))) {
      segments.push([]);
      continue;
    }
    segments[segments.length - 1].push(token);
  }

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const segment of segments) {
    const part = segment.join(' ').replace(EDGE_PUNCTUATION, '');
    if (part.length < MIN_PART_LENGTH) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(part);
  }

  // One part is not a split: it means the person typed a connector with
  // nothing on one side of it ("mit Hafermilch"), and offering the single
  // remaining word as a chip would just repeat the search they already ran.
  if (parts.length < 2) return [];
  return parts.slice(0, MAX_PARTS);
}

/**
 * The parts to offer as chips, or none.
 *
 * @param query - the query that was actually searched.
 * @param language - the active UI language.
 * @param hasConfidentMatch - whether the whole-query search already produced a
 *   strong or likely match. When it did, the person has what they came for and
 *   the chips would only be noise.
 * @returns the chip labels, or an empty array.
 */
export function queryPartsToOffer({
  query,
  language,
  hasConfidentMatch,
}: {
  query: string;
  language?: string;
  hasConfidentMatch: boolean;
}): string[] {
  if (hasConfidentMatch) return [];
  return splitQueryIntoParts({ query, language });
}
