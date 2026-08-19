/**
 * Unit tests for the pure helpers exported from
 * `app/components/add/search-result-row.tsx` (search-readability round):
 * a single per-100g number instead of two conflicting carb figures, and a
 * match-tier chip that only shows up for a genuinely shaky match instead of
 * on every single row.
 *
 * Post-M129/05 `formatPer100gSummary` takes a `t` and returns whatever the
 * active catalog holds, so the assertions pin STRUCTURE (which key, which
 * interpolated value, which fields are skipped) rather than wording — the
 * English itself is now the catalog's contract.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPer100gSummary,
  shouldShowMatchTierChip,
  type Translate,
} from '../../app/components/add/search-result-row';
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
  return { carbs: 9.6, fiber: 1, sugars: null, polyols: null, protein: 10, fat: 2, kcal: 208, ...overrides };
}

describe('formatPer100gSummary', () => {
  it('shows calories only — never a second, differently-computed carb figure next to the net-carb badge', () => {
    const summary = formatPer100gSummary(macros(), stubT, 'en');
    assert.equal(summary, 'add.results.calories(value=208)');
    assert.equal(/carb/i.test(summary), false);
  });

  it('goes through a calories key — never renders the "kcal" jargon abbreviation itself', () => {
    assert.equal(/kcal/i.test(formatPer100gSummary(macros(), stubT, 'en')), false);
  });

  it('is blank (never a fabricated 0) when calories are unknown', () => {
    assert.equal(formatPer100gSummary(macros({ kcal: null }), stubT, 'en'), '');
  });

  it("writes the calorie figure with the active language's decimal separator", () => {
    const fractional = macros({ kcal: 208.5 });
    assert.equal(formatPer100gSummary(fractional, stubT, 'en'), 'add.results.calories(value=208.5)');
    assert.equal(formatPer100gSummary(fractional, stubT, 'de'), 'add.results.calories(value=208,5)');
  });
});

describe('shouldShowMatchTierChip', () => {
  it('hides the chip for a strong match — conveys nothing when every row would show it', () => {
    assert.equal(shouldShowMatchTierChip('strong'), false);
  });

  it('shows the chip for a likely or weak match — the case actually worth flagging', () => {
    assert.equal(shouldShowMatchTierChip('likely'), true);
    assert.equal(shouldShowMatchTierChip('weak'), true);
  });

  it('hides the chip when there is no tier at all (recent/custom rows)', () => {
    assert.equal(shouldShowMatchTierChip(null), false);
  });
});
