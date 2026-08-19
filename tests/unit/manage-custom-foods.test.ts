/**
 * Unit tests for the pure helper exported from
 * `app/components/add/manage-custom-foods.tsx` (jargon round): the "Your
 * foods" per-100g summary line goes through a translated calories label rather
 * than the "kcal" abbreviation, and skips a null field instead of showing a
 * fabricated 0. Post-M129/05 the helper takes a `t`, so these pin structure
 * (which key, which interpolated value, which fields are skipped) rather than
 * wording — the English is now the catalog's contract.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatPer100gLine, type Translate } from '../../app/components/add/manage-custom-foods';
import type { Macros } from '../../app/lib/macros';

/** Stub translator: echoes the key plus every interpolation value it was handed. */
const stubT: Translate = (key, params) => {
  if (!params) return key;
  const rendered = Object.entries(params)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',');
  return `${key}(${rendered})`;
};

function macros(overrides: Partial<Macros> = {}): Macros {
  return { carbs: 5, fiber: 1, sugars: null, polyols: null, protein: 10, fat: 2, kcal: 135, ...overrides };
}

describe('formatPer100gLine', () => {
  it('goes through a calories key — never renders the "kcal" jargon abbreviation itself', () => {
    const summary = formatPer100gLine(macros(), stubT, 'en');
    assert.equal(summary, 'add.custom.carbsSummary(value=5) · add.custom.caloriesSummary(value=135)');
    assert.equal(/kcal/i.test(summary), false);
  });

  it('skips a null field rather than showing a fabricated 0', () => {
    assert.equal(formatPer100gLine(macros({ kcal: null }), stubT, 'en'), 'add.custom.carbsSummary(value=5)');
    assert.equal(formatPer100gLine(macros({ carbs: null, kcal: null }), stubT, 'en'), '');
  });

  it('writes the figures with the active language\'s decimal separator', () => {
    const fractional = macros({ carbs: 5.5, kcal: 135 });
    assert.match(formatPer100gLine(fractional, stubT, 'en'), /value=5\.5/);
    assert.match(formatPer100gLine(fractional, stubT, 'de'), /value=5,5/);
  });
});
