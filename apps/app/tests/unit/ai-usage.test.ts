/**
 * Unit tests for `#app/models/ai-usage` — the pure AI-usage helpers (UTC month
 * windowing + the muted display lines). No DB/network: this module imports only
 * the pure `vision/cost` formatter, so the tests run without a database.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatFailedAttemptUsageLine,
  formatMonthlyUsageLine,
  formatSettingsUsageLine,
  getUtcMonthWindow,
  type MonthlyAiUsage,
  type Translate,
} from '../../app/models/ai-usage';

/**
 * Stub translator mirroring the English catalog entries `formatSettingsUsageLine`
 * composes (M129/05 string extraction). Spelling them out here keeps the
 * assertions below byte-identical to the pre-extraction ones — what is under
 * test is the COMPOSITION (which branch, which cost, which pluralization),
 * not the copy, which the locale catalogs own now.
 */
const t: Translate = (key, params = {}) => {
  switch (key) {
    case 'settingsAi.usage.scanCount':
      return Number(params.count) === 1 ? '1 scan' : `${String(params.count)} scans`;
    case 'settingsAi.usage.thisMonth':
      return `This month: ${String(params.cost)} · ${String(params.scans)}`;
    case 'settingsAi.usage.thisMonthUnknown':
      return `This month: ${String(params.scans)} · cost unknown`;
    case 'settingsAi.usage.failed':
      return `${String(params.count)} failed`;
    default:
      throw new Error(`unexpected translation key: ${key}`);
  }
};

function makeUsage(overrides: Partial<MonthlyAiUsage> = {}): MonthlyAiUsage {
  const scanCount = overrides.scanCount ?? 3;
  return {
    scanCount,
    totalCostUsd: 0.0042,
    unknownCostCount: 0,
    inputTokens: 600,
    outputTokens: 2400,
    // Default to "all successful, none failed" — the pre-M123/09 shape every
    // existing test below assumes, so those tests stay unchanged.
    successCount: scanCount,
    failedCount: 0,
    ...overrides,
  };
}

describe('getUtcMonthWindow', () => {
  it('brackets a mid-month instant to [month-start, next-month-start)', () => {
    const { start, end } = getUtcMonthWindow(new Date('2026-07-12T15:30:00.000Z'));

    assert.strictEqual(start.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-08-01T00:00:00.000Z');
  });

  it('rolls the year over for December', () => {
    const { start, end } = getUtcMonthWindow(new Date('2026-12-15T09:00:00.000Z'));

    assert.strictEqual(start.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('handles January (no previous-year underflow)', () => {
    const { start, end } = getUtcMonthWindow(new Date('2026-01-20T00:00:00.000Z'));

    assert.strictEqual(start.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-02-01T00:00:00.000Z');
  });

  it('keeps the exact month-start instant inside its own window (inclusive start)', () => {
    const { start, end } = getUtcMonthWindow(new Date('2026-03-01T00:00:00.000Z'));

    assert.strictEqual(start.toISOString(), '2026-03-01T00:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-04-01T00:00:00.000Z');
  });

  it('keeps the last instant of a month in that month (exclusive end)', () => {
    const { start, end } = getUtcMonthWindow(new Date('2026-02-28T23:59:59.999Z'));

    assert.strictEqual(start.toISOString(), '2026-02-01T00:00:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-03-01T00:00:00.000Z');
  });
});

describe('formatMonthlyUsageLine', () => {
  it('returns null when there are no scans this month', () => {
    assert.strictEqual(formatMonthlyUsageLine(makeUsage({ scanCount: 0 })), null);
  });

  it('renders cost + pluralized scan count', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 3, totalCostUsd: 0.0042 })),
      'AI usage this month: $0.0042 across 3 scans',
    );
  });

  it('uses the singular "scan" for a single scan', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 1, totalCostUsd: 0.0042 })),
      'AI usage this month: $0.0042 across 1 scan',
    );
  });

  it('appends the unknown-cost count when some scans were uncatalogued', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 5, totalCostUsd: 0.0042, unknownCostCount: 2 })),
      'AI usage this month: $0.0042 across 5 scans · 2 with unknown cost',
    );
  });

  it('leads with the unknown fact when no scan had known pricing (never a false <$0.001)', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 2, totalCostUsd: 0, unknownCostCount: 2 })),
      'AI usage this month: 2 scans · cost unknown for your model',
    );
  });

  it('uses the singular "scan" in the all-unknown line for a single scan', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 1, totalCostUsd: 0, unknownCostCount: 1 })),
      'AI usage this month: 1 scan · cost unknown for your model',
    );
  });

  it('still shows a real <$0.001 when cost is known but rounds to ~free (no unknowns)', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 2, totalCostUsd: 0, unknownCostCount: 0 })),
      'AI usage this month: <$0.001 across 2 scans',
    );
  });

  it('appends a failed-count suffix so a run of failures does not read as N successful scans', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 3, successCount: 2, failedCount: 1 })),
      'AI usage this month: $0.0042 across 3 scans · 1 failed',
    );
  });

  it('combines the unknown-cost and failed-count suffixes when both apply', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 5, unknownCostCount: 2, successCount: 3, failedCount: 2 })),
      'AI usage this month: $0.0042 across 5 scans · 2 with unknown cost · 2 failed',
    );
  });

  it('appends the failed-count suffix on the all-unknown-cost branch too', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(
        makeUsage({ scanCount: 2, totalCostUsd: 0, unknownCostCount: 2, successCount: 1, failedCount: 1 }),
      ),
      'AI usage this month: 2 scans · cost unknown for your model · 1 failed',
    );
  });

  it('omits the failed-count suffix entirely when every billed scan succeeded', () => {
    assert.strictEqual(
      formatMonthlyUsageLine(makeUsage({ scanCount: 4, successCount: 4, failedCount: 0 })),
      'AI usage this month: $0.0042 across 4 scans',
    );
  });
});

describe('formatSettingsUsageLine', () => {
  it('returns null when there are no scans this month', () => {
    assert.strictEqual(formatSettingsUsageLine({ usage: makeUsage({ scanCount: 0 }), t }), null);
  });

  it('renders the compact "This month" line', () => {
    assert.strictEqual(
      formatSettingsUsageLine({ usage: makeUsage({ scanCount: 3, totalCostUsd: 0.0042 }), t }),
      'This month: $0.0042 · 3 scans',
    );
  });

  it('says "cost unknown" instead of a false <$0.001 when no scan had known pricing', () => {
    assert.strictEqual(
      formatSettingsUsageLine({ usage: makeUsage({ scanCount: 3, totalCostUsd: 0, unknownCostCount: 3 }), t }),
      'This month: 3 scans · cost unknown',
    );
  });

  it('omits the failed segment entirely when every billed scan succeeded', () => {
    assert.strictEqual(
      formatSettingsUsageLine({ usage: makeUsage({ scanCount: 3, successCount: 3, failedCount: 0 }), t }),
      'This month: $0.0042 · 3 scans',
    );
  });

  it('uses the singular failed key for exactly one failure', () => {
    assert.strictEqual(
      formatSettingsUsageLine({
        usage: makeUsage({ scanCount: 3, totalCostUsd: 0.0042, successCount: 2, failedCount: 1 }),
        t,
      }),
      'This month: $0.0042 · 3 scans · 1 failed',
    );
  });

  it('uses the plural failed key for several failures', () => {
    assert.strictEqual(
      formatSettingsUsageLine({
        usage: makeUsage({ scanCount: 5, totalCostUsd: 0.0042, successCount: 2, failedCount: 3 }),
        t,
      }),
      'This month: $0.0042 · 5 scans · 3 failed',
    );
  });

  it('appends the failed segment on the unknown-cost branch too', () => {
    assert.strictEqual(
      formatSettingsUsageLine({
        usage: makeUsage({ scanCount: 2, totalCostUsd: 0, unknownCostCount: 2, successCount: 1, failedCount: 1 }),
        t,
      }),
      'This month: 2 scans · cost unknown · 1 failed',
    );
  });
});

describe('formatFailedAttemptUsageLine', () => {
  it('includes the estimated cost and locale-formatted tokens when pricing is known', () => {
    assert.strictEqual(
      formatFailedAttemptUsageLine({ inputTokens: 1200, outputTokens: 45, estimatedCostUsd: 0.0042 }),
      "This attempt still used 1,200 input / 45 output tokens (est. $0.0042) — it's been recorded in your usage.",
    );
  });

  it('drops the est. clause when pricing is unknown (null)', () => {
    assert.strictEqual(
      formatFailedAttemptUsageLine({ inputTokens: 1200, outputTokens: 45, estimatedCostUsd: null }),
      "This attempt still used 1,200 input / 45 output tokens — it's been recorded in your usage.",
    );
  });

  it('renders <$0.001 for a sub-thousandth-cent failed attempt', () => {
    assert.strictEqual(
      formatFailedAttemptUsageLine({ inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.0005 }),
      "This attempt still used 10 input / 5 output tokens (est. <$0.001) — it's been recorded in your usage.",
    );
  });
});
