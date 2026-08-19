/**
 * The Progress page's weight chapter: a one-field quick log, three stat tiles,
 * the smoothed trend chart, and the readouts that make the chart legible
 * without hovering.
 *
 * The chart moved here from `/settings/goals` (one home per idea): Goals keeps
 * the entry form, the recent-weigh-ins list and delete; Progress gets the
 * story. The quick log is duplicated on purpose and only in the shallowest
 * sense — both routes parse the SAME schema
 * (`#app/lib/weight-log-schema`) and write through the same local-store
 * upsert, so a weigh-in logged here is byte-identical to one logged there.
 *
 * On a plain `bg-card`: this screen's one `.surface-brand` hero is
 * `WeeklyRecapCard` (DESIGN.md §2).
 */
import { useMemo, useState } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getFormProps, useForm } from '@conform-to/react';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { celebrationMessage } from '#app/lib/celebration';
import { exponentialMovingAverage, type DatedValue } from '#app/lib/ewma';
import { formatDayLabel } from '#app/lib/format-day-label';
import { formatMacroNumber, formatMacroNumberIn } from '#app/lib/format-macro-number';
import { cn } from '#app/lib/utils';
import { computeWeightProgress } from '#app/lib/weight-progress';
import { makeLogWeightSchema } from '#app/lib/weight-log-schema';
import {
  formatKgForDisplay,
  fromKg,
  parseDisplayWeightToKg,
  roundWeightForDisplay,
  toWeightSubmitValue,
  type WeightUnit,
} from '#app/lib/weight-units';
import { useCelebration } from '#app/hooks/use-celebration';
import { FieldError } from '#app/components/field-error';
import { SubmitButton } from '#app/components/submit-button';
import { WeightStatTiles } from '#app/components/trends/weight-stat-tiles';
import { WeightTrendChart, type WeightChartPoint } from '#app/components/weight/weight-trend-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';

interface WeightProgressCardProps {
  /** Weigh-ins in the 13-week window, ascending by date. */
  points: WeightChartPoint[];
  /** The user's target weight in kg, or null when none is set. */
  targetWeightKg: number | null;
  /** The user's current local day, `YYYY-MM-DD` — the chart's right edge. */
  today: string;
  /** Today's weigh-in in kg, or null — decides "Log" vs "Update". */
  todayWeightKg: number | null;
  /** The reader's display unit (device-local preference). */
  weightUnit: WeightUnit;
}

/**
 * The inline quick log: one unit-aware field and a submit. Posts to the route's
 * `clientAction`, which writes straight to the local store.
 */
function LogWeightForm({ todayWeightKg, weightUnit }: { todayWeightKg: number | null; weightUnit: WeightUnit }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<SubmissionResult<string[]>>();
  const isLogging = fetcher.state !== 'idle';

  // "Adjust state during render" (react.dev's "You Might Not Need an Effect"):
  // a landed save resets the field to the fresh value, a unit switch converts
  // whatever is currently typed in place. Same pattern as the goals page.
  const [synced, setSynced] = useState<{ unit: WeightUnit; todayWeightKg: number | null }>({
    unit: weightUnit,
    todayWeightKg,
  });
  const [weightText, setWeightText] = useState<string>(() => formatKgForDisplay(todayWeightKg, weightUnit));
  if (weightUnit !== synced.unit || todayWeightKg !== synced.todayWeightKg) {
    const dataChanged = todayWeightKg !== synced.todayWeightKg;
    const kgFromCurrentText = dataChanged ? todayWeightKg : parseDisplayWeightToKg(weightText, synced.unit);
    setSynced({ unit: weightUnit, todayWeightKg });
    setWeightText(formatKgForDisplay(kgFromCurrentText, weightUnit));
  }

  const [form, fields] = useForm({
    id: 'trends-log-weight',
    lastResult: fetcher.data,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeLogWeightSchema(t) });
    },
    defaultValue: { weightKg: todayWeightKg !== null ? formatMacroNumber(todayWeightKg) : '' },
  });

  // A filled-but-unreadable field submits its raw text so the schema answers
  // "Enter a valid number" rather than the misleading blank-field message.
  const weightKgForSubmit = toWeightSubmitValue(weightText, weightUnit);

  return (
    <fetcher.Form method="post" {...getFormProps(form)} className="flex flex-wrap items-center gap-2">
      <Label htmlFor={fields.weightKg.id} className="sr-only">
        {t('goals.weight.todayLabel', { unit: weightUnit })}
      </Label>
      <Input
        id={fields.weightKg.id}
        inputMode="decimal"
        placeholder={weightUnit === 'kg' ? t('goals.weight.placeholderKg') : t('goals.weight.placeholderLb')}
        value={weightText}
        onChange={(event) => setWeightText(event.target.value)}
        aria-describedby={fields.weightKg.errorId}
        aria-invalid={fields.weightKg.errors?.length ? true : undefined}
        className="h-11 w-24 tabular-nums sm:h-9"
      />
      <span className="text-sm text-muted-foreground">{weightUnit}</span>
      <input type="hidden" name={fields.weightKg.name} value={weightKgForSubmit} />
      <SubmitButton pending={isLogging} pendingLabel={t('goals.saving')} className="h-11 sm:h-9">
        {todayWeightKg !== null ? t('goals.weight.update') : t('goals.weight.log')}
      </SubmitButton>
      <FieldError id={fields.weightKg.errorId} errors={fields.weightKg.errors} />
    </fetcher.Form>
  );
}

/**
 * The weight card.
 *
 * @param points - weigh-ins in the window, ascending by date.
 * @param targetWeightKg - the user's target, or null.
 * @param today - the user's current local day.
 * @param todayWeightKg - today's weigh-in, or null.
 * @param weightUnit - the reader's display unit.
 */
export function WeightProgressCard({
  points,
  targetWeightKg,
  today,
  todayWeightKg,
  weightUnit,
}: WeightProgressCardProps) {
  const { t, i18n } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const entries = useMemo(
    (): DatedValue[] => points.map((point) => ({ date: point.date, value: point.weightKg })),
    [points],
  );
  const progress = useMemo(() => computeWeightProgress({ entries, targetWeightKg }), [entries, targetWeightKg]);
  const trend = useMemo(() => exponentialMovingAverage([...entries]), [entries]);

  // The food-milestone facts are the neutral values, not a claim: this card
  // reads weight, and `/diary` owns the logging milestones.
  const celebration = useCelebration({
    totalLogCount: 0,
    aiEstimatedLogCount: 0,
    loggedDaysInWindow: 0,
    windowDays: 0,
    weighInCount: entries.length,
    crossedTargetOnLatest: progress.crossedTargetOnLatest,
  });
  const isCelebrating = celebration === 'target-weight';

  const activePoint = activeIndex === null ? null : (points[activeIndex] ?? null);
  const activeTrend = activeIndex === null ? null : (trend[activeIndex] ?? null);

  return (
    <Card className={cn(isCelebrating && 'motion-safe:animate-celebrate')}>
      <CardHeader className="space-y-3">
        <div className="space-y-1">
          <CardTitle className="text-lg">{t('trends.weight.title')}</CardTitle>
          <CardDescription>{t('trends.weight.description')}</CardDescription>
        </div>
        <LogWeightForm todayWeightKg={todayWeightKg} weightUnit={weightUnit} />
      </CardHeader>
      <CardContent className="space-y-4">
        {points.length === 0 ?
          <p className="text-sm text-muted-foreground">{t('trends.weight.empty')}</p>
        : <WeightStatTiles progress={progress} unit={weightUnit} hasTarget={targetWeightKg !== null} />}

        {isCelebrating && <p className="text-sm font-medium">{celebrationMessage('target-weight', t)}</p>}

        <WeightTrendChart
          points={points}
          targetWeightKg={targetWeightKg}
          today={today}
          weightUnit={weightUnit}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
        />

        <p className="min-h-[1.25rem] text-xs tabular-nums text-muted-foreground">
          {activePoint !== null && activeTrend !== null ?
            [
              formatDayLabel(activePoint.date, i18n.language),
              `${_display(activePoint.weightKg, weightUnit, i18n.language)} ${weightUnit} ${t('trends.weight.point.raw')}`,
              `${_display(activeTrend.value, weightUnit, i18n.language)} ${weightUnit} ${t('trends.weight.point.trend')}`,
            ].join(' · ')
          : t('trends.weight.pointCaptionIdle')}
        </p>

        <p className="text-xs text-muted-foreground">{t('trends.weight.caption')}</p>
      </CardContent>
    </Card>
  );
}

/** A kilogram value in the reader's unit, rounded the way every weight in the app is. */
function _display(kg: number, unit: WeightUnit, language: string): string {
  return formatMacroNumberIn(language, roundWeightForDisplay(fromKg(kg, unit)));
}
