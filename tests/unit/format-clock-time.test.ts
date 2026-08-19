/**
 * Unit tests for `#app/lib/format-clock-time` — the shared wall-clock formatter
 * used by the fasting cards and (since the M132 follow-up round) by
 * `diary.tsx`'s `formatEntryTime` and the entry-detail receipt.
 *
 * These pin the RENDERED STRING per language and time zone, not the option
 * object, because the helper's whole job is that three call sites produce the
 * same characters. They are the safety net under the diary adoption: if the
 * shared helper ever drifts from the hand-rolled formatting the diary used to
 * do, these fail rather than the diary silently changing how it reads a clock.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatClockTime } from '../../app/lib/format-clock-time';

/**
 * ICU has shipped both a plain space (U+0020) and a narrow no-break space
 * (U+202F) before "AM"/"PM" across releases. Which one this Node build emits is
 * not what these tests are about, so both are compared as a plain space.
 */
function normalizeSpaces(value: string): string {
  return value.replace(/ | /g, ' ');
}

/** 2026-07-14T18:32:00Z — an evening in Europe, an afternoon in New York. */
const EVENING_UTC = Date.UTC(2026, 6, 14, 18, 32);
/** 2026-07-14T06:05:00Z — a morning whose German rendering must be zero-padded. */
const MORNING_UTC = Date.UTC(2026, 6, 14, 6, 5);
/** 2026-07-14T22:05:00Z — already the NEXT morning in Tokyo. */
const LATE_UTC = Date.UTC(2026, 6, 14, 22, 5);

describe('formatClockTime', () => {
  it('renders English on a 12-hour clock', () => {
    assert.strictEqual(
      normalizeSpaces(formatClockTime(EVENING_UTC, { timezone: 'Europe/Berlin', language: 'en' })),
      '8:32 PM',
    );
    assert.strictEqual(
      normalizeSpaces(formatClockTime(MORNING_UTC, { timezone: 'Europe/Berlin', language: 'en' })),
      '8:05 AM',
    );
  });

  it('renders German on a zero-padded 24-hour clock', () => {
    assert.strictEqual(formatClockTime(EVENING_UTC, { timezone: 'Europe/Berlin', language: 'de' }), '20:32');
    assert.strictEqual(formatClockTime(MORNING_UTC, { timezone: 'Europe/Berlin', language: 'de' }), '08:05');
  });

  it('reads the instant in the given time zone, not the host zone', () => {
    assert.strictEqual(
      normalizeSpaces(formatClockTime(EVENING_UTC, { timezone: 'America/New_York', language: 'en' })),
      '2:32 PM',
    );
    assert.strictEqual(formatClockTime(EVENING_UTC, { timezone: 'America/New_York', language: 'de' }), '14:32');
  });

  it('crosses the date line with the zone rather than with UTC', () => {
    assert.strictEqual(
      normalizeSpaces(formatClockTime(LATE_UTC, { timezone: 'Asia/Tokyo', language: 'en' })),
      '7:05 AM',
    );
    assert.strictEqual(formatClockTime(LATE_UTC, { timezone: 'Asia/Tokyo', language: 'de' }), '07:05');
  });

  it('falls back to English for an unsupported language rather than throwing', () => {
    assert.strictEqual(
      normalizeSpaces(formatClockTime(EVENING_UTC, { timezone: 'Europe/Berlin', language: 'fr' })),
      '8:32 PM',
    );
  });
});
