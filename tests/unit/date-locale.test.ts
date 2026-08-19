/**
 * Unit tests for `app/i18n/date-locale.ts` — the UI-language → BCP-47
 * formatting-tag seam every DISPLAY formatter in the app goes through, and for
 * `app/lib/format-day-label.ts`, its first consumer.
 *
 * The two English tags differ on purpose (`en-GB` for dates, `en-US` for
 * clocks) and that is exactly the kind of decision a future edit would
 * "simplify" away, so it is pinned here rather than left to a comment.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clockLocale, dateLabelLocale, numberLocale } from '../../app/i18n/date-locale';
import { formatDayLabel } from '../../app/lib/format-day-label';

describe('dateLabelLocale', () => {
  it('keeps English day labels in day-before-month order (en-GB)', () => {
    assert.equal(dateLabelLocale('en'), 'en-GB');
  });

  it('maps German to de-DE', () => {
    assert.equal(dateLabelLocale('de'), 'de-DE');
  });
});

describe('clockLocale', () => {
  it('keeps English clocks on the 12-hour convention (en-US)', () => {
    assert.equal(clockLocale('en'), 'en-US');
  });

  it('maps German to de-DE, which is 24-hour', () => {
    assert.equal(clockLocale('de'), 'de-DE');
  });
});

describe('locale fallbacks', () => {
  // The language cookie is not httpOnly, so these inputs are user-writable. A
  // tampered or stale value must degrade to English, never throw — a bad
  // cookie cannot be allowed to blank the diary.
  for (const bad of ['fr', 'de-CH', '', 'not-a-language'] as const) {
    it(`falls back to the English tags for ${JSON.stringify(bad)}`, () => {
      assert.equal(dateLabelLocale(bad), 'en-GB');
      assert.equal(clockLocale(bad), 'en-US');
      assert.equal(numberLocale(bad), 'en-US');
    });
  }

  it('falls back for null and undefined', () => {
    assert.equal(dateLabelLocale(null), 'en-GB');
    assert.equal(clockLocale(undefined), 'en-US');
  });
});

describe('formatDayLabel', () => {
  it('renders the established English label when no language is given', () => {
    assert.equal(formatDayLabel('2026-07-12'), 'Sun 12 Jul');
  });

  it('renders a German label for a German UI', () => {
    const label = formatDayLabel('2026-07-12', 'de');
    assert.notEqual(label, formatDayLabel('2026-07-12'));
    assert.match(label, /12/);
    // German abbreviates Sunday as "So" and July as "Juli" — the point is that
    // no English weekday/month name survives into a German page.
    assert.match(label, /So/);
    assert.match(label, /Jul/);
    assert.doesNotMatch(label, /Sun/);
  });

  it('reads the date in UTC, so the label never shifts with the runtime zone', () => {
    // 2026-01-01 is a Thursday everywhere; a zone-shifted read would say Wed.
    assert.equal(formatDayLabel('2026-01-01'), 'Thu 1 Jan');
  });

  it('reuses one formatter per locale rather than building one per call', () => {
    // Same output on repeat calls is the observable half; the cache itself is
    // an implementation detail, but a broken cache key would show up here.
    assert.equal(formatDayLabel('2026-07-12', 'de'), formatDayLabel('2026-07-12', 'de'));
    assert.equal(formatDayLabel('2026-07-12', 'en'), 'Sun 12 Jul');
  });

  it('throws on a malformed date regardless of language', () => {
    assert.throws(() => formatDayLabel('12/07/2026', 'de'), /Invalid date/);
  });
});
