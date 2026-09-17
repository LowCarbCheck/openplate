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
import type { PantryCapturePath } from '#app/lib/matomo-events';
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

////////////////////////////////////////////////////////////////////////////////
// From the rows on screen to the list that is written
////////////////////////////////////////////////////////////////////////////////

/**
 * One line as the form holds it while a person edits.
 *
 * `amount` is a STRING, not a number, because it is the text in the box: a
 * half-typed "1." and a cleared field are both states a `number | null` cannot
 * hold, and a form that reinterpreted them mid-keystroke would delete digits
 * under the person's thumb. It becomes a number once, on confirm.
 *
 * It lives here rather than beside the screen because the two functions below
 * are the whole of what a save does, and they are pure.
 */
export interface PantryDraftRow {
  /** Stable key for the list, never stored. A row's stored id is decided by the merge. */
  key: string;
  name: string;
  amount: string;
  unit: PantryUnit | null;
  category: PantryCategory;
}

/**
 * The amount box as a number, or null.
 *
 * A DECIMAL COMMA IS A DECIMAL POINT. Most of the languages this app ships in
 * write 1,5 for one and a half, and phone keyboards in those locales offer a
 * comma on the number pad, so `Number.parseFloat` would quietly read 1,5 as 1
 * and store a third of the yoghurt. One comma with no point anywhere is
 * therefore rewritten before parsing. A string with both, or with two commas,
 * is not a decimal in any convention this app can name, so it stays
 * unparseable and the row is stored with no amount at all.
 *
 * @param text - the text in the amount box.
 * @returns the number it names, or null for blank, unparseable or negative.
 */
function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const decimal = !trimmed.includes('.') && trimmed.split(',').length === 2 ? trimmed.replace(',', '.') : trimmed;
  // A TRAILING REMAINDER IS NOT A NUMBER. `Number.parseFloat` stops at the
  // first character it cannot use and answers with what it has, so "1,5,5"
  // and "-2" would otherwise be stored as 1 and as 2. A half-typed "1." is
  // still a number, because it is what a person sees while they type.
  if (!/^(?:\d+\.?\d*|\.\d+)$/u.test(decimal)) return null;
  const parsed = Number.parseFloat(decimal);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The draft rows as the merge wants them.
 *
 * A BLANK AMOUNT IS NULL, never 0, and an unparseable one is null too. Zero is
 * a claim ("there is none of this"), and a person who cleared the box was
 * saying they do not know. A row with no name is dropped here rather than in
 * the merge, so an "add a line" nobody filled in never reaches the store.
 *
 * @param rows - the draft rows, in the order they are shown.
 * @param source - how these rows arrived, stamped on every one of them.
 * @returns one captured item per named row.
 */
export function capturedFromDrafts(rows: readonly PantryDraftRow[], source: PantryCapturePath): CapturedPantryItem[] {
  const captured: CapturedPantryItem[] = [];
  for (const row of rows) {
    if (row.name.trim() === '') continue;
    const amount = parseAmount(row.amount);
    captured.push({
      name: row.name,
      amount,
      unit: amount === null ? null : row.unit,
      category: row.category,
      source,
    });
  }
  return captured;
}

/**
 * Whether the rows on screen still hold this merged item.
 *
 * Matching is by NAME through {@link pantryNameKey}, the merge's OWN folding
 * rule rather than a second spelling of it, because a row the person typed has
 * no id until the merge gives it one, and two foldings would drop rows the
 * merge had just kept.
 */
function rowsHold(rows: readonly PantryDraftRow[], item: LocalPantryItem): boolean {
  const key = pantryNameKey(item.name);
  return rows.some((row) => pantryNameKey(row.name) === key);
}

/**
 * The whole pantry after one save, ready for `replaceLocalPantry`.
 *
 * ── THE ROWS ON SCREEN MEAN TWO DIFFERENT THINGS ─────────────────────────
 *
 * `/pantry` renders one row editor for two arrivals, and what the rows in it
 * ARE differs:
 *
 *  - From the LIST (`path` is `'manual'`), the rows are the whole pantry. A
 *    line the person deleted is a removal, so the merged list is reconciled
 *    against them and anything they no longer show is gone.
 *  - From a READING (`'photo'` or `'text'`), the rows are that reading and
 *    nothing else. The stored items it did not name are not removals, they are
 *    simply things the camera could not see, so the save is ADDITIVE and
 *    nothing is reconciled away.
 *
 * One filter for both arrivals is the defect this function was extracted to
 * fix: a second photograph deleted everything the first one had found
 * (`tests/e2e/pantry-second-photo.spec.ts`). A person who wants an item gone
 * removes it in the list, which is the arrival where removal means something.
 *
 * @param stored - the pantry as the store holds it.
 * @param rows - the rows on screen, as the person left them.
 * @param path - how those rows arrived, which decides whether this is the whole list.
 * @param now - epoch-ms to stamp every touched row with.
 * @param makeId - id source for new rows, defaulting to the app's own.
 * @returns the complete new pantry.
 */
export function nextPantry({
  stored,
  rows,
  path,
  now,
  makeId = randomUuid,
}: {
  stored: readonly LocalPantryItem[];
  rows: readonly PantryDraftRow[];
  path: PantryCapturePath;
  now: number;
  makeId?: () => string;
}): LocalPantryItem[] {
  const merged = mergePantry({ existing: stored, captured: capturedFromDrafts(rows, path), now, makeId });
  if (path !== 'manual') return merged;
  return merged.filter((item) => rowsHold(rows, item));
}
