/**
 * The tab strip atop `/trends` (M239/02): four review sections that live in
 * the URL. Every tab is a real `Link` carrying `range`, `slot` and `metric` forward,
 * the same "don't drop the other control" rule `TrendControls`'s own
 * `controlHref` follows, so switching sections never resets the chart window
 * or the meal filter, and a shared URL lands on the same view.
 *
 * `grid-cols-4`, not a wrapping flex row: four equal columns can never
 * scroll sideways, which is the phone-first budget this strip is written
 * against (checked at 360 px).
 */
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { ALL_MEALS, DEFAULT_TREND_METRIC } from '#app/lib/trend-chart';
import type { TrendMetric, TrendSlot } from '#app/lib/trend-chart';
import { INSIGHTS_TABS, type InsightsTab } from '#app/lib/insights-tabs';
import { cn } from '#app/lib/utils';

/** One tab's catalog key, keyed by its own value. */
const TAB_LABEL_KEYS = {
  overview: 'trends.tabs.overview',
  nutrition: 'trends.tabs.nutrition',
  meals: 'trends.tabs.meals',
  goals: 'trends.tabs.goals',
} satisfies Record<InsightsTab, string>;

/**
 * The href for one tab, carrying the current range, slot and metric with it.
 * `slot` and `metric` are written as the absence of their param at their
 * defaults, mirroring `controlHref`, so the plain view stays the plain URL.
 *
 * @param tab - the tab this link lands on.
 * @param range - the active day range.
 * @param slot - the active meal slot, or `ALL_MEALS`.
 * @param metric - the active chart metric.
 * @returns a same-route query string.
 */
function tabHref({
  tab,
  range,
  slot,
  metric,
}: {
  tab: InsightsTab;
  range: number;
  slot: TrendSlot;
  metric: TrendMetric;
}): string {
  const params = new URLSearchParams({ tab, range: `${range}` });
  if (slot !== ALL_MEALS) params.set('slot', slot);
  if (metric !== DEFAULT_TREND_METRIC) params.set('metric', metric);
  return `?${params.toString()}`;
}

/**
 * @param active - the tab currently shown.
 * @param range - the active day range, carried into every tab link.
 * @param slot - the active meal slot, carried into every tab link.
 * @param metric - the active chart metric, carried into every tab link.
 */
export function InsightsTabStrip({
  active,
  range,
  slot,
  metric,
}: {
  active: InsightsTab;
  range: number;
  slot: TrendSlot;
  metric: TrendMetric;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="tablist"
      aria-label={t('trends.title')}
      data-slot="insights-tab-strip"
      className="grid grid-cols-4 gap-1 rounded-lg border bg-card p-1"
    >
      {INSIGHTS_TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <Link
            key={tab}
            to={tabHref({ tab, range, slot, metric })}
            preventScrollReset
            role="tab"
            aria-selected={isActive}
            className={cn(
              'flex min-h-11 min-w-0 items-center justify-center rounded-md px-1 py-1.5 text-center',
              // NOT `truncate`: three of the four German labels and two of the
              // Turkish ones need more than a quarter of a 360px phone, and a
              // navigation label that ends in an ellipsis is a navigation
              // label nobody can read. They wrap, or they hyphenate.
              'hyphens-auto break-words text-xs font-medium leading-tight transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(TAB_LABEL_KEYS[tab])}
          </Link>
        );
      })}
    </div>
  );
}
