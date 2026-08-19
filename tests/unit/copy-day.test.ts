/**
 * Unit tests for `#app/lib/copy-day` — the pure time-mapping behind the diary's
 * "copy yesterday's meals" action. Documents the "elapsed since local midnight"
 * choice: a copy keeps its offset from midnight, mapped onto the target day.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { remapInstantToTargetDay } from '../../app/lib/copy-day';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('remapInstantToTargetDay', () => {
  it('preserves the offset from local midnight on the target day', () => {
    const sourceDayStartMs = Date.UTC(2026, 6, 11, 0, 0, 0);
    const targetDayStartMs = sourceDayStartMs + DAY_MS;
    // Source entry logged at 08:30 local.
    const sourceMs = sourceDayStartMs + 8 * HOUR_MS + 30 * 60 * 1000;

    const mapped = remapInstantToTargetDay({ sourceMs, sourceDayStartMs, targetDayStartMs });

    assert.strictEqual(mapped - targetDayStartMs, 8 * HOUR_MS + 30 * 60 * 1000);
  });

  it('keeps the relative ordering of entries within the day', () => {
    const sourceDayStartMs = Date.UTC(2026, 6, 11, 0, 0, 0);
    const targetDayStartMs = sourceDayStartMs + DAY_MS;
    const breakfast = sourceDayStartMs + 8 * HOUR_MS;
    const dinner = sourceDayStartMs + 19 * HOUR_MS;

    const mappedBreakfast = remapInstantToTargetDay({ sourceMs: breakfast, sourceDayStartMs, targetDayStartMs });
    const mappedDinner = remapInstantToTargetDay({ sourceMs: dinner, sourceDayStartMs, targetDayStartMs });

    assert.ok(mappedBreakfast < mappedDinner);
    assert.strictEqual(mappedDinner - mappedBreakfast, dinner - breakfast);
  });

  it('works when the day boundaries are not exactly 24h apart (DST-length days)', () => {
    const sourceDayStartMs = Date.UTC(2026, 2, 8, 0, 0, 0);
    // A 23h "spring forward" source day: the target midnight is only 23h later.
    const targetDayStartMs = sourceDayStartMs + 23 * HOUR_MS;
    const sourceMs = sourceDayStartMs + 9 * HOUR_MS;

    const mapped = remapInstantToTargetDay({ sourceMs, sourceDayStartMs, targetDayStartMs });

    // Offset from the (shorter) target day's midnight is still 9h.
    assert.strictEqual(mapped - targetDayStartMs, 9 * HOUR_MS);
  });
});
