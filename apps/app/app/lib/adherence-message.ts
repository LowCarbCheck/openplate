/**
 * Pure copy formatter for one adherence-grid cell — the ONE builder behind all
 * three readouts: the pointer tooltip, the always-visible caption row, and the
 * cell button's `aria-label`. Three surfaces, one sentence, so a touch user, a
 * mouse user and a screen-reader user are never told different things about
 * the same day (Radix tooltips don't open on touch, which is why the caption
 * row exists at all).
 *
 * Same seam as `streak-message.ts`: the translator and the language are
 * parameters, never the i18next singleton, so this stays testable without a
 * provider.
 *
 * Values LEAD and labels follow ("18 g net carbs, under 20 g") because the
 * number is what the reader came for, and because nothing here may depend on
 * colour — the caller's coloured mark is redundant with this text, not a
 * substitute for it.
 */
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { formatDayLabel } from '#app/lib/format-day-label';
import { ADHERENCE_GOAL_KEYS } from '#app/models/adherence-grid';
import type {
  AdherenceDay,
  AdherenceGoalKey,
  AdherenceGoalVerdict,
  AdherenceGoals,
  AdherenceMode,
} from '#app/models/adherence-grid';

/** Translation lookup, threaded in as a parameter — see the module doc. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

export interface AdherenceGoalRow {
  key: AdherenceGoalKey;
  /** Value first — e.g. "18 g", "112 g", "1 740". */
  value: string;
  /** Label second — e.g. "net carbs". */
  label: string;
  verdict: AdherenceGoalVerdict;
  /** The user's own number, e.g. "under 20 g" / "over 20 g" / "of 100 g". */
  against: string;
}

export interface AdherenceDayDescription {
  /** Locale-formatted date, e.g. "Mon, 14 Jul" / "Mo., 14. Juli". */
  dateLabel: string;
  /**
   * The one-line verdict. On a `no-data` day this is the whole sentence
   * INCLUDING the date (it reuses the bar chart's "{{date}}: nothing logged"
   * string), so a renderer must not print `dateLabel` above it there.
   */
  headline: string;
  /** One per configured, non-`unknown` goal. Empty in activity mode. */
  rows: AdherenceGoalRow[];
  /** "Today — still going." when `isToday`, else null. */
  note: string | null;
  /** The whole thing as one sentence, for `aria-label` on the cell button. */
  ariaLabel: string;
}

/** Catalog keys for the goal names, in display order. */
const GOAL_LABEL_KEY = {
  netCarbs: 'trends.grid.goal.netCarbs',
  protein: 'trends.grid.goal.protein',
  kcal: 'trends.grid.goal.calories',
} satisfies Record<AdherenceGoalKey, string>;

/** A gram figure with its unit; calories are a bare rounded number. */
function formatFigure(key: AdherenceGoalKey, value: number, language: string): string {
  if (key === 'kcal') return formatMacroNumberIn(language, Math.round(value));
  return `${formatMacroNumberIn(language, value)} g`;
}

/** The user's own goal number, phrased against the verdict ("under 20 g", "over 20 g", "of 100 g"). */
function formatAgainst({
  key,
  verdict,
  goals,
  t,
  language,
}: {
  key: AdherenceGoalKey;
  verdict: AdherenceGoalVerdict;
  goals: AdherenceGoals;
  t: Translate;
  language: string;
}): string {
  const goalValue =
    key === 'netCarbs' ? goals.netCarbsCeilingG
    : key === 'protein' ? goals.proteinFloorG
    : goals.kcalTarget;
  if (goalValue === null) return '';
  const goal = formatFigure(key, goalValue, language);
  // Protein is a FLOOR — "of 100 g" reads the same whether or not it was
  // reached, and "under 100 g" would sound like the goal was to stay below it.
  if (key === 'protein') return t('trends.grid.against.of', { goal });
  return verdict === 'met' ? t('trends.grid.against.under', { goal }) : t('trends.grid.against.over', { goal });
}

/** The per-goal rows, skipping goals that weren't configured or couldn't be assessed. */
function buildRows({
  day,
  goals,
  t,
  language,
}: {
  day: AdherenceDay;
  goals: AdherenceGoals;
  t: Translate;
  language: string;
}): AdherenceGoalRow[] {
  return ADHERENCE_GOAL_KEYS.flatMap((key) => {
    const verdict = day.verdicts[key];
    if (verdict === undefined || verdict === 'unknown') return [];
    const total = day.totals[key];
    if (total === null) return [];
    return [
      {
        key,
        value: formatFigure(key, total, language),
        label: t(GOAL_LABEL_KEY[key]),
        verdict,
        against: formatAgainst({ key, verdict, goals, t, language }),
      },
    ];
  });
}

/** The cell's one-line verdict. */
function buildHeadline({
  day,
  mode,
  dateLabel,
  t,
}: {
  day: AdherenceDay;
  mode: AdherenceMode;
  dateLabel: string;
  t: Translate;
}): string {
  if (day.status === 'no-data') return t('trends.chart.bar.empty', { date: dateLabel });
  if (day.status === 'unrated') return t('trends.grid.cell.unrated');
  if (mode === 'activity' || day.status === 'logged') return t('trends.grid.cell.logged');
  return t('trends.grid.cell.metCount', { met: day.metCount, total: day.ratedCount });
}

/**
 * Drops one trailing period so a segment can take the joiner's own. A
 * translator ending a sentence with a period ("You logged something.") is
 * correct copy, so a doubled period is the JOIN's bug to fix — never the
 * catalog's.
 */
function withoutTrailingPeriod(text: string): string {
  return text.replace(/\s*\.\s*$/, '');
}

/**
 * Joins sentence fragments with '. ', tolerating fragments that already end in
 * one. Only the LAST fragment keeps its terminal period: there it ends the
 * sentence rather than separating two.
 */
function joinSentences(parts: string[]): string {
  const kept = parts.filter((part) => part !== '');
  return kept.map((part, index) => (index === kept.length - 1 ? part : withoutTrailingPeriod(part))).join('. ');
}

/**
 * Describes one cell for the tooltip, the caption row and the accessible name.
 *
 * @param day - the resolved cell.
 * @param goals - the user's configured daily goals (for the "against" phrases).
 * @param mode - whether the grid is grading goals or just recording activity.
 * @param t - the caller's translator.
 * @param language - the active UI language, for date and number formatting.
 * @returns the parts to render, plus the whole thing as one sentence.
 */
export function describeAdherenceDay({
  day,
  goals,
  mode,
  t,
  language,
}: {
  day: AdherenceDay;
  goals: AdherenceGoals;
  mode: AdherenceMode;
  t: Translate;
  language: string;
}): AdherenceDayDescription {
  const dateLabel = formatDayLabel(day.date, language);
  const headline = buildHeadline({ day, mode, dateLabel, t });
  const rows = day.status === 'rated' ? buildRows({ day, goals, t, language }) : [];
  const note = day.isToday ? t('trends.grid.cell.today') : null;

  const detail = joinSentences([
    ...rows.map((row) =>
      `${row.value} ${row.label} ${row.against}, ${t(`trends.grid.verdict.${row.verdict}`)}`.replace(/\s+/g, ' '),
    ),
    ...(note === null ? [] : [note]),
  ]);

  // A no-data headline already carries the date, so repeating it would read
  // "Mon 14 Jul: Mon 14 Jul: nothing logged" to a screen reader.
  //
  // `trends.grid.aria.day` supplies the '. ' after the headline, so a headline
  // that already ends in one would double it up ("You logged something.. Today
  // — still going."). The trailing `.trim()` mops up the same template's
  // separator when there is no detail to follow it.
  const ariaLabel =
    day.status === 'no-data' ?
      headline
    : t('trends.grid.aria.day', { date: dateLabel, headline: withoutTrailingPeriod(headline), detail }).trim();

  return { dateLabel, headline, rows, note, ariaLabel };
}
