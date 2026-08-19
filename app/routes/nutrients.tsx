/**
 * Nutrients (M135/06) — what the food log contained, per vitamin and mineral,
 * against the reference intake published for this person.
 *
 * TWO RULES GOVERN EVERY LINE ON THIS SCREEN, and they are the reason the
 * feature exists rather than constraints bolted onto it:
 *
 * **1. It never asserts a bodily state.** A food log is not a blood panel. Copy
 * describes the LOG ("your log was light on magnesium in this window"), never
 * the person, and there is no supplement anywhere on it — no suggestion, no
 * mention, no link. M135 locked decision 2; DESIGN.md §10.1 (the voice never
 * grades the person) says the same thing from the other direction.
 *
 * **2. It never shows a number it cannot stand behind.** Two independent
 * refusals, each a type rather than a convention:
 *   - `NutrientIntake` (from the aggregation) only carries an `amount` on its
 *     `hasEnoughData: true` arm. Below the coverage bar the row renders an
 *     explicit "not enough data" state — no partial sum, no percentage, no bar,
 *     no colour verdict — and says WHY in plain language.
 *   - `ReferenceAmount` (from `#app/lib/nutrient-reference`) has three refusal
 *     arms: no body metrics, an age below the youngest published band, and no
 *     published reference. None of them falls back to a "typical person"
 *     number; see that module for why inventing one would be the implied health
 *     claim this milestone forbids.
 *
 * **3. Not every reference amount is a goal.** A nutrient upstream classifies
 * as a `ceiling` (sodium, today the only one) is rendered in limit vocabulary
 * throughout — a "Limit" badge on the name, "of a … limit", and a plain reading
 * of whether the log is under or over in place of the percentage and the bar,
 * which both say "progress towards". It is also excluded from the "lightest on
 * these" ranking and therefore from the food suggestions: being low in sodium
 * is not a gap, and filling it would mean recommending the saltiest foods in
 * the corpus. See `NutrientKind` in `#app/lib/nutrient-reference`.
 *
 * Local-first and fail-open, like every tracker surface: the log and the body
 * metrics are read from the on-device store, and the published reference data
 * is fetched through `/api/nutrients` in a way that can only ever ADD targets.
 * With the API unreachable the screen still renders intake and coverage, and
 * every row simply reports "no published reference" — which is the same state a
 * nutrient with no published DRV is in anyway.
 *
 * Exactly ONE brand-filled hero card (DESIGN.md §2): the window summary at the
 * top. Everything below it is plain `bg-card`.
 */
import type { ReactElement } from 'react';
import type { Route } from './+types/nutrients';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import {
  computeMicronutrientsInWindow,
  DEFAULT_MIN_COVERAGE_FRACTION,
  getLocalProfileGoals,
  listLocalFoodLogs,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import { shiftDate, todayInTimezone } from '#app/lib/user-days';
import { readBodyMetrics } from '#app/models/body-metrics';
import {
  buildNutrientRows,
  filterSuggestions,
  formatNutrientAmount,
  formatSharePercent,
  isAboveReferenceLimit,
  NUTRIENT_SLUGS,
  pickLightestNutrients,
} from '#app/lib/nutrient-reference';
import type { NutrientRow, NutrientSourceFood, ReferenceAmount } from '#app/lib/nutrient-reference';
import { fetchNutrientReferenceList, fetchNutrientSources } from '#app/lib/nutrient-reference-client';
import type { NutrientKey } from '#app/lib/micronutrients';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SectionEyebrow } from '#app/components/typography';
import { Badge } from '#app/components/ui/badge';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: Route.MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.nutrients') },
];

export const handle = {
  // No `backTo`: `/nutrients` is a top-level catalog destination like `/trends`.
  title: 'Nutrients',
  titleKey: 'nutrients.title',
};

//////////////////////////////////////////////////////////////////////////////
// Constants
//////////////////////////////////////////////////////////////////////////////

/**
 * The share of a window's logged GRAMS that must carry a real figure for a
 * nutrient before this screen will show an intake number for it.
 *
 * Deliberately the aggregation's own default rather than a looser
 * screen-specific bar: that constant's doc comment justifies the 0.6 value, and
 * a surface that quietly relaxed it would be re-deciding — in the render layer,
 * invisibly — the one question this milestone's locked decision 3 settled.
 */
export const NUTRIENT_COVERAGE_THRESHOLD = DEFAULT_MIN_COVERAGE_FRACTION;

/** Selectable windows, in days — the same three `/trends` offers, so the two screens agree on what "a window" is. */
const ALLOWED_RANGES = [7, 14, 30] as const;
type NutrientRange = (typeof ALLOWED_RANGES)[number];
const DEFAULT_RANGE: NutrientRange = 7;

/** How many nutrients get a suggestion block. Three is a shortlist; eighteen would be a catalogue nobody reads. */
const SUGGESTION_NUTRIENT_LIMIT = 3;
/** Foods shown per suggested nutrient. */
const SUGGESTION_FOOD_LIMIT = 4;

/** Parses an explicit `range` search param, falling back to the default on anything invalid. */
function parseRange(raw: string | null): NutrientRange {
  const value = Number(raw);
  return ALLOWED_RANGES.find((allowed) => allowed === value) ?? DEFAULT_RANGE;
}

//////////////////////////////////////////////////////////////////////////////
// Server loader — none needed (this route's data is entirely on-device plus a
// public, person-independent reference table fetched from the client)
//////////////////////////////////////////////////////////////////////////////

/** No server work. Present so an offline client-side navigation resolves without a `.data` fetch. */
export async function loader() {
  return {};
}

//////////////////////////////////////////////////////////////////////////////
// Client loader
//////////////////////////////////////////////////////////////////////////////

/** One nutrient's food suggestions, already filtered against the person's tracking focus. */
export interface NutrientSuggestion {
  key: NutrientKey;
  foods: NutrientSourceFood[];
}

export interface NutrientsData {
  rows: NutrientRow[];
  suggestions: NutrientSuggestion[];
  range: NutrientRange;
  fromDate: string;
  toDate: string;
  /** Days in the window carrying at least one entry — the denominator behind every per-day figure. */
  loggedDays: number;
  /** Entries logged across the window. `0` is the empty state. */
  totalEntries: number;
  /** True once both `biologicalSex` and `birthYear` are stored — the two a reference amount needs. */
  hasReferenceMetrics: boolean;
}

export async function clientLoader({ request }: Route.ClientLoaderArgs): Promise<NutrientsData> {
  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  const toDate = todayInTimezone(timezone);
  const range = parseRange(new URL(request.url).searchParams.get('range'));
  const fromDate = shiftDate(toDate, -(range - 1));

  const window = computeMicronutrientsInWindow(
    await listLocalFoodLogs(),
    { fromDate, toDate },
    {
      minCoverageFraction: NUTRIENT_COVERAGE_THRESHOLD,
    },
  );

  // Fail-open: `[]` here (API off, offline, upstream down) means every row
  // reports "no published reference" and the screen still shows the log.
  const references = await fetchNutrientReferenceList();
  const metrics = readBodyMetrics(profile);
  const rows = buildNutrientRows({
    byNutrient: window.byNutrient,
    loggedDays: window.loggedDays,
    references,
    metrics,
    // The user's own calendar year, taken from their local today rather than
    // the device clock's UTC year — the same instant is two different years for
    // a few hours every 31 December.
    currentYear: Number(toDate.slice(0, 4)),
  });

  const trackingFocus = profile?.trackingFocus ?? null;
  const suggestions = await Promise.all(
    pickLightestNutrients(rows, { limit: SUGGESTION_NUTRIENT_LIMIT }).map(async (row) => {
      const slug = NUTRIENT_SLUGS[row.key];
      const foods = slug === undefined ? [] : await fetchNutrientSources(slug);
      return {
        key: row.key,
        foods: filterSuggestions(foods, { trackingFocus }).slice(0, SUGGESTION_FOOD_LIMIT),
      };
    }),
  );

  return {
    rows,
    suggestions,
    range,
    fromDate,
    toDate,
    loggedDays: window.loggedDays,
    totalEntries: window.totalEntries,
    hasReferenceMetrics: metrics.biologicalSex !== null && metrics.birthYear !== null,
  };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads the log from the on-device primary store. */
export function HydrateFallback(): ReactElement {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('nutrients.loading')}
    </output>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Shared bits
//////////////////////////////////////////////////////////////////////////////

/** The window picker — a search param, like `/trends`, so the choice survives a reload and is shareable. */
function RangeControls({ range }: { range: NutrientRange }): ReactElement {
  const { t } = useTranslation();
  const labelKeys = {
    7: 'nutrients.range.week',
    14: 'nutrients.range.twoWeeks',
    30: 'nutrients.range.month',
  } satisfies Record<NutrientRange, string>;

  return (
    <fieldset className="flex flex-wrap gap-1" aria-label={t('nutrients.range.group')}>
      {ALLOWED_RANGES.map((option) => (
        <Button key={option} asChild size="sm" variant={range === option ? 'default' : 'outline'}>
          <Link to={`?range=${option}`} preventScrollReset aria-current={range === option ? 'true' : undefined}>
            {t(labelKeys[option])}
          </Link>
        </Button>
      ))}
    </fieldset>
  );
}

/**
 * The one-line footnote under a row: which segment the reference amount came
 * from and who published it — or the specific reason there is none.
 *
 * The source is always rendered alongside the number. An unsourced reference
 * intake reads as invented, and this screen's whole claim to be honest rests on
 * the reader being able to see where its numbers come from.
 */
function ReferenceFootnote({ reference }: { reference: ReferenceAmount }): ReactElement | null {
  const { t } = useTranslation();

  // Said ONCE, in the hero, not sixteen times down the list (DESIGN.md §10.7,
  // one phrasing per idea): with no body metrics EVERY row is in this state, so
  // a per-row prompt would be the same sentence repeated until it reads as
  // nagging — which is precisely the growth dark pattern this screen is
  // supposed to avoid being.
  if (reference.kind === 'no-body-metrics') return null;

  if (reference.kind === 'age-out-of-bands') {
    return <p className="text-xs text-muted-foreground">{t('nutrients.reference.ageOutOfBands')}</p>;
  }
  if (reference.kind === 'not-published') {
    return <p className="text-xs text-muted-foreground">{t('nutrients.reference.notPublished')}</p>;
  }

  const segment =
    reference.segment.kind === 'pregnancy' ? t('nutrients.reference.segmentPregnancy')
    : reference.segment.kind === 'lactation' ? t('nutrients.reference.segmentLactation')
    : t('nutrients.reference.segmentSexAge', {
        sex: t(`bodyMetrics.sex.${reference.segment.sex}`),
        band: t(`nutrients.band.${reference.segment.band}`),
      });

  return (
    <p className="text-xs text-muted-foreground">
      {t('nutrients.reference.footnote', { segment, source: reference.source })}
    </p>
  );
}

/**
 * The share bar. Rendered ONLY when both sides of the ratio are real AND the
 * reference is a target — no bar is the "not enough data" state, deliberately,
 * because an empty bar still reads as a measured zero, and a bar filling
 * towards a CEILING would read as progress towards something worth reaching
 * (see `LimitReading`).
 *
 * `bg-primary` at every share, never amber and never red: this compares a log
 * to a published amount, and colouring the low end would turn a data gap into a
 * verdict about the person (DESIGN.md §10.1).
 */
function ShareBar({ share }: { share: number }): ReactElement {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15" aria-hidden="true">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(share, 1) * 100}%` }} />
    </div>
  );
}

//////////////////////////////////////////////////////////////////////////////
// The nutrient list
//////////////////////////////////////////////////////////////////////////////

/**
 * A ceiling row's one-line reading of the log against the published limit.
 *
 * It replaces the percentage pill and the share bar rather than joining them,
 * and that swap IS the design: both of those say "progress towards", which is
 * the wrong sentence about a bound nobody is trying to reach — a bar at 40%
 * of a sodium ceiling reads as being 60% short of something good.
 *
 * Neither state is coloured. Being under is the good state and being over is
 * the notable one, so the only difference is weight: `text-foreground` above
 * the limit against `text-muted-foreground` below it. Amber (the app's "over
 * goal" signal) was deliberately not reused — it grades a day, and this line
 * may only report a fact about the log (DESIGN.md §10.1, M135 locked
 * decision 2).
 */
function LimitReading({ isAbove }: { isAbove: boolean }): ReactElement {
  const { t } = useTranslation();

  return (
    <p className={isAbove ? 'text-xs font-medium text-foreground' : 'text-xs text-muted-foreground'}>
      {isAbove ? t('nutrients.limit.over') : t('nutrients.limit.under')}
    </p>
  );
}

function NutrientListRow({ row }: { row: NutrientRow }): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const language = i18next.language;
  const name = t(`nutrients.name.${row.key}`);

  // A ceiling (sodium today) answers "have you stayed under?", not "have you
  // had enough?" — so it gets the limit vocabulary end to end: a badge on the
  // name, "of a … limit" instead of "of …", and a plain-language reading in
  // place of the percentage and the bar.
  const isCeiling = row.referenceKind === 'ceiling';
  const hasLimitReading = isCeiling && row.reference.kind === 'available' && row.share !== null;

  const figure =
    row.perDayAmount === null ?
      null
    : t('nutrients.amount.perDay', {
        amount: formatNutrientAmount(row.perDayAmount, { language }),
        unit: row.unit,
      });
  const target =
    row.reference.kind === 'available' ?
      t(isCeiling ? 'nutrients.amount.ofLimit' : 'nutrients.amount.ofReference', {
        amount: formatNutrientAmount(row.reference.amount, { language }),
        unit: row.unit,
      })
    : null;

  return (
    <div className="space-y-1.5 border-b border-border/60 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {name}
          {isCeiling && (
            <Badge variant="outline" className="border-border bg-muted px-1.5 py-0 text-muted-foreground">
              {t('nutrients.limit.badge')}
            </Badge>
          )}
        </span>
        {figure === null ?
          <span className="text-xs font-medium text-muted-foreground">{t('nutrients.coverage.notEnoughData')}</span>
        : <span className="text-sm tabular-nums">
            <span className="font-semibold">{figure}</span>
            {target !== null && <span className="text-muted-foreground"> {target}</span>}
            {/* Percentage on targets only — see `LimitReading`. */}
            {!isCeiling && row.share !== null && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {formatSharePercent(row.share, { language })}
              </span>
            )}
          </span>
        }
      </div>

      {!isCeiling && row.share !== null && <ShareBar share={row.share} />}
      {hasLimitReading && <LimitReading isAbove={isAboveReferenceLimit(row)} />}

      {figure === null ?
        <p className="text-xs text-muted-foreground">
          {t('nutrients.coverage.notEnoughDataDetail', {
            share: formatSharePercent(row.intake.coveredFraction, { language }),
          })}
        </p>
      : <ReferenceFootnote reference={row.reference} />}

      {/* Beta-carotene under vitamin A: context, never a second target. See
          `NUTRIENT_CONTEXT_OF` for the RAE arithmetic behind that decision. */}
      {row.context.map((context) =>
        context.perDayAmount === null ?
          null
        : <p key={context.key} className="text-xs text-muted-foreground">
            {t(`nutrients.context.${context.key}`, {
              amount: formatNutrientAmount(context.perDayAmount, { language }),
              unit: context.unit,
            })}
          </p>,
      )}
    </div>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Suggestions
//////////////////////////////////////////////////////////////////////////////

function SuggestionFoodRow({ food, unit }: { food: NutrientSourceFood; unit: string }): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const amount = t('nutrients.suggestions.per100g', {
    amount: formatNutrientAmount(food.value, { language: i18next.language }),
    unit,
  });

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">
        {food.url === null ?
          food.title
        : <a
            href={food.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            {food.title}
          </a>
        }
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{amount}</span>
    </div>
  );
}

function SuggestionsCard({
  suggestions,
  rows,
}: {
  suggestions: NutrientSuggestion[];
  rows: NutrientRow[];
}): ReactElement | null {
  const { t } = useTranslation();
  const withFoods = suggestions.filter((suggestion) => suggestion.foods.length > 0);
  if (withFoods.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('nutrients.suggestions.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">{t('nutrients.suggestions.lead')}</p>
        {withFoods.map((suggestion) => {
          const row = rows.find((candidate) => candidate.key === suggestion.key);
          return (
            <div key={suggestion.key} className="space-y-1">
              <SectionEyebrow>
                {t('nutrients.suggestions.forNutrient', { nutrient: t(`nutrients.name.${suggestion.key}`) })}
              </SectionEyebrow>
              {suggestion.foods.map((food) => (
                <SuggestionFoodRow key={food.slug} food={food} unit={row?.unit ?? ''} />
              ))}
            </div>
          );
        })}
        {/* The attribution these foods' sources require, said once for the
            block rather than repeated on every row. */}
        <p className="text-xs text-muted-foreground">{t('nutrients.suggestions.source')}</p>
      </CardContent>
    </Card>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Page
//////////////////////////////////////////////////////////////////////////////

export default function Nutrients({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { rows, suggestions, range, loggedDays, totalEntries, hasReferenceMetrics } = loaderData;

  const withData = rows.filter((row) => row.intake.hasEnoughData).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* The screen's single brand-filled hero (DESIGN.md §2 — one per screen). */}
      <Card className="surface-brand overflow-hidden rounded-2xl border-primary/30 shadow-md">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="space-y-1.5">
            <SectionEyebrow>{t('nutrients.hero.eyebrow')}</SectionEyebrow>
            {totalEntries === 0 ?
              <p className="text-lg font-semibold">{t('nutrients.hero.empty')}</p>
            : <>
                <p className="text-3xl font-semibold tabular-nums tracking-tight">
                  {t('nutrients.hero.covered', { covered: withData, total: rows.length })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('nutrients.hero.loggedDays', { logged: loggedDays, days: range })}
                </p>
              </>
            }
          </div>

          <RangeControls range={range} />

          <p className="text-xs text-muted-foreground">{t('nutrients.coverage.why')}</p>

          {!hasReferenceMetrics && (
            <p className="text-xs text-muted-foreground">
              {t('nutrients.hero.addDetails')}{' '}
              <Link to="/settings/goals" className="font-medium text-primary underline-offset-4 hover:underline">
                {t('nutrients.reference.noBodyMetricsAction')}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <SuggestionsCard suggestions={suggestions} rows={rows} />

      <Card>
        <CardHeader>
          <CardTitle>{t('nutrients.list.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {totalEntries === 0 ?
            <p className="text-sm text-muted-foreground">{t('nutrients.list.empty')}</p>
          : <div>
              {rows.map((row) => (
                <NutrientListRow key={row.key} row={row} />
              ))}
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}
