import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_NUDGE_THRESHOLD_DAYS, shouldShowBackupNudge } from '../../app/lib/backup-nudge';
import { computeDaysSinceFirstData } from '../../app/lib/local-store/backup';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('shouldShowBackupNudge — device that has exported before', () => {
  it('is false at 0 days since a real export', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: 0, daysSinceFirstData: 900, hasData: true }), false);
  });

  it('is false one day after an export, however old the data is', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: 1, daysSinceFirstData: 900, hasData: true }), false);
  });

  it('is false below the threshold', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS - 1,
        daysSinceFirstData: 900,
        hasData: true,
      }),
      false,
    );
  });

  it('is true exactly at the threshold', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS,
        daysSinceFirstData: 900,
        hasData: true,
      }),
      true,
    );
  });

  it('is true well past the threshold (20 days since export)', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: 20, daysSinceFirstData: 900, hasData: true }), true);
  });
});

describe('shouldShowBackupNudge — device that has NEVER exported', () => {
  it('is false when the data is only a day old — a first-week user is not nagged', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: 1, hasData: true }), false);
  });

  it('is false one day short of the threshold', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: null,
        daysSinceFirstData: BACKUP_NUDGE_THRESHOLD_DAYS - 1,
        hasData: true,
      }),
      false,
    );
  });

  it('is true exactly at the threshold — the same bar an exported device is held to', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: null,
        daysSinceFirstData: BACKUP_NUDGE_THRESHOLD_DAYS,
        hasData: true,
      }),
      true,
    );
  });

  it('is true when the data is 20 days old', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: 20, hasData: true }), true);
  });

  // Case 4 in `shouldShowBackupNudge`'s doc. `firstDataAt` only started being
  // written in M123, so a device in the field today can hold months of data
  // and no marker. Its data is therefore OLDER than anything the marker can
  // measure, not newer — and the costs are asymmetric: nudging wrongly costs a
  // dismissible banner, staying quiet wrongly costs the user everything with
  // no warning. So a missing marker with data present nudges.
  it('is true when the marker is missing but data is present (pre-marker device)', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: null, hasData: true }), true);
  });
});

describe('shouldShowBackupNudge — device with nothing to lose', () => {
  it('is false with no data and no marker, never exported (genuinely new device)', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: null, hasData: false }), false);
  });

  it('is false with no data even when the marker is old (data was deleted, nothing left to back up)', () => {
    assert.equal(shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: 900, hasData: false }), false);
  });

  it('is false with no data even long past a real export', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS + 30,
        daysSinceFirstData: null,
        hasData: false,
      }),
      false,
    );
  });
});

describe('computeDaysSinceFirstData', () => {
  it('is null when the device never held data (no marker)', () => {
    assert.equal(computeDaysSinceFirstData(null, Date.UTC(2026, 0, 20)), null);
  });

  it('floors to whole days, matching computeDaysSinceExport', () => {
    const now = Date.UTC(2026, 0, 20);
    assert.equal(computeDaysSinceFirstData(now - 20 * DAY_MS, now), 20);
    assert.equal(computeDaysSinceFirstData(now - (20 * DAY_MS - 1), now), 19);
  });

  it('is 0 for data created moments ago', () => {
    const now = Date.UTC(2026, 0, 20);
    assert.equal(computeDaysSinceFirstData(now - 1000, now), 0);
  });

  it('clamps a backwards clock to 0 rather than reporting negative days', () => {
    const now = Date.UTC(2026, 0, 20);
    assert.equal(computeDaysSinceFirstData(now + 5 * DAY_MS, now), 0);
  });
});
