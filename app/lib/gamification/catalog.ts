/**
 * The signal and award catalog (M235/01).
 *
 * The rules ship with the build, never with the data. openplate decides a badge
 * on a device that may never reach a server, so the store holds facts (which
 * day carried which signal) and outcomes (which key was earned), and every
 * rule that turns one into the other lives here, in code. That also means a
 * later round adds a signal or an award by adding a string to this file.
 *
 * Two properties of this module are load bearing and easy to break:
 *
 * - A signal id is PERMANENT. It is added, never renamed and never removed. A
 *   mark row's id embeds the signal (`marks.ts`), so a rename orphans every row
 *   already written on every device, and there is no server copy to repair them
 *   from.
 * - An award key is PERMANENT for the same reason: it is the row key of the
 *   award table. `awardDefinition` therefore returns undefined for a key it
 *   does not know instead of throwing, so an award minted by a newer build is
 *   held by an older one and simply not rendered.
 *
 * Nothing here imports the store, a clock or the i18next singleton. The catalog
 * carries i18n KEYS and the caller brings its own translator, the same seam
 * `celebration.ts` uses.
 */

/**
 * Every activity signal, in the order the awards screen lists them.
 *
 * Frozen as a tuple so `ActivitySignal` is derived from it and the two can
 * never drift apart.
 */
export const ACTIVITY_SIGNALS = [
  'log.food',
  'log.scan',
  'fast.run',
  'weight.log',
  'meal.repeat',
  'pantry.edit',
  'backup.export',
] as const;

/** One recordable act, as written into a mark row. */
export type ActivitySignal = (typeof ACTIVITY_SIGNALS)[number];

/**
 * Whether a signal makes its day count as an ACTIVE day.
 *
 * `backup.export` is the one that does not. A backup is housekeeping, and it is
 * the one act the app can plausibly prompt for (`backup-nudge.ts`), so counting
 * it would let the app hand a person a streak day for doing what the app asked.
 * The signal is still recorded, because the explorer award for trying an export
 * is honest, but it never extends the count.
 */
export const SIGNAL_COUNTS_TOWARD_ACTIVE = {
  'log.food': true,
  'log.scan': true,
  'fast.run': true,
  'weight.log': true,
  'meal.repeat': true,
  'pantry.edit': true,
  'backup.export': false,
} satisfies Record<ActivitySignal, boolean>;

/** The signals that make a day active, as a set, so a lookup by an unknown id is not a type error. */
const COUNTING_SIGNALS: ReadonlySet<string> = new Set(
  ACTIVITY_SIGNALS.filter((signal) => SIGNAL_COUNTS_TOWARD_ACTIVE[signal]),
);

/**
 * Whether a stored signal id makes its day active.
 *
 * Takes a plain `string` on purpose: a mark row's `signal` is widened to
 * `string` in the store so a mark written by a NEWER build survives on an older
 * one. An id this build does not know returns false, which under-counts rather
 * than over-counts. The other way round the app would be guessing that an
 * unknown signal is an active one, and a wrong guess there inflates a number a
 * person is being asked to trust.
 *
 * @param signal - the signal id as stored.
 * @returns whether the day carrying it counts as active.
 */
export function signalCountsTowardActive(signal: string): boolean {
  return COUNTING_SIGNALS.has(signal);
}

/** The three award families. They are separate counts, never one score. */
export type AwardKind = 'explorer' | 'streak' | 'onplan';

/** One award in the catalog. `key` is also its row key in the store, forever. */
export interface AwardDefinition {
  /** The permanent key, for example `explorer.log.food` or `streak.active.7`. */
  key: string;
  /** Which family it belongs to, which decides how it is evaluated. */
  kind: AwardKind;
  /** The signal that earns it. Set for `explorer` awards only. */
  signal?: ActivitySignal;
  /** The number of consecutive days that earn it. Set for `streak` and `onplan` awards only. */
  threshold?: number;
  /** i18n key for the short title. */
  titleKey: string;
  /** i18n key for the one-line note shown when it is earned. */
  noteKey: string;
}

/** Consecutive ACTIVE days that earn a streak award. */
const ACTIVE_STREAK_THRESHOLDS = [3, 7, 14, 30, 100] as const;

/**
 * Consecutive days at or under the net-carb ceiling that earn an on-plan award.
 *
 * It starts at 7, not 3, because this family is deliberately the quieter one:
 * the activity streak is the number a person sees, and staying under carbs is
 * its own, slower achievement rather than a second daily score.
 */
const ON_PLAN_THRESHOLDS = [7, 14, 30, 100] as const;

/** The i18n subtree every award's copy hangs under. See M235/07. */
const AWARD_COPY_PREFIX = 'awards';

/** The copy keys for an award, derived from its key so a new award cannot be added with the wrong ones. */
function titleKeyFor(key: string): string {
  return `${AWARD_COPY_PREFIX}.${key}.title`;
}

/** The note key for an award. Paired with `titleKeyFor`; see M235/07 for the subtree. */
function noteKeyFor(key: string): string {
  return `${AWARD_COPY_PREFIX}.${key}.note`;
}

/** The badge for having tried a function once. Key: `explorer.<signal>`, permanent. */
function explorerAward(signal: ActivitySignal): AwardDefinition {
  const key = `explorer.${signal}`;
  return { key, kind: 'explorer', signal, titleKey: titleKeyFor(key), noteKey: noteKeyFor(key) };
}

/** The badge for a run of active days. Key: `streak.active.<days>`, permanent. */
function activeStreakAward(threshold: number): AwardDefinition {
  const key = `streak.active.${threshold}`;
  return { key, kind: 'streak', threshold, titleKey: titleKeyFor(key), noteKey: noteKeyFor(key) };
}

/** The badge for a run of days at or under the carb ceiling. Key: `onplan.<days>`, permanent. */
function onPlanAward(threshold: number): AwardDefinition {
  const key = `onplan.${threshold}`;
  return { key, kind: 'onplan', threshold, titleKey: titleKeyFor(key), noteKey: noteKeyFor(key) };
}

/**
 * Every award, in the order a screen lists them: the explorer badges in signal
 * order, then the activity streak, then on-plan.
 *
 * Built from the tuples above rather than written out, so adding a signal or a
 * threshold cannot leave a half-declared award behind. The keys the builders
 * mint are still permanent strings: `explorer.<signal>`, `streak.active.<days>`
 * and `onplan.<days>`.
 */
export const AWARDS: readonly AwardDefinition[] = [
  ...ACTIVITY_SIGNALS.map(explorerAward),
  ...ACTIVE_STREAK_THRESHOLDS.map(activeStreakAward),
  ...ON_PLAN_THRESHOLDS.map(onPlanAward),
];

/** Every key this build knows. */
export const AWARD_KEYS: ReadonlySet<string> = new Set(AWARDS.map((award) => award.key));

/** Key to definition, built once. */
const AWARD_BY_KEY: ReadonlyMap<string, AwardDefinition> = new Map(AWARDS.map((award) => [award.key, award]));

/**
 * The definition behind an earned award row.
 *
 * Returns undefined, never throws, for a key this build does not know. The
 * store keeps award keys as free strings precisely so a row written by a newer
 * build survives an older one; a throw here would turn that survival into a
 * crash on the awards screen.
 *
 * @param key - the award key as stored.
 * @returns the definition, or undefined when this build does not know the key.
 */
export function awardDefinition(key: string): AwardDefinition | undefined {
  return AWARD_BY_KEY.get(key);
}
