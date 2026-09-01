/**
 * Unit tests for `#app/lib/format-multiplier`.
 *
 * Release-QA defect C: the edit form's "Grosser (1.5x)" chip was the only
 * number on a German screen written with an English decimal point, beside
 * "182 g" and "0,8 g". The hints live in a shared, literal-English option table
 * (`PORTION_SCALE_OPTIONS`), so the localisation has to happen at render.
 *
 * The narrowness is the design: only the leading NUMERIC token is reformatted,
 * so the "½×" fraction glyph survives untouched instead of being demoted to
 * "0.5×" in English.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatMultiplierHintIn } from '../../app/lib/format-multiplier';
import { PORTION_SCALE_OPTIONS } from '../../app/lib/portion-preview';

describe('formatMultiplierHintIn', () => {
  it('writes the decimal multiplier with the language’s own separator', () => {
    assert.strictEqual(formatMultiplierHintIn('de', '1.5×'), '1,5×');
    assert.strictEqual(formatMultiplierHintIn('en', '1.5×'), '1.5×');
  });

  it('leaves whole multipliers identical in both languages', () => {
    for (const language of ['de', 'en']) {
      assert.strictEqual(formatMultiplierHintIn(language, '1×'), '1×');
      assert.strictEqual(formatMultiplierHintIn(language, '2×'), '2×');
    }
  });

  it('does not touch a fraction glyph — "½×" must not become "0.5×"', () => {
    assert.strictEqual(formatMultiplierHintIn('de', '½×'), '½×');
    assert.strictEqual(formatMultiplierHintIn('en', '½×'), '½×');
  });

  it('covers every shipped chip, so a new option cannot slip through unlocalised', () => {
    const german = PORTION_SCALE_OPTIONS.map((option) => formatMultiplierHintIn('de', option.hint));
    assert.deepStrictEqual(german, ['½×', '1×', '1,5×', '2×']);
    const english = PORTION_SCALE_OPTIONS.map((option) => formatMultiplierHintIn('en', option.hint));
    assert.deepStrictEqual(english, ['½×', '1×', '1.5×', '2×']);
  });

  it('falls back to the hint verbatim when it starts with no number at all', () => {
    assert.strictEqual(formatMultiplierHintIn('de', '×2'), '×2');
    assert.strictEqual(formatMultiplierHintIn('de', ''), '');
  });
});
