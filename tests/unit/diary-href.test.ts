/**
 * Unit tests for `#app/lib/diary-href` — the pure `/diary` URL normalization
 * behind the entry-detail page's Back link, Delete redirect, and Undo-restore
 * submit target.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { diaryHrefForDate } from '../../app/lib/diary-href';

describe('diaryHrefForDate', () => {
  it('returns a bare /diary when the day is today', () => {
    assert.strictEqual(diaryHrefForDate('2026-07-14', '2026-07-14'), '/diary');
  });

  it('returns /diary?date=<day> when the day is not today', () => {
    assert.strictEqual(diaryHrefForDate('2026-07-10', '2026-07-14'), '/diary?date=2026-07-10');
  });

  it('carries a future day the same way as a past day', () => {
    assert.strictEqual(diaryHrefForDate('2026-07-20', '2026-07-14'), '/diary?date=2026-07-20');
  });
});
