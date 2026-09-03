/**
 * The long-press shortcut on the tab bar's launcher.
 *
 * Both decisions it makes — "has this been held long enough" and "has the
 * finger drifted far enough that this is a scroll, not a press" — are pure,
 * and they are the part that is worth pinning: a threshold that is off by a
 * strict comparison, or a tolerance measured per axis instead of as a
 * distance, both fail only on a real phone under a real thumb.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasMovedBeyondPressTolerance,
  isLongPress,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  LONG_PRESS_MS,
} from '../../app/lib/long-press';

describe('isLongPress', () => {
  it('does not fire before the threshold', () => {
    assert.equal(isLongPress(LONG_PRESS_MS - 1), false);
  });

  it('fires exactly ON the threshold — the timer that drives it fires there', () => {
    assert.equal(isLongPress(LONG_PRESS_MS), true);
  });

  it('fires past the threshold', () => {
    assert.equal(isLongPress(LONG_PRESS_MS + 500), true);
  });

  it('is long enough to be deliberate, short enough to feel immediate', () => {
    assert.ok(LONG_PRESS_MS >= 350 && LONG_PRESS_MS <= 600);
  });
});

describe('hasMovedBeyondPressTolerance', () => {
  const start = { x: 100, y: 200 };

  it('tolerates a still thumb', () => {
    assert.equal(hasMovedBeyondPressTolerance({ start, current: { x: 100, y: 200 } }), false);
  });

  it('tolerates drift up to the limit', () => {
    assert.equal(
      hasMovedBeyondPressTolerance({ start, current: { x: 100 + LONG_PRESS_MOVE_TOLERANCE_PX, y: 200 } }),
      false,
    );
  });

  it('abandons the press once the finger travels further than the limit', () => {
    assert.equal(
      hasMovedBeyondPressTolerance({ start, current: { x: 100, y: 200 + LONG_PRESS_MOVE_TOLERANCE_PX + 1 } }),
      true,
    );
  });

  it('measures a distance, not each axis on its own', () => {
    // 8px right and 8px down is 11.3px of travel: inside the tolerance on
    // either axis alone, outside it as a distance. A per-axis check would
    // keep the timer alive through a diagonal scroll.
    assert.equal(hasMovedBeyondPressTolerance({ start, current: { x: 108, y: 208 } }), true);
  });

  it('is symmetric — the direction of travel is not what decides', () => {
    const away = { x: 130, y: 200 };
    assert.equal(
      hasMovedBeyondPressTolerance({ start, current: away }),
      hasMovedBeyondPressTolerance({ start: away, current: start }),
    );
  });
});
