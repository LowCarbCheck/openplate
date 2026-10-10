/**
 * The Overview hero's LEAD and LEDGER wording: the main goal as one large
 * figure, and every other row as a short status line.
 *
 * Layout F of the hero playground (operator decision, 2026-10-11). The lead is
 * the row `buildDayBudgetRows` already put first (`mainGoal`), read as an
 * answer to the question the person opened the app with:
 *
 * | the lead is            | the figure is   | the caption reads                         |
 * | ---------------------- | --------------- | ----------------------------------------- |
 * | under a limit          | what is LEFT    | "26 g net carbs left today"               |
 * | under a limit, no food | the whole limit | "100 g net carbs to spend today"          |
 * | over a limit           | the excess      | "12 g net carbs over today" (amber)       |
 * | under a floor          | what is NEEDED  | "14 g protein still needed"               |
 * | under a floor, no food | the whole floor | "68 g protein to reach today"             |
 * | a floor reached        | what was eaten  | "92 g protein, target reached" (a check)  |
 * | no target              | what was eaten  | "74 g net carbs today", and no meter      |
 *
 * NOTHING IS COMPUTED TWICE. The number in the figure is `row.gap.amount`, set
 * by the row builder from the figure its own headline was printed from. This
 * module only picks which of the seven states the row is in, formats the
 * number, and chooses the words. A remaining value subtracted here a second
 * time is how a lead would come to say "26" over a row that says "25.9".
 *
 * NEVER A FABRICATED TARGET. A row with no target (`gap.kind === 'none'`) states
 * what was eaten, draws no meter, and says so in the scale line. The header of
 * `#app/lib/day-budget-rows` holds the same rule for the rows.
 *
 * ONE FIGURE, ONE UNIT. The unit sits beside the figure ("1,950 kcal"), so the
 * calorie captions never repeat the noun: "left today", not "calories left
 * today" (which would read "1,950 kcal calories left today"). The grams
 * captions keep their noun because "26 g left today" would not say of what.
 *
 * Pure and provider free, like the module it reads: the translator and the
 * language come in as parameters, so every string is pinned by a unit test.
 */
import { formatMacroNumberIn, UNIT_SPACE } from '#app/lib/format-macro-number';
import { formatBudgetFigure } from '#app/lib/day-budget-rows';
import type { DayBudgetRow, DayBudgetRowKey, DayBudgetRowTone } from '#app/lib/day-budget-rows';
import type { Translate } from '#app/components/hero-stat';

/** The three metrics a person can pick as their main goal, and so the three a lead can be. */
export type HeroLeadMetric = 'netCarbs' | 'calories' | 'protein';

/** The states a lead under a LIMIT (net carbs, calories) can be in. */
type LimitLeadState = 'left' | 'spend' | 'over' | 'open';

/** The states a lead over a FLOOR (protein) can be in. */
type FloorLeadState = 'needed' | 'reach' | 'met' | 'open';

/** The unit printed beside the figure. Not translated: "g" and "kcal" read the same in all six languages. */
export type HeroLeadUnit = 'g' | 'kcal';

/** The catalog key for each limit lead's caption, by state. The wording lives in `diary.budget.lead.caption.*`. */
const LIMIT_CAPTION_KEY = {
  netCarbs: {
    left: 'diary.budget.lead.caption.netCarbs.left',
    spend: 'diary.budget.lead.caption.netCarbs.spend',
    over: 'diary.budget.lead.caption.netCarbs.over',
    open: 'diary.budget.lead.caption.netCarbs.open',
  },
  calories: {
    left: 'diary.budget.lead.caption.calories.left',
    spend: 'diary.budget.lead.caption.calories.spend',
    over: 'diary.budget.lead.caption.calories.over',
    open: 'diary.budget.lead.caption.calories.open',
  },
} satisfies Record<'netCarbs' | 'calories', Record<LimitLeadState, string>>;

/** The catalog key for the floor lead's caption, by state. */
const FLOOR_CAPTION_KEY = {
  needed: 'diary.budget.lead.caption.protein.needed',
  reach: 'diary.budget.lead.caption.protein.reach',
  met: 'diary.budget.lead.caption.protein.met',
  open: 'diary.budget.lead.caption.protein.open',
} satisfies Record<FloorLeadState, string>;

/** What the lead block draws. Every string is final: the component adds no wording of its own. */
export interface HeroLead {
  /** The row this lead reads, for the accessible `progress` element and the reference tag. */
  row: DayBudgetRow;
  metric: HeroLeadMetric;
  /** Amber past a limit, brand once a floor is reached, plain otherwise. The row's own tone. */
  tone: DayBudgetRowTone;
  /** The large figure, already formatted (and hedged with a "~" when the day holds AI estimates). */
  figure: string;
  unit: HeroLeadUnit;
  /** The words beside the figure: "net carbs left today". */
  caption: string;
  /** Eaten over target, clamped 0..1. Null when there is no target, which is also when no meter is drawn. */
  fraction: number | null;
  /** The scale line's left end: the empty-day line, or what was eaten and how many entries. */
  scaleStart: string;
  /** The scale line's right end: "limit 100 g", "target 68 g", "reference 68 g" or "no limit set". */
  scaleEnd: string;
}

export interface HeroLeadInput {
  /** The row to lead with: `rows[0]` of `buildDayBudgetRows`, built with the person's main goal. */
  row: DayBudgetRow;
  /** How many entries the day holds. Zero decides "to spend today" over "left today", and the empty-day line. */
  entryCount: number;
  /** True when the day includes AI estimates, which hedges a budget figure with a leading "~", as the rows do. */
  hasEstimates: boolean;
  t: Translate;
  language: string | null | undefined;
}

/** Narrows a row key to the three a lead can be. Throws for fat and fiber, which no main goal names. */
function leadMetricOf(key: DayBudgetRowKey): HeroLeadMetric {
  if (key === 'netCarbs' || key === 'calories' || key === 'protein') return key;
  throw new Error(`A hero lead cannot be the "${key}" row: only a main goal leads`);
}

/**
 * One number in the lead's own precision: grams keep the row's rounding (one
 * decimal for net carbs, whole for protein), and calories are whole with the
 * language's thousands separator, because a 46 px "1950" reads worse than
 * "1,950" in a way a 14 px row never does.
 */
function formatLeadNumber({
  row,
  value,
  language,
}: {
  row: Pick<DayBudgetRow, 'figureFormat'>;
  value: number;
  language: string | null | undefined;
}): string {
  if (row.figureFormat === 'grams') return formatMacroNumberIn(language, value);
  return formatMacroNumberIn(language, Math.round(value));
}

/** A number with its unit attached by the app's one no-break space, or the bare number when there is no unit. */
function withUnit({ number, unit }: { number: string; unit: HeroLeadUnit | '' }): string {
  return unit === '' ? number : `${number}${UNIT_SPACE}${unit}`;
}

/** The figure the lead prints: the gap when there is one to state, otherwise what was eaten. */
function leadFigureValue(row: DayBudgetRow): number {
  const { gap } = row;
  if (gap.kind === 'left' || gap.kind === 'over' || gap.kind === 'needed') return gap.amount;
  return row.consumed;
}

/** The scale line's left end. The empty-day line is the dashboard's own, reused. */
function buildScaleStart({
  input,
  unit,
  state,
}: {
  input: HeroLeadInput;
  unit: HeroLeadUnit;
  state: LimitLeadState | FloorLeadState;
}): string {
  const { row, entryCount, t, language } = input;
  if (entryCount === 0) return t('diary.empty.ordinary.line');
  // The figure IS the amount eaten in these two states, so the scale line
  // states only the count; saying the amount twice, one line apart, is noise.
  if (state === 'open' || state === 'met') return t('diary.budget.lead.entries', { count: entryCount });
  return t('diary.budget.lead.soFar', {
    value: withUnit({ number: formatLeadNumber({ row, value: row.consumed, language }), unit }),
    count: entryCount,
  });
}

/** The scale line's right end. */
function buildScaleEnd({
  input,
  unit,
  metric,
}: {
  input: HeroLeadInput;
  unit: HeroLeadUnit;
  metric: HeroLeadMetric;
}): string {
  const { row, t, language } = input;
  if (row.target === null) return t(metric === 'protein' ? 'diary.budget.lead.noTarget' : 'diary.budget.lead.noLimit');
  const value = withUnit({ number: formatLeadNumber({ row, value: Math.round(row.target), language }), unit });
  if (metric !== 'protein') return t('diary.budget.lead.limit', { value });
  // A reference intake is not a number the person set; the row says so, so the lead does too.
  return t(row.targetSource === 'default' ? 'diary.budget.lead.reference' : 'diary.budget.lead.target', { value });
}

/** A lead's state and the catalog key of its caption. */
interface LeadCaption<State> {
  state: State;
  captionKey: string;
}

/** The state and caption key of a lead over a limit. */
function limitLead({
  row,
  entryCount,
  metric,
}: {
  row: DayBudgetRow;
  entryCount: number;
  metric: 'netCarbs' | 'calories';
}): LeadCaption<LimitLeadState> {
  const captions = LIMIT_CAPTION_KEY[metric];
  if (row.gap.kind === 'over') return { state: 'over', captionKey: captions.over };
  if (row.gap.kind !== 'left') return { state: 'open', captionKey: captions.open };
  // An untouched day has the whole limit still to spend; once anything is
  // logged the same figure is what is left.
  if (entryCount === 0) return { state: 'spend', captionKey: captions.spend };
  return { state: 'left', captionKey: captions.left };
}

/** The state and caption key of a lead over a floor. */
function floorLead({ row, entryCount }: { row: DayBudgetRow; entryCount: number }): LeadCaption<FloorLeadState> {
  if (row.gap.kind === 'reached') return { state: 'met', captionKey: FLOOR_CAPTION_KEY.met };
  if (row.gap.kind !== 'needed') return { state: 'open', captionKey: FLOOR_CAPTION_KEY.open };
  if (entryCount === 0) return { state: 'reach', captionKey: FLOOR_CAPTION_KEY.reach };
  return { state: 'needed', captionKey: FLOOR_CAPTION_KEY.needed };
}

/**
 * The lead for the Overview hero: the figure, its words, its meter, its scale.
 *
 * @param input - the first row, how many entries the day holds, the estimate flag, the translator and the language.
 * @returns the final strings and numbers the lead block draws.
 * @throws when the row is fat or fiber: a lead is always a main goal.
 */
export function buildHeroLead(input: HeroLeadInput): HeroLead {
  const { row, entryCount, hasEstimates, t, language } = input;
  const metric = leadMetricOf(row.key);
  const unit: HeroLeadUnit = metric === 'calories' ? 'kcal' : 'g';
  // The rows hedge their budget headlines when the day holds AI estimates, and
  // the protein row has never been hedged. The lead follows each row.
  const hedge = hasEstimates && metric !== 'protein' ? '~' : '';
  const figure = `${hedge}${formatLeadNumber({ row, value: leadFigureValue(row), language })}`;
  const { state, captionKey } =
    metric === 'protein' ? floorLead({ row, entryCount }) : limitLead({ row, entryCount, metric });

  return {
    row,
    metric,
    tone: row.tone,
    figure,
    unit,
    caption: t(captionKey),
    fraction: row.fraction,
    scaleStart: buildScaleStart({ input, unit, state }),
    scaleEnd: buildScaleEnd({ input, unit, metric }),
  };
}

/** One ledger row's status line, and the tone that paints it. */
export interface LedgerStatus {
  text: string;
  tone: DayBudgetRowTone;
}

/**
 * The short status line under a ledger row's value: "26 g left", "12 g over",
 * "14 g to go", "Reached", "no target".
 *
 * The number is the row's `gap.amount`, formatted through the row's own figure
 * format (`formatBudgetFigure`), so the status and the value beside it round
 * the same way.
 *
 * @param row - the ledger row.
 * @param t - the caller's translator.
 * @param language - the active UI language.
 * @returns the text, and the tone: amber over a limit, brand once a floor is reached.
 */
export function buildLedgerStatus({
  row,
  t,
  language,
}: {
  row: DayBudgetRow;
  t: Translate;
  language: string | null | undefined;
}): LedgerStatus {
  const { gap } = row;
  if (gap.kind === 'none') return { text: t('diary.budget.ledger.noTarget'), tone: 'default' };
  if (gap.kind === 'reached') return { text: t('diary.gap.reached'), tone: 'met' };
  // Calories carry no unit here: the value beside the status prints none either
  // ("1640 / 1950"), and the row's label names the metric.
  const unit = row.figureFormat === 'kcal' ? '' : 'g';
  const value = withUnit({ number: formatBudgetFigure({ row, numericValue: gap.amount, language, t }).value, unit });
  // The row's own tone, not the gap's: the derived fat row says "over" in words and stays plain.
  if (gap.kind === 'over') return { text: t('diary.budget.ledger.over', { value }), tone: row.tone };
  if (gap.kind === 'needed') return { text: t('diary.budget.ledger.needed', { value }), tone: 'default' };
  return { text: t('diary.budget.ledger.left', { value }), tone: 'default' };
}
