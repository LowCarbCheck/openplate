/**
 * The eating style: one pick that decides which numbers the app keeps for a
 * person, and which single verdict the day is graded by (M210).
 *
 * Before this module the onboarding asked for a tracking focus and a carb
 * preset, and the dashboard graded every day against a net-carb ceiling even
 * when the person had never set one (a hidden 50 g reference stood in). Two
 * things went wrong with that. A person who only wanted calories still got a
 * carb verdict, and a person with no goal at all got a verdict against a number
 * they had never seen. The style replaces both: it names what the person is
 * doing, and the lens falls out of the name.
 *
 * Everything here is PURE and stores nothing. The durable source of truth stays
 * where it already is, on `goalNetCarbsCeilingG`, `goalKcalTarget` and
 * `goalProteinFloorG` on `LocalProfileGoals`. The only new stored field is
 * `eatingStyle` (schema v20), and it is nullable because every account written
 * before v20 has no style: `deriveEatingStyle` reads one back out of the
 * numbers instead, and never writes it. That is what keeps the upgrade lossless
 * and reversible.
 *
 * The types below are declared structurally rather than imported from
 * `local-store/schema`, so this module stays free of the store and can be
 * exercised by a plain unit test. `schema.ts` imports `EatingStyleId` from here
 * (type-only, so it is erased), which is why the dependency points this way.
 */
import type { ReproductiveStatus } from '#app/lib/local-store/schema';

/**
 * The five styles, in the order the onboarding lists them. `low-carb` is first
 * because it is the app's own reason to exist and the "most people start here"
 * hint sits on it; `just-track` is last because it opts out of a verdict.
 */
export const EATING_STYLE_IDS = [
  'low-carb',
  'low-carb-low-kcal',
  'low-kcal',
  'high-protein',
  'just-track',
] as const;

/** One of the five style ids. Stored verbatim in `LocalProfileGoals.eatingStyle`. */
export type EatingStyleId = (typeof EATING_STYLE_IDS)[number];

/**
 * Which daily verdict a style earns. `none` is a real answer, not a missing
 * one: `just-track` deliberately shows the rows and no grade, which is the
 * behaviour the old hidden carb reference took away.
 */
export type EatingStyleLens = 'carb' | 'kcal' | 'protein' | 'none';

/**
 * How the kcal target is obtained. `asked` means the existing onboarding kcal
 * input becomes required for that style. There is no `computed` value on
 * purpose, because no TDEE formula is added in this milestone, and a mode nothing
 * implements would only invite a caller to branch on it.
 */
export type EatingStyleKcalMode = 'none' | 'asked';

/**
 * How the protein floor is obtained. `reference` means the age/sex reference
 * intake the app already derives; `g-per-kg` means body weight times
 * `HIGH_PROTEIN_G_PER_KG`.
 */
export type EatingStyleProteinRule = 'reference' | 'g-per-kg';

/** Grams of protein per kg of body weight for the high-protein style. */
export const HIGH_PROTEIN_G_PER_KG = 1.6;

/**
 * The description of one style. `labelKey`/`detailKey` are i18n KEYS, not copy,
 * for the same reason `CARB_PRESETS` uses keys: this table has to stay
 * language-agnostic so the two locales cannot drift apart in code.
 */
export interface EatingStyle {
  id: EatingStyleId;
  labelKey: string;
  detailKey: string;
  /**
   * Whether picking this style opens the 20/50/100 g sub step. Only the two
   * carb styles do, and a `false` here is what tells the UI to skip a question
   * rather than ask one whose answer is thrown away.
   */
  carbSubPreset: boolean;
  kcalMode: EatingStyleKcalMode;
  proteinRule: EatingStyleProteinRule;
  lens: EatingStyleLens;
}

/** The five styles. Ordered like `EATING_STYLE_IDS`, and asserted to be. */
export const EATING_STYLES: readonly EatingStyle[] = [
  {
    id: 'low-carb',
    labelKey: 'onboarding.style.lowCarb.label',
    detailKey: 'onboarding.style.lowCarb.detail',
    carbSubPreset: true,
    kcalMode: 'none',
    proteinRule: 'reference',
    lens: 'carb',
  },
  {
    id: 'low-carb-low-kcal',
    labelKey: 'onboarding.style.lowCarbLowKcal.label',
    detailKey: 'onboarding.style.lowCarbLowKcal.detail',
    carbSubPreset: true,
    kcalMode: 'asked',
    proteinRule: 'reference',
    lens: 'carb',
  },
  {
    id: 'low-kcal',
    labelKey: 'onboarding.style.lowKcal.label',
    detailKey: 'onboarding.style.lowKcal.detail',
    carbSubPreset: false,
    kcalMode: 'asked',
    proteinRule: 'reference',
    lens: 'kcal',
  },
  {
    id: 'high-protein',
    labelKey: 'onboarding.style.highProtein.label',
    detailKey: 'onboarding.style.highProtein.detail',
    carbSubPreset: false,
    kcalMode: 'none',
    proteinRule: 'g-per-kg',
    lens: 'protein',
  },
  {
    id: 'just-track',
    labelKey: 'onboarding.style.justTrack.label',
    detailKey: 'onboarding.style.justTrack.detail',
    carbSubPreset: false,
    kcalMode: 'none',
    proteinRule: 'reference',
    lens: 'none',
  },
];

/** The ids as a set, so the guard below is a lookup rather than a scan. */
const EATING_STYLE_ID_SET: ReadonlySet<string> = new Set<EatingStyleId>(EATING_STYLE_IDS);

/**
 * Narrows a stored string to a style id. Needed because a stored field is only
 * as trustworthy as the oldest build that wrote it. A blob merged from a peer
 * on a future version can carry a string this build has never heard of, and the
 * readers must fall back to a derived style rather than grade a day by a lens
 * they cannot resolve.
 *
 * @param value - the candidate, typically read off a stored profile.
 * @returns whether it is one of the five ids.
 */
export function isEatingStyleId(value: string | null | undefined): value is EatingStyleId {
  return value !== null && value !== undefined && EATING_STYLE_ID_SET.has(value);
}

/**
 * The full description for a style id. Throws rather than returning a default,
 * because every caller here has already narrowed to `EatingStyleId` and a
 * silent fallback would hide a table that lost a row.
 *
 * @param id - the style id.
 * @returns the style description.
 */
export function eatingStyle(id: EatingStyleId): EatingStyle {
  const found = EATING_STYLES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No eating style defined for id "${id}"`);
  return found;
}

/**
 * The daily lens for a style. A one-line lookup, exported on its own because
 * the dashboard and the diary want the lens without caring about the rest of
 * the row, and a `lensForStyle` call site reads as the intent it has.
 *
 * @param id - the style id.
 * @returns which verdict, if any, the day is graded by.
 */
export function lensForStyle(id: EatingStyleId): EatingStyleLens {
  return eatingStyle(id).lens;
}

/**
 * The stored goal numbers a style is read out of, or written onto. Declared as
 * its own shape rather than `Pick<LocalProfileGoals, ...>` so this module owes
 * the local store nothing at runtime.
 */
export interface EatingStyleGoals {
  goalNetCarbsCeilingG: number | null;
  goalKcalTarget: number | null;
  goalProteinFloorG: number | null;
  /** Absent on every account written before schema v20. */
  eatingStyle?: EatingStyleId | null;
}

/**
 * Reads a style back out of the numbers an account already stores, for a
 * profile written before v20. It NEVER writes: a derived style is recomputed on
 * every read, so a person who later fine-tunes a number sees the app follow
 * them instead of arguing with a stale stored id. It is also lossless, since the
 * numbers are untouched, so nothing about the upgrade is one-way.
 *
 * @param goals - the stored goal numbers.
 * @returns the style those numbers describe.
 */
export function deriveEatingStyle(goals: EatingStyleGoals): EatingStyleId {
  const hasCeiling = goals.goalNetCarbsCeilingG !== null && goals.goalNetCarbsCeilingG !== undefined;
  const hasKcal = goals.goalKcalTarget !== null && goals.goalKcalTarget !== undefined;
  const hasProtein = goals.goalProteinFloorG !== null && goals.goalProteinFloorG !== undefined;

  if (hasCeiling && hasKcal) return 'low-carb-low-kcal';
  if (hasCeiling) return 'low-carb';
  if (hasKcal) return 'low-kcal';
  if (hasProtein) return 'high-protein';
  return 'just-track';
}

/**
 * The style to treat this account as having: the stored pick when there is one,
 * otherwise the derived one. The single entry point for every reader, so no
 * screen has to remember that `eatingStyle` can be absent, and so a pre-v20
 * account and a fresh one are never graded by different rules.
 *
 * @param goals - the stored goal numbers, with or without a stored style.
 * @returns the style in effect.
 */
export function effectiveEatingStyle(goals: EatingStyleGoals): EatingStyleId {
  return isEatingStyleId(goals.eatingStyle) ? goals.eatingStyle : deriveEatingStyle(goals);
}

/** The four profile fields `applyEatingStyle` decides, ready to patch onto the profile. */
export interface EatingStylePatch {
  goalNetCarbsCeilingG: number | null;
  goalKcalTarget: number | null;
  goalProteinFloorG: number | null;
  eatingStyle: EatingStyleId;
}

/** What `applyEatingStyle` needs to turn a pick into numbers. An options object because five of the six arguments are the same type. */
export interface ApplyEatingStyleInput {
  style: EatingStyleId;
  /** The numbers stored today, used as the fallback for a field the caller did not re-ask. */
  currentGoals: EatingStyleGoals;
  /** The 20/50/100 g answer from the carb sub step, or null when it was not asked. */
  carbPresetCeiling: number | null;
  /** The kcal answer for an `asked` style, or null when it was not asked. */
  kcalTarget: number | null;
  /** The latest logged body weight, or null when the person has never logged one. */
  latestWeightKg: number | null;
  /** The age/sex reference protein intake, or null when the body metrics are unknown. */
  referenceProteinFloorG: number | null;
}

/** The patch plus the one thing the caller must tell the person about. */
export interface ApplyEatingStyleResult {
  patch: EatingStylePatch;
  /**
   * True only for `high-protein` with no logged weight. The floor falls back to
   * the reference so the person is never left with no goal at all, and the
   * style card says a weight is needed. A number that silently means something
   * other than 1.6 g per kg would be worse than no number.
   */
  needsWeight: boolean;
}

/**
 * Turns a style pick into the numbers to store. It writes what the style owns
 * and NULLS what it does not, which is the whole point: leaving a stale carb
 * ceiling behind when someone switches to `low-kcal` would keep the old ceiling
 * live in every export, every sync blob and every future derivation, and the
 * app would go on grading a day by a goal the person thought they had dropped.
 *
 * @param input - the pick and the answers gathered alongside it.
 * @returns the patch to merge onto the profile, and whether a weight is missing.
 */
export function applyEatingStyle(input: ApplyEatingStyleInput): ApplyEatingStyleResult {
  const { style, currentGoals, carbPresetCeiling, kcalTarget, latestWeightKg, referenceProteinFloorG } = input;
  const definition = eatingStyle(style);

  // A field the style owns but the caller did not re-ask keeps the number
  // already stored (settings can change a style without re-running the whole
  // wizard); a field the style does not own goes to null regardless.
  const ceiling = definition.carbSubPreset ? (carbPresetCeiling ?? currentGoals.goalNetCarbsCeilingG) : null;
  const kcal = definition.kcalMode === 'asked' ? (kcalTarget ?? currentGoals.goalKcalTarget) : null;

  const needsWeight = definition.proteinRule === 'g-per-kg' && latestWeightKg === null;
  const proteinFloor =
    definition.proteinRule === 'g-per-kg' && latestWeightKg !== null
      ? Math.round(latestWeightKg * HIGH_PROTEIN_G_PER_KG)
      : referenceProteinFloorG;

  return {
    patch: {
      goalNetCarbsCeilingG: ceiling,
      goalKcalTarget: kcal,
      goalProteinFloorG: proteinFloor,
      eatingStyle: style,
    },
    needsWeight,
  };
}

/** The one caution this module can raise. A key, not a sentence, and never a number. */
export type EatingStyleCaution = 'caution';

/**
 * The page the caution note links to. The DGE's pregnancy and lactation page
 * was checked with `curl -sI` on 2026-09-09 and answered 404, so the note
 * points at the DGE landing page instead, because a link that resolves is worth more
 * than a deeper link that dies.
 */
export const STYLE_CAUTION_SOURCE_URL = 'https://www.dge.de/';

/**
 * Whether to show the sourced caution note under the style list. Pregnancy and
 * lactation raise energy and carbohydrate needs, so the three restricting
 * styles get a note pointing at `high-protein` or `just-track`.
 *
 * It returns a KEY and nothing else on purpose: no block, no adjusted number,
 * no colour. The app has no business overriding a clinician, and a silently
 * adjusted reference is exactly the behaviour this milestone removed.
 *
 * @param style - the style being considered.
 * @param reproductiveStatus - the stored status, absent when never told.
 * @returns `'caution'` when the note applies, otherwise `null`.
 */
export function styleCaution(
  style: EatingStyleId,
  reproductiveStatus: ReproductiveStatus | null | undefined,
): EatingStyleCaution | null {
  if (reproductiveStatus !== 'pregnant' && reproductiveStatus !== 'lactating') return null;
  if (style !== 'low-carb' && style !== 'low-carb-low-kcal' && style !== 'low-kcal') return null;
  return 'caution';
}
