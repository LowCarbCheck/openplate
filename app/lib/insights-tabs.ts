/**
 * The four review sections `/trends` splits into (M239/02), and the values
 * its `?tab=` search param accepts.
 *
 * Lives here rather than in the route file because both the tab strip
 * (`#app/components/trends/insights-tab-strip.tsx`) and the chart's own
 * controls (`#app/components/trends/trend-controls.tsx`) need the type to
 * build a link that keeps the active tab, the same reason `TrendSlot` and
 * `TrendMetric` live in `#app/lib/trend-chart` rather than in `trends.tsx`,
 * whose route module is its own build chunk. The route's `_parseTab` (next to
 * `_parseSlot`) is the only thing that reads this list to PARSE a param; this
 * module only names the values.
 */

/** The tab strip's four destinations, in the order they are drawn. */
export const INSIGHTS_TABS = ['overview', 'nutrition', 'meals', 'goals'] as const;

/** One of the four review sections `/trends` splits into. */
export type InsightsTab = (typeof INSIGHTS_TABS)[number];

/** The tab an absent or invalid `?tab=` value reads as, the glance-first section. */
export const DEFAULT_INSIGHTS_TAB: InsightsTab = 'overview';
