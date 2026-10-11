/**
 * The Overview hero: the "Today so far" card at the top of the dashboard.
 *
 * ── Composed here because the route composes it inline ───────────────────
 *
 * `TodayHeroCard` in `app/routes/dashboard.tsx` is not exported, so a card
 * cannot mount it. This file composes the same pieces in the same order inside
 * the same `.surface-brand` wrapper: the eyebrow, `DayBudgetLead`, then
 * `DayBudgetRows density="ledger"`. Every string and every number comes from
 * the app's own builders (`computeDayGaps`, `buildDayBudgetRows`,
 * `buildHeroLead`), run on the plain inputs in `fixtures/hero.ts`. There is no
 * hand-built `HeroLead` anywhere on this page.
 *
 * LEFT OUT, and the cards say nothing about them: the verdict chip beside the
 * eyebrow (it needs the eating-style lens, a setting of its own) and the
 * composer and links under the budget block. Neither changes the budget block.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { DayBudgetLead } from '#app/components/day-budget-lead';
import { DayBudgetRows } from '#app/components/day-budget-rows';
import { SectionEyebrow } from '#app/components/typography';
import { Card as AppCard, CardContent } from '#app/components/ui/card';
import { buildDayBudgetRows } from '#app/lib/day-budget-rows';
import { buildHeroLead } from '#app/lib/day-hero-lead';
import { computeDayGaps } from '#app/lib/macro-gaps';
import { Card, Group, Section, type SectionDef } from '../layout';
import {
  CALORIES_NO_TARGET,
  CALORIES_OVER,
  CALORIES_PARTWAY,
  CALORIES_ZERO,
  NET_CARBS_ESTIMATES,
  NET_CARBS_NO_LIMIT,
  NET_CARBS_OVER,
  NET_CARBS_PARTWAY,
  NET_CARBS_ZERO,
  PROTEIN_NO_TARGET,
  PROTEIN_PARTWAY,
  PROTEIN_REACHED,
  PROTEIN_REFERENCE,
  PROTEIN_REFERENCE_DATE_MISSING,
  PROTEIN_ZERO,
  type HeroScenario,
} from '../fixtures/hero';

export const DEF: SectionDef = {
  id: 'overview-hero',
  title: 'Overview hero',
  intent:
    'The "Today so far" hero on the dashboard, one group per main goal. The route builds it inline, so each card composes the same pieces in the same wrapper and builds the lead through the real day-hero-lead functions. The verdict chip and the buttons under the budget block are left out.',
};

/**
 * The hero for one day, built the way `TodayHeroCard` builds it.
 *
 * @param scenario - the day's totals and goals, and the main goal that leads.
 */
function HeroPreview({ scenario }: { scenario: HeroScenario }): ReactElement {
  const { t, i18n } = useTranslation();
  const { totals, goals } = scenario;
  const gaps = computeDayGaps({
    totals: { netCarbs: totals.netCarbs, protein: totals.protein, fiber: totals.fiber },
    goals,
    t,
  });
  const rows = buildDayBudgetRows({
    totals,
    goals: {
      netCarbsCeiling: goals.netCarbsCeiling,
      kcalTarget: goals.kcalTarget,
      proteinFloor: goals.proteinFloor,
      missingReferenceDate: goals.proteinReferenceMissingDate,
    },
    gaps,
    t,
    language: i18n.language,
    mainGoal: scenario.mainGoal,
  });
  // `buildDayBudgetRows` puts the main goal's row first, always.
  const [leadRow, ...ledgerRows] = rows;
  if (leadRow === undefined) throw new Error('buildDayBudgetRows built no rows');
  const lead = buildHeroLead({
    row: leadRow,
    entryCount: scenario.entryCount,
    hasEstimates: totals.hasEstimates,
    t,
    language: i18n.language,
  });
  return (
    <AppCard className="surface-brand overflow-hidden shadow-sm">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="space-y-3">
          <SectionEyebrow>{t('diary.hero.eyebrow')}</SectionEyebrow>
          <DayBudgetLead lead={lead} />
          <DayBudgetRows rows={ledgerRows} density="ledger" />
        </div>
      </CardContent>
    </AppCard>
  );
}

interface HeroCardDef {
  state: string;
  label: string;
  reach: string;
  scenario: HeroScenario;
}

const NET_CARBS_CARDS: readonly HeroCardDef[] = [
  {
    state: 'hero-net-carbs-zero',
    label: 'Nothing logged yet',
    reach: 'Settings, Nutrition: set the main goal to net carbs and a daily limit of 50 g. Open Today before you log a food.',
    scenario: NET_CARBS_ZERO,
  },
  {
    state: 'hero-net-carbs-partway',
    label: 'Partway through the limit',
    reach: 'With that setting, log a few foods that add up to about 24 g net carbs and open Today.',
    scenario: NET_CARBS_PARTWAY,
  },
  {
    state: 'hero-net-carbs-over',
    label: 'Limit exceeded (amber)',
    reach: 'With that setting, log foods past 50 g net carbs. The figure, caption and meter turn amber.',
    scenario: NET_CARBS_OVER,
  },
  {
    state: 'hero-net-carbs-estimates',
    label: 'Day holds an AI estimate',
    reach: 'Log a food from a plate photo or a description, so its figures are an AI estimate. Budget figures then start with "~".',
    scenario: NET_CARBS_ESTIMATES,
  },
  {
    state: 'hero-net-carbs-no-limit',
    label: 'No limit set',
    reach: 'Settings, Nutrition: leave the daily carb limit empty. The lead states what was eaten and draws no meter.',
    scenario: NET_CARBS_NO_LIMIT,
  },
];

const CALORIES_CARDS: readonly HeroCardDef[] = [
  {
    state: 'hero-calories-zero',
    label: 'Nothing logged yet',
    reach: 'Settings, Nutrition: set the main goal to calories and a calorie target of 1,950. Open Today before you log a food.',
    scenario: CALORIES_ZERO,
  },
  {
    state: 'hero-calories-partway',
    label: 'Partway through the target',
    reach: 'With that setting, log foods that add up to about 1,240 kcal and open Today.',
    scenario: CALORIES_PARTWAY,
  },
  {
    state: 'hero-calories-over',
    label: 'Target exceeded (amber)',
    reach: 'With that setting, log foods past 1,950 kcal. The lead turns amber and says how far over.',
    scenario: CALORIES_OVER,
  },
  {
    state: 'hero-calories-no-target',
    label: 'No calorie target set',
    reach: 'Settings, Nutrition: set the main goal to calories and leave the calorie target empty. The lead shows the day\'s calories with no meter.',
    scenario: CALORIES_NO_TARGET,
  },
];

const PROTEIN_CARDS: readonly HeroCardDef[] = [
  {
    state: 'hero-protein-zero',
    label: 'Nothing logged yet',
    reach: 'Settings, Nutrition: set the main goal to protein and a protein floor of 90 g. Open Today before you log a food.',
    scenario: PROTEIN_ZERO,
  },
  {
    state: 'hero-protein-partway',
    label: 'Partway to the floor',
    reach: 'With that setting, log foods that add up to about 52 g protein and open Today.',
    scenario: PROTEIN_PARTWAY,
  },
  {
    state: 'hero-protein-reached',
    label: 'Target reached (check mark)',
    reach: 'With that setting, log foods that reach 90 g protein. The figure turns brand coloured and gets a check mark.',
    scenario: PROTEIN_REACHED,
  },
  {
    state: 'hero-protein-reference',
    label: 'Reference intake, not a set target',
    reach: 'Settings, Nutrition: set the main goal to protein and leave the protein floor empty. The dashboard then uses the reference intake for your body facts, and the scale line says "reference".',
    scenario: PROTEIN_REFERENCE,
  },
  {
    state: 'hero-protein-reference-date-missing',
    label: 'Reference, date missing',
    reach: 'As above, while Settings, Life phase says pregnant with no due date. The tag asks for the date and links to that page.',
    scenario: PROTEIN_REFERENCE_DATE_MISSING,
  },
  {
    state: 'hero-protein-no-target',
    label: 'No target at all',
    reach: 'Not reachable on the dashboard today: its loader always passes a reference intake, so a person with no floor sees the reference card above. The builders accept a missing target, and this card shows what they draw for it.',
    scenario: PROTEIN_NO_TARGET,
  },
];

function HeroCards({ cards }: { cards: readonly HeroCardDef[] }): ReactElement {
  return (
    <>
      {cards.map((card) => (
        <Card key={card.state} state={card.state} label={card.label} reach={card.reach}>
          <HeroPreview scenario={card.scenario} />
        </Card>
      ))}
    </>
  );
}

export default function OverviewHeroSection(): ReactElement {
  return (
    <Section def={DEF}>
      <Group title="Net carbs lead">
        <HeroCards cards={NET_CARBS_CARDS} />
      </Group>
      <Group title="Calories lead">
        <HeroCards cards={CALORIES_CARDS} />
      </Group>
      <Group title="Protein lead">
        <HeroCards cards={PROTEIN_CARDS} />
      </Group>
    </Section>
  );
}
