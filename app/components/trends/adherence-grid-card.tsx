/**
 * The card around the adherence grid: title, description and legend.
 *
 * No nudge of its own when no daily goal is set: the card lives on the Goals
 * tab, which opens with its own invitation to `/settings/nutrition` in that
 * case (M239/05), and a second button to the same page one card lower would
 * be the same question asked twice.
 *
 * On a plain `bg-card`, NOT `.surface-brand`: this screen already spends its
 * one hero on `WeeklyRecapCard` (DESIGN.md §2), and the ramp below was
 * validated for contrast against `--card` — a brand wash under the cells would
 * invalidate that check as well as being a second hero.
 */
import { useTranslation } from 'react-i18next';
import { AdherenceGrid } from '#app/components/trends/adherence-grid';
import { AdherenceLegend } from '#app/components/trends/adherence-legend';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import type { AdherenceGoals, AdherenceGrid as AdherenceGridModel } from '#app/models/adherence-grid';

/**
 * The grid card.
 *
 * @param grid - the resolved grid model.
 * @param goals - the user's configured daily goals (drives the readouts).
 */
export function AdherenceGridCard({ grid, goals }: { grid: AdherenceGridModel; goals: AdherenceGoals }) {
  const { t } = useTranslation();
  const isActivityMode = grid.mode === 'activity';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {t(isActivityMode ? 'trends.grid.titleActivity' : 'trends.grid.title')}
        </CardTitle>
        <CardDescription>
          {t(isActivityMode ? 'trends.grid.descriptionActivity' : 'trends.grid.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <AdherenceGrid grid={grid} goals={goals} />
        <AdherenceLegend mode={grid.mode} hasUnratedDays={grid.hasUnratedDays} />
      </CardContent>
    </Card>
  );
}
