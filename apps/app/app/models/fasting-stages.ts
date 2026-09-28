/**
 * What is happening in the body right now, as a stage of the running fast.
 *
 * The `/fasting` screen shows one elapsed figure and one ring. That number
 * answers "how long", never "so what". This module is the "so what": six
 * non-overlapping stages keyed off elapsed hours, each with one plain sentence
 * the screen can show beside the clock. It is pure, it takes `elapsedMs` rather
 * than a clock, and it holds no copy, exactly like `models/fasting.ts` does.
 *
 * WHY KEYS AND NOT SENTENCES
 *
 * Every string here is a catalog key. The English text below is the intended
 * source copy for whoever adds `fasting.stages.*` to the locale bundle; German
 * is a translation of that, not of this comment. Holding the prose in the
 * module would put one language in the model and force the other through it.
 *
 * WHY THE SENTENCES HEDGE
 *
 * These hours are population averages from ordinary metabolic literature, not
 * a measurement of the person reading them. Someone eating low carb enters the
 * later stages sooner, sometimes hours sooner. So every sentence says what
 * TYPICALLY happens, `HEDGE_KEY` says so once more under the card, and nothing
 * here claims a benefit, a cure or a rate of fat loss. openplate is not allowed
 * to grade a body or to promise one an outcome (DESIGN.md section 10.1), and a
 * fasting stage card is the single easiest place in the app to break that.
 * `tests/unit/fasting-stages.test.ts` reads the block below back out of this
 * file and fails on claim words, so the rule survives an edit made in a hurry.
 *
 * INTENDED ENGLISH COPY BEGIN
 *
 * hedge: Averages, not a measurement of you. On low carb you move through the
 *   early stages sooner.
 * fed: Your body is still digesting your last meal.
 * early: Insulin falls and your body starts using stored liver sugar.
 * low-stores: Stored liver sugar is mostly used up for most people and fat
 *   burning rises.
 * rising-ketones: Blood ketones typically start climbing here, sooner if you
 *   already eat low carb.
 * ketosis: Many people reach measurable ketosis here and the brain runs more on
 *   ketones. Some animal studies suggest cell cleanup rises too; human evidence
 *   is limited.
 * extended: Beyond what most people practise. Anything past 72 hours is outside
 *   what this app can guide.
 *
 * INTENDED ENGLISH COPY END
 */

/** The six stage ids, in elapsed order. */
export type FastingStageId = 'fed' | 'early' | 'low-stores' | 'rising-ketones' | 'ketosis' | 'extended';

export interface FastingStage {
  id: FastingStageId;
  /** Elapsed hours at which this stage begins. The previous stage ends here. */
  startsAtHours: number;
  /** Catalog key for the short stage name. */
  nameKey: string;
  /** Catalog key for the one-sentence explanation. */
  sentenceKey: string;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/** How long a stage counts as newly entered, unless the caller says otherwise. */
export const FASTING_STAGE_FRESH_WINDOW_MS = 60 * 60 * 1000;

/** The single hedge line the stage card carries, under whichever stage is showing. */
export const HEDGE_KEY = 'fasting.stages.hedge';

function defineStage(id: FastingStageId, startsAtHours: number): FastingStage {
  return {
    id,
    startsAtHours,
    nameKey: `fasting.stages.${id}.name`,
    sentenceKey: `fasting.stages.${id}.sentence`,
  };
}

/**
 * The stages, ascending, contiguous and with no gap: each one runs from its own
 * `startsAtHours` up to the next one's, and `extended` runs to infinity. The
 * boundaries are the conventional ones, and 72 h is the same outer edge
 * `FAST_MAX_CUSTOM_HOURS` uses, for the same reason: past it the app would be
 * implying guidance it cannot give.
 */
export const FASTING_STAGES: readonly FastingStage[] = [
  defineStage('fed', 0),
  defineStage('early', 4),
  defineStage('low-stores', 12),
  defineStage('rising-ketones', 16),
  defineStage('ketosis', 24),
  defineStage('extended', 72),
];

/**
 * The stage an elapsed duration falls in. TOTAL, like `resolveFastTimeline`:
 * a negative elapsed (a device clock stepped forward mid-fast) reads as `fed`
 * rather than throwing, and anything past 72 h stays `extended` forever.
 *
 * @param elapsedMs - ms fasted so far.
 * @returns the one stage containing that instant.
 */
export function stageAt(elapsedMs: number): FastingStage {
  const hours = Math.max(0, elapsedMs) / MS_PER_HOUR;
  let current = FASTING_STAGES[0];
  for (const candidate of FASTING_STAGES) {
    if (hours >= candidate.startsAtHours) current = candidate;
  }
  return current;
}

/**
 * The stage after this one, or null for `extended`, there is nothing after the
 * last stage, and the caller renders "next up" only when this is non-null.
 *
 * @param current - the stage to step from.
 * @returns the following stage, or null at the end of the ladder.
 */
export function nextStageAfter(current: FastingStage): FastingStage | null {
  const index = FASTING_STAGES.findIndex((candidate) => candidate.id === current.id);
  if (index === -1) return null;
  return FASTING_STAGES[index + 1] ?? null;
}

/**
 * The instant a fast that began at `startAtMs` entered (or will enter) `stage`.
 * Lets the screen write "since 04:12" or "at 04:12" from a real wall clock
 * instead of a duration.
 *
 * @param startAtMs - the instant the fast counts from.
 * @param stage - the stage to locate.
 * @returns the epoch-ms of that stage's boundary.
 */
export function stageEnteredAtMs(startAtMs: number, stage: FastingStage): number {
  return startAtMs + stage.startsAtHours * MS_PER_HOUR;
}

/**
 * Whether the fast has only just entered this stage, which is what earns the
 * stage card its one moment of emphasis. `fed` is NEVER fresh: every fast opens
 * in it, so treating it as new would put a "something just happened" flourish on
 * the first hour of every single fast, which is the opposite of meaning
 * something.
 *
 * @param elapsedMs - ms fasted so far.
 * @param stage - the stage to test against.
 * @param freshWindowMs - how long counts as fresh; defaults to one hour.
 * @returns true only inside the window that starts at the stage boundary.
 */
export function isFreshStage(
  elapsedMs: number,
  stage: FastingStage,
  freshWindowMs: number = FASTING_STAGE_FRESH_WINDOW_MS,
): boolean {
  if (stage.id === 'fed') return false;
  const sinceBoundary = elapsedMs - stage.startsAtHours * MS_PER_HOUR;
  return sinceBoundary >= 0 && sinceBoundary < freshWindowMs;
}
