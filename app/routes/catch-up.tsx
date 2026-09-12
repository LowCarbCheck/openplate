/**
 * `/catch-up`, the morning catch-up on screen.
 *
 * The notification deep links here, and the words are the SAME words: both the
 * push text and this page come out of `#app/models/catch-up`, so tapping a
 * notification can never land on a page that says something else.
 *
 * NO SERVER LOADER work, by design (AGENTS.md, local-first): the three days,
 * the goals and the fast are all on-device. The `loader` below exists only so
 * an offline client-side navigation resolves without a `.data` fetch, exactly
 * as `/dashboard` and `/diary` do it.
 *
 * Where a number is shown it is shown in the diary's own budget rows
 * (`#app/lib/day-budget-rows`), not in a second formatting of the same
 * figures: yesterday's ceiling on this page and yesterday's ceiling in the
 * diary must round, hedge and colour identically or one of them is wrong.
 */
import type { ReactElement } from 'react';
import type { Route } from './+types/catch-up';
import { useTranslation } from 'react-i18next';

import i18n from '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { loadCatchUpInput } from '#app/lib/catch-up-input';
import { buildDayBudgetRows } from '#app/lib/day-budget-rows';
import type { DayBudgetTotals } from '#app/lib/day-budget-rows';
import { computeDayGaps } from '#app/lib/macro-gaps';
import { buildCatchUp } from '#app/models/catch-up';
import type { CatchUp, CatchUpDay, CatchUpGoals } from '#app/models/catch-up';
import type { Translate } from '#app/models/fasting';
import { DayBudgetRows } from '#app/components/day-budget-rows';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { SectionEyebrow } from '#app/components/typography';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: Route.MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.catchUp') },
];

export const handle = {
  title: 'Your daily catch-up',
  titleKey: 'catchUp.title',
  backTo: '/dashboard',
};

/**
 * The translator for the CLIENT LOADER, which runs outside the React tree and
 * so has no `useTranslation`. Safe here and only here: in the browser the
 * i18next singleton IS the live, language-synced instance (see
 * `app/i18n/I18nProvider.tsx`; only the server render uses a clone), and a
 * client loader never runs on the server.
 */
const loaderT: Translate = (key, params) => i18n.t(key, params ?? {});

/** No server work. See the module doc. */
export async function loader() {
  return {};
}

export interface CatchUpData {
  catchUp: CatchUp;
  /** Yesterday's figures, so the rows below the sentence are the day it talks about. */
  yesterday: CatchUpDay | null;
  goals: CatchUpGoals;
}

export async function clientLoader(): Promise<CatchUpData> {
  const input = await loadCatchUpInput({ t: loaderT, locale: i18n.language });
  const yesterday = [...input.days].toSorted((a, b) => b.dayKey.localeCompare(a.dayKey))[0] ?? null;
  return { catchUp: buildCatchUp(input), yesterday, goals: input.goals };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads the last three days off the on-device store. */
export function HydrateFallback(): ReactElement {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('catchUp.loading')}
    </output>
  );
}

/**
 * Yesterday's totals in the day-budget-rows shape, straight off `CatchUpDay`.
 *
 * Exported and kept pure so the wiring is pinned by a test that does not need
 * to render the route: the catch-up's own three sentences never mention fat,
 * but the row set below is the diary's, and the diary's fat row needs the
 * day's real figure, not a placeholder that would read as "no fat yesterday".
 */
export function yesterdayBudgetTotals(yesterday: CatchUpDay): DayBudgetTotals {
  return {
    netCarbs: yesterday.netCarbsG,
    kcal: yesterday.kcal,
    protein: yesterday.proteinG,
    fat: yesterday.fatG,
    fiber: yesterday.fiberG,
    hasEstimates: false,
  };
}

/**
 * Yesterday's budget rows, built from the same three figures the sentence
 * above them names. Rendered only for a day that HAS entries: a row set for a
 * day with nothing in it is five zeros, which reads as a verdict.
 */
function YesterdayRows({ yesterday, goals }: { yesterday: CatchUpDay; goals: CatchUpGoals }): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const language = i18next.language;
  const totals = yesterdayBudgetTotals(yesterday);
  const gaps = computeDayGaps({
    totals: { netCarbs: totals.netCarbs, protein: totals.protein, fiber: totals.fiber },
    goals: { netCarbsCeiling: goals.netCarbsCeiling, proteinFloor: goals.proteinFloor },
    t,
  });

  return (
    <div>
      <SectionEyebrow>{t('catchUp.yesterdayHeading')}</SectionEyebrow>
      <DayBudgetRows
        rows={buildDayBudgetRows({
          totals,
          goals: {
            netCarbsCeiling: goals.netCarbsCeiling,
            proteinFloor: goals.proteinFloor,
            kcalTarget: goals.kcalTarget,
          },
          gaps,
          t,
          language,
        })}
      />
    </div>
  );
}

export default function CatchUpRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const { catchUp, yesterday, goals } = loaderData;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">{catchUp.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {catchUp.lines.map((line) => (
              <li key={line} className="text-sm leading-relaxed text-foreground">
                {line}
              </li>
            ))}
          </ul>
          {yesterday !== null && yesterday.meals > 0 && <YesterdayRows yesterday={yesterday} goals={goals} />}
        </CardContent>
      </Card>
    </div>
  );
}
