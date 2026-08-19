/**
 * Unit tests for `#app/lib/weight-progress` — the stats behind the Progress
 * page's three weight tiles. Pure, so no DB and no React.
 *
 * The property worth defending hardest is `crossedTargetOnLatest`: it arms a
 * one-time celebration, so it must fire on a genuine CROSSING and never on a
 * standing state. A user who installs the app already at their target is not
 * congratulated for weighing themselves.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeWeightProgress } from '../../app/lib/weight-progress';
import type { DatedValue } from '../../app/lib/ewma';

/** Weigh-ins on consecutive days, ascending — the shape the loader supplies. */
function series(...values: number[]): DatedValue[] {
  return values.map((value, index) => ({ date: `2026-07-${String(index + 1).padStart(2, '0')}`, value }));
}

describe('computeWeightProgress', () => {
  it('W1: an empty window is all nulls, and nothing is celebrated', () => {
    const progress = computeWeightProgress({ entries: [], targetWeightKg: 70 });

    assert.deepEqual(progress, {
      latestKg: null,
      latestDate: null,
      trendKg: null,
      changeKg: null,
      toTargetKg: null,
      direction: null,
      hasReachedTarget: false,
      crossedTargetOnLatest: false,
    });
  });

  it('W2: one weigh-in has a latest and a distance, but no change', () => {
    const progress = computeWeightProgress({ entries: series(78), targetWeightKg: 70 });

    assert.equal(progress.latestKg, 78);
    assert.equal(progress.latestDate, '2026-07-01');
    assert.equal(progress.trendKg, 78);
    assert.equal(progress.changeKg, null, 'a change needs two readings');
    assert.equal(progress.toTargetKg, 8);
    assert.equal(progress.direction, 'down');
    assert.equal(progress.hasReachedTarget, false);
  });

  it('W3: the change is the SMOOTHED endpoints, not the raw ones', () => {
    const progress = computeWeightProgress({ entries: series(78, 76.5, 75.2), targetWeightKg: 70 });

    assert.ok(progress.changeKg !== null && progress.changeKg < 0);
    assert.ok(
      progress.changeKg !== null && progress.changeKg > 75.2 - 78,
      'the EWMA lags the raw series, so the smoothed drop is smaller than the raw one',
    );
    assert.equal(progress.toTargetKg, 5.2);
    assert.equal(progress.direction, 'down');
  });

  it('W4: reaching the target on the latest weigh-in is a crossing', () => {
    const progress = computeWeightProgress({ entries: series(71, 69.8), targetWeightKg: 70 });

    assert.equal(progress.hasReachedTarget, true);
    assert.equal(progress.crossedTargetOnLatest, true);
  });

  it('standing at the target is NOT a crossing — the celebration must not re-fire', () => {
    // The spec's W5 in spirit, with an unambiguous window: the user crossed
    // earlier and has stayed under. (W5's own two-point window starts BELOW the
    // target, which the documented direction rule reads as a gain goal — see
    // the next case.)
    const progress = computeWeightProgress({ entries: series(71, 69.8, 69.5), targetWeightKg: 70 });

    assert.equal(progress.hasReachedTarget, true);
    assert.equal(progress.crossedTargetOnLatest, false);
  });

  it('W5: direction comes from the window’s FIRST weigh-in, so a window opening below the target reads as a gain goal', () => {
    const progress = computeWeightProgress({ entries: series(69.8, 69.5), targetWeightKg: 70 });

    assert.equal(progress.direction, 'up');
    assert.equal(progress.hasReachedTarget, false);
    assert.equal(progress.crossedTargetOnLatest, false);
  });

  it('a window that opens ABOVE the target keeps working downward even while the user gains', () => {
    // The failure mode a movement-derived direction would produce: telling
    // someone 8 kg above their target that they had reached it.
    const progress = computeWeightProgress({ entries: series(78, 79), targetWeightKg: 70 });

    assert.equal(progress.direction, 'down');
    assert.equal(progress.hasReachedTarget, false);
    assert.equal(progress.toTargetKg, 9);
  });

  it('W6: a gain goal counts distance the other way', () => {
    const progress = computeWeightProgress({ entries: series(62, 64.5), targetWeightKg: 68 });

    assert.equal(progress.direction, 'up');
    assert.equal(progress.hasReachedTarget, false);
    assert.equal(progress.toTargetKg, 3.5);
  });

  it('W7: the at-target verdict uses the DISPLAYED (1-decimal) value', () => {
    const progress = computeWeightProgress({ entries: series(70.04), targetWeightKg: 70 });

    assert.equal(progress.hasReachedTarget, true, '70.04 displays as 70.0, so the tile must not say "not yet"');
  });

  it('W8: without a target there is no direction and no distance', () => {
    const progress = computeWeightProgress({ entries: series(78, 76.5), targetWeightKg: null });

    assert.equal(progress.toTargetKg, null);
    assert.equal(progress.direction, null);
    assert.equal(progress.hasReachedTarget, false);
    assert.equal(progress.crossedTargetOnLatest, false);
    assert.ok(progress.changeKg !== null, 'the smoothed change is still reported');
  });

  it('never celebrates on a single weigh-in, even one already past the target', () => {
    const progress = computeWeightProgress({ entries: series(69), targetWeightKg: 70 });

    assert.equal(progress.crossedTargetOnLatest, false);
  });
});
