/**
 * Vitamins and minerals: the block under "What you ate" on the diary, and the
 * same block on Insights' Nutrition tab.
 *
 * Every card mounts `MicronutrientSnapshotCard`, the presentational half,
 * with a snapshot the app's own pipeline built from the logs in
 * `fixtures/nutrients.ts`: `computeMicronutrientsInWindow`, then
 * `buildNutrientRows`, then `buildMicronutrientSnapshot`. The container,
 * `MicronutrientSnapshotBlock`, reads the reference list from the network, so
 * it is not mounted here; the loading card passes the same flag it would.
 *
 * The last group composes the diary's day card the way `DaySummaryCard` in
 * `app/routes/diary.tsx` does (that component is not exported): "What you
 * ate", then this block, each under a hairline, inside the same
 * `.surface-brand` card. The verdict chip, the budget rows and the
 * suggestions disclosure are left out; none of them sits between the two.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { WhatYouAte } from '#app/components/day-summary-details';
import { MicronutrientSnapshotCard } from '#app/components/micronutrient-snapshot-card';
import type { SnapshotScope } from '#app/components/micronutrient-snapshot-card';
import { Card as AppCard, CardContent } from '#app/components/ui/card';
import { computeDailyTotals, computeMicronutrientsInWindow, DEFAULT_MIN_COVERAGE_FRACTION } from '#app/lib/local-store/aggregates';
import { buildMicronutrientSnapshot } from '#app/lib/micronutrient-snapshot';
import type { MicronutrientSnapshot } from '#app/lib/micronutrient-snapshot';
import { buildNutrientRows } from '#app/lib/nutrient-reference';
import { nutrientsDayHref, nutrientsRangeHref } from '#app/lib/nutrient-window';
import { EMPTY_DAY_SUMMARY } from '#app/models/food-log-summary';
import { Card, Group, Section, type SectionDef } from '../layout';
import {
  AGE_OUT_OF_BANDS,
  AI_ONLY,
  EMPTY_DAY,
  MIXED_JUST_UNDER,
  NO_BODY_METRICS,
  NO_GAPS,
  NUTRIENT_CURRENT_YEAR,
  NUTRIENT_TODAY,
  REFERENCES_UNREACHABLE,
  SODIUM_OVER,
  THREE_GAPS,
  WEEK_RANGE,
  type NutrientScenario,
} from '../fixtures/nutrients';

export const DEF: SectionDef = {
  id: 'nutrients',
  title: 'Nutrients',
  intent:
    'The vitamins and minerals block on the diary and on Insights. Every snapshot is built from fixture logs through the real pipeline; the reference amounts are fixture figures, not a published table.',
};

const DAY_SCOPE: SnapshotScope = { kind: 'day' };
const DAY_LINK = nutrientsDayHref(NUTRIENT_TODAY);

/**
 * The snapshot a scenario's logs produce, built the way the block builds it.
 *
 * @param scenario - the logs, the window, the references and the profile.
 */
function snapshotOf(scenario: NutrientScenario): MicronutrientSnapshot {
  const intake = computeMicronutrientsInWindow(
    scenario.logs,
    { fromDate: scenario.fromDate, toDate: scenario.toDate },
    { minCoverageFraction: DEFAULT_MIN_COVERAGE_FRACTION },
  );
  const rows = buildNutrientRows({
    byNutrient: intake.byNutrient,
    loggedDays: intake.loggedDays,
    references: scenario.references,
    metrics: scenario.metrics,
    currentYear: NUTRIENT_CURRENT_YEAR,
  });
  return buildMicronutrientSnapshot({
    rows,
    totalEntries: intake.totalEntries,
    referencesReachable: scenario.references.length > 0,
    hasBodyMetrics: scenario.metrics.biologicalSex !== null && scenario.metrics.birthYear !== null,
  });
}

interface SnapshotCardDef {
  state: string;
  label: string;
  reach: string;
  scenario: NutrientScenario;
  isLoading?: boolean;
}

const DAY_CARDS: readonly SnapshotCardDef[] = [
  {
    state: 'nutrients-three-gaps',
    label: 'Good coverage, three gaps',
    reach:
      'Save a year of birth and a sex in Settings, Profile. Log a food from the database search, then open that day in the diary.',
    scenario: THREE_GAPS,
  },
  {
    state: 'nutrients-no-gaps',
    label: 'Good coverage, no gaps',
    reach: 'As above, with foods from the database search that are rich in every vitamin and mineral.',
    scenario: NO_GAPS,
  },
  {
    state: 'nutrients-sodium-over',
    label: 'Sodium above its limit',
    reach: 'Log a large salty dish from the database search, such as ramen or cured ham, and open that day in the diary.',
    scenario: SODIUM_OVER,
  },
  {
    state: 'nutrients-ai-only',
    label: 'Only AI estimates: not enough data',
    reach: 'Log a day with photo or describe entries only, then open that day in the diary.',
    scenario: AI_ONLY,
  },
  {
    state: 'nutrients-mixed-under-bar',
    label: 'Mixed day, 55 percent covered, just under the bar',
    reach: 'Log about 165 g of a database food and about 135 g by photo on the same day.',
    scenario: MIXED_JUST_UNDER,
  },
  {
    state: 'nutrients-no-body-metrics',
    label: 'No year of birth or sex saved',
    reach: 'Clear the year of birth or the sex in Settings, Profile, then open a day with database foods.',
    scenario: NO_BODY_METRICS,
  },
  {
    state: 'nutrients-references-unreachable',
    label: 'Reference amounts unreachable',
    reach: 'Run an instance with no FOOD_DB_API_KEY, or go offline before the diary opens, on a day with database foods.',
    scenario: REFERENCES_UNREACHABLE,
  },
  {
    state: 'nutrients-age-out-of-bands',
    label: 'Year of birth below the published bands',
    reach: 'Save a year of birth that makes you younger than 14 in Settings, Profile.',
    scenario: AGE_OUT_OF_BANDS,
  },
  {
    state: 'nutrients-empty-day',
    label: 'Nothing logged',
    reach: 'Not reachable on the diary: the day card shows only once a day has an entry. /nutrients?day= on an empty day shows the same words.',
    scenario: EMPTY_DAY,
  },
  {
    state: 'nutrients-loading',
    label: 'Loading: the reserved box',
    reach: 'Open a day with database foods on a slow connection; the block holds this box until the reference amounts arrive.',
    scenario: THREE_GAPS,
    isLoading: true,
  },
];

/** The block for one card, drawn with the props the container would pass. */
function SnapshotCardFor({ def }: { def: SnapshotCardDef }): ReactElement {
  return (
    <Card state={def.state} label={def.label} reach={def.reach}>
      <AppCard>
        <CardContent className="p-4">
          <MicronutrientSnapshotCard
            snapshot={snapshotOf(def.scenario)}
            to={DAY_LINK}
            scope={DAY_SCOPE}
            isLoading={def.isLoading ?? false}
            fillReserve="none"
          />
        </CardContent>
      </AppCard>
    </Card>
  );
}

/** The diary's day card, "What you ate" then the block, composed as `DaySummaryCard` composes them. */
function DiaryPanePreview({ scenario }: { scenario: NutrientScenario }): ReactElement {
  const { t } = useTranslation();
  const summary = computeDailyTotals(scenario.logs, NUTRIENT_TODAY).summary ?? EMPTY_DAY_SUMMARY;
  return (
    <AppCard className="surface-brand overflow-hidden shadow-sm">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="border-t pt-4">
          <WhatYouAte
            summary={summary}
            caveat={null}
            kcalLine={
              <p className="text-sm text-muted-foreground tabular-nums">
                {t('diary.kcal.absolute', { value: Math.round(summary.kcal) })}
              </p>
            }
          />
        </div>
        <div className="border-t pt-4">
          <MicronutrientSnapshotCard snapshot={snapshotOf(scenario)} to={DAY_LINK} scope={DAY_SCOPE} isLoading={false} fillReserve="none" />
        </div>
      </CardContent>
    </AppCard>
  );
}

export default function NutrientsSection(): ReactElement {
  const weekScope: SnapshotScope = { kind: 'range', days: 7 };
  return (
    <Section def={DEF}>
      <Group title="Diary, one day">
        {DAY_CARDS.map((def) => (
          <SnapshotCardFor key={def.state} def={def} />
        ))}
      </Group>
      <Group title="Insights, a window">
        <Card
          state="nutrients-insights-week"
          label="Insights, Nutrition tab, 7 days"
          reach="Open Insights, Nutrition, with the 7 day range picked, after logging database foods on five of the last seven days."
        >
          <AppCard>
            <CardContent className="p-6">
              <MicronutrientSnapshotCard
                snapshot={snapshotOf(WEEK_RANGE)}
                to={nutrientsRangeHref(7)}
                scope={weekScope}
                isLoading={false}
                fillReserve="none"
              />
            </CardContent>
          </AppCard>
        </Card>
      </Group>
      <Group title="Diary day card">
        <Card
          state="nutrients-diary-pane"
          label="What you ate, then vitamins and minerals"
          reach="Open the diary on a day with database foods. The day card sits under the date bar and the habit strip."
          note="Composed here: DaySummaryCard is not exported. The verdict chip, the budget rows and the suggestions are left out."
          span={2}
        >
          <DiaryPanePreview scenario={THREE_GAPS} />
        </Card>
      </Group>
    </Section>
  );
}
