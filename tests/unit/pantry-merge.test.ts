/**
 * The merge-by-name rule (`#app/lib/pantry-merge`), M233/02.
 *
 * The feature it protects: somebody photographs the same shelf twice, and both
 * readings name eggs. Without this rule the list grows a second "Eggs" every
 * time, and a list with two of everything is a list nobody keeps.
 *
 * Pure, so there is no store and no clock here: `now` and the id source are
 * arguments, the same shape `saved-meals.test.ts` and `copy-day.test.ts` use.
 *
 * EVERY ASSERTION IS PAIRED WITH A CONTROL. "Two captures of eggs leave one
 * row" is trivially true of a function that discards everything, so each
 * collapse test sits beside a case where two DIFFERENT names must leave two
 * rows.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergePantry, pantryNameKey, type CapturedPantryItem } from '../../app/lib/pantry-merge';
import type { LocalPantryItem } from '../../app/lib/local-store/schema';

const FIRST = 1_700_000_000_000;
const LATER = FIRST + 86_400_000;

/** A stored row; override any field per test. */
function stored(name: string, overrides: Partial<LocalPantryItem> = {}): LocalPantryItem {
  return {
    id: `id-${name}`,
    name,
    amount: null,
    unit: null,
    category: 'other',
    source: 'manual',
    createdAt: FIRST,
    updatedAt: FIRST,
    ...overrides,
  };
}

/** A captured row; override any field per test. */
function captured(name: string, overrides: Partial<CapturedPantryItem> = {}): CapturedPantryItem {
  return { name, amount: null, unit: null, category: 'other', source: 'photo', ...overrides };
}

/** Ids that say which call minted them, so a new row is obvious in a failure message. */
function countingIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `new-${next}`;
  };
}

describe('pantryNameKey', () => {
  it('folds case and collapses whitespace', () => {
    assert.equal(pantryNameKey('  Red   Peppers '), 'red peppers');
  });

  it('does NOT fold two different words together, which is the control', () => {
    // A matcher that decided "Eier" and "eggs" were one ingredient would be
    // translating the person's own list with no way to see it happen.
    assert.notEqual(pantryNameKey('Eier'), pantryNameKey('eggs'));
  });
});

describe('mergePantry', () => {
  it('leaves ONE row when two captures name the same ingredient', () => {
    const merged = mergePantry({
      existing: [stored('Eggs', { amount: 6, unit: 'piece' })],
      captured: [captured('eggs', { amount: 10, unit: 'piece' })],
      now: LATER,
      makeId: countingIds(),
    });

    assert.equal(merged.length, 1);
    // Same row, so the id and the creation instant survive.
    assert.equal(merged[0].id, 'id-Eggs');
    assert.equal(merged[0].createdAt, FIRST);
    // The newer reading's figure wins, and the change is dated.
    assert.equal(merged[0].amount, 10);
    assert.equal(merged[0].updatedAt, LATER);
  });

  it('leaves TWO rows when two captures name different ingredients, which is the control', () => {
    // Without this case the test above passes against a merge that threw the
    // capture away, or one that answered `existing` unchanged.
    const merged = mergePantry({
      existing: [stored('Eggs')],
      captured: [captured('Butter')],
      now: LATER,
      makeId: countingIds(),
    });

    assert.deepEqual(
      merged.map((item) => item.name),
      ['Eggs', 'Butter'],
    );
    assert.equal(merged[1].id, 'new-1');
    assert.equal(merged[1].createdAt, LATER);
  });

  it('collapses two rows of one capture that fold to the same key', () => {
    const merged = mergePantry({
      existing: [],
      captured: [captured('Eggs', { amount: 6, unit: 'piece' }), captured('  eggs ', { amount: 12, unit: 'piece' })],
      now: LATER,
      makeId: countingIds(),
    });

    assert.equal(merged.length, 1);
    assert.equal(merged[0].amount, 12);
  });

  it('lets a capture with no amount clear one that had one', () => {
    // A second photograph in which the bag's weight is no longer legible says
    // "I can no longer tell". Keeping 1000 would assert a figure this reading
    // did not support, and the person cannot tell it from one they typed.
    const merged = mergePantry({
      existing: [stored('Flour', { amount: 1000, unit: 'g' })],
      captured: [captured('flour')],
      now: LATER,
      makeId: countingIds(),
    });

    assert.equal(merged[0].amount, null);
    assert.equal(merged[0].unit, null);
  });

  it('never stores a unit without an amount', () => {
    const merged = mergePantry({
      existing: [],
      captured: [captured('Milk', { amount: null, unit: 'ml' })],
      now: LATER,
      makeId: countingIds(),
    });

    assert.equal(merged[0].unit, null);
  });

  it('takes the newest spelling of a name it already holds', () => {
    const merged = mergePantry({
      existing: [stored('eggs')],
      captured: [captured('Eggs')],
      now: LATER,
      makeId: countingIds(),
    });

    assert.equal(merged.length, 1);
    assert.equal(merged[0].name, 'Eggs');
  });

  it('drops a captured row with no name at all', () => {
    const merged = mergePantry({
      existing: [stored('Eggs')],
      captured: [captured('   ')],
      now: LATER,
      makeId: countingIds(),
    });

    assert.deepEqual(
      merged.map((item) => item.name),
      ['Eggs'],
    );
  });

  it('touches nothing when there is nothing to fold in', () => {
    const existing = [stored('Eggs'), stored('Butter')];

    const merged = mergePantry({ existing, captured: [], now: LATER, makeId: countingIds() });

    assert.deepEqual(merged, existing);
  });
});
