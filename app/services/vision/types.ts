/**
 * Domain types for BYOK plate-identification vision providers. This is the
 * app-facing shape — never a vendor SDK type (see `openai-compatible.ts` /
 * `anthropic.ts` for the fetch-only adapters that translate to/from it).
 */

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

export interface PlateImageInput {
  /** Raw image bytes, base64-encoded. Never written to disk. */
  base64: string;
  mimeType: string;
}

export interface VisionProvider {
  identifyPlate(image: PlateImageInput): Promise<PlateIdentification>;
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
