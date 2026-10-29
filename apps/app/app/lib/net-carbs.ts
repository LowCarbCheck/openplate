/**
 * The one place `net carbs = carbs − fiber (maybe) − polyols` gets computed
 * from a food's raw macro parts. Everything upstream of this file that
 * already has an AUTHORITATIVE per-100g figure (`LocalFoodLog.netCarbsPer100g`
 * / `LocalPersonalFood.netCarbsPer100g`) bypasses it entirely — that figure
 * always wins outright (see those fields' doc comments in
 * `#app/lib/local-store/schema`). This module is only the fallback used when
 * no such figure was snapshotted, i.e. hand-typed manual foods, AI plate
 * estimates, and any entry logged before this field existed.
 *
 * Spec 13 (M123): openplate used ONE formula, `carbs − fiber − polyols`,
 * for that fallback everywhere, silently assuming every printed carb figure
 * already includes fibre (the US "Total Carbohydrate" convention). An EU
 * panel's "Kohlenhydrate" / "carbohydrate" figure does NOT include fibre —
 * fibre is its own separate row, not an "of which" — so applying the US
 * formula to an EU-basis reading subtracts fibre a SECOND time and floors a
 * genuinely high-carb food to a false, confident low number. Understating is
 * the dangerous direction for a low-carb tracker: see spec 13's Ground Truth.
 *
 * Spec 13 still read an UNKNOWN basis as `total`, and unknown is the common
 * case: the manual and custom food forms default to it, a scan whose model
 * answers `null` stores it, every AI estimate and every entry logged before
 * 2026-08-25 carries it. So a German pack typed in as "carbs 10, fibre 6"
 * read 4 g instead of 10 (operator report, 2026-10-29). Since then no reader
 * decides on its own: `resolveCarbBasis` turns a stated or missing basis into
 * a definite one, from the numbers, and every function below goes through it.
 *
 * `CarbBasis` names which convention a printed panel used, deliberately
 * matching lowcarbcheck's own vocabulary (`carbBasisForOrigin` in
 * `lowcarbcheck/apps/remix-lcc/app/lib/food-api/mappers.ts`, the `carbBasis`
 * prop on `CarbCheck.tsx`) — two apps solving the same problem, one name for
 * it. Unlike lowcarbcheck's origin-derived default, openplate carries the
 * flag PER FOOD/LOG (see `#app/lib/local-store/schema`'s `carbBasis` doc
 * comment) rather than inferring it from where the row came from. A stored
 * row keeps only what was STATED; the resolved basis is never written back,
 * so a better rule here re-reads every old entry on its next render.
 */
import type { Macros } from '#app/lib/macros';

/** The two printed-panel conventions this app distinguishes. */
export const CARB_BASES = ['total', 'available'] as const;

/**
 * `total` — a US "Total Carbohydrate" panel: the printed carbs figure
 * INCLUDES fibre, so net carbs subtract both fibre and polyols.
 *
 * `available` — an EU "Kohlenhydrate"/"carbohydrate" panel: the printed
 * carbs figure ALREADY EXCLUDES fibre (fibre is its own separate row), so
 * net carbs subtract only polyols. Polyols still get subtracted because an
 * EU panel prints them as "of which polyols" INSIDE the carbohydrate figure,
 * unlike fibre.
 *
 * A row with no stated basis is neither until `resolveCarbBasis` reads its
 * numbers, see there.
 */
export type CarbBasis = (typeof CARB_BASES)[number];

/**
 * What every net carbs reader hands over: the basis someone stated, and the
 * full macros it is resolved from when nobody did.
 *
 * Every key is REQUIRED, and `explicit` is required even though its value may
 * be `undefined`. M123 shipped broken twice through a call site that left an
 * optional basis out, so the compiler now names every caller that forgets one.
 */
export interface CarbBasisInput {
  /** The basis a person, a label scan or a source stated, or `undefined` when nobody did. */
  explicit: CarbBasis | undefined;
  /** The food's macros for `grams` of it, every one present, unknown ones `null`. */
  macros: Readonly<Macros>;
  /**
   * How many grams `macros` describe: `100` for a per-100 g row, the serving
   * weight for a logged entry. The evidence below is weighed per 100 g, the
   * scale a label rounds at, so a 30 g serving and its food agree.
   */
  grams: number;
}

/** A US total of carbs always holds its fibre, so fibre above carbs by more than label rounding is an EU panel. */
const FIBER_OVER_CARBS_TOLERANCE_G = 0.5;

/** Sugars and fibre both sit inside a US total, so their sum above carbs by more than this is an EU panel. */
const SUGARS_AND_FIBER_OVER_CARBS_TOLERANCE_G = 1;

/** Below this much fibre per 100 g the two energy models are too close to tell apart. */
const MIN_FIBER_FOR_ENERGY_CHECK_G = 2;

/** The smallest kcal gap from the EU model that counts as "clearly not EU". */
const MIN_ENERGY_GAP_KCAL = 8;

/** The same gap as a share of the stated kcal, for energy-dense foods. */
const RELATIVE_ENERGY_GAP = 0.1;

/** Polyols at 2.4 kcal per gram, the EU figure (Regulation 1169/2011, Annex XIV). */
const KCAL_PER_GRAM_POLYOLS = 2.4;

/** The macros per 100 g, or `null` when the row has no positive weight to scale by. */
function per100g({ macros, grams }: Pick<CarbBasisInput, 'macros' | 'grams'>): Macros | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const scale = (value: number | null): number | null => (value === null ? null : (value * 100) / grams);
  return {
    carbs: scale(macros.carbs),
    fiber: scale(macros.fiber),
    sugars: scale(macros.sugars),
    polyols: scale(macros.polyols),
    protein: scale(macros.protein),
    fat: scale(macros.fat),
    kcal: scale(macros.kcal),
  };
}

/**
 * Reads the basis off the stated energy, or `undefined` when it cannot tell.
 *
 * The kcal the carbohydrate row must account for is what is left after
 * protein (4), fat (9) and polyols (2.4). On an EU panel that remainder is
 * `4 * carbs + 2 * fiber`. On a US panel the carbs figure already holds the
 * fibre, so the remainder lies between `4 * carbs - 4 * fiber` (fibre counted
 * as nothing) and `4 * carbs` (fibre counted at 4). `total` needs the
 * remainder on the US side of the midpoint AND clearly away from the EU model;
 * `available` needs it at or above `4 * carbs + fiber`.
 */
function basisFromEnergy(macros: Macros): CarbBasis | undefined {
  const { kcal, protein, fat, carbs, fiber } = macros;
  if (kcal === null || protein === null || fat === null || carbs === null || fiber === null) return undefined;
  if (fiber < MIN_FIBER_FOR_ENERGY_CHECK_G) return undefined;
  const remainder = kcal - 4 * protein - 9 * fat - KCAL_PER_GRAM_POLYOLS * (macros.polyols ?? 0);
  const euModel = 4 * carbs + 2 * fiber;
  const isUsSide = remainder <= 4 * carbs - 0.5 * fiber;
  const isFarFromEu = Math.abs(remainder - euModel) > Math.max(MIN_ENERGY_GAP_KCAL, RELATIVE_ENERGY_GAP * kcal);
  if (isUsSide && isFarFromEu) return 'total';
  if (remainder >= 4 * carbs + fiber) return 'available';
  return undefined;
}

/**
 * The basis a row's net carbs are computed on. Never `undefined`.
 *
 * 1. A stated basis wins: a person's pick, a label the scan read, a source
 *    whose convention is known.
 * 2. Fibre above carbs (beyond label rounding) is an EU panel: a US total
 *    always includes its fibre.
 * 3. Sugars plus fibre above carbs is an EU panel, for the same reason.
 * 4. The stated energy, when every figure it needs is known and the fibre is
 *    large enough to matter (see `basisFromEnergy`).
 * 5. Otherwise `available`. Wrong, it overstates net carbs by the fibre, which
 *    is the safe direction for a low-carb tracker; the opposite default
 *    understated an EU food's carbs as a confident green. With no fibre both
 *    bases give the same number anyway.
 *
 * The evidence is read per 100 g (see `CarbBasisInput.grams`).
 *
 * @param input - the stated basis, the macros and the grams they describe.
 * @returns the basis to compute on.
 */
export function resolveCarbBasis(input: CarbBasisInput): CarbBasis {
  if (input.explicit !== undefined) return input.explicit;
  const macros = per100g(input);
  if (macros === null || macros.carbs === null || macros.fiber === null) return 'available';
  if (macros.fiber > macros.carbs + FIBER_OVER_CARBS_TOLERANCE_G) return 'available';
  if (macros.sugars !== null && macros.sugars + macros.fiber > macros.carbs + SUGARS_AND_FIBER_OVER_CARBS_TOLERANCE_G) {
    return 'available';
  }
  return basisFromEnergy(macros) ?? 'available';
}

/**
 * Computes net carbs from raw macro parts, on the basis `resolveCarbBasis`
 * gives. This is the fallback formula ONLY: callers with an authoritative
 * `netCarbsPer100g`/`netCarbs` figure must use that instead and never call
 * this (see the module doc).
 *
 * Not clamped at zero — callers that need the floor (day totals, chip
 * classification) apply it themselves.
 *
 * @param input - the stated basis, the macros and the grams they describe.
 * @returns net carbs in the macros' own unit, or `null` when `carbs` itself is unknown, never a fabricated `0`.
 */
export function computeNetCarbsFromParts(input: CarbBasisInput): number | null {
  const { carbs, fiber, polyols } = input.macros;
  if (carbs === null) return null;
  if (resolveCarbBasis(input) === 'available') return carbs - (polyols ?? 0);
  return carbs - (fiber ?? 0) - (polyols ?? 0);
}

/**
 * The entry's TOTAL carbs, fibre included, whichever convention printed it.
 *
 * A `total` (US) panel prints carbs WITH fibre, so the figure is already the
 * total. An `available` (EU) panel prints carbs WITHOUT fibre, so the fibre
 * row is added back. Summing the printed figures of a day that mixes both
 * conventions is therefore wrong: the EU foods' fibre drops out of the sum,
 * and a ratio drawn from it understates carbs (the diary read 7 % where 6 % of
 * the calories and 13 % of the grams were right, 2026-10-13). This is the one
 * place that normalises, and `DaySummary.carbs` sums it. The basis is the same
 * one net carbs use, so the two figures can never disagree about a row.
 *
 * An unknown `fiber` counts as nothing, the same convention the day totals
 * use (`fiber ?? 0`); the day's `hasUnknowns` caveat is what says the fibre
 * row was missing.
 *
 * @param input - the stated basis, the macros and the grams they describe.
 * @returns total carbs in the macros' own unit, or `null` when `carbs` itself is unknown.
 */
export function computeTotalCarbsFromParts(input: CarbBasisInput): number | null {
  const { carbs, fiber } = input.macros;
  if (carbs === null) return null;
  if (resolveCarbBasis(input) === 'available') return carbs + (fiber ?? 0);
  return carbs;
}

/**
 * Narrows a raw form value (a radio/select's submitted string) to a
 * `CarbBasis`. Anything unrecognised — including a blank field, i.e.
 * "Automatic" — resolves to `null`, never a guess here: the guess is
 * `resolveCarbBasis`'s, made at read time from the numbers. Same convention as
 * `parseBiologicalSex`/`parseReproductiveStatus` in `#app/models/body-metrics`:
 * an unreadable answer here is a legitimate answer, not an error.
 *
 * @param raw - the raw form value.
 * @returns a valid `CarbBasis`, or `null` for "Automatic"/unrecognised.
 */
export function parseCarbBasis(raw: string | null | undefined): CarbBasis | null {
  return CARB_BASES.find((value) => value === raw) ?? null;
}

/**
 * Derives a `CarbBasis` from a curated `FoodMatch`'s `origin`, mirroring
 * lowcarbcheck's own `carbBasisForOrigin` in
 * `lowcarbcheck/apps/remix-lcc/app/lib/food-api/mappers.ts` (`bls`/`curated`
 * → `available`, `fdc`/`user` → `total`) — same vocabulary, same mapping, so
 * the two apps keep agreeing about which sources print a fibre-exclusive
 * carbohydrate figure.
 *
 * The one deliberate divergence: LCC's version has a closed return type and
 * falls through unrecognised origins to `total` as a default. `FoodMatch.origin`
 * is an OPEN union (see its doc comment on `#app/services/food-resolution/types`)
 * — LCC may ship a fifth origin tomorrow — so guessing `total` here would
 * silently apply the wrong formula to a basis this function was never taught.
 * An unrecognised or `null` origin therefore returns `undefined` (unknown),
 * exactly like a food with no origin fact at all, and `resolveCarbBasis`
 * then reads the basis from the food's own numbers (the person can still set
 * it by hand on the edit form).
 *
 * @param origin - the match's `FoodMatch.origin` (`"curated"`, `"bls"`, `"user"`, `"fdc"`, an unrecognised string, or `null`).
 * @returns the basis that origin's printed panel uses, or `undefined` when the origin is absent or not one this function recognises.
 */
export function carbBasisForOrigin(origin: string | null): CarbBasis | undefined {
  if (origin === 'bls' || origin === 'curated') return 'available';
  // `proposal` (M251/04, LowCarbCheck M205): a food LowCarbCheck published
  // from a proposal, which it stores on the total basis.
  if (origin === 'fdc' || origin === 'user' || origin === 'proposal') return 'total';
  return undefined;
}
