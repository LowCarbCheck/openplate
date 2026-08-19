import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_NUDGE_THRESHOLD_DAYS,
  shouldShowBackupNudge,
} from '../../app/lib/backup-nudge';

describe('shouldShowBackupNudge', () => {
  it('is false when the device has no data yet, even if never exported (genuinely new device)', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: null, hasData: false }), false);
  });

  it('is false when the device has no data yet, even past the threshold (defensive — should not happen in practice)', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS + 30, hasData: false }), false);
  });

  it('is TRUE when the device has data and has never exported — the population most at risk (inversion fix)', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: null, hasData: true }), true);
  });

  it('is false below the threshold when the device has exported before', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS - 1, hasData: true }), false);
  });

  it('is true exactly at the threshold', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS, hasData: true }), true);
  });

  it('is true well past the threshold', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS + 30, hasData: true }), true);
  });

  it('is false at 0 days since a real export', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: 0, hasData: true }), false);
  });
});
