/**
 * The diary hero's novice-first surface (M129/06): a qualitative carb-impact
 * chip plus a single protein figure at the top level, and — behind one
 * "Day details" tap — the full macro breakdown, a per-target gap view, and
 * deterministic food suggestions for whatever the day is short on.
 *
 * The four raw macro figures that used to sit in the hero live in
 * `DayDrillDown` now. That's the whole point of this file: a novice opening
 * the diary should see "moderate carb day, 46 g protein" and nothing else,
 * and should be able to get to "54 g protein to go — here are four foods that
 * would fix that" in exactly one deliberate tap.
 *
 * All arithmetic is imported, none of it lives here: `#app/lib/macro-gaps`
 * decides the impact tier and the gaps, `#app/lib/food-suggestions` ranks the
 * foods. This module is composition and color only.
 */
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { DaySummary } from '#app/models/food-log-summary';
import { describeGap } from '#app/lib/macro-gaps';
import type { CarbImpact, CarbImpactLevel, DayGaps, GapNutrient, MacroGap, MacroGapKey } from '#app/lib/macro-gaps';
import { describeSuggestion, rankFoodSuggestions } from '#app/lib/food-suggestions';
import type { FoodSuggestion } from '#app/lib/food-suggestions';
import { SUGGESTION_FOODS } from '#app/data/suggestion-foods';
import { formatMacroNumberIn, formatMeasureIn } from '#app/lib/format-macro-number';
import { MacroRatioBar } from '#app/components/macro-ratio-bar';
import { SectionEyebrow } from '#app/components/typography';
import { cn } from '#app/lib/utils';

/** How many suggestions the drill-down offers. Enough to feel like a choice, few enough to scan standing up. */
const SUGGESTION_LIMIT = 4;

////////////////////////////////////////////////////////////////////////////////
// Carb-impact chip — the hero's one-glance verdict
////////////////////////////////////////////////////////////////////////////////

/**
 * Chip skin per tier. The palette deliberately tops out at amber and never
 * reaches `--destructive`: a high-carb day is a description of the food, not a
 * failure, and this app's own convention (the over-goal ring arc, the habit
 * strip's over dots) is already "amber, never red".
 *
 * Because moderate and high therefore share a hue AND the same fixed
 * `--accent-amber-surface`/`--accent-amber-border` wash (opacity-stepped
 * fills mix to grey in light mode — see the token comment in `app.css`),
 * color is NOT the discriminator between them — the three-bar level meter
 * beside the label is, and the label itself says the tier in words.
 */
const IMPACT_CHIP_CLASS = {
  low: 'border-primary/35 bg-primary/10 text-primary',
  moderate: 'border-accent-amber-border bg-accent-amber-surface text-accent-amber',
  high: 'border-accent-amber-border bg-accent-amber-surface text-accent-amber',
} satisfies Record<CarbImpactLevel, string>;

/** How many of the meter's three bars are lit per tier. */
const IMPACT_METER_BARS = { low: 1, moderate: 2, high: 3 } satisfies Record<CarbImpactLevel, number>;

/** Bar heights, shortest first — a rising staircase, so the meter reads as a level even unlit. */
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
 * The hero's qualitative carb verdict. Replaces the four-cell macro grid as
 * the first thing a novice reads: "Moderate carb impact" is a sentence they
 * can act on, where "Carbs 42.1g · Fiber 0.8g" is homework.
 *
 * When the verdict is measured against the documented 50 g reference rather
 * than a goal the user set, the chip says so in its accessible name (and the
 * caption underneath says it on screen) — the app never quietly implies the
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

/**
 * The hero's single protein figure — the one macro number that survives the
 * novice-first cut, because it's the one people are actively trying to REACH
 * (net carbs already has the whole ring). Shows progress against the floor
 * when one is set and a plain total when it isn't; never a NaN, never a
 * fabricated target.
 */
export function HeroProteinFigure({ gap }: { gap: MacroGap }) {
  const { t, i18n } = useTranslation();
  return (
    <p className="flex items-center gap-1.5 text-sm tabular-nums">
      <span className="text-muted-foreground">{t('diary.macros.protein')}</span>
      <span className="font-semibold text-foreground">
        {gap.target === null ?
          `${formatMacroNumberIn(i18n.language, gap.consumed)} g`
        : `${Math.round(gap.consumed)} / ${Math.round(gap.target)} g`}
      </span>
      {gap.isMet && <Check className="h-4 w-4 text-primary" aria-label={t('diary.drilldown.proteinReached')} />}
    </p>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Gap list
////////////////////////////////////////////////////////////////////////////////

/**
 * Fill per gap row, tied to the macro legend the ratio bar and the macro grid
 * already use — so a row, its slice of the bar, and its figure in the grid are
 * visibly the same thing. Net carbs is the exception: it's the tracked ceiling,
 * so it takes the brand color (and flips to amber when over, matching the ring).
 */
const GAP_FILL_CLASS = {
  netCarbs: 'bg-primary',
  protein: 'bg-macro-protein',
  fiber: 'bg-macro-fiber',
} satisfies Record<MacroGapKey, string>;

/** Left rule per gap row — the same position cue the macro grid uses, so the two sections rhyme. */
const GAP_RULE_CLASS = {
  netCarbs: 'border-primary',
  protein: 'border-macro-protein',
  fiber: 'border-macro-fiber',
} satisfies Record<MacroGapKey, string>;

/**
 * One target's row: what's been eaten, what the target is, how far there is to
 * go, and a bar carrying the same ratio in a second, non-textual encoding.
 *
 * A row with NO target (a user who set no ceiling or floor) renders no bar at
 * all — the first pass drew an empty track there, which read as "0% of
 * something", and the something was never named. Two lines collapse to one:
 * the label, and the absolute figure. Deliberately not a 0%-full bar against
 * an invented target, and never an "NaN%".
 */
function MacroGapRow({ gap }: { gap: MacroGap }) {
  const { t, i18n } = useTranslation();
  const phrase = describeGap(gap, (value) => formatMacroNumberIn(i18n.language, value), t);
  const isAmber = gap.isOver;

  const heading = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="text-sm font-medium text-foreground">
        {gap.label}
        {gap.targetSource === 'default' && (
          <span className="ml-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {t('diary.drilldown.referenceTag')}
          </span>
        )}
      </span>
      <span
        className={cn(
          'text-xs font-semibold tabular-nums',
          isAmber ? 'text-accent-amber'
          : gap.isMet && gap.kind === 'floor' ? 'text-primary'
          : 'text-muted-foreground',
        )}
      >
        {phrase}
      </span>
    </div>
  );

  if (gap.target === null) {
    return (
      <div className={cn('border-l-2 pl-3', GAP_RULE_CLASS[gap.key])}>
        {heading}
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('diary.drilldown.noTarget')}</p>
      </div>
    );
  }

  return (
    <div className={cn('border-l-2 pl-3', GAP_RULE_CLASS[gap.key])}>
      {heading}
      <div className="mt-1.5 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', isAmber ? 'bg-accent-amber' : GAP_FILL_CLASS[gap.key])}
            style={{ width: `${(gap.fraction ?? 0) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {Math.round(gap.consumed)} / {Math.round(gap.target)} g
        </span>
      </div>
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Suggestions
////////////////////////////////////////////////////////////////////////////////

/** Catalog key for the helper line naming what the suggestions are FOR — the section is meaningless without it. */
const SUGGESTION_INTRO_KEY = {
  protein: 'diary.suggestions.introProtein',
  fiber: 'diary.suggestions.introFiber',
} satisfies Record<GapNutrient, string>;

/**
 * One suggestion, as a whole-row link into the existing add flow with the
 * search pre-filled (`/add?q=…`), carrying the viewed day so a suggestion
 * taken while browsing a past day lands on that day. No new logging path — the
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
 * The suggestion block. FAIL-OPEN is the contract, not an aspiration: if the
 * bundled dataset is missing, empty, or malformed in a way that throws while
 * ranking, this renders NOTHING — no error card, no empty-state apology. The
 * drill-down above it is complete on its own, and a broken enrichment must
 * never be the reason a user can't read their own day.
 */
function FoodSuggestions({ gaps, addBase }: { gaps: DayGaps; addBase: string }) {
  const { t } = useTranslation();
  const dominant = gaps.dominantGap;
  if (dominant === null) return null;

  let suggestions: FoodSuggestion[] = [];
  try {
    suggestions = rankFoodSuggestions({
      foods: SUGGESTION_FOODS,
      nutrient: dominant.nutrient,
      remainingG: dominant.remainingG,
      carbHeadroomG: gaps.carbHeadroomG,
      limit: SUGGESTION_LIMIT,
    });
  } catch {
    // Enrichment, never a dependency — see this component's doc comment.
    return null;
  }
  if (suggestions.length === 0) return null;

  // Licence credit rides with the numbers, at the point of display (DESIGN.md
  // §6) — deduped, because four BLS-sourced foods owe one credit, not four.
  const attributions = Array.from(
    new Set(suggestions.map((suggestion) => suggestion.food.attribution).filter((value): value is string => value !== null)),
  );

  // The section rule lives HERE rather than on a wrapper in `DayDrillDown`,
  // because every branch above can return null — a wrapper out there would
  // draw an empty bordered block on any day with nothing to suggest.
  return (
    <div className="space-y-2.5 border-t border-primary/15 pt-4">
      <div className="space-y-0.5">
        <SectionEyebrow as="h4">{t('diary.suggestions.title')}</SectionEyebrow>
        <p className="text-xs text-muted-foreground">{t(SUGGESTION_INTRO_KEY[dominant.nutrient])}</p>
      </div>
      <ul className="space-y-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.food.slug}>
            <SuggestionRow suggestion={suggestion} nutrient={dominant.nutrient} addBase={addBase} />
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

////////////////////////////////////////////////////////////////////////////////
// Macro breakdown (relocated here from the hero)
////////////////////////////////////////////////////////////////////////////////

/** Order + label keys for the macro figures — mirrors `MacroRatioBar`'s own `MACRO_ORDER` (Carbs · Fiber · Protein · Fat). */
const MACRO_BREAKDOWN_FIGURES: { key: 'carbs' | 'fiber' | 'protein' | 'fat'; labelKey: string }[] = [
  { key: 'carbs', labelKey: 'diary.macros.carbs' },
  { key: 'fiber', labelKey: 'diary.macros.fiber' },
  { key: 'protein', labelKey: 'diary.macros.protein' },
  { key: 'fat', labelKey: 'diary.macros.fat' },
];

/** Left rule per macro — same token family as the ratio-bar segment above it, so a figure and its slice of the bar are visibly the same thing. */
const MACRO_RULE_CLASS = {
  carbs: 'border-macro-carbs',
  fiber: 'border-macro-fiber',
  protein: 'border-macro-protein',
  fat: 'border-macro-fat',
} satisfies Record<'carbs' | 'fiber' | 'protein' | 'fat', string>;

/**
 * The day's four macro figures as a grid of labelled cells (M129/01), moved
 * out of the hero in M129/06 — this is exactly the detail a novice was being
 * asked to parse before they'd been told whether the day went well.
 *
 * Color still isn't the sole encoding: every cell is named in words, the cells
 * are in a fixed order matching the ratio bar's segment order, and the color
 * appears as a 2px left rule (a position cue) rather than as the text color of
 * the figure itself.
 */
function MacroBreakdown({ summary }: { summary: DaySummary }) {
  const { t, i18n } = useTranslation();
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
      {MACRO_BREAKDOWN_FIGURES.map(({ key, labelKey }) => (
        <div key={key} className={cn('min-w-0 border-l-2 pl-2.5', MACRO_RULE_CLASS[key])}>
          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t(labelKey)}</dt>
          <dd className="text-sm font-semibold leading-tight text-foreground tabular-nums">
            {formatMeasureIn(i18n.language, summary[key], 'g')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

////////////////////////////////////////////////////////////////////////////////
// The drill-down itself
////////////////////////////////////////////////////////////////////////////////

/**
 * Everything the hero no longer says: the gap view first (it's the reason the
 * user tapped), then the macro composition, then calories and caveats, then
 * the suggestions.
 *
 * Order is deliberate. "54 g protein to go" is an answer; "Protein 46g" is a
 * fact. The answers come first and the facts back them up — the reverse of the
 * old hero, which led with facts and never got to an answer at all.
 */
export function DayDrillDown({
  summary,
  gaps,
  addBase,
  hasAnyGoal,
  caveat,
  kcalLine,
}: {
  summary: DaySummary;
  gaps: DayGaps;
  addBase: string;
  hasAnyGoal: boolean;
  caveat: string | null;
  kcalLine: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionEyebrow as="h4">{t('diary.drilldown.whereTheDayStands')}</SectionEyebrow>
        <div className="space-y-3">
          {gaps.gaps.map((gap) => (
            <MacroGapRow key={gap.key} gap={gap} />
          ))}
        </div>
        {!hasAnyGoal && (
          <Link to="/settings/goals" className="inline-block text-xs text-primary underline-offset-4 hover:underline">
            {t('diary.drilldown.setTargets')}
          </Link>
        )}
      </div>

      <div className="space-y-3 border-t border-primary/15 pt-4">
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

      <FoodSuggestions gaps={gaps} addBase={addBase} />
    </div>
  );
}

/**
 * The "Day details" disclosure, split into a hook + a button + a panel rather
 * than one self-contained component.
 *
 * The split exists for one concrete layout reason: on a phone the trigger
 * belongs directly under the ring, but on a wide screen it belongs in the
 * ring's RIGHT-hand column — the novice-first hero left that column holding
 * two short lines, and a full-width button under the row left an obvious void
 * beside the ring. The expanded PANEL still wants the card's full width (its
 * macro grid goes four-across at `sm`). One component can't be in two places;
 * a shared piece of state can.
 */
export interface DayDetailsDisclosure {
  isOpen: boolean;
  toggle: () => void;
  panelId: string;
}

/** Owns the disclosure's open state and the id tying the button to its panel. */
export function useDayDetails(): DayDetailsDisclosure {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  return { isOpen, toggle: () => setIsOpen((open) => !open), panelId };
}

/**
 * The disclosure trigger — a real button with `aria-expanded` and
 * `aria-controls`, at least 44px tall so it's a comfortable thumb target.
 * Collapsed by default: the whole point of the novice-first hero is that the
 * detail is opt-in. The chevron's rotation is `motion-safe:`-gated, so a
 * reduced-motion visitor gets the state change without the spin.
 */
export function DayDetailsButton({ isOpen, toggle, panelId }: DayDetailsDisclosure) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={isOpen}
      aria-controls={panelId}
      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-primary/25 bg-card/60 px-3.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-card"
    >
      <span>{isOpen ? t('diary.drilldown.hide') : t('diary.drilldown.show')}</span>
      <ChevronDown
        className={cn(
          'h-4 w-4 text-primary motion-safe:transition-transform motion-safe:duration-200',
          isOpen && 'rotate-180',
        )}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * The expanded panel. It gets its OWN card surface rather than sitting
 * directly on the hero: the hero's `.surface-brand` wash is a directional
 * gradient that has faded to ~2% by the bottom of the card, so a drill-down
 * rendered straight onto it visually fell out of the card — the content kept
 * going after the color stopped. An inset `bg-card` panel with a brand
 * hairline restores the boundary and reads as "detail inside the hero" rather
 * than "loose text under it".
 */
export function DayDetailsPanel({ isOpen, panelId, children }: DayDetailsDisclosure & { children: ReactNode }) {
  if (!isOpen) return null;
  return (
    <div
      id={panelId}
      className="rounded-xl border border-primary/15 bg-card/70 p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"
    >
      {children}
    </div>
  );
}
