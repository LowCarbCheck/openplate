/**
 * The diary hero's headline stat — REMAINING-FIRST (M129/03).
 *
 * The old hero answered "how much have you eaten?". This one answers the
 * question people actually open the app with: "how much have I got left?".
 * `formatHeroStat` is the single pure function behind all four states, so the
 * exact wording is pinned by a test rather than by a screenshot:
 *
 * | state              | tier 1  | tier 2           | tier 3      |
 * | ------------------ | ------- | ---------------- | ----------- |
 * | under a carb goal  | `7.9`   | `g left of 50`   | `net carbs` |
 * | over a carb goal   | `12`    | `g over today`   | `net carbs` |
 * | under a kcal goal  | `620`   | `left of 1800`   | `calories`  |
 * | over a kcal goal   | `120`   | `over today`     | `calories`  |
 * | no goal at all     | `42.1`  | `g net carbs`    | —           |
 *
 * Three rules, all of them load-bearing:
 *
 * 1. **Remaining is never negative.** Going over flips the framing to "12 g
 *    over today" rather than rendering "-12 g left" — a negative budget is a
 *    scolding, and this app's over-goal treatment is amber and factual (see
 *    DESIGN.md §2b), never `--destructive`, never an exclamation.
 * 2. **Never a NaN, never a placeholder target.** A user with no ceiling and no
 *    calorie target gets their absolute net carbs and nothing invented on their
 *    behalf — the same discipline `#app/lib/macro-gaps` holds.
 * 3. **One stat, or one per goal.** `formatHeroStat` returns a SINGLE stat and
 *    carbs win it when both goals exist, which is what a caller with room for
 *    exactly one figure needs. `formatHeroStats` (M200 spec 02) returns one
 *    stat per goal the person actually set, so carbs and calories can be
 *    tracked together instead of one silently hiding the other.
 *
 * The formatter lives beside the markup deliberately: these strings are the
 * component's whole substance, and splitting them one directory away is how
 * copy and layout drift apart. Since M129/05 the strings themselves live in
 * the `diary.hero.*` catalog and `formatHeroStat` takes a `t` — the function
 * stays PURE and provider-free, which is what keeps the five framings pinned
 * by a unit test rather than by a screenshot.
 */
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { isOverCarbGoal, isOverKcalGoal } from '#app/lib/goal-progress';
import type { GoalRing } from '#app/lib/goal-rings';
import { selectGoalRings } from '#app/lib/goal-rings';
import { cn } from '#app/lib/utils';

/**
 * The i18next `t` shape this module needs, declared locally rather than
 * imported: taking the translator as a plain function is what lets the
 * formatter be driven from a test with no i18n instance in scope.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** Which of the five framings the hero is rendering. */
export type HeroStatMode = 'carbs-remaining' | 'carbs-over' | 'kcal-remaining' | 'kcal-over' | 'carbs-absolute';

/** What the hero needs from the day: the two totals, the two possible targets, and whether the figures are hedged. */
export interface HeroStatInput {
  netCarbs: number;
  /** The user's daily net-carb ceiling, or null when they set none. */
  netCarbsCeiling: number | null;
  kcal: number;
  /** The user's daily calorie target, or null when they set none. */
  kcalTarget: number | null;
  /** True when the day's totals include AI estimates — hedges the figure with a leading "~". */
  hasEstimates: boolean;
  /** The caller's translator. Passed in, never imported, so this stays a pure function. */
  t: Translate;
  /** Active UI language — the spoken labels carry formatted figures. Passed in for the same reason `t` is. */
  language: string | null | undefined;
}

export interface HeroStat {
  mode: HeroStatMode;
  /** True in the two over-goal modes — the caller paints amber, never destructive. */
  isOver: boolean;
  /** Tier 1: the big number, already hedged and formatted. */
  value: string;
  /** Tier 2: the unit plus what the number is measured against. */
  context: string;
  /** Tier 3: the metric's name, or null when tier 2 already says it. */
  unitLabel: string | null;
  /** The raw number tier 1 renders — what the count-up tween animates toward. */
  numericValue: number;
  /** A whole sentence for assistive tech and the ring's accessible name. */
  srLabel: string;
}

/** Calorie modes render whole numbers; gram modes keep the app's one-decimal rounding. */
function isKcalMode(mode: HeroStatMode): boolean {
  return mode === 'kcal-remaining' || mode === 'kcal-over';
}

/**
 * Formats a hero figure for a given mode. Exported so the count-up tween can
 * re-render intermediate values through exactly the same rounding and hedging
 * as the final one — an animation that formats differently from its own
 * destination visibly "snaps" on the last frame.
 *
 * @param numericValue - the (possibly mid-tween) figure to render.
 * @param mode - the hero framing, which decides gram vs whole-calorie rounding.
 * @param hasEstimates - whether to prefix the "~" estimate hedge.
 * @param language - the active UI language, for the decimal separator.
 * @returns the tier-1 string.
 */
export function formatHeroValue({
  numericValue,
  mode,
  hasEstimates,
  language,
}: {
  numericValue: number;
  mode: HeroStatMode;
  hasEstimates: boolean;
  language: string | null | undefined;
}): string {
  const hedge = hasEstimates ? '~' : '';
  return `${hedge}${isKcalMode(mode) ? String(Math.round(numericValue)) : formatMacroNumberIn(language, numericValue)}`;
}

/**
 * Builds the shared parts of a stat: the over-goal flag follows from the mode,
 * and the tier-1 string is formatted exactly once, here.
 */
function buildStat(
  parts: Omit<HeroStat, 'value' | 'isOver'>,
  { hasEstimates, language }: Pick<HeroStatInput, 'hasEstimates' | 'language'>,
): HeroStat {
  return {
    ...parts,
    isOver: parts.mode === 'carbs-over' || parts.mode === 'kcal-over',
    value: formatHeroValue({ numericValue: parts.numericValue, mode: parts.mode, hasEstimates, language }),
  };
}

/** The net-carb framing, under or over. `ceiling` is passed separately because it is known non-null here. */
function carbStat(input: HeroStatInput, netCarbsCeiling: number): HeroStat {
  const { netCarbs, t, language } = input;
  const ceiling = Math.round(netCarbsCeiling);
  // Over/under is decided by the SHARED rounded comparison, so the hero can
  // never say "over today" while the habit-strip dot for the same day reads
  // as met (`#app/lib/goal-progress`'s whole point).
  if (isOverCarbGoal({ netCarbs, ceiling: netCarbsCeiling })) {
    const overBy = netCarbs - netCarbsCeiling;
    return buildStat(
      {
        mode: 'carbs-over',
        context: t('diary.hero.overToday'),
        unitLabel: t('diary.hero.netCarbs'),
        numericValue: overBy,
        srLabel: t('diary.hero.srCarbsOver', { value: formatMacroNumberIn(language, overBy), ceiling }),
      },
      input,
    );
  }
  // `Math.max(0, …)` is belt-and-braces: sub-half-gram spillover reads as
  // "not over" above, and would otherwise land here as a negative remainder.
  const left = Math.max(0, netCarbsCeiling - netCarbs);
  return buildStat(
    {
      mode: 'carbs-remaining',
      context: t('diary.hero.leftOf', { ceiling }),
      unitLabel: t('diary.hero.netCarbs'),
      numericValue: left,
      srLabel: t('diary.hero.srCarbsLeft', { value: formatMacroNumberIn(language, left), ceiling }),
    },
    input,
  );
}

/** The calorie framing, under or over. Same shape as `carbStat`, in whole calories. */
function kcalStat(input: HeroStatInput, kcalTarget: number): HeroStat {
  const { kcal, t } = input;
  const target = Math.round(kcalTarget);
  // The same shared verdict the carb arm uses, for the same reason: the
  // calorie line in the drill-down and this hero must never disagree.
  if (isOverKcalGoal({ kcal, target: kcalTarget })) {
    const overBy = kcal - kcalTarget;
    return buildStat(
      {
        mode: 'kcal-over',
        context: t('diary.hero.kcalOverToday'),
        unitLabel: t('diary.hero.calories'),
        numericValue: overBy,
        srLabel: t('diary.hero.srKcalOver', { value: Math.round(overBy), target }),
      },
      input,
    );
  }
  const left = Math.max(0, kcalTarget - kcal);
  return buildStat(
    {
      mode: 'kcal-remaining',
      context: t('diary.hero.kcalLeftOf', { target }),
      unitLabel: t('diary.hero.calories'),
      numericValue: left,
      srLabel: t('diary.hero.srKcalLeft', { value: Math.round(left), target }),
    },
    input,
  );
}

/** The no-goal framing: the day's absolute net carbs, with nothing invented to measure them against. */
function absoluteStat(input: HeroStatInput): HeroStat {
  const { netCarbs, t, language } = input;
  return buildStat(
    {
      mode: 'carbs-absolute',
      context: t('diary.hero.absolute'),
      unitLabel: null,
      numericValue: netCarbs,
      srLabel: t('diary.hero.srAbsolute', { value: formatMacroNumberIn(language, netCarbs) }),
    },
    input,
  );
}

/**
 * Resolves the day into ONE remaining-first hero stat: the single-stat
 * framing, unchanged since M129/03 and still what a caller that wants exactly
 * one figure gets. Carbs win when both goals exist; that ordering is this
 * function's contract, not an accident, and `formatHeroStats` below is where a
 * caller goes for the second goal instead.
 *
 * @param input - the day's totals and the user's targets.
 * @returns the three display tiers, the over-goal flag, the raw figure, and a spoken sentence.
 */
export function formatHeroStat(input: HeroStatInput): HeroStat {
  const { netCarbsCeiling, kcalTarget } = input;
  if (netCarbsCeiling !== null && netCarbsCeiling > 0) return carbStat(input, netCarbsCeiling);
  if (kcalTarget !== null && kcalTarget > 0) return kcalStat(input, kcalTarget);
  return absoluteStat(input);
}

/**
 * Resolves the day into one stat PER VISIBLE RING (M200 spec 02), so carbs
 * and calories can be shown together for someone who set both targets.
 *
 * Which rings are visible comes from `#app/lib/goal-rings`, which reads the
 * goal values and never the stored `trackingFocus`. Rule 3 in this file's
 * header ("carbs win when both goals exist") still holds for `formatHeroStat`;
 * it was never a statement about what a person tracks, only about which single
 * figure fits in one ring.
 *
 * @param input - the day's totals and the user's targets.
 * @returns one stat per visible ring, carbs first; the absolute framing alone when no target is set.
 */
export function formatHeroStats(input: HeroStatInput): HeroStat[] {
  const { netCarbsCeiling, kcalTarget } = input;
  const stats: HeroStat[] = [];
  for (const ring of selectGoalRings({ netCarbsCeiling, kcalTarget })) {
    // The null re-checks are what the selector already guarantees, spelled out
    // so this reads without a type assertion.
    if (ring === 'net-carbs' && netCarbsCeiling !== null) stats.push(carbStat(input, netCarbsCeiling));
    if (ring === 'calories' && kcalTarget !== null) stats.push(kcalStat(input, kcalTarget));
  }
  if (stats.length === 0) return [absoluteStat(input)];
  return stats;
}

/** Carb goal modes draw their arc against the ceiling; the absolute framing draws no arc at all. */
function isCarbGoalMode(mode: HeroStatMode): boolean {
  return mode === 'carbs-remaining' || mode === 'carbs-over';
}

/** One visible ring: which metric it is, the stat inside it, and the two numbers its arc is drawn from. */
export interface HeroRing {
  metric: GoalRing;
  stat: HeroStat;
  /** What the day has used of the budget, the arc's numerator. */
  consumed: number;
  /** The budget itself. Always positive: `selectGoalRings` refuses a non-positive target. */
  max: number;
}

/**
 * The rings to draw for the day, one per goal the person set.
 *
 * The stat inside a ring and the arc around it are resolved together here so
 * they cannot come from different goals. A ring drawn against the calorie
 * target with the carb figure inside it would be a fabricated number, and
 * keeping the pairing in one function is what makes that unrepresentable.
 *
 * @param input - the day's totals and the user's targets.
 * @returns one ring per goal, carbs first; empty when the person set no target.
 */
export function formatHeroRings(input: HeroStatInput): HeroRing[] {
  const { netCarbs, netCarbsCeiling, kcal, kcalTarget } = input;
  const rings: HeroRing[] = [];
  for (const stat of formatHeroStats(input)) {
    if (isCarbGoalMode(stat.mode) && netCarbsCeiling !== null) {
      rings.push({ metric: 'net-carbs', stat, consumed: netCarbs, max: netCarbsCeiling });
    }
    if (isKcalMode(stat.mode) && kcalTarget !== null) {
      rings.push({ metric: 'calories', stat, consumed: kcal, max: kcalTarget });
    }
  }
  return rings;
}

/**
 * The three-tier stack itself — used both inside the ring and, at a larger
 * size, as the goal-less card's headline.
 *
 * Tier 1 is the only number that changes minute to minute, so it carries all
 * the weight; tiers 2 and 3 are fixed context and step down hard. Each tier is
 * its own element, so there is exactly one possible line-break arrangement and
 * it's the one drawn here.
 *
 * The headline size steps down for long values ("1240", "142.1") so a six-
 * character figure can't run into the ring's arc. Digits are `tabular-nums`;
 * the display serif deliberately never comes near this number (its subset has
 * no tabular figures — see DESIGN.md §4).
 *
 * `value` is passed in rather than read off `stat` so the caller can feed it a
 * mid-tween figure from `useCountUp` while every other tier stays fixed.
 */
export function HeroStat({
  stat,
  value,
  size = 'ring',
  className,
}: {
  stat: HeroStat;
  /** The tier-1 string to render — usually `stat.value`, or a tweened one mid-animation. */
  value: string;
  /** `ring` sits inside the 120px ring; `headline` is the goal-less card's larger left-aligned stack. */
  size?: 'ring' | 'headline';
  className?: string;
}) {
  const isLongValue = value.length >= 5;
  const valueSize =
    size === 'headline' ? 'text-3xl'
    : isLongValue ? 'text-2xl'
    : 'text-3xl';
  return (
    <div className={cn('flex flex-col', size === 'ring' ? 'items-center text-center' : 'items-start', className)}>
      <span
        className={cn(
          'font-semibold leading-none tracking-tight tabular-nums',
          valueSize,
          // Over-goal is amber and only amber. `--destructive` is off-limits
          // here by design: the day describes the food, not the person.
          stat.isOver ? 'text-accent-amber' : 'text-foreground',
        )}
      >
        {value}
      </span>
      <span
        className={cn(
          'mt-1.5 text-xs font-medium leading-none tabular-nums',
          stat.isOver ? 'text-accent-amber' : 'text-muted-foreground',
        )}
      >
        {stat.context}
      </span>
      {stat.unitLabel && (
        <span className="mt-1 text-[10px] font-medium uppercase leading-none tracking-[0.1em] text-muted-foreground">
          {stat.unitLabel}
        </span>
      )}
    </div>
  );
}
