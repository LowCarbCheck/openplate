/**
 * Unit tests for `#app/lib/format-macro-number` — the two rounding formatters
 * every macro number passes through. No React/DB/network.
 *
 * The split is the point: `formatMacroNumber` is PINNED (it feeds inputs and
 * `Number()`), `formatMacroNumberIn` is localised (it feeds eyes). A test that
 * let the pinned one drift with the UI language would be blessing the exact bug
 * the two names exist to prevent, so its language-independence is asserted here
 * rather than assumed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { UNIT_SPACE, formatMacroNumber, formatMacroNumberIn, formatMeasureIn } from '../../app/lib/format-macro-number';

describe('formatMacroNumber', () => {
  it('kills floating-point garbage down to one decimal', () => {
    assert.strictEqual(formatMacroNumber(8.370000000000001), '8.4');
    assert.strictEqual(formatMacroNumber(45.953), '46');
  });

  it('trims trailing zeros', () => {
    assert.strictEqual(formatMacroNumber(46.0), '46');
    assert.strictEqual(formatMacroNumber(8.4), '8.4');
    assert.strictEqual(formatMacroNumber(165), '165');
  });

  it('keeps a single meaningful decimal', () => {
    assert.strictEqual(formatMacroNumber(3.6), '3.6');
    assert.strictEqual(formatMacroNumber(0.5), '0.5');
  });

  it('renders zero as "0" (never "-0")', () => {
    assert.strictEqual(formatMacroNumber(0), '0');
    assert.strictEqual(formatMacroNumber(-0.001), '0');
  });

  it('rounds half away from zero at the first decimal', () => {
    assert.strictEqual(formatMacroNumber(2.45), '2.5');
    assert.strictEqual(formatMacroNumber(2.44), '2.4');
  });
});

describe('formatMacroNumberIn', () => {
  it('writes English with a dot and German with a comma — the M129 bug', () => {
    assert.strictEqual(formatMacroNumberIn('en', 346.7), '346.7');
    assert.strictEqual(formatMacroNumberIn('de', 346.7), '346,7');
  });

  it('applies the same one-decimal rounding as the pinned formatter', () => {
    assert.strictEqual(formatMacroNumberIn('de', 8.370000000000001), '8,4');
    assert.strictEqual(formatMacroNumberIn('de', 46.0), '46');
    assert.strictEqual(formatMacroNumberIn('de', 2.45), '2,5');
  });

  it('renders zero as "0" (never "-0") in either language', () => {
    assert.strictEqual(formatMacroNumberIn('de', -0.001), '0');
    assert.strictEqual(formatMacroNumberIn('en', 0), '0');
  });

  it('groups thousands the way each language does', () => {
    assert.strictEqual(formatMacroNumberIn('en', 1467), '1,467');
    assert.strictEqual(formatMacroNumberIn('de', 1467), '1.467');
  });

  it('falls back to English for an unsupported or absent language', () => {
    assert.strictEqual(formatMacroNumberIn('fr', 346.7), '346.7');
    assert.strictEqual(formatMacroNumberIn(null, 346.7), '346.7');
    assert.strictEqual(formatMacroNumberIn(undefined, 346.7), '346.7');
  });
});

describe('formatMacroNumber stays pinned', () => {
  it('never follows the UI language — its output round-trips into inputs and Number()', () => {
    assert.strictEqual(formatMacroNumber(346.7), '346.7');
    assert.strictEqual(Number(formatMacroNumber(346.7)), 346.7);
    assert.strictEqual(Number(formatMacroNumber(1467.25)), 1467.3);
  });

  it('emits no thousands grouping, which a number input would reject', () => {
    assert.strictEqual(formatMacroNumber(1467), '1467');
  });
});

describe('formatMeasureIn', () => {
  it('separates the number from its unit with a no-break space, in both languages', () => {
    assert.strictEqual(formatMeasureIn('en', 0.8, 'g'), `0.8${UNIT_SPACE}g`);
    assert.strictEqual(formatMeasureIn('de', 0.8, 'g'), `0,8${UNIT_SPACE}g`);
    assert.strictEqual(formatMeasureIn('de', 182, 'g'), `182${UNIT_SPACE}g`);
    assert.strictEqual(formatMeasureIn('de', 105, 'kcal'), `105${UNIT_SPACE}kcal`);
  });

  it('uses U+00A0, so a narrow screen cannot orphan the unit onto its own line', () => {
    assert.strictEqual(UNIT_SPACE, '\u00a0');
    assert.ok(!formatMeasureIn('de', 13.8, 'g').includes('\u0020'), 'a plain ASCII space would still break');
  });

  it('returns the bare number when the caller has no unit to append', () => {
    assert.strictEqual(formatMeasureIn('de', 105.6, ''), '105,6');
    assert.strictEqual(formatMeasureIn('en', 105.6, ''), '105.6');
  });

  it('inherits the shared one-decimal rounding rather than re-implementing it', () => {
    assert.strictEqual(formatMeasureIn('en', 8.370000000000001, 'g'), `8.4${UNIT_SPACE}g`);
    assert.strictEqual(formatMeasureIn('de', -0.02, 'g'), `0${UNIT_SPACE}g`);
  });
});
