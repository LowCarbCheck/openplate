/**
 * A food name, shortened to fit a header status sentence (M265).
 *
 * A food name is user data: a person can call a food anything, and "Dinkel
 * porridge with blueberries and cinnamon" is as real as "Egg". No wording of
 * the sentence around it can make every name fit, so the NAME gives way: past
 * a fixed length it keeps its start and ends in "…", and the rest of the
 * sentence ("entfernt.", "Added") stays whole.
 *
 * ── WHY 18 ───────────────────────────────────────────────────────────────
 *
 * The tightest place a name lands is an Undo status on a 360 px phone: the
 * icon button and the close control leave the text column 126 px, and the
 * status face (Victor Mono at `text-xs`) is a flat 7 px a character, so a line
 * holds 18. A name of at most 18 characters therefore always fits on one line,
 * and the sentence's own words take the other: the quick-add sentence has two
 * lines, the delete sentence three. `tests/e2e/undo-control-look.spec.ts`
 * writes a 40 character German name at 360 px and measures the sentence.
 *
 * Counted in graphemes, not UTF-16 units, so an accented letter written as two
 * code points or an emoji is never cut in half.
 *
 * Pure.
 */

/** The most characters a food name keeps in a header status sentence, the "…" included. */
export const STATUS_FOOD_NAME_MAX_CHARS = 18;

/** The character a shortened name ends in. One character, so the cap holds. */
const ELLIPSIS = '…';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The name, or its start and "…" when it is longer than `maxChars`.
 *
 * A short name comes back untouched, the same string. A long one keeps its
 * first `maxChars - 1` characters, without trailing spaces, then "…".
 *
 * @param name - the food's display name.
 * @param maxChars - the most characters to keep, the "…" included. At least 2.
 * @returns a name of at most `maxChars` characters.
 */
export function shortenFoodName(name: string, maxChars: number = STATUS_FOOD_NAME_MAX_CHARS): string {
  if (!Number.isInteger(maxChars) || maxChars < 2) throw new Error(`maxChars must be an integer of at least 2: ${maxChars}`);
  const characters = Array.from(graphemes.segment(name), (part) => part.segment);
  if (characters.length <= maxChars) return name;
  return `${characters.slice(0, maxChars - 1).join('').trimEnd()}${ELLIPSIS}`;
}
