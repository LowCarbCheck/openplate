/**
 * Domain types for BYOK plate-identification vision providers. This is the
 * app-facing shape — never a vendor SDK type (see `openai-compatible.ts` /
 * `anthropic.ts` for the fetch-only adapters that translate to/from it).
 */

// Type-only import: `./task` imports this module's values, so a value import
// here would close a runtime cycle. The descriptor shape belongs beside the
// task definitions, not in the domain types.
import type { IntakeTaskDescriptor } from './task';
import type { CarbBasis } from '#app/lib/net-carbs';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface IdentifiedFoodMacros {
  carbs?: number;
  fiber?: number;
  sugars?: number;
  polyols?: number;
  protein?: number;
  fat?: number;
  kcal?: number;
}

/**
 * Where one item's per-100g macros came from, as reported by the provider:
 * `'corpus'` for a lookup in a food database, `'model'` for the vision model's
 * own estimate.
 *
 * Only a self-hosted openplate-inference server reports this today (M138
 * spec 06); every cloud provider omits it, which is why the field is optional
 * everywhere it appears and is absent from the provider-facing JSON Schema
 * (see `schema.ts`). Nothing in the UI reads it yet — it exists so a corpus
 * answer can be told apart from a guess, and so its licence attribution can
 * travel with it.
 */
export const MACRO_PROVENANCE_VALUES = ['corpus', 'model'] as const;
export type MacroProvenance = (typeof MACRO_PROVENANCE_VALUES)[number];

/**
 * WHERE ONE ITEM'S MACROS CAME FROM.
 *
 * `'estimated'` is the model looking at food and judging; `'label'` is the
 * model transcribing a manufacturer's printed nutrition panel. They are not
 * the same kind of number and the review screen must not present them as one:
 * a transcription can be checked against the package in the person's hand, an
 * estimate cannot be checked against anything.
 *
 * This replaces the separate label SCAN MODE (M123/10, amended 2026-09-08).
 * The mode asked the person to declare, before the shutter, which kind of
 * photograph they were about to take; the model decides per ITEM now, which is
 * the only way a photo of a packet standing on a plate can be answered
 * honestly.
 */
export const MACRO_SOURCE_VALUES = ['estimated', 'label'] as const;
export type MacroSource = (typeof MACRO_SOURCE_VALUES)[number];

/**
 * The serving a nutrition panel prints, kept as text plus grams where the
 * panel states them. `asPrinted` is the authority ("1 bar (35 g)",
 * "2 pieces"); `grams` is present only when the panel actually gives a weight,
 * and is never derived here.
 *
 * It reaches the review screen as a PORTION CHIP and goes no further: nothing
 * persists a serving, because `LocalPersonalFood` has no field for one and
 * inventing one would be a local-store version bump for a value the person has
 * already applied by the time they confirm.
 */
export interface PrintedServingSize {
  asPrinted: string;
  grams?: number;
}

export interface IdentifiedFood {
  name: string;
  estimatedGrams: number;
  confidence: ConfidenceLevel;
  /** Short everyday-size comparison ("about half the plate") — display-only, may be absent. */
  portionHint?: string;
  macrosPer100g?: IdentifiedFoodMacros;
  /** See {@link MacroSource}. Always present: every item declares which kind of number it is. */
  macroSource: MacroSource;
  /** The manufacturer, when a package named one. Absent for anything unbranded. */
  brand?: string;
  /** The panel's printed serving, for a `'label'` item. See {@link PrintedServingSize}. */
  servingSize?: PrintedServingSize;
  /**
   * Which printed-panel convention this item's carbs figure uses: `total`
   * (US "Total Carbohydrate", fibre-INCLUSIVE) or `available` (EU
   * "Kohlenhydrate", fibre-EXCLUSIVE, polyols still subtracted). The model
   * reports the LAYOUT it sees and never does the subtraction itself
   * (`#app/lib/net-carbs` owns that). Absent for an estimated item, which has
   * no printed panel to report, and absent when a panel's layout does not
   * decide it. See `LocalFoodLog.carbBasis` for the UNKNOWN-means-`total` rule
   * downstream.
   */
  carbBasis?: CarbBasis;
  /** See {@link MacroProvenance} — present only when the provider reported it. */
  provenance?: MacroProvenance;
  /**
   * Licence attribution for a `'corpus'` answer (e.g. a CC BY 4.0 source that
   * must be credited when its numbers are shown). Carried through parsing
   * untouched; no surface displays it yet, so a corpus source's attribution
   * obligation is preserved rather than discharged by this field alone.
   */
  attribution?: string;
}

/** Token usage for one vision-provider call — used for cost estimation (see `./cost`). */
export interface ScanTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface PlateIdentification {
  foods: IdentifiedFood[];
  /**
   * The model's own "I could not read this" answer (a 2xx response, not a
   * transport failure, see `VisionFailureCause`, which deliberately carries
   * no member for it). Asking for this escape hatch is a correctness feature:
   * without it a model invents plausible numbers off a blurry photograph.
   *
   * It became a TOP-LEVEL field when the label mode was merged in: it is a
   * statement about the whole picture, not about one food on it. A photograph
   * with three legible items and one unreadable packet is not unreadable, and
   * the model is told to say so per item instead, by leaving that item's
   * macros null.
   */
  unreadable: boolean;
  unreadableReason?: string;
  notes?: string;
  /** Present only when the provider's response reported usage — never fabricated. */
  usage?: ScanTokenUsage;
}

/**
 * What every scan-task result has in common: the optional token usage the
 * adapters attach after a successful call. It is the only part of a result the
 * shared transport code touches, which is what lets one adapter serve every
 * task (see `./task`).
 */
export interface ScanResultBase {
  usage?: ScanTokenUsage;
}

/** The photo handed to a scan task. Named for the plate path it shipped with; every photo task uses it. */
export interface PlateImageInput {
  /** Raw image bytes, base64-encoded. Never written to disk. */
  base64: string;
  mimeType: string;
}

/**
 * WHAT ONE INTAKE CALL CARRIES: a picture, or the person's own words.
 *
 * A union rather than two optional fields, so "both" and "neither" are
 * unrepresentable. Both would be a request whose meaning depended on which
 * branch an adapter read first; neither would be a paid call about nothing.
 *
 * It exists because the two are the SAME job from the model's side — describe
 * the foods worth logging and return `foods[]` — and differ only in which
 * content part the user message carries. Everything around that (transport,
 * retry, failure classification, token accounting) is shared, exactly as it
 * already is between the two photo tasks.
 */
export type IntakeInput =
  | { kind: 'photo'; image: PlateImageInput }
  /** Free text in any language, exactly as the person typed or spoke it. Never rewritten before it is sent. */
  | { kind: 'text'; text: string };

export interface VisionProvider {
  /**
   * Runs one PHOTO task against the provider. The task descriptor (see
   * `./task`) carries the prompt, the JSON Schema and the parse; transport,
   * retry, failure classification and cost accounting here stay task-blind —
   * there is no mode branch inside an adapter, by design.
   */
  runScan<TResult extends ScanResultBase>(options: {
    task: IntakeTaskDescriptor<TResult>;
    image: PlateImageInput;
  }): Promise<TResult>;
  /**
   * Runs one TEXT task against the provider, with everything above shared.
   */
  runTextIntake<TResult extends ScanResultBase>(options: {
    task: IntakeTaskDescriptor<TResult>;
    text: string;
  }): Promise<TResult>;
}

/**
 * Thrown for any vision-provider failure (network, non-2xx response,
 * malformed output). The message is always safe to display/log — adapters
 * must never include the API key or Authorization header in it.
 *
 * `usage` is attached only when a 2xx response already reported token usage
 * before parsing failed (malformed/empty content) — so the billed-but-fruitless
 * attempt can still be recorded. It stays undefined for network/non-2xx errors,
 * where nothing was billed. Never fabricated.
 */
export class VisionProviderError extends Error {
  readonly usage?: ScanTokenUsage;
  constructor(message: string, options?: { cause?: unknown; usage?: ScanTokenUsage }) {
    super(message, options);
    this.name = 'VisionProviderError';
    this.usage = options?.usage;
  }
}
