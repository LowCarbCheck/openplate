/**
 * The capture ceiling is a property of the SCAN TASK, not of the route.
 *
 * A nutrition panel is small printed type: downscaled to the plate default it
 * routinely loses the "of which polyols" row, which is the one row the label
 * feature exists to read. This pins the two facts that keep that true — the
 * label task asks for more detail, and the plate default is NOT raised to give
 * it (a plate scan would then pay for pixels it cannot use, on the user's own
 * provider credit, on every single scan).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LABEL_SCAN_TASK, PLATE_SCAN_TASK, SCAN_TASK_BY_MODE, VISION_MODES } from '../../app/services/vision/task';
import { MAX_IMAGE_DIMENSION } from '../../app/lib/photo-constraints';

describe('scan-task capture ceilings', () => {
  it('gives a label capture more detail than a plate capture', () => {
    assert.ok(
      LABEL_SCAN_TASK.captureMaxDimension > PLATE_SCAN_TASK.captureMaxDimension,
      'a nutrition panel needs more pixels than a plate',
    );
  });

  it('leaves the shared plate default untouched', () => {
    assert.equal(PLATE_SCAN_TASK.captureMaxDimension, MAX_IMAGE_DIMENSION);
    assert.equal(MAX_IMAGE_DIMENSION, 1600);
  });

  it('reaches every task by its mode, so a route never branches to get one', () => {
    for (const mode of VISION_MODES) {
      assert.equal(SCAN_TASK_BY_MODE[mode].mode, mode);
      assert.ok(SCAN_TASK_BY_MODE[mode].captureMaxDimension > 0);
    }
  });
});
