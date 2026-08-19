/**
 * The card around the adherence grid: title, description, legend, and the
 * nudge shown when no daily goal is configured yet.
 *
 * On a plain `bg-card`, NOT `.surface-brand`: this screen already spends its
 * one hero on `WeeklyRecapCard` (DESIGN.md §2), and the ramp below was
 * validated for contrast against `--card` — a brand wash under the cells would
 * invalidate that check as well as being a second hero.
 */
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { AdherenceGrid } from '#app/components/trends/adherence-grid';
import { AdherenceLegend } from '#app/components/trends/adherence-legend';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import type { AdherenceGoals, AdherenceGrid as AdherenceGridModel } from '#app/models/adherence-grid';

/**
 * The grid card.
 *
 * @param grid - the resolved grid model.
 * @param goals - the user's configured daily goals (drives the mode-specific copy and the readouts).
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
        {isActivityMode && (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground">{t('trends.grid.noGoalsHint')}</p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings/goals">{t('trends.grid.noGoalsCta')}</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
