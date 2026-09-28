/**
 * Pure helpers for AI-usage bookkeeping — UTC month windowing plus the muted
 * display lines shown on the scan and AI-settings pages. No DB import: the
 * data-access layer (`ai-usage.server.ts`) re-exports the window helper, and
 * the routes import the formatters directly. Kept side-effect-free so it's
 * unit-testable without a database (same split as `food-log-summary.ts`).
 */
import { DEFAULT_LANGUAGE } from '#app/i18n/language-prefs';
import { formatScanCost, formatTokenCount } from '#app/services/vision/cost';

/**
 * The narrow slice of i18next's `t` the display formatters below depend on.
 * Threaded in explicitly: this module stays pure and testable with a stub
 * translator, and never imports the i18next singleton (which is per-request on
 * the server).
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * Aggregated AI-usage totals for a single UTC calendar month.
 *
 * `successCount` + `failedCount` always sum to `scanCount` — the split is
 * over the SAME billed population `scanCount` already counts, not an
 * additional set. `failedCount` counts billed attempts recorded with
 * outcome `'error'` (the provider took the tokens but the call ultimately
 * failed); everything else — a real identification or a genuine "no food on
 * this plate" — is a success. A billed event with no recorded outcome (a
 * legacy row from before outcome tracking existed) is treated as a success:
 * absence of evidence of failure is not evidence of failure, and defaulting
 * old rows to "failed" would retroactively and incorrectly redraw a clean
 * scan history as broken.
 */
export interface MonthlyAiUsage {
  scanCount: number;
  /** Sum of the non-null `estimatedCostUsd` values (unknown-cost scans contribute 0 here). */
  totalCostUsd: number;
  /** How many scans this month had no known pricing (custom/uncatalogued model). */
  unknownCostCount: number;
  inputTokens: number;
  outputTokens: number;
  /** Billed scans that ended in a real identification or a genuine no-food result. */
  successCount: number;
  /** Billed scans that ended in a provider/parse error after tokens were already spent. */
  failedCount: number;
}

/** Half-open `[start, end)` instant range covering one UTC calendar month. */
export interface UtcMonthWindow {
  /** First instant of the month (inclusive). */
  start: Date;
  /** First instant of the NEXT month (exclusive). */
  end: Date;
}

/**
 * UTC calendar-month window containing `now`: `start` is the first instant of
 * the month, `end` is the first instant of the *next* month — a half-open
 * `[start, end)` range. `now` is passed in (never read from the clock inside)
 * so the computation is deterministic and directly testable.
 *
 * @param now - the instant whose calendar month defines the window.
 * @returns the month's start (inclusive) and end (exclusive) instants.
 */
export function getUtcMonthWindow(now: Date): UtcMonthWindow {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Pluralized scan count, e.g. `1 scan` / `3 scans`. */
function _formatScanCount(scanCount: number): string {
  return scanCount === 1 ? '1 scan' : `${scanCount} scans`;
}

/** True when there's no known-priced scan to report but some scans used an uncatalogued model. */
function _hasOnlyUnknownCost(usage: MonthlyAiUsage): boolean {
  return usage.totalCostUsd === 0 && usage.unknownCostCount > 0;
}

/**
 * ` · 1 failed` / ` · 3 failed` — appended whenever some of this month's
 * billed scans errored out, so a run of billed-but-failed attempts (issue 3
 * in the spec: doubled 4xx retries) doesn't silently inflate the plain
 * "N scans" figure into looking like N successful identifications. Omitted
 * entirely when every billed scan succeeded.
 */
function _formatFailedSuffix(usage: MonthlyAiUsage): string {
  return usage.failedCount > 0 ? ` · ${usage.failedCount} failed` : '';
}

/**
 * Muted one-liner for the scan page footer, e.g.
 * `AI usage this month: $0.0042 across 3 scans` — with a trailing
 * ` · 2 with unknown cost` when some scans used an uncatalogued model.
 *
 * When no scan this month had known pricing, leads with the honest unknown fact
 * instead of a `<$0.001` that would falsely imply "basically free".
 *
 * @returns the line, or `null` when there's nothing to show (no scans yet).
 */
export function formatMonthlyUsageLine(usage: MonthlyAiUsage): string | null {
  if (usage.scanCount === 0) return null;
  const failedSuffix = _formatFailedSuffix(usage);
  if (_hasOnlyUnknownCost(usage)) {
    return `AI usage this month: ${_formatScanCount(usage.scanCount)} · cost unknown for your model${failedSuffix}`;
  }
  const base = `AI usage this month: ${formatScanCost(usage.totalCostUsd)} across ${_formatScanCount(usage.scanCount)}`;
  const unknownSuffix = usage.unknownCostCount > 0 ? ` · ${usage.unknownCostCount} with unknown cost` : '';
  return `${base}${unknownSuffix}${failedSuffix}`;
}

/**
 * Compact muted usage line for the AI-settings card, e.g.
 * `This month: $0.0042 · 3 scans`. Mirrors `formatMonthlyUsageLine`'s honesty:
 * when nothing had known pricing, it says so rather than showing `<$0.001`.
 *
 * Translated (M129/05) — the AI-settings page is its only caller; the scan
 * page's own `formatMonthlyUsageLine` above is a separate line with separate
 * copy.
 *
 * Carries the same success/failed split `formatMonthlyUsageLine` gained in
 * M123/09, e.g. `This month: $0.0042 · 3 scans · 1 failed` — composed from
 * the plural-aware `settingsAi.usage.failed` catalog key, following the
 * same `t('...scanCount', { count })` shape already used for `scans` above.
 * Omitted entirely when every billed scan this month succeeded.
 *
 * @returns the line, or `null` when there are no scans this month.
 */
export function formatSettingsUsageLine({ usage, t }: { usage: MonthlyAiUsage; t: Translate }): string | null {
  if (usage.scanCount === 0) return null;
  const scans = t('settingsAi.usage.scanCount', { count: usage.scanCount });
  const failedSuffix = usage.failedCount > 0 ? ` · ${t('settingsAi.usage.failed', { count: usage.failedCount })}` : '';
  if (_hasOnlyUnknownCost(usage)) {
    return `${t('settingsAi.usage.thisMonthUnknown', { scans })}${failedSuffix}`;
  }
  return `${t('settingsAi.usage.thisMonth', { cost: formatScanCost(usage.totalCostUsd), scans })}${failedSuffix}`;
}

/**
 * Muted reassurance line under a failed-identify alert — the model still
 * billed tokens even though nothing usable came back, and that cost has been
 * recorded. The `(est. …)` clause is dropped when pricing is unknown.
 *
 * @param inputTokens - provider-reported prompt tokens for the failed attempt.
 * @param outputTokens - provider-reported completion tokens for the failed attempt.
 * @param estimatedCostUsd - estimated USD cost, or `null` when uncatalogued.
 */
export function formatFailedAttemptUsageLine({
  inputTokens,
  outputTokens,
  estimatedCostUsd,
  language = DEFAULT_LANGUAGE,
}: {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  /** Active UI language — only the number grouping follows it; this line's copy is still English. */
  language?: string;
}): string {
  const costClause = estimatedCostUsd !== null ? ` (est. ${formatScanCost(estimatedCostUsd)})` : '';
  return `This attempt still used ${formatTokenCount(inputTokens, language)} input / ${formatTokenCount(outputTokens, language)} output tokens${costClause} — it's been recorded in your usage.`;
}
