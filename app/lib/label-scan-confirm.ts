/**
 * The pure core of the LABEL scan's confirm step (M123/10): a `LabelReading`
 * as the vision service parsed it, turned into the values a person reviews and
 * the two rows a confirmed reading persists.
 *
 * Every rule that makes this feature trustworthy lives here rather than in
 * `app/routes/scan.tsx`, so each one is testable without a browser, a store or
 * a provider:
 *
 * 1. UNREADABLE IS TERMINAL AND CHECKED FIRST. The wire schema does not forbid
 *    a response with `unreadable: true` AND stray macro rows — a model that
 *    gave up halfway can send both. This module answers `{ kind: 'unreadable' }`
 *    before it looks at a single macro, so no such number can reach a field.
 * 2. NULL STAYS NULL, ALL THE WAY TO THE FORM. An absent macro becomes an EMPTY
 *    input, never `0`. A silent `0` for polyols makes a maltitol-sweetened
 *    product look zero-carb, which is the exact bug the label feature exists to
 *    kill — so there is no `?? 0` on any macro path in this file.
 * 3. CONVERSION IS BORROWED, NOT REIMPLEMENTED. A panel that prints only a
 *    per-serving column still has to yield a per-100g figure; that is
 *    `resolveMacrosPer100gFromEntry` (M123/06), reused verbatim.
 * 4. TWO PRINTED COLUMNS CROSS-CHECK EACH OTHER. When the panel printed both,
 *    the per-100g column is preferred AND the per-serving column is converted
 *    and compared to it — they describe one product, so a disagreement means a
 *    misread. That check is `checkLabelColumnAgreement`, in the same
 *    `MacroSanityIssue` vocabulary as every other confirm-step note.
 */
import type { IdentifiedFoodMacros, LabelReading } from '#app/services/vision/types';
import type { LocalFoodLog, LocalPersonalFood } from '#app/lib/local-store/schema';
import type { Macros } from './macros';
import { scaleMacrosPer100gToServing } from './macros';
import { resolveMacrosPer100gFromEntry } from './portions/serving-macros';
import { checkLabelColumnAgreement, checkMacroSanity } from './macro-sanity';
import type { MacroSanityIssue, Translate } from './macro-sanity';

/** Every macro key, in the order the confirm form renders them. */
export const LABEL_MACRO_KEYS = ['carbs', 'fiber', 'sugars', 'polyols', 'protein', 'fat', 'kcal'] as const;

/** All-null macros: the honest answer when a panel printed no usable column at all. */
const NULL_MACROS: Macros = {
  carbs: null,
  fiber: null,
  sugars: null,
  polyols: null,
  protein: null,
  fat: null,
  kcal: null,
};

/** Which printed column the confirmed per-100g figures actually came from. */
export type LabelMacroBasis = 'per100g' | 'perServing';

/** The confirm step's view of one scanned panel — an unreadable answer, or a reviewable reading. */
export type LabelConfirmView =
  | {
      kind: 'unreadable';
      /** The model's own brief reason, when it gave one. Never a fabricated one. */
      reason: string | null;
    }
  | {
      kind: 'reading';
      productName: string | null;
      brand: string | null;
      /** The serving size text exactly as the panel printed it ("1 bar (35 g)"). */
      servingAsPrinted: string | null;
      /** The serving weight, only when the panel stated one. */
      servingGrams: number | null;
      /** The per-100g basis the app stores. A null field means the panel didn't print it — NOT zero. */
      macrosPer100g: Macros;
      /** Which column `macrosPer100g` came from; null when the panel printed no macros at all. */
      basis: LabelMacroBasis | null;
      /** The panel's own per-100g column, when it printed one — kept for the cross-check. */
      printedPer100g: Macros | null;
      /** The per-serving column converted to per 100 g, when that was possible — kept for the cross-check. */
      convertedPer100g: Macros | null;
      /** The model's free-text note (drink printed per 100 ml, "as prepared" column also present, …). */
      notes: string | null;
    };

/** Absent macro → `null`. The vision layer's `?:` optionals and this layer's `| null` mean the same thing: unknown. */
function toMacros(macros: IdentifiedFoodMacros | undefined): Macros {
  if (!macros) return { ...NULL_MACROS };
  return {
    carbs: macros.carbs ?? null,
    fiber: macros.fiber ?? null,
    sugars: macros.sugars ?? null,
    polyols: macros.polyols ?? null,
    protein: macros.protein ?? null,
    fat: macros.fat ?? null,
    kcal: macros.kcal ?? null,
  };
}

/** Whether a macro set carries at least one real figure (an all-null set is "no column"). */
export function hasAnyMacro(macros: Macros): boolean {
  return LABEL_MACRO_KEYS.some((key) => macros[key] !== null);
}

/**
 * A `LabelReading` → what the confirm step shows.
 *
 * @param reading - the panel as the vision service parsed it.
 * @returns the terminal unreadable answer, or the reviewable reading.
 */
export function buildLabelConfirmView(reading: LabelReading): LabelConfirmView {
  // FIRST and unconditional — see rule 1 in this module's header. Anything the
  // model sent alongside an `unreadable: true` is discarded here, deliberately.
  if (reading.unreadable) {
    return { kind: 'unreadable', reason: reading.unreadableReason ?? null };
  }

  const servingGrams = reading.servingSize?.grams ?? null;
  const rawPrinted = toMacros(reading.macrosPer100g);
  const rawServing = toMacros(reading.macrosPerServing);
  const printedPer100g = hasAnyMacro(rawPrinted) ? rawPrinted : null;

  // A per-serving column is only convertible when the panel also stated the
  // serving's weight. Without it `resolveMacrosPer100gFromEntry` degrades to
  // all-null rather than dividing by zero — which reads back as "no column".
  const convertedCandidate =
    hasAnyMacro(rawServing) ?
      resolveMacrosPer100gFromEntry({
        basis: 'perServing',
        macros: rawServing,
        servingGrams: servingGrams ?? 0,
      })
    : null;
  const convertedPer100g = convertedCandidate && hasAnyMacro(convertedCandidate) ? convertedCandidate : null;

  // The panel's own per-100g column wins when it printed one: it is the
  // manufacturer's rounding, not ours.
  const macrosPer100g = printedPer100g ?? convertedPer100g ?? { ...NULL_MACROS };
  let basis: LabelMacroBasis | null = null;
  if (printedPer100g) basis = 'per100g';
  else if (convertedPer100g) basis = 'perServing';

  return {
    kind: 'reading',
    productName: reading.productName ?? null,
    brand: reading.brand ?? null,
    servingAsPrinted: reading.servingSize?.asPrinted ?? null,
    servingGrams,
    macrosPer100g,
    basis,
    printedPer100g,
    convertedPer100g,
    notes: reading.notes ?? null,
  };
}

/**
 * Every plausibility note for a reviewed panel: the shared per-100g rules, plus
 * the two-column cross-check when the panel printed both columns.
 *
 * @param view - a `'reading'` view from `buildLabelConfirmView`.
 * @param t - translator for the note copy.
 * @param language - active UI language, for the figures inside the copy.
 * @returns the notes to show; empty means the numbers look sane.
 */
export function collectLabelSanityIssues(
  view: Extract<LabelConfirmView, { kind: 'reading' }>,
  t: Translate,
  language: string | null | undefined,
): MacroSanityIssue[] {
  const issues = checkMacroSanity(view.macrosPer100g, t, language);
  if (view.printedPer100g && view.convertedPer100g) {
    const disagreement = checkLabelColumnAgreement(
      { printedPer100g: view.printedPer100g, convertedPer100g: view.convertedPer100g },
      t,
      language,
    );
    if (disagreement) issues.push(disagreement);
  }
  return issues;
}

/**
 * One macro's default value for the confirm form. `undefined` — not `'0'` — is
 * what an unknown macro becomes: Conform renders it as an empty input.
 */
function toMacroFieldValue(value: number | null): string | undefined {
  return value === null ? undefined : String(value);
}

/** One macro field's default value for the confirm form — `undefined` renders an EMPTY input. */
export type LabelMacroFieldValues = { [TKey in (typeof LABEL_MACRO_KEYS)[number]]: string | undefined };

/**
 * Macro defaults for the confirm form. THE `null` → `undefined` STEP IS THE
 * POINT: Conform renders `undefined` as an empty input, so a macro the panel
 * never printed stays blank for the person to fill in or leave alone. Mapping
 * it to `'0'` here would be indistinguishable, in the diary forever after, from
 * a panel that really printed zero.
 *
 * @param macros - the per-100g macros from a `'reading'` view.
 * @returns one form value per macro; `undefined` for every unknown.
 */
export function toLabelMacroFieldValues(macros: Macros): LabelMacroFieldValues {
  return {
    carbs: toMacroFieldValue(macros.carbs),
    fiber: toMacroFieldValue(macros.fiber),
    sugars: toMacroFieldValue(macros.sugars),
    polyols: toMacroFieldValue(macros.polyols),
    protein: toMacroFieldValue(macros.protein),
    fat: toMacroFieldValue(macros.fat),
    kcal: toMacroFieldValue(macros.kcal),
  };
}

/** The default name for the food a confirmed reading creates: the product, qualified by its brand. */
export function buildLabelFoodName(view: Extract<LabelConfirmView, { kind: 'reading' }>): string {
  const product = view.productName?.trim() ?? '';
  const brand = view.brand?.trim() ?? '';
  if (product !== '' && brand !== '' && !product.toLowerCase().includes(brand.toLowerCase())) {
    return `${brand} ${product}`;
  }
  if (product !== '') return product;
  return brand;
}

/**
 * The quantity the confirm form pre-fills: the panel's own serving weight when
 * it printed one, otherwise 100 g — the basis the person is looking at. Never
 * 0, which no form can submit.
 */
export const DEFAULT_LABEL_LOG_GRAMS = 100;

/** @returns the grams to pre-fill for logging this panel's product. */
export function defaultLabelLogGrams(view: Extract<LabelConfirmView, { kind: 'reading' }>): number {
  return view.servingGrams !== null && view.servingGrams > 0 ? view.servingGrams : DEFAULT_LABEL_LOG_GRAMS;
}

/**
 * The reusable CUSTOM FOOD a confirmed panel creates — the payoff of the whole
 * feature. Reading a package costs a paid vision call; this row means the
 * second purchase of that product is a one-tap re-log from /add's "Your foods"
 * and never a second call.
 *
 * It carries every macro the panel printed, `polyols` included. That field is
 * `null` for every food in the generic database (sugar alcohols are
 * branded-only data), so this is the first row in openplate that can hold one —
 * and holding it is what makes net carbs right for a maltitol-sweetened
 * product.
 *
 * `source: 'user'`, not `'plate_ai'`: nothing here was estimated from a
 * photograph of food. The figures are the manufacturer's own, transcribed and
 * then confirmed by the person on an editable form — the same provenance as
 * typing the panel in by hand, which is exactly what this replaces.
 *
 * `netCarbsPer100g` and `micronutrientsPer100g` are deliberately OMITTED, for
 * the same reasons `buildManualFood` omits them: a panel prints neither, so
 * absent is the honest answer and the readers correctly compute net carbs from
 * the very numbers on the label. Do not "fix" this by filling either.
 *
 * @param options.name - the food's name as confirmed.
 * @param options.brand - the brand as confirmed, or null.
 * @param options.macrosPer100g - the per-100g macros, `carbs` already narrowed to a number (the personal-food invariant).
 * @param options.id - the client-generated food id.
 * @param options.createdAtMs - the instant the row was created on-device.
 * @returns the personal food to persist.
 */
export function buildLabelScanFood({
  name,
  brand,
  macrosPer100g,
  id,
  createdAtMs,
}: {
  name: string;
  brand: string | null;
  macrosPer100g: Macros & { carbs: number };
  id: string;
  createdAtMs: number;
}): LocalPersonalFood {
  return {
    id,
    name,
    brand: brand !== null && brand.trim() !== '' ? brand.trim() : null,
    macrosPer100g,
    source: 'user',
    createdAt: createdAtMs,
  };
}

/**
 * The diary entry a confirmed panel logs, alongside the food above.
 *
 * `aiEstimated: true` even though the numbers are a manufacturer's: a model
 * read them off a photograph, and reading small print off a curved, glossy
 * package can go wrong in a way the person confirming may not catch. The flag
 * is what puts the day's "~" caveat on this entry, and this is precisely the
 * kind of entry that caveat exists for. It is a claim about who produced the
 * figure, not about how careful the figure is.
 *
 * `netCarbsPer100g`, `micronutrientsPer100g` and `attribution` are omitted for
 * the same reasons as on the food: a panel prints no net-carb figure of its
 * own, no vitamins, and credits no third-party source.
 *
 * @param options.name - the food's name as confirmed.
 * @param options.quantityGrams - the amount being logged.
 * @param options.macrosPer100g - the confirmed per-100g macros.
 * @param options.foodId - the custom food created for this panel, or null when it couldn't be (no carbs).
 * @param options.id - the client-generated entry id / idempotency key.
 * @param options.loggedAtMs - the instant the entry is logged against.
 * @param options.dayKey - the device-local calendar day the entry belongs to.
 * @param options.createdAtMs - the instant the row was created on-device.
 * @returns the entry to persist.
 */
export function buildLabelScanEntry({
  name,
  quantityGrams,
  macrosPer100g,
  foodId,
  id,
  loggedAtMs,
  dayKey,
  createdAtMs,
}: {
  name: string;
  quantityGrams: number;
  macrosPer100g: Macros;
  foodId: string | null;
  id: string;
  loggedAtMs: number;
  dayKey: string;
  createdAtMs: number;
}): LocalFoodLog {
  return {
    id,
    name,
    quantityGrams,
    macros: scaleMacrosPer100gToServing(macrosPer100g, quantityGrams),
    mealType: null,
    source: 'plate_ai',
    aiEstimated: true,
    curatedSource: null,
    foodId,
    dayKey,
    loggedAt: loggedAtMs,
    createdAt: createdAtMs,
    logBatchId: null,
  };
}
