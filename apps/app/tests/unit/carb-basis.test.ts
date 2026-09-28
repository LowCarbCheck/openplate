/**
 * Unit tests for `#app/lib/net-carbs` — spec 13 (M123): the EU-vs-US carb
 * basis fix. Pins BOTH directions, in the spirit of lowcarbcheck's M123/02
 * tests: an `available`-basis (EU) food does not double-subtract fibre, a
 * `total`-basis (US) food still does, both still subtract polyols, unknown
 * carbs still yield `null`, and — the regression guard for every existing
 * user's history — an UNKNOWN basis produces byte-identical output to
 * today's formula.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeNetCarbsFromParts, CARB_BASES } from '../../app/lib/net-carbs';
import type { NetCarbsParts } from '../../app/lib/net-carbs';

const EMPTY: NetCarbsParts = { carbs: null, fiber: null, polyols: null };

/**
 * Today's (pre-spec-13) formula, unchanged: carbs - fiber - polyols, applied
 * unconditionally. Every row already on every device has no `carbBasis` at
 * all, so `computeNetCarbsFromParts(parts, undefined)` must keep producing
 * the exact same number this always has — no user's history may shift under
 * them. Module scope, not a closure: it captures nothing from any test.
 */
function legacyFormula(parts: NetCarbsParts): number | null {
  if (parts.carbs === null) return null;
  return parts.carbs - (parts.fiber ?? 0) - (parts.polyols ?? 0);
}

describe('computeNetCarbsFromParts', () => {
  it('lists exactly the two supported bases', () => {
    assert.deepStrictEqual(CARB_BASES, ['total', 'available']);
  });

  it('an `available` (EU) food does not double-subtract fibre', () => {
    // EU panel: 21.7 g carbs already excludes the 42.8 g fibre printed
    // separately. The available-basis formula must NOT touch fibre at all.
    const parts: NetCarbsParts = { carbs: 21.7, fiber: 42.8, polyols: null };
    assert.strictEqual(computeNetCarbsFromParts(parts, 'available'), 21.7);
  });

  it('a `total` (US) food still subtracts fibre', () => {
    const parts: NetCarbsParts = { carbs: 21.7, fiber: 5, polyols: null };
    assert.strictEqual(computeNetCarbsFromParts(parts, 'total'), 16.7);
  });

  it('both bases still subtract polyols', () => {
    const parts: NetCarbsParts = { carbs: 20, fiber: 3, polyols: 4 };
    assert.strictEqual(computeNetCarbsFromParts(parts, 'total'), 13);
    assert.strictEqual(computeNetCarbsFromParts({ ...parts, fiber: null }, 'available'), 16);
  });

  it('unknown carbs still yield null on both bases, never a fabricated 0', () => {
    assert.strictEqual(computeNetCarbsFromParts(EMPTY, 'total'), null);
    assert.strictEqual(computeNetCarbsFromParts(EMPTY, 'available'), null);
    assert.strictEqual(computeNetCarbsFromParts(EMPTY, undefined), null);
  });

  it('REGRESSION GUARD: an UNKNOWN basis is byte-identical to today\'s formula for every existing row', () => {
    const fixtures: NetCarbsParts[] = [
      { carbs: 21.7, fiber: 42.8, polyols: null },
      { carbs: 10, fiber: 2, polyols: 1 },
      { carbs: 5, fiber: null, polyols: null },
      { carbs: 0, fiber: 0, polyols: 0 },
      EMPTY,
    ];

    for (const parts of fixtures) {
      assert.strictEqual(computeNetCarbsFromParts(parts, undefined), legacyFormula(parts));
    }
  });
});
