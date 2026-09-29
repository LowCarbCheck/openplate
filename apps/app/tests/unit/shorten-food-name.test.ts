/**
 * Unit tests for `#app/lib/shorten-food-name`, the name a header status
 * sentence carries (M265).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { STATUS_FOOD_NAME_MAX_CHARS, shortenFoodName } from '../../app/lib/shorten-food-name';

/** Counts what a person sees as one character. */
function visibleLength(text: string): number {
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;
}

describe('shortenFoodName', () => {
  it('returns a short name untouched, the same string', () => {
    assert.equal(shortenFoodName('Egg'), 'Egg');
    assert.equal(shortenFoodName('Smoke tier muesli'), 'Smoke tier muesli');
  });

  it('keeps a name of exactly the cap whole, and shortens one character more', () => {
    const atCap = 'a'.repeat(STATUS_FOOD_NAME_MAX_CHARS);
    assert.equal(shortenFoodName(atCap), atCap);
    // THE CONTROL for the boundary: one character past the cap is shortened.
    const pastCap = 'a'.repeat(STATUS_FOOD_NAME_MAX_CHARS + 1);
    assert.equal(shortenFoodName(pastCap), `${'a'.repeat(STATUS_FOOD_NAME_MAX_CHARS - 1)}…`);
  });

  it('keeps the start of a long name and ends it in one ellipsis, within the cap', () => {
    const name = 'Dinkelporridge mit Heidelbeeren und Zimt';
    const shortened = shortenFoodName(name);
    assert.equal(shortened, 'Dinkelporridge mi…');
    assert.ok(name.startsWith(shortened.slice(0, -1)), 'the shortened name is not the start of the name');
    assert.equal(visibleLength(shortened), STATUS_FOOD_NAME_MAX_CHARS);
  });

  it('drops a space the cut lands after, so the ellipsis follows a letter', () => {
    // The first 17 characters are "Smoke tier" and seven spaces.
    assert.equal(shortenFoodName('Smoke tier       crispy bread'), 'Smoke tier…');
  });

  it('never cuts a grapheme in half', () => {
    // "é" written as "e" plus a combining accent is one character on screen.
    const decomposed = `Cr${'e\u0301'.repeat(20)}pe`;
    const shortened = shortenFoodName(decomposed);
    assert.equal(visibleLength(shortened), STATUS_FOOD_NAME_MAX_CHARS);
    assert.ok(!shortened.slice(0, -1).endsWith('e'), 'the cut split a letter from its accent');
    const emoji = '🥣'.repeat(30);
    assert.equal(shortenFoodName(emoji), `${'🥣'.repeat(STATUS_FOOD_NAME_MAX_CHARS - 1)}…`);
  });

  it('takes another cap, and refuses one that leaves no room for a character', () => {
    assert.equal(shortenFoodName('Greek yogurt', 6), 'Greek…');
    assert.throws(() => shortenFoodName('Greek yogurt', 1), /at least 2/);
    assert.throws(() => shortenFoodName('Greek yogurt', 4.5), /at least 2/);
  });
});
