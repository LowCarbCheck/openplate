/**
 * The weekly recap card that sits above the chart: this Monday→Sunday week vs.
 * last week, phrased kindly (no scolding, everything hedged with "~" and whole
 * grams). Presentational only — all numbers arrive pre-aggregated from the pure
 * recap/weight/eating-window libs. Weight is shown as a raw first→last delta and
 * explicitly labelled noisy; no smoothing is implied here.
 */
import { Trans, useTranslation } from 'react-i18next';
import type { WeeklyRecap } from '#app/lib/trend-recap';
import type { WeeklyWeightChange } from '#app/lib/trend-weight';
import type { EatingWindow } from '#app/lib/trend-eating-window';
import type { MacroRatioGrams } from '#app/lib/macro-ratio';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { MacroRatioBar, MACRO_SWATCH_CLASS } from '#app/components/macro-ratio-bar';
import { SectionEyebrow } from '#app/components/typography';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';

/** Minutes in an hour, for the eating-window duration split. */
const MINUTES_PER_HOUR = 60;

/**
 * The narrow slice of i18next's `t` the module-scope formatters need — they are
 * called during render, not from a component body, so `t` is threaded in.
 */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** The goals that gate the optional recap lines (a null goal hides its line). */
interface RecapGoals {
  netCarbsCeiling: number | null;
  proteinFloor: number | null;
}

/** Whole-gram, "~"-hedged rendering of an average grams value. */
function formatGrams(value: number): string {
  return `~${Math.round(value)} g`;
}

/** A signed whole-gram delta, e.g. `+6 g` / `−4 g` / `no change`. */
function formatGramsDelta(value: number, t: Translate): string {
  const rounded = Math.round(value);
  if (rounded === 0) return t('trends.recap.noChange');
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} g`;
}

/** A signed one-decimal kilogram delta, e.g. `+0.4 kg` / `−0.5 kg` / `no change`. */
function formatKgDelta(value: number, t: Translate, language: string): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return t('trends.recap.noChange');
  return `${rounded > 0 ? '+' : '−'}${formatMacroNumberIn(language, Math.abs(rounded))} kg`;
}

/** Minutes → a compact `Hh Mm` (or `Mm` / `Hh`) duration. */
function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const mins = total % MINUTES_PER_HOUR;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * The headline average-net-carbs line, with a neutral vs.-last-week comparison.
 *
 * `Trans` rather than a split pair of keys: the bolded figure sits mid-sentence
 * in English but German may want it elsewhere, and only a whole-sentence key
 * lets a translator move it.
 */
function AverageLine({ current, previous }: { current: WeeklyRecap; previous: WeeklyRecap }) {
  const { t } = useTranslation();

  if (current.avgNetCarbs === null) {
    return <p className="text-sm text-muted-foreground">{t('trends.recap.noEntries')}</p>;
  }
  const hasComparison = previous.avgNetCarbs !== null;
  return (
    <p className="text-sm">
      <Trans
        i18nKey="trends.recap.averaged"
        values={{ value: formatGrams(current.avgNetCarbs) }}
        components={{ strong: <span className="font-semibold tabular-nums" /> }}
      />
      {hasComparison && (
        <span className="text-muted-foreground">
          {' '}
          {t('trends.recap.vsLastWeek', {
            delta: formatGramsDelta(current.avgNetCarbs - (previous.avgNetCarbs ?? 0), t),
          })}
        </span>
      )}
      .
    </p>
  );
}

/** Render order + label keys for the average-day figures — the same order `MacroRatioBar` draws its segments in. */
const AVERAGE_DAY_MACROS: { key: keyof MacroRatioGrams; labelKey: string }[] = [
  { key: 'carbs', labelKey: 'trends.recap.macro.carbs' },
  { key: 'fiber', labelKey: 'trends.recap.macro.fiber' },
  { key: 'protein', labelKey: 'trends.recap.macro.protein' },
  { key: 'fat', labelKey: 'trends.recap.macro.fat' },
];

/**
 * "An average day" — the week's composition as the spec-01 `MacroRatioBar`
 * (M129/04). This card was text-only, which meant the one thing a week of
 * logging is actually good for — the SHAPE of a typical day — had to be
 * reconstructed in the reader's head from a list of sentences. The bar shows it
 * at a glance; the labelled figures under it keep the meaning off hue alone and
 * give the honest grams the bar's widths can only imply.
 */
function AverageDayComposition({ grams }: { grams: MacroRatioGrams }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 pt-1">
      <SectionEyebrow>{t('trends.recap.averageDay')}</SectionEyebrow>
      <MacroRatioBar grams={grams} className="h-2.5" />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {AVERAGE_DAY_MACROS.map((macro) => (
          <span key={macro.key} className="inline-flex items-center gap-1.5 tabular-nums">
            <span className={`h-2 w-2 rounded-full ${MACRO_SWATCH_CLASS[macro.key]}`} aria-hidden="true" />
            {t(macro.labelKey)} {formatGrams(grams[macro.key])}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The recap card.
 *
 * @param current - this week's aggregated stats.
 * @param previous - last week's stats (for the comparison line).
 * @param weight - raw first→last weight change this week, or null.
 * @param eatingWindow - median eating-window span this week, or null.
 * @param goals - the goals gating the ceiling / protein lines.
 */
export function WeeklyRecapCard({
  current,
  previous,
  weight,
  eatingWindow,
  goals,
}: {
  current: WeeklyRecap;
  previous: WeeklyRecap;
  weight: WeeklyWeightChange | null;
  eatingWindow: EatingWindow | null;
  goals: RecapGoals;
}) {
  const ceiling = goals.netCarbsCeiling;
  const proteinFloor = goals.proteinFloor;
  const { t, i18n } = useTranslation();
  return (
    // Brand hero surface (M129/01) — trends' equivalent of the diary's totals
    // card: the one card on this page worth visually leading with, and it
    // uses the exact same treatment as that card (`surface-brand` + the
    // brand-tinted border + a real shadow) so "this is the hero" means one
    // consistent thing across the app rather than a different flat tint per
    // page.
    <Card className="surface-brand overflow-hidden rounded-2xl border-primary/30 shadow-md">
      <CardHeader>
        <CardTitle className="text-lg">{t('trends.recap.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <AverageLine current={current} previous={previous} />

        {current.avgMacroGrams !== null && <AverageDayComposition grams={current.avgMacroGrams} />}

        {ceiling !== null && current.daysUnderCeiling !== null && current.loggedDays > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('trends.recap.underGoal', {
              days: current.daysUnderCeiling,
              total: current.loggedDays,
              goal: formatMacroNumberIn(i18n.language, ceiling),
            })}
          </p>
        )}

        {proteinFloor !== null && current.daysHitProteinFloor !== null && current.loggedDays > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('trends.recap.metProtein', {
              days: current.daysHitProteinFloor,
              total: current.loggedDays,
              goal: formatMacroNumberIn(i18n.language, proteinFloor),
            })}
          </p>
        )}

        {weight !== null && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('trends.recap.weight', {
              first: formatMacroNumberIn(i18n.language, weight.firstKg),
              last: formatMacroNumberIn(i18n.language, weight.lastKg),
              delta: formatKgDelta(weight.deltaKg, t, i18n.language),
            })}{' '}
            <span className="text-xs">{t('trends.recap.weightNoisy')}</span>
          </p>
        )}

        {/*
          M123/07: `estimateShare` is mathematically honest — 0 is a real,
          computed "you didn't use AI estimation this week" answer, not a
          missing value (see trend-recap.ts's doc comment). But surfacing
          "~0% of this week's calories are AI-estimated" to someone who has
          never touched the scan feature (i.e. everyone, by default) reads as
          a broken/empty stat, not information. Only worth a line when there
          is something to actually report: some AI-estimated share this week.
        */}
        {current.estimateShare !== null && current.estimateShare > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('trends.recap.estimateShare', { percent: Math.round(current.estimateShare * 100) })}
          </p>
        )}

        {eatingWindow !== null && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('trends.recap.eatingWindow', {
              duration: formatDuration(eatingWindow.medianSpanMinutes),
              days: eatingWindow.loggedDayCount,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
