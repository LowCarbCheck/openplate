/**
 * ONE builder for the goals an adherence surface grades a day against.
 *
 * Three screens now paint a day by how many goals it met: the dashboard's
 * 13-week grid, the same grid on `/trends`, and the diary's calendar popover.
 * A day must carry one verdict across all three, so the arithmetic behind that
 * verdict is written once, here, rather than three times in three loaders.
 *
 * The arithmetic is small and entirely about energy. `netCarbsCeilingG` and
 * `proteinFloorG` are the figures the person typed in and pass through
 * untouched. `kcalTarget` does not: somebody pregnant or breastfeeding is
 * compared against their own target PLUS the EFSA energy addition for their
 * stage (`computeReferenceKcalAddition`), which is the same DISPLAYED figure
 * the day's budget rows use. Grading against the stored figure instead would
 * mark every day of a pregnancy as over target while the rows above the grid
 * said the day was fine.
 *
 * Nothing is written back. `goalKcalTarget` in the store stays the number the
 * person set; the addition exists only for as long as a screen is rendering.
 *
 * Pure, and it reads no clock: `today` comes in as the caller's device-local
 * day key, exactly as `#app/lib/reproductive-stage` requires. The resolved
 * `stage` comes back out because both diary and dashboard need it again for
 * the protein reference and its missing-date tag, and resolving it twice is
 * how the two screens would drift apart.
 */
import type { AdherenceGoals } from '#app/models/adherence-grid';
import { computeReferenceKcalAddition } from '#app/models/body-metrics';
import type { BodyMetrics, ReproductiveStageInput } from '#app/models/body-metrics';
import { resolveGestation, resolveLactationMonths } from '#app/lib/reproductive-stage';

/** The three targets as the profile stores them, before any adjustment. */
export interface StoredGoalTargets {
  netCarbsCeiling: number | null;
  proteinFloor: number | null;
  kcalTarget: number | null;
}

/** The dates and status the stage is resolved from. A structural subset of `BodyMetrics`. */
export type ReproductiveDates = Pick<
  BodyMetrics,
  'reproductiveStatus' | 'pregnancyDueDate' | 'lactationStartDate'
>;

export interface ResolvedAdherenceGoals {
  /** What an adherence surface grades against, calorie addition already applied. */
  goals: AdherenceGoals;
  /** The stage the addition came from, for the caller's protein reference and its tag. */
  stage: ReproductiveStageInput;
  /** The DISPLAYED calorie target: the stored one plus the EFSA addition, or the stored one unchanged. Repeated off `goals` so a caller that only needs the figure does not reach through the graded set for it. */
  kcalTarget: number | null;
}

/**
 * The goals an adherence surface grades against, plus the intermediates the
 * caller still needs.
 *
 * @param goals - the three targets as stored.
 * @param bodyMetrics - the reproductive status and its two dates.
 * @param today - the caller's device-local `YYYY-MM-DD` day key.
 * @returns the graded goals, the resolved stage and the displayed calorie target.
 */
export function resolveAdherenceGoals({
  goals,
  bodyMetrics,
  today,
}: {
  goals: StoredGoalTargets;
  bodyMetrics: ReproductiveDates;
  today: string;
}): ResolvedAdherenceGoals {
  const stage: ReproductiveStageInput = {
    reproductiveStatus: bodyMetrics.reproductiveStatus,
    trimester: resolveGestation({ dueDate: bodyMetrics.pregnancyDueDate, today })?.trimester ?? null,
    lactationMonths: resolveLactationMonths({ startDate: bodyMetrics.lactationStartDate, today }),
  };
  const kcalAddition = computeReferenceKcalAddition(stage);
  const kcalTarget =
    goals.kcalTarget === null || kcalAddition === null ? goals.kcalTarget : goals.kcalTarget + kcalAddition;
  return {
    goals: {
      netCarbsCeilingG: goals.netCarbsCeiling,
      proteinFloorG: goals.proteinFloor,
      kcalTarget,
    },
    stage,
    kcalTarget,
  };
}
