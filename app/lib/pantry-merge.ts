/**
 * Folding a fresh capture into the pantry somebody already has, as a pure
 * function.
 *
 * ── Why a merge and not an append ────────────────────────────────────────
 *
 * People photograph the same shelf twice. They photograph the fridge on
 * Monday, buy eggs on Wednesday and photograph it again, and both readings
 * name eggs. An append would answer that with two rows called "Eggs", and a
 * list with two of everything is a list nobody keeps. So the SECOND reading of
 * a name updates the first row rather than standing beside it.
 *
 * ── What counts as the same name ─────────────────────────────────────────
 *
 * Case-folded and whitespace-collapsed, and nothing cleverer. "Eggs", "eggs"
 * and "  eggs " are one ingredient. "Eier" and "eggs" are two, deliberately:
 * the app never translates a person's own list (see `pantry-prompt.ts`), and a
 * matcher that decided those were the same would be doing translation with no
 * way for the person to see it happen or undo it. Two rows they can merge by
 * renaming one is a smaller problem than one row in a language they did not
 * choose.
 *
 * ── Pure, with every impure input passed in ──────────────────────────────
 *
 * `now` and the id source are arguments, so the whole rule is unit-testable
 * without a clock or a store, the same shape `saved-meals.ts` and `copy-day.ts`
 * already use for the sibling features.
 */
import { randomUuid } from '#app/lib/uuid';
import type { LocalPantryItem, PantryCategory, PantryUnit } from '#app/lib/local-store/schema';

/** One row as a capture or a review form hands it over: everything but an identity and a clock. */
export interface CapturedPantryItem {
  name: string;
  amount: number | null;
  unit: PantryUnit | null;
  category: PantryCategory;
  source: LocalPantryItem['source'];
}

/**
 * The key two rows are considered the same ingredient under.
 *
 * Exported because the review form needs the SAME answer when it decides
 * whether two lines a person typed collide; a second spelling of this rule
 * there would let a capture merge rows the form had just let stand apart.
 *
 * @param name - the item's name as written.
 * @returns the name folded to lower case with every run of whitespace collapsed to one space.
 */
export function pantryNameKey(name: string): string {
  return name.trim().replaceAll(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * The pantry after a capture is folded into it.
 *
 * An EXISTING name is updated in place, keeping its id, its `createdAt` and
 * its position in the list, and taking the capture's amount, unit, category
 * and source with a fresh `updatedAt`. A new name is appended as a new row.
 *
 * THE CAPTURE'S AMOUNT WINS, INCLUDING A NULL ONE, and that is a decision
 * rather than an oversight: the reading is the person's newest statement about
 * that shelf, so a second photograph in which the flour bag's weight is no
 * longer legible says "I can no longer tell", and keeping the old 1000 g would
 * assert a figure this reading did not support. A person who wants the old
 * number types it back in, which is one tap in the review form.
 *
 * Two captured rows that fold to the SAME key inside one call collapse into
 * one, last one winning, for the same reason: a reading that named "eggs" and
 * "Eggs" has named one ingredient twice.
 *
 * @param existing - the pantry as stored, in the order it is shown.
 * @param captured - the rows the person just confirmed, in the order they were shown.
 * @param now - epoch-ms to stamp every touched row with.
 * @param makeId - id source for new rows, defaulting to the app's own.
 * @returns the complete new pantry, ready for `replaceLocalPantry`.
 */
export function mergePantry({
  existing,
  captured,
  now,
  makeId = randomUuid,
}: {
  existing: readonly LocalPantryItem[];
  captured: readonly CapturedPantryItem[];
  now: number;
  makeId?: () => string;
}): LocalPantryItem[] {
  const merged = [...existing];
  // Position by key, so a second capture of a name reaches the row it already
  // has rather than being compared against every row again.
  const indexByKey = new Map<string, number>();
  merged.forEach((item, index) => indexByKey.set(pantryNameKey(item.name), index));

  for (const item of captured) {
    const key = pantryNameKey(item.name);
    // A blank name is not a row. It is an "add a line" the person never filled
    // in, and storing it would put an unnameable entry in their list.
    if (key === '') continue;

    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({
        id: makeId(),
        name: item.name.trim(),
        amount: item.amount,
        // A unit without an amount would render a bare "ml" against a name.
        unit: item.amount === null ? null : item.unit,
        category: item.category,
        source: item.source,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const previous = merged[index];
    merged[index] = {
      ...previous,
      // The NAME the person most recently wrote, so fixing the capitalisation
      // of a row is a rename rather than a no-op that silently keeps the old
      // spelling. The key is unchanged by definition, so nothing moves.
      name: item.name.trim(),
      amount: item.amount,
      unit: item.amount === null ? null : item.unit,
      category: item.category,
      source: item.source,
      updatedAt: now,
    };
  }

  return merged;
}
