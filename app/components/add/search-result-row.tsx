import { useTranslation } from 'react-i18next';
import type { Macros } from '#app/lib/macros';
import type { QuickAddSource } from '#app/lib/quick-add-search';
import { computeMacroPreview } from '#app/lib/portion-preview';
import type { CarbBasis } from '#app/lib/net-carbs';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { getCarbStatus, carbStatusBadgeClass } from '#app/utils/carb-status';
import { matchTierChipClass, type MatchTier } from '#app/lib/match-quality';
import { cn } from '#app/lib/utils';
import { Badge } from '#app/components/ui/badge';
import { ChevronRight } from 'lucide-react';

/**
 * The narrow slice of i18next's `t` this module's pure helper depends on —
 * threaded in as a parameter so it stays directly callable from a test with a
 * stub translator rather than reaching for the shared instance.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** Neutral zinc provenance label keys for the two on-device sources (DESIGN.md §6 — meal/source chips stay off the carb palette). A curated row shows its match-quality tier instead — see `SearchResultRow`. */
const PROVENANCE_LABEL_KEYS = {
  recent: 'add.results.provenance.recent',
  custom: 'add.results.provenance.custom',
} satisfies Record<'recent' | 'custom', string>;

/**
 * Match-tier chip label keys. Translated here rather than read from
 * `#app/lib/match-quality`'s `matchTierLabel`, which returns fixed English —
 * the chip renders whatever string this call site hands it.
 */
const MATCH_TIER_LABEL_KEYS = {
  strong: 'add.results.matchTier.strong',
  likely: 'add.results.matchTier.likely',
  weak: 'add.results.matchTier.weak',
} satisfies Record<MatchTier, string>;

/**
 * Compact per-100g calorie line — calories only, spelled out in place of the
 * "kcal" jargon abbreviation. Deliberately excludes carbs: this row already
 * shows a "net carbs" badge (the number that actually matters for a
 * low-carb tracker), and a second, differently-computed gross-carb figure
 * right next to it read as two conflicting answers to the same question
 * (defect: "per 100g: 208 kcal · 9.6g carbs" sitting beside a "9g net
 * carbs" badge, unexplained). Exported for direct testability.
 */
export function formatPer100gSummary(macros: Macros, t: Translate, language: string): string {
  return macros.kcal !== null ? t('add.results.calories', { value: formatMacroNumberIn(language, macros.kcal) }) : '';
}

/**
 * Whether a curated match's relevance tier is worth a chip at all. A
 * "Strong match" badge on every single row conveys nothing (defect: all ten
 * search results showed it) — the tier chip is only useful as a warning on a
 * shakier match, so it's suppressed entirely for `'strong'` and only shown
 * for `'likely'`/`'weak'`. Exported for direct testability.
 */
export function shouldShowMatchTierChip(tier: MatchTier | null): tier is Exclude<MatchTier, 'strong'> {
  return tier !== null && tier !== 'strong';
}

/**
 * The minimal candidate shape this row actually renders — deliberately
 * decoupled from any one candidate source type (`LocalQuickAddCandidate`,
 * `AddSearchCandidate`, or any future federated shape) since the row never
 * reads a candidate's `foodId`/`curatedSource`/`url` fields, whose id type
 * differs between sources. Every candidate type structurally satisfies this
 * interface without a cast — keep it that way when adding a field here.
 *
 * No `attribution` field here on purpose: a curated row's source/licence
 * credit is real and still discharged, just not on every row of a scanning
 * list — see `PortionStep` in `app/routes/add.tsx`, which shows it once a
 * food is actually selected (per-food, discoverable, not shouting).
 */
export interface SearchResultCandidate {
  name: string;
  macrosPer100g: Macros;
  /**
   * This candidate's OWN authoritative net-carbs-per-100g figure, threaded
   * into `computeMacroPreview` as `authoritativeNetCarbsPer100g` rather than
   * re-derived here. For a curated row this is LCC's origin-aware value, and
   * bls/curated foods already report fiber-EXCLUSIVE "available" carbs — so
   * recomputing `carbs - fiber - polyols` from `macrosPer100g` on this end
   * double-subtracts fiber and floors a genuinely high-carb food to a green
   * "0g net carbs" badge. That was the live defect: the search list and the
   * portion step showed contradictory numbers for the very same food, because
   * only the portion step passed this value through.
   *
   * THREE states, matching `LocalQuickAddCandidate.authoritativeNetCarbsPer100g`
   * (and `computeMacroPreview`'s parameter of the same name) exactly:
   * `undefined` = no upstream figure, fall back to the parts; `null` = upstream
   * consulted and genuinely unknown, so render no number rather than a
   * fabricated 0; a number = the figure wins outright. A `'recent'` row's
   * value is the ORIGINAL LOG's figure, which is why this list now shows the
   * same number the diary does for the same food (it previously re-derived a
   * double-subtracted estimate and showed a green 0 beside the diary's red
   * 21.7).
   *
   * REQUIRED, never `?:`, on purpose — note the difference: `undefined` is a
   * legal VALUE here, but the KEY must still be written. Marking the property
   * optional would let a future candidate type silently omit the field, which
   * type-checks, quietly falls back to the naive local formula, and
   * reintroduces exactly this bug with no compiler complaint. Every candidate
   * type that reaches this row already carries the field.
   */
  authoritativeNetCarbsPer100g: number | null | undefined;
  /**
   * This candidate's printed-panel convention, threaded into
   * `computeMacroPreview` as `carbBasis` — see
   * `LocalQuickAddCandidate.carbBasis`'s doc for the full contract. `?:`
   * (unlike `authoritativeNetCarbsPer100g` above) because absence here is
   * never ambiguous: it means UNKNOWN, which the compute-from-parts fallback
   * already treats as `total` (today's original formula) by design — see
   * `#app/lib/net-carbs`.
   */
  carbBasis?: CarbBasis;
  source: QuickAddSource;
  timesLogged: number;
  imageUrl: string | null;
  /** Curated-match relevance tier ("Strong match" / "Possible match" / "Rough match"), null for recent/custom rows or when no tier resolved. */
  matchTier: MatchTier | null;
}

/**
 * A single tappable quick-add search result: a full-width button carrying the
 * food name, its provenance (or, for a curated row, its match-quality tier —
 * an exact hit and a fuzzy typo-recovery guess must not look identical), a
 * per-100g net-carb traffic-light badge, and a compact macro summary. Tapping
 * it advances to the portion step (DESIGN.md §3 for the carb-status colors;
 * §6 for the zinc source chips).
 */
export function SearchResultRow({ candidate, onSelect }: { candidate: SearchResultCandidate; onSelect: () => void }) {
  const { t, i18n } = useTranslation();
  // `authoritativeNetCarbsPer100g` is not optional politeness — omitting it
  // here is what made this list disagree with the portion step for the same
  // food (see `SearchResultCandidate.authoritativeNetCarbsPer100g`). Both the
  // badge number and the traffic-light color below hang off this one value,
  // and passing `undefined` through is what makes a candidate with no upstream
  // figure fall back to the parts — the estimate lives in `computeMacroPreview`,
  // never in a second copy on the candidate.
  const preview = computeMacroPreview({
    macrosPer100g: candidate.macrosPer100g,
    grams: 100,
    authoritativeNetCarbsPer100g: candidate.authoritativeNetCarbsPer100g,
    carbBasis: candidate.carbBasis,
  });
  const carbStatus = preview ? getCarbStatus(preview.netCarbsPer100g) : null;
  const summary = formatPer100gSummary(candidate.macrosPer100g, t, i18n.language);
  const loggedHint =
    candidate.source === 'recent' && candidate.timesLogged > 1 ?
      t('add.results.loggedTimes', { times: candidate.timesLogged })
    : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-all duration-200 hover:border-teal-300 hover:shadow-md dark:hover:border-teal-600"
    >
      {candidate.imageUrl && (
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
          <img src={candidate.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {/* line-clamp (not a single-line `truncate`) so a long database
            descriptor wraps to a second line instead of clipping mid-word —
            defect: names like "Eggs boiled, with remoulade sauce, diluted…"
            were cut off unreadably on one line. */}
        <p className="line-clamp-2 text-sm font-medium">{candidate.name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {candidate.source !== 'curated' && (
            <Badge
              variant="outline"
              className="border-transparent bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {t(PROVENANCE_LABEL_KEYS[candidate.source])}
            </Badge>
          )}
          {candidate.source === 'curated' && shouldShowMatchTierChip(candidate.matchTier) && (
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', matchTierChipClass[candidate.matchTier])}>
              {t(MATCH_TIER_LABEL_KEYS[candidate.matchTier])}
            </span>
          )}
          {preview && carbStatus && (
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', carbStatusBadgeClass[carbStatus])}>
              {t('add.results.netCarbs', { value: formatMacroNumberIn(i18n.language, preview.netCarbsPer100g) })}
            </span>
          )}
          {loggedHint && <span className="text-xs text-muted-foreground">{loggedHint}</span>}
        </div>
        {summary && (
          <p className="truncate text-xs text-muted-foreground">{t('add.results.per100g', { summary })}</p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
