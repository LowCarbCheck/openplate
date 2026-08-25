/**
 * Domain types for BYOK plate-identification vision providers. This is the
 * app-facing shape — never a vendor SDK type (see `openai-compatible.ts` /
 * `anthropic.ts` for the fetch-only adapters that translate to/from it).
 */

// Type-only import: `./task` imports this module's values, so a value import
// here would close a runtime cycle. The descriptor shape belongs beside the
// task definitions, not in the domain types.
import type { ScanTaskDescriptor } from './task';

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

export interface IdentifiedFood {
  name: string;
  estimatedGrams: number;
  confidence: ConfidenceLevel;
  /** Short everyday-size comparison ("about half the plate") — display-only, may be absent. */
  portionHint?: string;
  macrosPer100g?: IdentifiedFoodMacros;
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
  notes?: string;
  /** Present only when the provider's response reported usage — never fabricated. */
  usage?: ScanTokenUsage;
}

/**
 * The serving size a nutrition panel prints, kept as text plus grams where the
 * panel states them. `asPrinted` is the authority ("1 bar (35 g)", "2 pieces");
 * `grams` is present only when the panel actually gives a weight — it is never
 * derived here, because deriving it is M123/06's job.
 */
export interface LabelServingSize {
  asPrinted?: string;
  grams?: number;
}

/**
 * One package nutrition panel, as read (M123/10). Deliberately NOT a
 * `PlateIdentification`: there is no `foods[]`, no `estimatedGrams`, no
 * per-item confidence and no `portionHint` — a label is one product's printed
 * figures, not a plate of estimated items.
 *
 * `macrosPerServing` and `macrosPer100g` mirror the two columns a panel may
 * print; either may be absent, and the conversion between them belongs to
 * M123/06, not here. An absent macro means the panel didn't print it or it
 * couldn't be read — never zero.
 */
export interface LabelReading {
  /**
   * The model's own "I could not read this panel" answer (a 2xx response, not
   * a transport failure — see `VisionFailureCause`, which deliberately carries
   * no label member). Asking for this escape hatch is a correctness feature:
   * without it a model invents plausible numbers off a blurry photo.
   */
  unreadable: boolean;
  unreadableReason?: string;
  productName?: string;
  brand?: string;
  servingSize?: LabelServingSize;
  servingsPerPackage?: number;
  /** Macros for one serving as printed — same macro vocabulary as the plate path. */
  macrosPerServing?: IdentifiedFoodMacros;
  /** Macros per 100 g as printed. Never computed from the per-serving column here. */
  macrosPer100g?: IdentifiedFoodMacros;
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

/** The photo handed to a scan task. Named for the plate path it shipped with; every task uses it. */
export interface PlateImageInput {
  /** Raw image bytes, base64-encoded. Never written to disk. */
  base64: string;
  mimeType: string;
}

export interface VisionProvider {
  /**
   * Runs one scan task against the provider. The task descriptor (see
   * `./task`) carries the prompt, the JSON Schema and the parse; transport,
   * retry, failure classification and cost accounting here stay task-blind —
   * there is no mode branch inside an adapter, by design.
   */
  runScan<TResult extends ScanResultBase>(options: {
    task: ScanTaskDescriptor<TResult>;
    image: PlateImageInput;
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
