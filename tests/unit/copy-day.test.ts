/**
 * Unit tests for `#app/lib/copy-day` — the pure time-mapping behind the diary's
 * "copy yesterday's meals" action. Documents the "elapsed since local midnight"
 * choice: a copy keeps its offset from midnight, mapped onto the target day.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { remapInstantToTargetDay, selectRepeatYesterday } from '../../app/lib/copy-day';

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

////////////////////////////////////////////////////////////////////////////////
// selectRepeatYesterday (M217): whether the "Wie gestern" door is offered
////////////////////////////////////////////////////////////////////////////////

const TODAY = '2026-09-10';
const YESTERDAY = '2026-09-09';

/** `n` logs stamped with one day key. Only `dayKey` is read by the selector. */
function logsOn(dayKey: string, n: number): { dayKey: string }[] {
  return Array.from({ length: n }, () => ({ dayKey }));
}

/** The selector run against the two day keys every case in this suite shares. */
function offerFor(logs: { dayKey: string }[]) {
  return selectRepeatYesterday({ logs, today: TODAY, yesterday: YESTERDAY });
}

describe('selectRepeatYesterday', () => {
  it('offers the whole of yesterday on a day with nothing logged yet', () => {
    const offer = offerFor(logsOn(YESTERDAY, 4));

    assert.deepEqual(offer, { sourceDate: YESTERDAY, targetDate: TODAY, sourceCount: 4, targetCount: 0 });
  });

  it('still offers it when today has fewer entries than yesterday', () => {
    // "I logged breakfast, the rest was the same as yesterday."
    const offer = offerFor([...logsOn(YESTERDAY, 4), ...logsOn(TODAY, 2)]);

    assert.notEqual(offer, null);
    assert.equal(offer?.sourceCount, 4);
    assert.equal(offer?.targetCount, 2);
  });

  it('answers null when yesterday is empty, whatever today holds', () => {
    assert.equal(offerFor([]), null);
    assert.equal(offerFor(logsOn(TODAY, 3)), null);
    // A day further back is not a source: reading 3 stays a non-goal.
    assert.equal(offerFor(logsOn('2026-09-08', 5)), null);
  });

  it('answers null when today already has as many entries as yesterday', () => {
    assert.equal(offerFor([...logsOn(YESTERDAY, 3), ...logsOn(TODAY, 3)]), null);
    assert.equal(offerFor([...logsOn(YESTERDAY, 3), ...logsOn(TODAY, 7)]), null);
  });

  it('counts only the two days it was given', () => {
    const offer = offerFor([
      ...logsOn(YESTERDAY, 2),
      ...logsOn(TODAY, 1),
      ...logsOn('2026-09-08', 9),
      ...logsOn('2026-09-11', 9),
    ]);

    assert.equal(offer?.sourceCount, 2);
    assert.equal(offer?.targetCount, 1);
  });

  it('names yesterday as the source and today as the target, never the other way round', () => {
    const offer = offerFor(logsOn(YESTERDAY, 1));

    assert.equal(offer?.sourceDate, YESTERDAY);
    assert.equal(offer?.targetDate, TODAY);
  });
});
