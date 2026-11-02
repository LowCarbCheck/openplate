/**
 * THE HERO for a person with no paid plan (2026-11-02).
 *
 * The free tier is the standard path, so this is where a person decides. It says
 * where they stand in their own numbers: a headline, one honest sentence, and a
 * meter from the real count (`plan-meter.ts`). A locked person reads why it is
 * locked and that their data stays theirs, in the same place.
 *
 * ── THE METER'S BOX IS ALWAYS THERE ──────────────────────────────────────
 *
 * No quota read means no meter and no invented number, and the box stays,
 * `invisible` with its lines reserved, so a figure that arrives moves nothing
 * under it (DESIGN.md section 7). The bar is flat, square and teal, and never
 * amber: amber means over a ceiling, and using an allowance is not that.
 *
 * Props only, apart from `t`, so every state renders in a unit test.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { describeQuotaReset } from '#app/lib/plans/ai-quota';
import { meterPercent, type HeroMeter, type MeterBasis } from '#app/lib/plans/plan-meter';
import { cn } from '#app/lib/utils';

/** The meter's sentence per basis. A `Record`, so a new basis fails to compile here. */
const METER_KEY = {
  'trial-scans': 'plan.meter.scans',
  week: 'plan.meter.week',
  day: 'plan.meter.day',
} satisfies Record<MeterBasis, string>;

/** A non-breaking space, so a reserved line keeps its height with nothing in it. */
const EMPTY_LINE = ' ';

/** The sentence, the bar and when it starts again, or the same box with nothing in it. */
export function PlanMeter({ meter }: { meter: HeroMeter | null }) {
  const { t, i18n } = useTranslation();
  const reset =
    meter === null || meter.resetsAt === null || meter.basis === 'trial-scans' ?
      null
    : describeQuotaReset({
        period: meter.basis,
        resetsAt: meter.resetsAt,
        language: i18n.resolvedLanguage ?? i18n.language,
        t,
      });
  const percent = meter === null ? 0 : meterPercent(meter);
  const sentence = meter === null ? null : t(METER_KEY[meter.basis], { used: meter.used, count: meter.limit });
  return (
    <div
      data-slot="plan-meter"
      data-state={meter === null ? 'empty' : 'read'}
      aria-hidden={meter === null}
      className={cn('flex flex-col gap-2', meter === null && 'invisible')}
    >
      <p data-slot="plan-meter-sentence" className="min-h-10 text-sm font-medium tabular-nums @2xl:min-h-5">
        {sentence ?? EMPTY_LINE}
      </p>
      <div
        data-slot="plan-meter-bar"
        role={meter === null ? undefined : 'progressbar'}
        aria-valuemin={meter === null ? undefined : 0}
        aria-valuemax={meter === null ? undefined : meter.limit}
        aria-valuenow={meter === null ? undefined : meter.used}
        aria-label={sentence ?? undefined}
        className="h-2 w-full bg-muted"
      >
        <div data-slot="plan-meter-fill" className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p data-slot="plan-meter-reset" className={cn('min-h-10 text-sm text-muted-foreground @2xl:min-h-5', reset === null && 'invisible')}>
        {reset ?? EMPTY_LINE}
      </p>
    </div>
  );
}

export interface PlanHeroProps {
  /** The headline and the words under it: the hero's own, or why the app is locked. */
  children: ReactNode;
  meter: HeroMeter | null;
}

/** The one hero of the plan page (DESIGN.md section 2): the words on the left, the meter on the right. */
export function PlanHero({ children, meter }: PlanHeroProps) {
  return (
    <section data-slot="plan-hero" className="surface-brand @container border p-5 shadow-sm">
      <div className="flex flex-col gap-5 @2xl:flex-row @2xl:items-start @2xl:gap-10">
        <div className="min-w-0 flex-1 space-y-3">{children}</div>
        <div className="w-full shrink-0 @2xl:w-80">
          <PlanMeter meter={meter} />
        </div>
      </div>
    </section>
  );
}
