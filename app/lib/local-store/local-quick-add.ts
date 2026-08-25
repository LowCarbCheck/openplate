/**
 * Local-first counterparts to `app/models/food-logs.server.ts`'s recent-foods
 * ranking (`listRecentFoodsForUser`) and `app/lib/quick-add-search.ts`'s
 * candidate federation, operating on the primary store's `LocalFoodLog`/
 * `LocalPersonalFood` shapes (string ids, `Macros` already-parsed numbers)
 * instead of Drizzle rows (numeric ids, numeric-string macros). Pure — no
 * store, no browser — so the diary/add clientLoaders are a thin shell over
 * these (mirrors the split `aggregates.ts` already established for daily
 * totals/streaks).
 *
 * M117/03: the route cutover moves `/diary` and `/add`'s reads off the server
 * entirely, so their "recent foods" / "frequent chips" / "quick-add search
 * candidates" logic needs a local-data equivalent of the three server-side
 * pure modules it used to call. The ranking rules are identical to the
 * server originals — only the id type and input shape differ.
 *
 * M12x (household portions): candidates now carry a `defaultPortion`
 * alongside `defaultGrams` — selecting a food preselects its most natural
 * portion (an upstream `portionSize`, or the small built-in household-unit
 * table in `#app/lib/portions`) instead of a flat 100 g. Recent foods pass
 * through whatever `DisplayPortion` the underlying log actually recorded
 * (the real historical choice beats a fresh guess); custom/curated foods
 * resolve one fresh via `resolveDefaultPortion`.
 */
import type { Macros } from '#app/lib/macros';
import type { MicronutrientsPer100g } from '#app/lib/micronutrients';
import type { FoodMatch } from '#app/services/food-resolution';
import { toCuratedSource } from '#app/services/food-resolution/apply-match';
import { chipCarbStatus } from '#app/lib/frequent-chips';
import type { CarbStatus } from '#app/utils/carb-status';
import type { CarbBasis } from '#app/lib/net-carbs';
import { snapshotToPer100gAtGrams } from '#app/lib/quick-add-search';
import { FALLBACK_PORTION_GRAMS, portionToGrams, resolveDefaultPortion, type DisplayPortion } from '#app/lib/portions';
import type { LocalFoodLog, LocalPersonalFood } from './schema';

/** Case-insensitive, whitespace-trimmed dedupe key for a food/candidate name. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Recent foods (local counterpart to `listRecentFoodsForUser`)
// ---------------------------------------------------------------------------

/** A previously-logged local food, deduped by lowercased name, for quick re-logging. */
export interface LocalRecentFood {
  /** The most recent casing the user logged this name under. */
  name: string;
  /** Grams of the most recent log for this name. */
  lastQuantityGrams: number;
  /** Epoch-ms this name was most recently logged. */
  lastLoggedAt: number;
  /** How many log entries share this (lowercased) name. */
  timesLogged: number;
  /** The most recent log's linked personal-food LOCAL id, if any. */
  foodId: string | null;
  /** The most recent log's curated provenance token, if any. */
  curatedSource: string | null;
  /** Whether the most recent log's macros were AI-estimated. */
  aiEstimated: boolean;
  /** The most recent log's per-serving macro snapshot. */
  macros: Macros;
  /** The most recent log's chosen display portion ("2 eggs"), or null for a gram-only log. */
  portion: DisplayPortion | null;
  /**
   * The most recent log's licence credit, or null when it had none. Carried
   * because re-logging a food from the "Recent" list produces a NEW entry from
   * the SAME credited data — the entry would otherwise claim the original's
   * `curatedSource` (which this row already passes through) while silently
   * dropping the CC BY credit that has to travel with it.
   */
  attribution: string | null;
  /**
   * The most recent log's AUTHORITATIVE per-100g net carbs, passed through
   * VERBATIM — all three of its states intact (see `LocalFoodLog.netCarbsPer100g`).
   * Deliberately not `?? null`-normalized the way `portion`/`attribution` above
   * are: for those two, "never captured" and "the source had none" are
   * indistinguishable to a reader, whereas here `null` ("upstream was consulted
   * and had none — never fabricate a 0") is a captured fact that absent isn't.
   *
   * This field is its own gate: it is only ever set on a log whose figure came
   * from an upstream source, so a recent food derived from a manual or
   * AI-estimated log simply has none and the re-log correctly stores none.
   */
  netCarbsPer100g?: number | null;
  /**
   * The most recent log's printed-panel convention, passed through VERBATIM
   * (see `LocalFoodLog.carbBasis`). Governs the compute-from-parts fallback
   * `chipCarbStatus`/`computeMacroPreview` fall into when `netCarbsPer100g`
   * above is absent — the exact gap a re-logged EU-basis manual food fell
   * through before spec 13 (M123): its per-100g badge/chip double-subtracted
   * fibre on the very list this row feeds.
   */
  carbBasis?: CarbBasis;
  /**
   * The most recent log's per-100 g vitamins/minerals snapshot, passed through
   * VERBATIM with every state intact (see `LocalFoodLog.micronutrientsPer100g`).
   * Re-logging a food from the "Recent" list is a new use of the SAME upstream
   * data, so the micronutrient dimension has to survive it — dropping it here
   * would silently turn a covered food into an uncovered one purely because of
   * which screen it was logged from, and the day's coverage would move for a
   * reason that has nothing to do with what the person ate.
   */
  micronutrientsPer100g?: MicronutrientsPer100g;
}

interface RecentBucket {
  latest: LocalFoodLog;
  timesLogged: number;
}

/**
 * Derives a ranked recent-foods list from the primary store's food logs:
 * grouped by lowercased name, most-often-logged first (ties broken by
 * recency), each row carrying its most recent log's snapshot to reuse for a
 * re-log. Same ranking rule as `listRecentFoodsForUser`.
 *
 * @param logs - every local food log, any order.
 * @param options - `limit` on the number of distinct foods returned.
 * @returns the distinct recent foods, most-logged first.
 */
export function computeLocalRecentFoods(
  logs: readonly LocalFoodLog[],
  { limit }: { limit: number },
): LocalRecentFood[] {
  const buckets = new Map<string, RecentBucket>();
  for (const log of logs) {
    const key = nameKey(log.name);
    if (key === '') continue;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { latest: log, timesLogged: 1 });
      continue;
    }
    existing.timesLogged += 1;
    if (log.loggedAt > existing.latest.loggedAt) existing.latest = log;
  }
  return Array.from(buckets.values())
    .toSorted((a, b) => b.timesLogged - a.timesLogged || b.latest.loggedAt - a.latest.loggedAt)
    .slice(0, limit)
    .map(({ latest, timesLogged }) => ({
      name: latest.name,
      lastQuantityGrams: latest.quantityGrams,
      lastLoggedAt: latest.loggedAt,
      timesLogged,
      foodId: latest.foodId,
      curatedSource: latest.curatedSource,
      aiEstimated: latest.aiEstimated,
      macros: latest.macros,
      portion: latest.portion ?? null,
      attribution: latest.attribution ?? null,
      // Verbatim, NOT `?? null` — see the field's doc: absent and null mean
      // different things here.
      netCarbsPer100g: latest.netCarbsPer100g,
      carbBasis: latest.carbBasis,
      // Verbatim for the same reason, one level deeper: an absent snapshot, an
      // absent block inside one, and a `null` figure inside a block are three
      // different facts, and only the third could ever be confused with a zero.
      micronutrientsPer100g: latest.micronutrientsPer100g,
    }));
}

// ---------------------------------------------------------------------------
// Frequent chips (local counterpart to `selectFrequentChips`)
// ---------------------------------------------------------------------------

/**
 * A ready-to-render quick-add chip, local counterpart of `FrequentChip`.
 *
 * Every field describing the FOOD (as opposed to the chip's own presentation)
 * has to be here, because tapping a chip re-logs that food — the chip form is a
 * complete entry-creating path, not a shortcut into another one. Three fields
 * were missing for exactly that reason and a tapped favourite re-logged as a
 * credit-less, portion-less entry reading 0 g net carbs.
 */
export interface LocalFrequentChip {
  name: string;
  lastQuantityGrams: number;
  macros: Macros;
  foodId: string | null;
  curatedSource: string | null;
  aiEstimated: boolean;
  timesLogged: number;
  carbStatus: CarbStatus | null;
  /** The portion this chip last logged ("2 eggs"), or null for a gram-only log. */
  portion: DisplayPortion | null;
  /** The licence credit the underlying log carried, or null when it had none — same obligation, same rule as `LocalRecentFood.attribution`. */
  attribution: string | null;
  /** The underlying log's authoritative per-100g net carbs, verbatim — see `LocalRecentFood.netCarbsPer100g`. */
  netCarbsPer100g?: number | null;
  /** The underlying log's printed-panel convention, verbatim — see `LocalRecentFood.carbBasis`. */
  carbBasis?: CarbBasis;
  /** The underlying log's per-100 g micronutrients, verbatim — see `LocalRecentFood.micronutrientsPer100g`. */
  micronutrientsPer100g?: MicronutrientsPer100g;
}

/**
 * Picks the chip-worthy local recent foods: those logged at least
 * `minTimesLogged` times, capped at `limit`, preserving the input's
 * most-frequent-first order. Reuses the server module's pure `chipCarbStatus`
 * (macro/grams only — no id dependency, so it's directly shareable).
 *
 * @param recents - the local recent foods, pre-ranked most-frequent first.
 * @param options - `limit` (max chips) and `minTimesLogged` (eligibility floor).
 * @returns the selected chips, ready to render.
 */
export function selectLocalFrequentChips(
  recents: readonly LocalRecentFood[],
  { limit, minTimesLogged }: { limit: number; minTimesLogged: number },
): LocalFrequentChip[] {
  return recents
    .filter((recent) => recent.timesLogged >= minTimesLogged)
    .slice(0, limit)
    .map((recent) => ({
      name: recent.name,
      lastQuantityGrams: recent.lastQuantityGrams,
      macros: recent.macros,
      foodId: recent.foodId,
      curatedSource: recent.curatedSource,
      aiEstimated: recent.aiEstimated,
      timesLogged: recent.timesLogged,
      // The traffic-light dot follows the SAME figure the entry will be logged
      // with — without the authoritative override a fibre-heavy curated food
      // shows a green dot on the chip and a red badge everywhere else.
      carbStatus: chipCarbStatus(recent.macros, recent.lastQuantityGrams, {
        authoritativeNetCarbsPer100g: recent.netCarbsPer100g,
        carbBasis: recent.carbBasis,
      }),
      portion: recent.portion,
      attribution: recent.attribution,
      netCarbsPer100g: recent.netCarbsPer100g,
      carbBasis: recent.carbBasis,
      micronutrientsPer100g: recent.micronutrientsPer100g,
    }));
}

// ---------------------------------------------------------------------------
// Quick-add candidate federation (local counterpart to `quick-add-search.ts`)
// ---------------------------------------------------------------------------

/** Which of the three federated sources a candidate came from. */
export type LocalQuickAddSource = 'recent' | 'custom' | 'curated';

/** A single local logging candidate, normalized across all three sources into one row shape. */
export interface LocalQuickAddCandidate {
  source: LocalQuickAddSource;
  name: string;
  macrosPer100g: Macros;
  /**
   * This candidate's AUTHORITATIVE per-100g net carbs — the same three-state
   * contract as `LocalFoodLog.netCarbsPer100g` and `computeMacroPreview`'s
   * `authoritativeNetCarbsPer100g` parameter, which is why it carries that
   * exact name:
   *  - `undefined` — no upstream figure exists for this candidate. Readers
   *    fall back to `carbs - fiber - polyols` from `macrosPer100g`, which is
   *    the correct answer for a personal food or a self-logged manual entry.
   *  - `null` — an upstream source WAS consulted and its figure is genuinely
   *    unknown for this food. Never fabricate a 0 from it.
   *  - a number — the figure wins outright over the parts.
   *
   * It used to be a 2-state `number | null` holding EITHER an upstream figure
   * (curated) OR a locally re-derived display estimate (recent/custom), and
   * that conflation is what forced `PortionStep` to gate persistence on
   * `source === 'curated'`: with an estimate indistinguishable from a real
   * figure, only the SOURCE TIER could say which was safe to store. The gate
   * then dropped the genuine figure a `'recent'` candidate inherits from its
   * own log, so one favourite food logged two ways produced two different day
   * totals. Splitting the states apart is what lets the persist decision
   * follow from the DATA (`encodeAuthoritativeNetCarbs` maps `undefined`
   * straight back to "no figure"), exactly as the diary's chip re-log already
   * does — see `PortionStep` in `app/routes/add.tsx`.
   *
   * There is deliberately NO sibling "estimate" field: the estimate is not a
   * fact about the candidate, it is what a reader computes when no
   * authoritative figure exists, and `computeMacroPreview` already implements
   * exactly that fallback. A second stored copy would have to hold the
   * double-subtracted 0 for curated foods and sit there waiting for a consumer
   * to read the wrong one.
   *
   * REQUIRED but nullable AND undefined-able, rather than `?:`, on purpose:
   * every candidate is built by hand in a factory below, so the compiler must
   * force each one to state its answer explicitly. `?:` would let a new
   * factory silently omit the field — which type-checks, quietly reverts that
   * source to the naive local formula, and reintroduces this exact bug with no
   * compiler complaint. (`LocalFoodLog`/`LocalRecentFood` use `?:` for the
   * opposite reason: there, absence is a real storage state — an on-device row
   * written before the field existed simply lacks the key.)
   */
  authoritativeNetCarbsPer100g: number | null | undefined;
  /**
   * This candidate's printed-panel convention, governing the compute-from-
   * parts fallback `computeMacroPreview`/`chipCarbStatus` fall into whenever
   * `authoritativeNetCarbsPer100g` above is `undefined` — i.e. exactly the
   * candidates that reach the fallback at all. `?:`, NOT the required-but-
   * undefined-able style the field above uses: there is no second, wrong
   * value a factory could silently fall back to here — omitting the key
   * yields UNKNOWN, which `computeNetCarbsFromParts` (`#app/lib/net-carbs`)
   * already treats as `total`, the correct legacy behaviour. A `'curated'`
   * candidate never sets this: LCC's `FoodMatch` has no basis field of its
   * own and always carries an authoritative figure (number or explicit
   * `null`), so its fallback branch is never reached.
   */
  carbBasis?: CarbBasis;
  /**
   * Grams to prefill when this candidate is selected. Derived from
   * `defaultPortion` when one resolves (see that field), otherwise
   * `FALLBACK_PORTION_GRAMS` — never a hardcoded flat 100 g regardless of the
   * food (M12x fix; `'recent'` is the one exception, see `defaultPortion`'s
   * doc, and always uses the exact last-logged grams here).
   */
  defaultGrams: number;
  /**
   * The most natural DISPLAY portion for this candidate ("1 egg"), for the
   * future unit-aware chip UI (`#app/lib/portions`'s `derivePortionChoices`)
   * to render instead of the old flat multiplier chips. Null when no
   * defensible unit exists (grams-only candidate — `defaultGrams` is then
   * the plain-grams prefill). For `source: 'recent'` this is the ACTUAL
   * portion the person chose last time (passed through from the log, never
   * re-derived) — more accurate than a fresh guess, and consistent with
   * `defaultGrams` there always being the exact last-logged amount too.
   */
  defaultPortion: DisplayPortion | null;
  curatedSource: string | null;
  /** Linked personal-food LOCAL id to reuse when logging, else null. */
  foodId: string | null;
  aiEstimated: boolean;
  imageUrl: string | null;
  timesLogged: number;
  url: string | null;
  attribution: string | null;
  /**
   * This candidate's per-100 g vitamins/minerals, carried through to the entry
   * it logs. Absent for every candidate whose source has no micronutrient
   * dimension — a personal food, a manual entry, an AI plate estimate, or a
   * BLS/FDC-origin match. That absence is the honest answer and the aggregation
   * counts it as UNCOVERED; it is never stood in for by a block of zeros.
   *
   * `?:` rather than the required-but-undefined-able style
   * `authoritativeNetCarbsPer100g` uses above, because unlike that field there
   * is no second, wrong value a factory could silently fall back to: omitting
   * it yields "no micronutrients", which is exactly what a source without them
   * should claim.
   */
  micronutrientsPer100g?: MicronutrientsPer100g;
}

/** The grams a candidate should prefill for a resolved (or absent) default portion. */
function candidateDefaultGrams(defaultPortion: DisplayPortion | null): number {
  return defaultPortion ? portionToGrams(defaultPortion) : FALLBACK_PORTION_GRAMS;
}

/**
 * Normalizes a local recent food (per-serving snapshot) onto its recovered
 * per-100g basis.
 *
 * Its authoritative figure is the ORIGINAL LOG's own, passed through verbatim
 * with all three states intact — never re-derived from the macros above. This
 * row IS the same food the diary's favourite chip re-logs, so the two paths
 * have to store the same number: re-deriving here made one favourite produce
 * two different day totals depending on whether it was tapped on /diary or
 * picked from /add's "Recent" list. Like the chip, this needs no source-tier
 * gate, because the underlying log's figure was already gated at ITS write
 * time — the data is the gate.
 */
export function localRecentFoodToCandidate(recent: LocalRecentFood): LocalQuickAddCandidate {
  const macrosPer100g = snapshotToPer100gAtGrams({ snapshot: recent.macros, grams: recent.lastQuantityGrams });
  return {
    source: 'recent',
    name: recent.name,
    macrosPer100g,
    authoritativeNetCarbsPer100g: recent.netCarbsPer100g,
    carbBasis: recent.carbBasis,
    defaultGrams: recent.lastQuantityGrams,
    defaultPortion: recent.portion,
    curatedSource: recent.curatedSource,
    foodId: recent.foodId,
    aiEstimated: recent.aiEstimated,
    imageUrl: null,
    timesLogged: recent.timesLogged,
    url: null,
    // Passed through, not dropped: the credit belongs to the DATA, so it has
    // to survive a re-log exactly as `curatedSource` above does.
    attribution: recent.attribution,
    // Same rule, same reason: the micronutrients belong to the food, so they
    // survive a re-log rather than being re-looked-up (or lost).
    micronutrientsPer100g: recent.micronutrientsPer100g,
  };
}

/**
 * Normalizes a local personal food (already per-100g) into a candidate. Its
 * default portion comes from the built-in household-unit table only (a
 * personal food has no upstream `portionSize`) — see `resolveDefaultPortion`.
 *
 * The authoritative figure is the FOOD's OWN, passed through verbatim with all
 * three states intact — never re-derived from the macros above, and never
 * hardcoded. This line used to be a flat `undefined` on the reasoning that "the
 * person who typed these macros IS the source", which is true of a hand-typed
 * food and false of the other way a personal food gets created: `handleConfirm`
 * in `app/routes/scan.tsx` creates one from an APPLIED CURATED MATCH's macros,
 * which really do come from upstream. The food row had nowhere to keep the
 * figure, so /add's "Your food" row for a scanned-and-matched wheat bran
 * re-derived `21.7 - 42.8` and rendered a green 0 while the very same food's
 * diary entry read 21.7 — one food, two screens, two numbers.
 *
 * Like the recent-food and chip paths, this needs no source-tier gate: the
 * figure was already gated at the food's WRITE time (a manual entry and a plain
 * AI plate estimate store none, so their candidates correctly claim none, and
 * `computeMacroPreview` computes the local estimate from the parts for them).
 * The data is the gate.
 */
export function localFoodToCandidate(food: LocalPersonalFood): LocalQuickAddCandidate {
  const defaultPortion = resolveDefaultPortion({ name: food.name, portionSizeGrams: null });
  return {
    source: 'custom',
    name: food.name,
    macrosPer100g: food.macrosPer100g,
    authoritativeNetCarbsPer100g: food.netCarbsPer100g,
    carbBasis: food.carbBasis,
    defaultGrams: candidateDefaultGrams(defaultPortion),
    defaultPortion,
    curatedSource: null,
    foodId: food.id,
    aiEstimated: false,
    imageUrl: null,
    timesLogged: 0,
    url: null,
    attribution: null,
    // The FOOD's OWN snapshot, passed through verbatim with every state intact
    // — never re-derived, never stood in for by zeros. This line used to be a
    // deliberate omission on the reasoning that a personal food has no
    // micronutrient dimension, which was true only because `LocalPersonalFood`
    // had nowhere to keep one (v10 gave it one). While it was absent, the same
    // saved food contributed full coverage when re-logged from "Recent" and
    // ZERO when re-logged from "Your foods" — the exact asymmetry
    // `authoritativeNetCarbsPer100g` above had one bump earlier.
    //
    // Needs no source-tier gate, like every sibling here: the snapshot was
    // already gated at the food's WRITE time (a hand-typed manual food and a
    // plain AI plate estimate store none, so their candidates correctly claim
    // none and their entries count as uncovered). The data is the gate.
    micronutrientsPer100g: food.micronutrientsPer100g,
  };
}

/**
 * Normalizes a curated LowCarbCheck match (already per-100g) into a local
 * candidate (never linked to a personal food). `authoritativeNetCarbsPer100g`
 * is LCC's own origin-aware figure passed straight through — NOT recomputed
 * from `macrosPer100g` here, since a naive `carbs - fiber` recompute is wrong
 * for sources with a fiber-EXCLUSIVE carb convention and fabricates a
 * confident value for the many curated rows where fiber is genuinely unknown
 * (`fiber: null`, not `0`). A `null` from LCC stays `null` (upstream consulted,
 * genuinely unknown) rather than collapsing to "no figure".
 *
 * Its default portion prefers LCC's own `portionSize` (a per-food
 * measurement) over the generic household-unit reference weight, and matches
 * the household-unit NAME against `canonicalName` (English) rather than the
 * localized `title` — see `resolveDefaultPortion`'s doc.
 */
export function localCuratedMatchToCandidate(match: FoodMatch): LocalQuickAddCandidate {
  const defaultPortion = resolveDefaultPortion({ name: match.canonicalName, portionSizeGrams: match.portionSize });
  return {
    source: 'curated',
    name: match.title,
    macrosPer100g: { ...match.macrosPer100g },
    authoritativeNetCarbsPer100g: match.netCarbsPer100g,
    // `carbBasis` deliberately omitted (stays `undefined`): `FoodMatch` has no
    // basis field of its own, and this candidate always carries an
    // authoritative figure (a number or an explicit `null`), so the
    // compute-from-parts fallback `carbBasis` governs is never reached for a
    // curated candidate — see `LocalQuickAddCandidate.carbBasis`'s doc.
    defaultGrams: candidateDefaultGrams(defaultPortion),
    defaultPortion,
    curatedSource: toCuratedSource(match.slug),
    foodId: null,
    aiEstimated: false,
    imageUrl: match.imageUrl,
    timesLogged: 0,
    url: match.url,
    attribution: match.attribution,
    // LCC's own per-100 g vitamins/minerals, passed straight through with the
    // absent-block distinction intact — the ONE place in the app where a
    // micronutrient figure originates.
    micronutrientsPer100g: match.micronutrientsPer100g,
  };
}

/**
 * Federates the three already-ranked local sources into one list: recents
 * first, then custom foods, then curated matches, deduped by (lowercased)
 * name. Same merge rule as `federateQuickAddCandidates`.
 *
 * @param sources - the per-source candidate lists.
 * @returns the merged, deduped candidate list in priority order.
 */
export function federateLocalQuickAddCandidates({
  recent,
  custom,
  curated,
}: {
  recent: LocalQuickAddCandidate[];
  custom: LocalQuickAddCandidate[];
  curated: LocalQuickAddCandidate[];
}): LocalQuickAddCandidate[] {
  const seen = new Set<string>();
  const merged: LocalQuickAddCandidate[] = [];
  for (const candidate of [...recent, ...custom, ...curated]) {
    const key = nameKey(candidate.name);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
}
