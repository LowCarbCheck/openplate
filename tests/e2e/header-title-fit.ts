/**
 * The header page titles that do not fit yet, and the one partition both title guards use.
 *
 * THE RULE (operator, 2026-09-22). The phone header title is 18 px and does not bend
 * (`HEADER_TITLE_PX` in `tests/design-contract.ts`). Every title that lands in the slot must fit
 * at 360 px and at 390 px, in all six languages, with `scrollWidth <= clientWidth`. A title that
 * does not fit is a defect in its STRING, and the fix is a shorter string in its locale file,
 * never a smaller size, a clamp or a shrink to fit.
 *
 * WHY A LIST AT ALL. On the day the size went to 18 px some shipped strings did not fit, and the
 * strings are shortened in a separate change. Until then the guards would be red for a known
 * reason, and a red gate that everybody has learned to ignore hides the next failure. So the
 * titles that overflowed on that day are listed here, and only those.
 *
 * THE LIST ONLY SHRINKS. Both guards fail in two directions: on an overflow the list does not
 * name, and on a listed entry that now FITS. The second failure is what makes somebody delete the
 * entry in the same change that shortens the string, so the list cannot rot into a silent pass.
 * Never add an entry to make a new title pass. Shorten the title.
 *
 * `lcc-lineage-header-title.spec.ts` writes every title string into the real header and matches
 * on `(locale, titleKey, viewport)`. `lcc-lineage-clip-sweep.spec.ts` visits the routes and
 * matches on `(locale, route, viewport)`, which is why each entry names the routes that draw it.
 */
import type { LanguageCode } from '../../app/i18n/language-prefs';
import type { HEADER_TITLE_FIT_WIDTHS_PX } from '../design-contract';

/** One of the widths a header title must fit at. */
export type HeaderTitleFitWidth = (typeof HEADER_TITLE_FIT_WIDTHS_PX)[number];

/** A title that overflowed the 18 px slot on 2026-09-22 and is waiting for a shorter string. */
export interface KnownTitleOverflow {
  locale: LanguageCode;
  /** The key in `app/i18n/locales/<locale>/common.json`. */
  titleKey: string;
  /** The paths that draw this title, as the clip sweep requests them. `:id` stands for any segment. */
  routes: readonly string[];
  /** The widths it overflows at. A title that overflows at 390 px also overflows at 360 px. */
  viewports: readonly HeaderTitleFitWidth[];
}

/**
 * Strings to be shortened, operator decision 2026-09-22.
 *
 * Measured on the production build in headless Chromium: the slot is 230 px wide at 360 px and
 * holds 21 characters, and 260 px wide at 390 px and holds 24. A string of 21 characters or fewer
 * fits at both widths. `test-results/header-title-fit/<locale>.json` has the overflow of each.
 */
export const KNOWN_TITLE_OVERFLOWS: readonly KnownTitleOverflow[] = [
  { locale: 'de', titleKey: 'describe.title', routes: ['/add/describe'], viewports: [360, 390] },
  { locale: 'de', titleKey: 'settings.rows.meals.title', routes: ['/meals'], viewports: [360] },
  { locale: 'en', titleKey: 'research.title', routes: ['/settings/research'], viewports: [360] },
  { locale: 'es', titleKey: 'nutrition.title', routes: ['/settings/nutrition'], viewports: [360] },
  { locale: 'es', titleKey: 'research.title', routes: ['/settings/research'], viewports: [360, 390] },
  { locale: 'es', titleKey: 'settings.data.title', routes: ['/settings/data'], viewports: [360, 390] },
  { locale: 'fr', titleKey: 'nutrition.title', routes: ['/settings/nutrition'], viewports: [360] },
  { locale: 'fr', titleKey: 'research.title', routes: ['/settings/research'], viewports: [360, 390] },
  { locale: 'it', titleKey: 'about.title', routes: ['/settings/about'], viewports: [360, 390] },
  { locale: 'it', titleKey: 'catchUp.title', routes: ['/catch-up'], viewports: [360, 390] },
  { locale: 'it', titleKey: 'nutrition.title', routes: ['/settings/nutrition'], viewports: [360, 390] },
  { locale: 'it', titleKey: 'profile.title', routes: ['/settings/profile'], viewports: [360] },
  { locale: 'it', titleKey: 'research.title', routes: ['/settings/research'], viewports: [360] },
];

/** What a guard found, set against what the list expected. */
export interface OverflowPartition<Found, Known> {
  /** Findings a list entry names. */
  explained: Found[];
  /** Findings nothing names: a title that does not fit and is not waiting for a shorter string. */
  unexplained: Found[];
  /** Entries no finding matched: titles that fit now and must be deleted from the list. */
  stale: Known[];
}

/**
 * Splits what a guard found against what the list expected.
 *
 * @param options.found - the overflows the guard measured.
 * @param options.known - the list entries the guard can observe in this run.
 * @param options.isMatch - whether a finding is the place an entry names.
 * @returns the findings an entry explains, the findings nothing explains, and the entries no
 *   finding matched, which are titles that now fit and must be deleted from the list.
 */
export function partitionKnownOverflows<Found, Known>({
  found,
  known,
  isMatch,
}: {
  found: readonly Found[];
  known: readonly Known[];
  isMatch: (finding: Found, entry: Known) => boolean;
}): OverflowPartition<Found, Known> {
  return {
    explained: found.filter((finding) => known.some((entry) => isMatch(finding, entry))),
    unexplained: found.filter((finding) => !known.some((entry) => isMatch(finding, entry))),
    stale: known.filter((entry) => !found.some((finding) => isMatch(finding, entry))),
  };
}

/**
 * Whether a requested path is one a route pattern names, with `:param` matching one segment.
 *
 * @param options.pattern - a path from {@link KnownTitleOverflow.routes}.
 * @param options.path - the path a guard requested.
 * @returns true when every segment agrees.
 */
export function routeMatches({ pattern, path }: { pattern: string; path: string }): boolean {
  const want = pattern.split('/');
  const have = path.split('/');
  if (want.length !== have.length) return false;
  return want.every((segment, index) => segment.startsWith(':') || segment === have[index]);
}
