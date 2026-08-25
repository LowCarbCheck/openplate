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
 * `CarbBasis` names which convention a printed panel used, deliberately
 * matching lowcarbcheck's own vocabulary (`carbBasisForOrigin` in
 * `lowcarbcheck/apps/remix-lcc/app/lib/food-api/mappers.ts`, the `carbBasis`
 * prop on `CarbCheck.tsx`) — two apps solving the same problem, one name for
 * it. Unlike lowcarbcheck's origin-derived default, openplate carries the
 * flag PER FOOD/LOG (see `#app/lib/local-store/schema`'s `carbBasis` doc
 * comment for the full precedence and legacy-data rules) rather than
 * inferring it from where the row came from.
 */

/** The two printed-panel conventions this app distinguishes. */
export const CARB_BASES = ['total', 'available'] as const;

/**
 * `total` — a US "Total Carbohydrate" panel: the printed carbs figure
 * INCLUDES fibre, so net carbs subtract both fibre and polyols. This is
 * today's original formula, unchanged, and is also what an ABSENT/UNKNOWN
 * basis means — see the module doc and `#app/lib/local-store/schema`.
 *
 * `available` — an EU "Kohlenhydrate"/"carbohydrate" panel: the printed
 * carbs figure ALREADY EXCLUDES fibre (fibre is its own separate row), so
 * net carbs subtract only polyols. Polyols still get subtracted because an
 * EU panel prints them as "of which polyols" INSIDE the carbohydrate figure,
 * unlike fibre.
 */
export type CarbBasis = (typeof CARB_BASES)[number];

/** The macro parts the formula reads. A subset of `Macros` so callers don't need the whole shape. */
export interface NetCarbsParts {
  carbs: number | null;
  fiber: number | null;
  polyols: number | null;
}

/**
 * Computes net carbs from raw macro parts, honouring which printed-panel
 * convention produced `carbs`. This is the fallback formula ONLY — callers
 * with an authoritative `netCarbsPer100g`/`netCarbs` figure must use that
 * instead and never call this (see the module doc).
 *
 * `basis` is `undefined` for every row logged before this field existed and
 * for any row where the person never set it (`LocalFoodLog.carbBasis` /
 * `LocalPersonalFood.carbBasis` absent). UNKNOWN is treated EXACTLY as
 * `total` — the original formula — so this function changes zero existing
 * numbers for legacy data; see spec 13's Decision for the full rationale
 * (guessing `available` for unknown rows would silently overstate every
 * US-basis food instead).
 *
 * Not clamped at zero — callers that need the floor (day totals, chip
 * classification) apply it themselves, same convention as the formula this
 * replaces.
 *
 * @param parts - the row's carbs/fiber/polyols.
 * @param basis - which panel convention `parts.carbs` was read from; `undefined` means unknown (treated as `total`).
 * @returns net carbs, or `null` when `carbs` itself is unknown — never a fabricated `0`.
 */
export function computeNetCarbsFromParts(parts: NetCarbsParts, basis?: CarbBasis): number | null {
  if (parts.carbs === null) return null;
  if (basis === 'available') return parts.carbs - (parts.polyols ?? 0);
  return parts.carbs - (parts.fiber ?? 0) - (parts.polyols ?? 0);
}

/**
 * Narrows a raw form value (a radio/select's submitted string) to a
 * `CarbBasis`. Anything unrecognised — including a blank field, i.e. "not
 * sure" — resolves to `null`, never a guess. Same convention as
 * `parseBiologicalSex`/`parseReproductiveStatus` in `#app/models/body-metrics`:
 * an unreadable answer here is a legitimate answer, not an error.
 *
 * @param raw - the raw form value.
 * @returns a valid `CarbBasis`, or `null` for "not sure"/unrecognised.
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
 * exactly like a food with no origin fact at all; `computeNetCarbsFromParts`
 * already treats `undefined` as `total`, so a genuinely US-basis food that
 * arrives under a new origin name still nets out correctly by default, while
 * a genuinely EU-basis one under a new name is merely un-derived (safe: the
 * person can still set the basis by hand on the edit form) rather than wrong.
 *
 * @param origin - the match's `FoodMatch.origin` (`"curated"`, `"bls"`, `"user"`, `"fdc"`, an unrecognised string, or `null`).
 * @returns the basis that origin's printed panel uses, or `undefined` when the origin is absent or not one this function recognises.
 */
export function carbBasisForOrigin(origin: string | null): CarbBasis | undefined {
  if (origin === 'bls' || origin === 'curated') return 'available';
  if (origin === 'fdc' || origin === 'user') return 'total';
  return undefined;
}
