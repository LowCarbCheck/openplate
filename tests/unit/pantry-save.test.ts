/**
 * What ONE SAVE writes (`nextPantry` and `capturedFromDrafts`), M233 review.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `/pantry` reconciled every save against the rows on screen, so a line the
 * person deleted was deleted from the store. On the REVIEW arrival the rows on
 * screen are the new reading and nothing else, so a second photograph of a
 * different shelf deleted everything the first one had found. A save from a
 * reading is additive; a save from the list is the whole list.
 *
 * Neither existing check could see it: `pantry-merge.test.ts` drives the pure
 * merge, which never removes anything, and the browser walk started from an
 * EMPTY pantry. Every case below therefore begins with something in the store.
 *
 * ── And the amount box takes a comma ─────────────────────────────────────
 *
 * Five of the six languages this app ships in write 1,5 for one and a half,
 * and `Number.parseFloat` reads that as 1. The second half of this file is
 * about the box, with an unparseable string as the control.
 *
 * EVERY ASSERTION HAS A CONTROL: the additive case is paired with the removal
 * it must not break, and each comma case with a string that must stay null.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { capturedFromDrafts, nextPantry, type PantryDraftRow } from '../../app/lib/pantry-merge';
import type { LocalPantryItem } from '../../app/lib/local-store/schema';

const NOW = 1_700_000_000_000;

/** A stored row, as the loader hands it over. */
function stored(name: string, overrides: Partial<LocalPantryItem> = {}): LocalPantryItem {
  return {
    id: `id-${name}`,
    name,
    amount: null,
    unit: null,
    category: 'other',
    source: 'photo',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A row as the form holds it. */
function row(name: string, amount = ''): PantryDraftRow {
  return { key: `key-${name}`, name, amount, unit: null, category: 'other' };
}

/** The names a save would write, in the order it would write them. */
function namesAfterSave({
  storedItems,
  rows,
  path,
}: {
  storedItems: LocalPantryItem[];
  rows: PantryDraftRow[];
  path: 'photo' | 'text' | 'manual';
}): string[] {
  return nextPantry({ stored: storedItems, rows, path, now: NOW, makeId: () => 'new-id' }).map((item) => item.name);
}

describe('nextPantry, a save that came from a reading', () => {
  for (const path of ['photo', 'text'] as const) {
    it(`ADDS what the ${path} named and keeps what it did not`, () => {
      // The second photograph of the week: a different shelf, naming nothing
      // the first one did. Both must survive it.
      const names = namesAfterSave({
        storedItems: [stored('Butter'), stored('Eggs')],
        rows: [row('Milk'), row('Flour')],
        path,
      });

      assert.deepEqual(names.toSorted(), ['Butter', 'Eggs', 'Flour', 'Milk']);
    });
  }

  it('still updates a row the reading DID name, rather than adding a second one', () => {
    const written = nextPantry({
      stored: [stored('Eggs', { amount: 6, unit: 'piece' })],
      rows: [{ key: 'read-0', name: 'eggs', amount: '10', unit: 'piece', category: 'egg' }],
      path: 'photo',
      now: NOW,
      makeId: () => 'new-id',
    });

    assert.deepEqual(
      written.map((item) => item.name),
      ['eggs'],
    );
    assert.equal(written[0]?.id, 'id-Eggs', 'the stored row kept its identity');
    assert.equal(written[0]?.amount, 10);
  });
});

describe('nextPantry, a save that came from the list', () => {
  it('REMOVES what the person deleted, which is the control for everything above', () => {
    // Without this, a save that had simply stopped reconciling would pass every
    // additive case while making the remove button do nothing at all.
    const names = namesAfterSave({
      storedItems: [stored('Butter'), stored('Eggs')],
      rows: [row('Eggs')],
      path: 'manual',
    });

    assert.deepEqual(names, ['Eggs'], 'a row the person deleted came back');
  });

  it('keeps a row the person typed by hand beside the ones that were there', () => {
    const names = namesAfterSave({
      storedItems: [stored('Butter')],
      rows: [row('Butter'), row('Salt')],
      path: 'manual',
    });

    assert.deepEqual(names.toSorted(), ['Butter', 'Salt']);
  });

  it('drops a removal made in a name the merge folds to the same key', () => {
    // Removal is matched through `pantryNameKey`, the merge's own folding rule,
    // so a row whose capitalisation the person fixed is not read as a deletion
    // of the old spelling plus an addition of the new one.
    const names = namesAfterSave({
      storedItems: [stored('Eggs'), stored('Butter')],
      rows: [row('  eggs  ')],
      path: 'manual',
    });

    assert.deepEqual(names, ['eggs']);
  });
});

describe('capturedFromDrafts and the amount box', () => {
  /** What one amount string is stored as. */
  function amountOf(text: string): number | null {
    const [item] = capturedFromDrafts([row('Yoghurt', text)], 'manual');
    assert.ok(item !== undefined, 'a named row must always be captured');
    return item.amount;
  }

  it('reads a decimal COMMA as a decimal point', () => {
    // A German, French, Italian, Spanish or Turkish keyboard offers a comma on
    // the number pad, and `Number.parseFloat('1,5')` is 1.
    assert.equal(amountOf('1,5'), 1.5);
    assert.equal(amountOf('0,25'), 0.25);
  });

  it('reads a decimal POINT the same way, which is the control', () => {
    // Without this the rule above could be satisfied by a function that
    // answered 1.5 to everything.
    assert.equal(amountOf('1.5'), 1.5);
    assert.equal(amountOf('6'), 6);
  });

  it('answers null for a string that is not one number', () => {
    // THE CONTROL FOR THE COMMA RULE. `Number.parseFloat` stops at the first
    // character it cannot use, so each of these would otherwise be stored as a
    // figure the person never wrote.
    for (const text of ['1,5,5', '1.5.5', '1,5.5', 'six', '-2', '']) {
      assert.equal(amountOf(text), null, `expected "${text}" to be no amount at all`);
    }
  });

  it('takes the unit with the amount, and neither without it', () => {
    const rows: PantryDraftRow[] = [
      { key: 'a', name: 'Milk', amount: '1,5', unit: 'ml', category: 'dairy' },
      { key: 'b', name: 'Salt', amount: 'plenty', unit: 'g', category: 'other' },
    ];

    assert.deepEqual(
      capturedFromDrafts(rows, 'manual').map((item) => [item.amount, item.unit]),
      [
        [1.5, 'ml'],
        [null, null],
      ],
    );
  });

  it('drops a line nobody named, and stamps the path on the rest', () => {
    const captured = capturedFromDrafts([row(''), row('  '), row('Rice', '500')], 'photo');

    assert.deepEqual(
      captured.map((item) => item.name),
      ['Rice'],
    );
    assert.equal(captured[0]?.source, 'photo');
  });
});
