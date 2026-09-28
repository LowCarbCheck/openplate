/**
 * Unit tests for `#app/lib/trend-weight` — the raw first→last weekly delta. No DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeWeeklyWeightChange } from '../../app/lib/trend-weight';

describe('computeWeeklyWeightChange', () => {
  it('returns null with fewer than two entries', () => {
    assert.strictEqual(computeWeeklyWeightChange([]), null);
    assert.strictEqual(computeWeeklyWeightChange([{ measuredAt: '2026-07-13', weightKg: 80 }]), null);
  });

  it('computes the first→last delta sorted by date, regardless of input order', () => {
    const change = computeWeeklyWeightChange([
      { measuredAt: '2026-07-16', weightKg: 79.2 },
      { measuredAt: '2026-07-13', weightKg: 80 },
      { measuredAt: '2026-07-19', weightKg: 78.5 },
    ]);

    assert.notStrictEqual(change, null);
    assert.strictEqual(change?.firstKg, 80);
    assert.strictEqual(change?.lastKg, 78.5);
    assert.strictEqual(change?.deltaKg, 78.5 - 80);
    assert.strictEqual(change?.entryCount, 3);
  });

  it('reports a positive delta when weight rises', () => {
    const change = computeWeeklyWeightChange([
      { measuredAt: '2026-07-13', weightKg: 77 },
      { measuredAt: '2026-07-15', weightKg: 77.6 },
    ]);

    assert.strictEqual(change?.deltaKg, 77.6 - 77);
  });
});
