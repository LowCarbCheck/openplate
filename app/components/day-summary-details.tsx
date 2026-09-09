/**
 * The pieces of the diary's day summary card that are not the budget rows.
 *
 * Three exports, in the order the card stacks them:
 *
 * 1. `CarbImpactChip`, the qualitative verdict that sits above the rows.
 * 2. `WhatYouAte`, the composition block: the macro ratio bar, the four macro
 *    figures, the calorie line the caller passes in, and the footnotes.
 * 3. `SuggestionsDisclosure`, the card's one collapsed offer, naming the foods
 *    that would close the day's dominant gap.
 *
 * The rows themselves live in `#app/components/day-budget-rows`, over a model
 * in `#app/lib/day-budget-rows`. This file was `day-drill-down.tsx` until the
 * rows landed: M129/06 hid all of the above behind a "Day details" tap, next
 * to a per-target gap list. That gap list became the card's headline content,
 * and with the answers on top there was nothing left worth hiding. The
 * composition block renders inline now, and only the suggestions, which are an
 * offer rather than a fact, stay collapsed.
 *
 * All arithmetic is imported, none of it lives here: `#app/lib/macro-gaps`
 * decides the impact tier and the gaps, `#app/lib/food-suggestions` ranks the
 * foods. This module is composition and colour only.
 */
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { ChevronDown, Plus } from 'lucide-react';
import type { DaySummary } from '#app/models/food-log-summary';
import type { CarbImpact, CarbImpactLevel, DayGaps, GapNutrient } from '#app/lib/macro-gaps';
import { describeSuggestion, rankFoodSuggestions } from '#app/lib/food-suggestions';
import type { FoodSuggestion } from '#app/lib/food-suggestions';
import { SUGGESTION_FOODS } from '#app/data/suggestion-foods';
import { formatMacroNumberIn, formatMeasureIn } from '#app/lib/format-macro-number';
import { MacroRatioBar } from '#app/components/macro-ratio-bar';
import { SectionEyebrow } from '#app/components/typography';
import { cn } from '#app/lib/utils';

/** How many suggestions the disclosure offers. Enough to feel like a choice, few enough to scan standing up. */
const SUGGESTION_LIMIT = 4;

////////////////////////////////////////////////////////////////////////////////
// Carb-impact chip, the card's one-glance verdict
////////////////////////////////////////////////////////////////////////////////

/**
 * Chip skin per tier. The palette deliberately tops out at amber and never
 * reaches `--destructive`: a high-carb day is a description of the food, not a
 * failure, and this app's own convention (the over-budget meter fill, the
 * habit strip's over dots) is already "amber, never red".
 *
 * Because moderate and high therefore share a hue AND the same fixed
 * `--accent-amber-surface`/`--accent-amber-border` wash (opacity-stepped
 * fills mix to grey in light mode, see the token comment in `app.css`),
 * color is NOT the discriminator between them. The three-bar level meter
 * beside the label is, and the label itself says the tier in words.
 */
const IMPACT_CHIP_CLASS = {
  low: 'border-primary/35 bg-primary/10 text-primary',
  moderate: 'border-accent-amber-border bg-accent-amber-surface text-accent-amber',
  high: 'border-accent-amber-border bg-accent-amber-surface text-accent-amber',
} satisfies Record<CarbImpactLevel, string>;

/** How many of the meter's three bars are lit per tier. */
const IMPACT_METER_BARS = { low: 1, moderate: 2, high: 3 } satisfies Record<CarbImpactLevel, number>;

/** Bar heights, shortest first, a rising staircase, so the meter reads as a level even unlit. */
const METER_BAR_HEIGHTS = ['h-1.5', 'h-2.5', 'h-3.5'] as const;

/**
 * Three-bar level meter. `currentColor` inherits the chip's tier color, so the
 * meter never needs its own color map, and unlit bars sit at 25% of the same
 * hue rather than on a separate neutral token.
 */
function ImpactMeter({ level }: { level: CarbImpactLevel }) {
  const lit = IMPACT_METER_BARS[level];
  return (
    <span className="flex items-end gap-0.5" aria-hidden="true">
      {METER_BAR_HEIGHTS.map((height, index) => (
        <span
          key={height}
          className={cn('w-1 rounded-full bg-current', height, index >= lit && 'opacity-25')}
        />
      ))}
    </span>
  );
}

/**
 * The hero's qualitative carb verdict. Sits above the budget rows: "Moderate
 * carb impact" is a sentence a novice can act on, where a column of grams is
 * homework.
 *
 * When the verdict is measured against the documented 50 g reference rather
 * than a goal the user set, the chip says so in its accessible name (and the
 * caption underneath says it on screen). The app never quietly implies the
 * user has a target they never chose.
 */
export function CarbImpactChip({ impact }: { impact: CarbImpact }) {
  const { t } = useTranslation();
  const reference =
    impact.referenceSource === 'goal' ?
      t('diary.impact.againstGoal', { value: Math.round(impact.referenceG) })
    : t('diary.impact.againstReference', { value: Math.round(impact.referenceG) });
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold',
        IMPACT_CHIP_CLASS[impact.level],
      )}
      aria-label={t('diary.impact.ariaLabel', { label: impact.label, reference })}
    >
      <ImpactMeter level={impact.level} />
      {impact.label}
    </span>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Suggestions
////////////////////////////////////////////////////////////////////////////////

/** Catalog key for the helper line naming what the suggestions are FOR, because the section is meaningless without it. */
const SUGGESTION_INTRO_KEY = {
  protein: 'diary.suggestions.introProtein',
  fiber: 'diary.suggestions.introFiber',
} satisfies Record<GapNutrient, string>;

/**
 * Catalog key for the disclosure's own label. One string per nutrient rather
 * than one string with the nutrient interpolated: a nutrient dropped into a
 * sentence reads as a calque in German, where the noun wants a compound and an
 * article that agree with it.
 */
const SUGGESTION_DISCLOSURE_KEY = {
  protein: 'diary.suggestions.disclosureProtein',
  fiber: 'diary.suggestions.disclosureFiber',
} satisfies Record<GapNutrient, string>;

/**
 * One suggestion, as a whole-row link into the existing add flow with the
 * search pre-filled (`/add?q=…`), carrying the viewed day so a suggestion
 * taken while browsing a past day lands on that day. No new logging path, the
 * suggestion's job ends at handing the search box a name.
 */
function SuggestionRow({
  suggestion,
  nutrient,
  addBase,
}: {
  suggestion: FoodSuggestion;
  nutrient: GapNutrient;
  addBase: string;
}) {
  const { t, i18n } = useTranslation();
  const separator = addBase.includes('?') ? '&' : '?';
  return (
    <Link
      to={`${addBase}${separator}q=${encodeURIComponent(suggestion.food.name)}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{suggestion.food.name}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {Math.round(suggestion.servingGrams)} g · {describeSuggestion(suggestion, nutrient, (value) => formatMacroNumberIn(i18n.language, value), t)}
        </span>
      </span>
    </Link>
  );
}

/**
 * Ranks the foods that would close the day's dominant gap.
 *
 * FAIL-OPEN is the contract, not an aspiration: if the bundled dataset is
 * missing, empty, or malformed in a way that throws while ranking, this
 * returns an empty list and the disclosure renders NOTHING: no error card, no
 * empty-state apology. The rows and the composition block above are complete
 * on their own, and a broken enrichment must never be the reason a user can't
 * read their own day.
 *
 * @param gaps - the day's gaps, whose `dominantGap` decides what to rank for.
 * @param dateKey - the viewed day, which rotates the list across days without making it move within one.
 * @param loggedFoodNames - what the day already contains, so it is not suggested back.
 * @returns the ranked foods, or an empty list when there is nothing to offer.
 */
function rankSuggestionsForDay({
  gaps,
  dateKey,
  loggedFoodNames,
}: {
  gaps: DayGaps;
  dateKey: string;
  loggedFoodNames: readonly string[];
}): FoodSuggestion[] {
  const dominant = gaps.dominantGap;
  if (dominant === null) return [];
  try {
    return rankFoodSuggestions({
      foods: SUGGESTION_FOODS,
      nutrient: dominant.nutrient,
      remainingG: dominant.remainingG,
      carbHeadroomG: gaps.carbHeadroomG,
      limit: SUGGESTION_LIMIT,
      dateKey,
      loggedFoodNames,
    });
  } catch {
    // Enrichment, never a dependency. See this function's doc comment.
    return [];
  }
}

/** The ranked list itself, with the line naming what it is for and the licence credit that rides with the numbers. */
function FoodSuggestions({
  suggestions,
  nutrient,
  addBase,
}: {
  suggestions: FoodSuggestion[];
  nutrient: GapNutrient;
  addBase: string;
}) {
  const { t } = useTranslation();

  // Licence credit rides with the numbers, at the point of display (DESIGN.md
  // §6), deduped, because four BLS-sourced foods owe one credit, not four.
  const attributions = Array.from(
    new Set(suggestions.map((suggestion) => suggestion.food.attribution).filter((value): value is string => value !== null)),
  );

  return (
    <div className="space-y-2.5 pt-3">
      <p className="text-xs text-muted-foreground">{t(SUGGESTION_INTRO_KEY[nutrient])}</p>
      <ul className="space-y-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.food.slug}>
            <SuggestionRow suggestion={suggestion} nutrient={nutrient} addBase={addBase} />
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t('diary.suggestions.attribution')}
        {attributions.length > 0 && ` ${attributions.join(' · ')}`}
      </p>
    </div>
  );
}

/**
 * The card's one remaining disclosure: "4 foods that would close the protein
 * gap".
 *
 * The label states the offer rather than naming a drawer, so a collapsed card
 * still tells the reader what is inside it. Collapsed by default, because a
 * suggestion is an offer and the day's own figures are already answered above.
 * Renders nothing at all when there is no unmet floor, or when ranking yields
 * no food. The ranking runs ONCE, feeding both the count in the label and
 * the list behind it.
 */
export function SuggestionsDisclosure({
  gaps,
  addBase,
  dateKey,
  loggedFoodNames,
}: {
  gaps: DayGaps;
  addBase: string;
  /** The viewed day, `YYYY-MM-DD`. The list rotates on it, so it is a required input, never read from a clock here. */
  dateKey: string;
  /** The names of the foods already logged on that day, which the ranking drops. */
  loggedFoodNames: readonly string[];
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  const dominant = gaps.dominantGap;
  const suggestions = rankSuggestionsForDay({ gaps, dateKey, loggedFoodNames });
  if (dominant === null || suggestions.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-primary/25 bg-card/60 px-3.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-card"
      >
        <span>{t(SUGGESTION_DISCLOSURE_KEY[dominant.nutrient], { count: suggestions.length })}</span>
        {/* The chevron's rotation is `motion-safe:`-gated, so a reduced-motion
            visitor gets the state change without the spin. */}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-primary motion-safe:transition-transform motion-safe:duration-200',
            isOpen && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      {isOpen && (
        <div id={panelId} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
          <FoodSuggestions suggestions={suggestions} nutrient={dominant.nutrient} addBase={addBase} />
        </div>
      )}
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// What you ate
////////////////////////////////////////////////////////////////////////////////

/** Order + label keys for the macro figures, mirroring `MacroRatioBar`'s own `MACRO_ORDER` (Carbs · Fiber · Protein · Fat). */
const MACRO_BREAKDOWN_FIGURES: { key: 'carbs' | 'fiber' | 'protein' | 'fat'; labelKey: string }[] = [
  { key: 'carbs', labelKey: 'diary.macros.carbs' },
  { key: 'fiber', labelKey: 'diary.macros.fiber' },
  { key: 'protein', labelKey: 'diary.macros.protein' },
  { key: 'fat', labelKey: 'diary.macros.fat' },
];

/** Swatch per macro, in the same token family as the ratio-bar segment above it, so a figure and its slice of the bar are visibly the same thing. */
const MACRO_DOT_CLASS = {
  carbs: 'bg-macro-carbs',
  fiber: 'bg-macro-fiber',
  protein: 'bg-macro-protein',
  fat: 'bg-macro-fat',
} satisfies Record<'carbs' | 'fiber' | 'protein' | 'fat', string>;

/**
 * The day's four macro figures as a grid of labelled cells (M129/01).
 *
 * Color still isn't the sole encoding: every cell is named in words, the cells
 * are in a fixed order matching the ratio bar's segment order, and the color
 * appears as a small round swatch beside the label rather than as the text
 * color of the figure itself.
 */
function MacroBreakdown({ summary }: { summary: DaySummary }) {
  const { t, i18n } = useTranslation();
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
      {MACRO_BREAKDOWN_FIGURES.map(({ key, labelKey }) => (
        <div key={key} className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', MACRO_DOT_CLASS[key])} aria-hidden="true" />
            <span className="truncate">{t(labelKey)}</span>
          </dt>
          <dd className="text-sm font-semibold leading-tight text-foreground tabular-nums">
            {formatMeasureIn(i18n.language, summary[key], 'g')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What the day was made of: the ratio bar, the four macro figures, and the
 * footnotes that qualify them.
 *
 * This is the FACTS half of the card, and it sits under the budget rows on
 * purpose. "12 g protein to go" is an answer; "Protein 46 g" is a fact, and a
 * novice needs the answer first. `kcalLine` is passed in rather than derived
 * here because it depends on the caller's goals: a card that already carries a
 * calorie budget row passes null, since repeating the same figure two ways is
 * the clutter this recomposition removed.
 */
export function WhatYouAte({
  summary,
  caveat,
  kcalLine,
}: {
  summary: DaySummary;
  caveat: string | null;
  /** The calorie figure, or null when a calorie budget row already carries it. */
  kcalLine: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <SectionEyebrow as="h4">{t('diary.drilldown.whatYouAte')}</SectionEyebrow>
      <MacroRatioBar
        grams={{ carbs: summary.carbs, protein: summary.protein, fat: summary.fat, fiber: summary.fiber }}
        className="h-2.5"
      />
      <MacroBreakdown summary={summary} />
      <div className="space-y-1">
        {kcalLine}
        <p className="text-xs text-muted-foreground">{t('diary.drilldown.netCarbsDefinition')}</p>
        {caveat && <p className="text-xs text-muted-foreground">{caveat}</p>}
      </div>
    </div>
  );
}
