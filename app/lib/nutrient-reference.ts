/**
 * The reference-intake model behind `/nutrients` (M135/06) — the pure half.
 *
 * It turns three inputs into the rows the screen renders:
 *  1. the per-nutrient intake + coverage from `#app/lib/local-store/aggregates`,
 *  2. the optional body metrics from `#app/models/body-metrics`,
 *  3. LowCarbCheck's published reference intakes (EFSA DRVs), fetched fail-open.
 *
 * No DOM, no store, no clock — the current year is always a parameter, exactly
 * as `#app/models/body-metrics` takes one — so every branch below is pinnable
 * from `node:test`.
 *
 * ── The two rules this module exists to enforce ────────────────────────────
 *
 * **1. Never present a number we cannot stand behind.** `NutrientIntake` is the
 * discriminated union from the aggregation: `amount` is a `number` only on the
 * branch that also asserts the coverage bar was cleared. Nothing here widens
 * that, casts around it, or reconstructs a partial sum — a row whose intake is
 * `hasEnoughData: false` simply carries no figure and no share, and the screen
 * renders the explicit "not enough data" state instead of a bar.
 *
 * The same rule applies to the REFERENCE side. `ReferenceAmount` is a union
 * with four arms, three of which are refusals: no body metrics, an age below
 * the youngest published band, and no published reference for that nutrient.
 * There is deliberately no "default person" fallback — see
 * `resolveReferenceAmount`.
 *
 * **2. Never assert a bodily state.** This module produces amounts, shares and
 * refusals. It produces no verdict, no status tier, and no colour: "your log is
 * light on magnesium this week" is a statement about a food log, and that is the
 * strongest claim anything downstream of here is allowed to make (M135 locked
 * decision 2, DESIGN.md §10). Any function here that returned a
 * `'deficient' | 'adequate'`-shaped tier would be the bug.
 *
 * **A corollary: not every reference amount is a goal.** `NutrientKind` splits
 * them into `target` ("have you had enough?") and `ceiling` ("have you stayed
 * under?"). Sodium is the only ceiling today, and the distinction is carried on
 * the wire rather than hardcoded here. See `NutrientKind` and
 * `pickLightestNutrients` for what changes.
 */
import { z } from 'zod';
import { MINERAL_KEYS, NUTRIENT_KEYS, VITAMIN_KEYS } from '#app/lib/micronutrients';
import type { NutrientKey } from '#app/lib/micronutrients';
import { getCarbStatus } from '#app/utils/carb-status';
import { RDA_AGE_BANDS, resolveAgeBandForBirthYear } from '#app/models/body-metrics';
import type { BodyMetrics, RdaAgeBand } from '#app/models/body-metrics';
// Type-only: the aggregation module reaches the browser store at runtime, and
// this one must stay importable from a plain `node:test` file.
import type { NutrientDayIntake } from '#app/lib/local-store/aggregates';
import type { TrackingFocusType } from '#types/enums';

/** Any already-parsed JSON value — what `response.json()` hands back before validation. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * One nutrient's intake + coverage, over whatever window the caller aggregated.
 * Alias rather than a new shape: the guarantee that makes it safe (a `number`
 * `amount` only on the `hasEnoughData: true` arm) belongs to the aggregation,
 * and re-declaring it here would be a second place for the two to drift.
 */
export type NutrientIntake = NutrientDayIntake;

////////////////////////////////////////////////////////////////////////////////
// Which nutrients this screen is about
////////////////////////////////////////////////////////////////////////////////

/**
 * BETA-CAROTENE IS NOT AN INDEPENDENT TARGET — this is the trap this constant
 * exists to close.
 *
 * LowCarbCheck's vitamin A figure is expressed in **retinol activity
 * equivalents (RAE)**, which already folds in provitamin-A carotenoids. Verified
 * against real curated rows: a seaweed carrying `betaCarotene: 4872` µg carries
 * `vitaminA: 406` µg — exactly 4872 ÷ 12, the standard dietary β-carotene → RAE
 * conversion. Beta-carotene is therefore a COMPONENT of the vitamin A figure,
 * not something to add to it.
 *
 * Giving it its own reference amount would let one person "hit" vitamin A and
 * beta-carotene as two separate goals off a single measurement, double-counting
 * the same molecules. So it gets no target of its own; it renders as context
 * INSIDE the vitamin A row ("already counted in the figure above"). Consistently
 * with this, upstream has no `content_nutrients` row for beta-carotene at all,
 * so `/api/v1/nutrients` never hands us a reference for it — that absence is the
 * data agreeing with us, not a gap to fill.
 */
export type NutrientContextTable = { [K in NutrientKey]?: NutrientKey };

export const NUTRIENT_CONTEXT_OF: NutrientContextTable = {
  betaCarotene: 'vitaminA',
};

/**
 * Nutrients the screen does not render at all.
 *
 * `nacl` (salt) is the only one. It has no `content_nutrients` row, so there is
 * no published reference intake and no upstream-declared unit for it; it also
 * restates `sodium`, which DOES have both and is the figure every reference
 * intake is actually published against. Rendering an unsourced salt figure next
 * to a sourced sodium one would invite the reader to treat them as two findings.
 */
const HIDDEN_NUTRIENT_KEYS: ReadonlySet<NutrientKey> = new Set<NutrientKey>(['nacl']);

/**
 * The nutrients that get a row of their own, in the aggregation's own order
 * (vitamins then minerals). Derived, never hand-listed, so a nutrient added
 * upstream cannot silently miss this screen.
 */
export const DISPLAYED_NUTRIENT_KEYS: readonly NutrientKey[] = NUTRIENT_KEYS.filter(
  (key) => !HIDDEN_NUTRIENT_KEYS.has(key) && NUTRIENT_CONTEXT_OF[key] === undefined,
);

/**
 * Unit each nutrient's per-100 g figures — and therefore every sum derived from
 * them — are expressed in. A local transcription of LCC's
 * `content_nutrients.unit`, on purpose: the API is fetched fail-open, and
 * without a local table an unreachable API would leave the screen unable to
 * label the intake figures it CAN still compute from the on-device log. The
 * API's own `unit` wins whenever it is present (see `NutrientReference.unit`),
 * so an upstream change is followed rather than fought.
 */
export type NutrientUnitTable = { readonly [K in NutrientKey]: string };

export const NUTRIENT_UNITS: NutrientUnitTable = {
  betaCarotene: 'µg',
  vitaminA: 'µg',
  vitaminC: 'mg',
  vitaminD: 'µg',
  vitaminE: 'mg',
  vitaminB1: 'mg',
  vitaminB2: 'mg',
  vitaminB6: 'mg',
  vitaminB9: 'µg',
  vitaminB12: 'µg',
  nacl: 'mg',
  potassium: 'mg',
  sodium: 'mg',
  calcium: 'mg',
  magnesium: 'mg',
  zinc: 'mg',
  phosphorus: 'mg',
  iron: 'mg',
};

/**
 * Nutrient key → LowCarbCheck `content_nutrients.slug`. The inverse of that
 * API's own `NUTRIENT_SLUG_TO_FOOD_KEY` table, transcribed rather than derived
 * because openplate cannot import from that repo. Keys with no slug (`nacl`)
 * are simply absent.
 *
 * PRODUCTION-PINNED SLUGS, same as the source table (`keys.ts` in
 * lowcarbcheck's `remix-lcc` app): `vitaminB9` maps to `folic-acid-folate` and
 * `vitaminE` maps to `vitamin-e-tocopherole` — both look like typos but are
 * the real, live `content_nutrients.slug` / URL-segment values. This table
 * and the LCC source must be updated together (2026-08-07 fix).
 */
export type NutrientSlugTable = { [K in NutrientKey]?: string };

export const NUTRIENT_SLUGS: NutrientSlugTable = {
  betaCarotene: 'beta-carotene',
  vitaminA: 'vitamin-a-retinol',
  vitaminC: 'vitamin-c',
  vitaminD: 'vitamin-d',
  vitaminE: 'vitamin-e-tocopherole',
  vitaminB1: 'vitamin-b-1-thiamine',
  vitaminB2: 'vitamin-b-2-riboflavin',
  vitaminB6: 'vitamin-b-6-pyridoxine',
  vitaminB9: 'folic-acid-folate',
  vitaminB12: 'vitamin-b-12-cobalamin',
  potassium: 'potassium',
  sodium: 'sodium',
  calcium: 'calcium',
  magnesium: 'magnesium',
  zinc: 'zinc',
  phosphorus: 'phosphorus',
  iron: 'iron',
};

/** Every nutrient slug this app will ever ask the API about — the allowlist the resource route validates against. */
export const KNOWN_NUTRIENT_SLUGS: readonly string[] = Object.values(NUTRIENT_SLUGS).filter(
  (slug): slug is string => slug !== undefined,
);

////////////////////////////////////////////////////////////////////////////////
// Wire contract (GET /api/v1/nutrients, GET /api/v1/nutrients/:slug/foods)
////////////////////////////////////////////////////////////////////////////////

/**
 * The published sex × age-band reference intakes, transcribed from the wire.
 *
 * The band keys are written out as literals rather than generated, because they
 * ARE the contract: **the source publishes no band below `14-18`**. There is
 * deliberately no younger band here and none is to be added — see
 * `resolveReferenceAmount` for what happens to someone younger.
 */
const rdaBandsSchema = z.object({
  '14-18': z.number(),
  '19-30': z.number(),
  '31-50': z.number(),
  '51-70': z.number(),
  over_70: z.number(),
});

const rdaSchema = z.object({
  source: z.string(),
  male: rdaBandsSchema,
  female: rdaBandsSchema,
  pregnancy: z.number().nullish(),
  lactation: z.number().nullish(),
});

/**
 * Which QUESTION a nutrient's reference amount answers.
 *
 * `target` — "have you had enough?" Every vitamin and most minerals.
 * `ceiling` — "have you stayed under?" Sodium, and today only sodium: its
 * published references (EFSA's safe-and-adequate 2000 mg, the US CDRR's
 * 2300 mg "reduce intake if above") are UPPER bounds. Nearly every real diet
 * already clears them, and the health objective is to be below, not to arrive.
 *
 * Rendering a ceiling with the target vocabulary — "40% of your sodium target",
 * a bar filling towards it — states that more would be better, for the one
 * nutrient where over-consumption is the actual population-wide problem. That
 * is why this is a data field carried from upstream rather than a hardcoded
 * `key === 'sodium'` check in the view: the classification is LowCarbCheck's to
 * publish, and a second nutrient joining it must not need an openplate release.
 */
export type NutrientKind = 'target' | 'ceiling';

/**
 * Reads a wire `kind` value, defaulting to `'target'`.
 *
 * DEFENSIVE ON PURPOSE, in both directions. The field is additive, so an older
 * API omits it entirely; a newer one may publish a third classification this
 * build has never heard of. Neither may be allowed to flip a nutrient into the
 * other reading — `'target'` is the safe default because it is what every
 * nutrient on this screen was before the field existed, and because reading a
 * genuine ceiling as a target is the milder of the two errors to recover from
 * (a stale build under-warns; the inverse would tell someone to eat MORE salt).
 *
 * @param value - the raw wire value; anything at all is accepted.
 * @returns the recognised kind, or `'target'`.
 */
export function normalizeNutrientKind(value: JsonValue | undefined): NutrientKind {
  return value === 'ceiling' ? 'ceiling' : 'target';
}

const nutrientWireSchema = z.object({
  slug: z.string(),
  unit: z.string().nullish(),
  foodKey: z.string().nullish(),
  // Deliberately NOT `z.enum([...])`: an unrecognised value must degrade to
  // `'target'` via `normalizeNutrientKind`, not fail the envelope and blank
  // every reference amount on the screen.
  kind: z.string().nullish(),
  // Only the EU block is parsed. Offering an EU/US toggle would mean two
  // reference bases on one screen, and a person comparing "78%" against "71%"
  // across a toggle is comparing two different documents' definitions of a
  // reference intake. One basis, named on screen with its source, is the
  // honest shape — and parsing only one makes mixing them structurally
  // impossible rather than merely discouraged.
  rdaEu: rdaSchema.nullish(),
});

const nutrientListWireSchema = z.object({
  nutrients: z.array(nutrientWireSchema),
});

/** One food surfaced as a source of a nutrient, as the wire sends it. */
const nutrientSourceFoodWireSchema = z.object({
  slug: z.string(),
  title: z.string(),
  url: z.string().nullish(),
  imageUrl: z.string().nullish(),
  netCarbsPer100g: z.number().nullish(),
  attribution: z.string().nullish(),
  // Never null on this endpoint: foods with no figure for the nutrient are
  // excluded from the ranking upstream rather than sorted as zero.
  value: z.number(),
});

const nutrientFoodsWireSchema = z.object({
  nutrient: z.string(),
  unit: z.string().nullish(),
  foods: z.array(nutrientSourceFoodWireSchema),
});

/** Thrown when a nutrient API response fails validation. Caught by the fail-open shells. */
export class NutrientReferenceParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NutrientReferenceParseError';
  }
}

/** One region's reference intakes for one nutrient, as this app owns them. */
export interface NutrientRda {
  /** Publishing body / document. Rendered — an unsourced reference number reads as invented. */
  source: string;
  male: Readonly<Record<RdaAgeBand, number>>;
  female: Readonly<Record<RdaAgeBand, number>>;
  /** Distinct reference intake while pregnant, or null when none is published. */
  pregnancy: number | null;
  /** Distinct reference intake while lactating, or null when none is published. */
  lactation: number | null;
}

/** One nutrient's published reference data, keyed onto this app's own nutrient key. */
export interface NutrientReference {
  key: NutrientKey;
  slug: string;
  /** Upstream's unit when it sent one, else the local `NUTRIENT_UNITS` transcription. */
  unit: string;
  /** Whether the reference amount is an amount to reach or a limit to stay under. See `NutrientKind`. */
  kind: NutrientKind;
  /** EFSA reference intakes, or null when none is published for this nutrient. */
  rda: NutrientRda | null;
}

/** A food the API ranks as a rich source of one nutrient. */
export interface NutrientSourceFood {
  slug: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  /** The food's per-100 g figure for the requested nutrient. Never null (see the wire schema). */
  value: number;
  netCarbsPer100g: number | null;
  attribution: string | null;
}

const rdaAmountsSchema = z.record(z.enum(RDA_AGE_BANDS), z.number());

const nutrientRdaSchema = z.object({
  source: z.string(),
  male: rdaAmountsSchema,
  female: rdaAmountsSchema,
  pregnancy: z.number().nullable(),
  lactation: z.number().nullable(),
});

const nutrientReferenceSchema = z.object({
  key: z.enum([...VITAMIN_KEYS, ...MINERAL_KEYS]),
  slug: z.string(),
  unit: z.string(),
  kind: z.enum(['target', 'ceiling']),
  rda: nutrientRdaSchema.nullable(),
});

const nutrientSourceFoodSchema = z.object({
  slug: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  imageUrl: z.string().nullable(),
  value: z.number(),
  netCarbsPer100g: z.number().nullable(),
  attribution: z.string().nullable(),
});

const nutrientReferenceBodySchema = z.object({ nutrients: z.array(nutrientReferenceSchema) });
const nutrientSourceFoodsBodySchema = z.object({ foods: z.array(nutrientSourceFoodSchema) });

/**
 * Reads THIS app's own `/api/nutrients` list body (already mapped onto owned
 * types by the route). Fail-open: anything unrecognised reads as no references,
 * which the screen renders honestly as "no published reference".
 */
export function readNutrientReferenceBody(json: JsonValue | null): NutrientReference[] {
  const result = nutrientReferenceBodySchema.safeParse(json);
  return result.success ? result.data.nutrients : [];
}

/** Reads THIS app's own `/api/nutrients?foodsFor=…` body. Fail-open to no foods. */
export function readNutrientSourceFoodsBody(json: JsonValue | null): NutrientSourceFood[] {
  const result = nutrientSourceFoodsBodySchema.safeParse(json);
  return result.success ? result.data.foods : [];
}

/** Reverse of `NUTRIENT_SLUGS`, built once. */
const KEY_BY_SLUG: ReadonlyMap<string, NutrientKey> = new Map(
  // SAFETY: the entries come out of `NUTRIENT_SLUGS`, whose keys ARE
  // `NutrientKey` literals — `Object.entries` only widens them to `string`.
  Object.entries(NUTRIENT_SLUGS).map(([key, slug]) => [slug, key as NutrientKey]),
);

/**
 * Validates a `/api/v1/nutrients` body and maps it onto owned types.
 *
 * Entries this app has no nutrient key for are DROPPED rather than failing the
 * parse — the endpoint also serves macros and anything else upstream classifies
 * as a nutrient, and a new row appearing there must not blank this screen.
 *
 * @param json - an already-parsed JSON value.
 * @returns one entry per recognised nutrient.
 * @throws NutrientReferenceParseError when the envelope itself is unrecognisable.
 */
export function parseNutrientReferences(json: JsonValue): NutrientReference[] {
  const result = nutrientListWireSchema.safeParse(json);
  if (!result.success) {
    throw new NutrientReferenceParseError('Nutrient reference response did not match the expected shape', {
      cause: result.error,
    });
  }

  const references: NutrientReference[] = [];
  for (const raw of result.data.nutrients) {
    const key = KEY_BY_SLUG.get(raw.slug);
    if (key === undefined) continue;
    references.push({
      key,
      slug: raw.slug,
      unit: raw.unit ?? NUTRIENT_UNITS[key],
      kind: normalizeNutrientKind(raw.kind),
      rda:
        raw.rdaEu ?
          {
            source: raw.rdaEu.source,
            male: raw.rdaEu.male,
            female: raw.rdaEu.female,
            pregnancy: raw.rdaEu.pregnancy ?? null,
            lactation: raw.rdaEu.lactation ?? null,
          }
        : null,
    });
  }
  return references;
}

/**
 * Validates a `/api/v1/nutrients/:slug/foods` body and maps it onto owned types.
 *
 * @param json - an already-parsed JSON value.
 * @returns the ranked foods, upstream order preserved (richest first).
 * @throws NutrientReferenceParseError on a shape mismatch.
 */
export function parseNutrientSourceFoods(json: JsonValue): NutrientSourceFood[] {
  const result = nutrientFoodsWireSchema.safeParse(json);
  if (!result.success) {
    throw new NutrientReferenceParseError('Nutrient sources response did not match the expected shape', {
      cause: result.error,
    });
  }
  return result.data.foods.map((raw) => ({
    slug: raw.slug,
    title: raw.title,
    url: raw.url ?? null,
    imageUrl: raw.imageUrl ?? null,
    value: raw.value,
    netCarbsPer100g: raw.netCarbsPer100g ?? null,
    attribution: raw.attribution ?? null,
  }));
}

////////////////////////////////////////////////////////////////////////////////
// Reference resolution
////////////////////////////////////////////////////////////////////////////////

/** Which published segment a resolved reference amount came from — rendered, never implied. */
export type ReferenceSegment =
  { kind: 'sex-age'; sex: 'female' | 'male'; band: RdaAgeBand } | { kind: 'pregnancy' } | { kind: 'lactation' };

/**
 * A reference intake, or the specific reason there isn't one.
 *
 * Three of the four arms are refusals, and every one of them is deliberate: the
 * alternative in each case is to invent a number about somebody's body.
 */
export type ReferenceAmount =
  | { kind: 'available'; amount: number; source: string; segment: ReferenceSegment }
  /**
   * No `biologicalSex` and/or no `birthYear` on the profile — the default for
   * every existing user, since both are optional and always will be.
   *
   * There is NO default band fallback here, on purpose. Any single default is a
   * guess about the person's body (a reference intake differs by up to ~2× across
   * the published segments), and filling the screen with a guessed target is
   * exactly the implied health claim this milestone forbids — while ALSO making
   * the "add your details" prompt honest instead of a growth dark pattern: the
   * screen genuinely cannot personalise without them, and it says so rather than
   * showing a plausible number and nagging anyway.
   */
  | { kind: 'no-body-metrics' }
  /**
   * The stored birth year puts the person below the youngest published band
   * (`14-18`) — or implausibly far above the oldest sanity bound.
   *
   * NEVER clamped up into `14-18`. The source publishes no reference intake for
   * a child because a child's is genuinely different, and borrowing the
   * teenagers' number would fabricate a reference for someone it does not apply
   * to. The screen says so instead.
   */
  | { kind: 'age-out-of-bands' }
  /** The nutrient itself has no published reference intake (e.g. beta-carotene). */
  | { kind: 'not-published' };

/**
 * The reference intake for one nutrient and one person, or the reason there is
 * none.
 *
 * Order of resolution: pregnancy → lactation → sex + age band. A pregnancy or
 * lactation figure that upstream does not publish for this nutrient falls back
 * to the sex + age band value and REPORTS that segment, so the footnote always
 * names the segment the number actually came from.
 *
 * @param input.reference - the nutrient's published reference data, or null when the API was unreachable.
 * @param input.metrics - the stored body metrics; every field may be null.
 * @param input.currentYear - the year to measure age against (never read from a clock here).
 * @returns the amount plus its segment and source, or the specific refusal.
 */
export function resolveReferenceAmount({
  reference,
  metrics,
  currentYear,
}: {
  reference: NutrientReference | null;
  metrics: BodyMetrics;
  currentYear: number;
}): ReferenceAmount {
  const rda = reference?.rda ?? null;
  if (rda === null) return { kind: 'not-published' };

  const { biologicalSex, birthYear, reproductiveStatus } = metrics;
  if (biologicalSex === null || birthYear === null) return { kind: 'no-body-metrics' };

  const band = resolveAgeBandForBirthYear({ birthYear, currentYear });
  if (band === null) return { kind: 'age-out-of-bands' };

  if (reproductiveStatus === 'pregnant' && rda.pregnancy !== null) {
    return { kind: 'available', amount: rda.pregnancy, source: rda.source, segment: { kind: 'pregnancy' } };
  }
  if (reproductiveStatus === 'lactating' && rda.lactation !== null) {
    return { kind: 'available', amount: rda.lactation, source: rda.source, segment: { kind: 'lactation' } };
  }

  const bands = biologicalSex === 'female' ? rda.female : rda.male;
  return {
    kind: 'available',
    amount: bands[band],
    source: rda.source,
    segment: { kind: 'sex-age', sex: biologicalSex, band },
  };
}

////////////////////////////////////////////////////////////////////////////////
// Rows
////////////////////////////////////////////////////////////////////////////////

/** Beta-carotene's contribution, rendered inside the vitamin A row (see `NUTRIENT_CONTEXT_OF`). */
export interface NutrientContext {
  key: NutrientKey;
  unit: string;
  /** Average per logged day, or null when that nutrient's own coverage was too low to say. */
  perDayAmount: number | null;
}

/** One rendered nutrient: what the log said, what the reference says, and the gap — or the refusal in place of each. */
export interface NutrientRow {
  key: NutrientKey;
  unit: string;
  /**
   * Whether this row's reference amount is a target to reach or a ceiling to
   * stay under (`NutrientKind`).
   *
   * NOT the same field as `reference.kind`, which is the availability
   * discriminant (`available` / the three refusals). This one classifies the
   * nutrient and is known even when no amount could be resolved — an offline
   * sodium row is still a row about a limit.
   */
  referenceKind: NutrientKind;
  /** Intake + coverage over the window. `amount` is only a number on the `hasEnoughData: true` arm. */
  intake: NutrientIntake;
  /** Window intake averaged over the days that carry at least one entry; null whenever the intake arm has no figure. */
  perDayAmount: number | null;
  reference: ReferenceAmount;
  /**
   * `perDayAmount / reference.amount`, or null whenever EITHER side is missing.
   * Unbounded on purpose: a share above 1 is reported as-is, never clamped and
   * never recoloured — over a reference intake is not an overrun.
   *
   * On a `ceiling` row the ratio is still computed (it is what
   * `isAboveReferenceLimit` reads) but is deliberately NOT rendered as a
   * percentage: "72% of your sodium limit" is progress vocabulary pointed at a
   * bound nobody is trying to reach.
   */
  share: number | null;
  /** Nutrients that are a component of this one rather than a target of their own. */
  context: NutrientContext[];
}

function perDay(intake: NutrientIntake, loggedDays: number): number | null {
  if (!intake.hasEnoughData || loggedDays <= 0) return null;
  return intake.amount / loggedDays;
}

function unitFor(key: NutrientKey, references: readonly NutrientReference[]): string {
  return references.find((reference) => reference.key === key)?.unit ?? NUTRIENT_UNITS[key];
}

/**
 * Builds one row per displayed nutrient, in `DISPLAYED_NUTRIENT_KEYS` order.
 *
 * @param input.byNutrient - the window's per-nutrient intake + coverage.
 * @param input.loggedDays - days in the window carrying at least one entry (the per-day denominator).
 * @param input.references - published reference data; EMPTY is the normal offline case, and every row then reports `not-published`.
 * @param input.metrics - the stored body metrics.
 * @param input.currentYear - the year to measure age against.
 * @returns the rendered rows.
 */
export function buildNutrientRows({
  byNutrient,
  loggedDays,
  references,
  metrics,
  currentYear,
}: {
  byNutrient: Readonly<Record<NutrientKey, NutrientIntake>>;
  loggedDays: number;
  references: readonly NutrientReference[];
  metrics: BodyMetrics;
  currentYear: number;
}): NutrientRow[] {
  return DISPLAYED_NUTRIENT_KEYS.map((key) => {
    const intake = byNutrient[key];
    const perDayAmount = perDay(intake, loggedDays);
    const published = references.find((candidate) => candidate.key === key) ?? null;
    // Normalised again here rather than trusted off the object: the browser
    // path (`#app/lib/nutrient-reference-client`) CASTS the resource route's
    // JSON instead of re-validating it, so a cached body from an older build
    // can reach this function with no `kind` at all.
    const referenceKind = normalizeNutrientKind(published?.kind);
    const reference = resolveReferenceAmount({
      reference: published,
      metrics,
      currentYear,
    });
    const share =
      perDayAmount !== null && reference.kind === 'available' && reference.amount > 0 ?
        perDayAmount / reference.amount
      : null;

    const context: NutrientContext[] = NUTRIENT_KEYS.filter((candidate) => NUTRIENT_CONTEXT_OF[candidate] === key).map(
      (candidate) => ({
        key: candidate,
        unit: unitFor(candidate, references),
        perDayAmount: perDay(byNutrient[candidate], loggedDays),
      }),
    );

    return { key, unit: unitFor(key, references), referenceKind, intake, perDayAmount, reference, share, context };
  });
}

/**
 * Below this share of the reference intake, the window is "light on" a nutrient
 * and earns food suggestions. Strictly a threshold on a RATIO WE COMPUTED, not
 * a judgement about the person: at 1.0 it would just mean "not at the reference
 * amount", which for a food log fluctuating day to day would flag nearly
 * everything and make the section noise.
 */
export const SUGGESTION_SHARE_CEILING = 0.8;

/**
 * Whether a ceiling row's log is above the published limit.
 *
 * A statement about the log against a number, and nothing more: there is no
 * tier above it and none below it, because "above the reference amount" is a
 * fact and "your sodium is too high" is a claim about a body this app does not
 * get to make (M135 locked decision 2, DESIGN.md §10.1).
 *
 * @param row - a rendered row.
 * @returns true only for a `ceiling` row with a known share strictly above 1.
 */
export function isAboveReferenceLimit(row: NutrientRow): boolean {
  return row.referenceKind === 'ceiling' && row.share !== null && row.share > 1;
}

/**
 * The rows the log is lightest on: a known share, below `SUGGESTION_SHARE_CEILING`,
 * lowest first.
 *
 * A row with no share never qualifies — not because it is fine, but because we
 * do not know, and suggesting foods off an unknown is the same fabrication as
 * showing a bar off one.
 *
 * **CEILING ROWS ARE EXCLUDED OUTRIGHT**, and this is the single choke point
 * that keeps them out of both the "your log was lightest on these" ranking and
 * the food suggestions the screen derives from it. Being low in sodium is not a
 * gap to fill, so ranking it as one would be wrong even before the suggestions
 * ran — and the suggestions themselves would then recommend the highest-sodium
 * foods in the corpus, which is the exact inverse of the published guidance.
 *
 * @param rows - every rendered row.
 * @param options.limit - how many to return.
 * @returns the lightest target rows, lowest share first.
 */
export function pickLightestNutrients(rows: readonly NutrientRow[], { limit }: { limit: number }): NutrientRow[] {
  return rows
    .filter(
      (row): row is NutrientRow & { share: number } =>
        row.referenceKind === 'target' && row.share !== null && row.share < SUGGESTION_SHARE_CEILING,
    )
    .toSorted((left, right) => left.share - right.share)
    .slice(0, Math.max(limit, 0));
}

/**
 * Net carbs per 100 g at or above which a suggestion is withheld from someone
 * tracking a carb ceiling. Reuses the shared traffic light (DESIGN.md §3) rather
 * than a second private threshold — `high` is exactly the tier that page already
 * calls out on every food card.
 */
function isHighCarb(food: NutrientSourceFood): boolean {
  return food.netCarbsPer100g !== null && getCarbStatus(food.netCarbsPer100g) === 'high';
}

/**
 * Drops suggestions that would fight the goal the person is actually tracking.
 *
 * Only a `net-carbs` focus filters. A calorie or habit tracker has no food this
 * would be inconsistent with — a calorie budget is spent across the day, not
 * per food — and inventing a filter for them would quietly narrow the list for
 * no stated reason.
 *
 * @param foods - the ranked source foods.
 * @param options.trackingFocus - the profile's tracking focus, or null when unset.
 * @returns the foods worth suggesting, upstream order preserved.
 */
export function filterSuggestions(
  foods: readonly NutrientSourceFood[],
  { trackingFocus }: { trackingFocus: TrackingFocusType | null },
): NutrientSourceFood[] {
  if (trackingFocus !== 'net-carbs') return [...foods];
  return foods.filter((food) => !isHighCarb(food));
}

////////////////////////////////////////////////////////////////////////////////
// Formatting
////////////////////////////////////////////////////////////////////////////////

/**
 * Decimal places for an amount: enough to be useful at 1.4 mg, never a fake
 * third digit at 1240 µg.
 */
function fractionDigitsFor(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude >= 100) return 0;
  if (magnitude >= 10) return 1;
  return 2;
}

/**
 * Formats a nutrient amount for display. Locale-aware (a German reader expects
 * `1,4`), trailing zeros dropped.
 *
 * @param value - the amount.
 * @param options.language - the active i18next language.
 * @returns the formatted number, without its unit.
 */
export function formatNutrientAmount(value: number, { language }: { language: string }): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: fractionDigitsFor(value) }).format(value);
}

/**
 * Formats a share as a whole-number percentage. Never clamped — a log above the
 * reference intake reports the real figure.
 *
 * @param share - `intake / reference`.
 * @param options.language - the active i18next language.
 * @returns e.g. `"62%"`.
 */
export function formatSharePercent(share: number, { language }: { language: string }): string {
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(share);
}
