/**
 * Scan-task descriptors — the seam that lets one vision service run two very
 * different jobs (M123/10).
 *
 * A task descriptor bundles everything that DIFFERS between a plate scan and a
 * label scan: the system prompt, the user prompt, the JSON Schema handed to the
 * provider for enforced structured output, and the two parse entry points (the
 * enforced-output validator and the free-text fallback). Everything an adapter
 * does around that — transport, the structured-output retry, HTTP failure
 * classification, token/cost accounting — is task-blind and shared.
 *
 * WHY A DESCRIPTOR AND NOT A MODE STRING: both adapters hardcoded the plate
 * prompt AND the plate JSON schema AND the plate parse. Threading a bare
 * `'plate' | 'label'` would have grown three `if (mode === 'label')` branches
 * per adapter — two copies of the same drift-prone fork. With a descriptor
 * there is nothing left to branch on. If a future task seems to need a branch
 * inside an adapter, the descriptor is missing a field: add the field.
 */
import type { LabelReading, PlateIdentification, ScanResultBase, ScanTokenUsage } from './types';
import {
  LABEL_READING_JSON_SCHEMA,
  PLATE_IDENTIFICATION_JSON_SCHEMA,
  parseLabelReadingJson,
  parsePlateIdentificationJson,
  validateLabelReading,
  validatePlateIdentification,
} from './schema';
import type { JsonSchemaNode, UnvalidatedProviderJson } from './schema';
import {
  LABEL_READING_SYSTEM_PROMPT,
  PLATE_IDENTIFICATION_SYSTEM_PROMPT,
  buildLabelReadingUserPrompt,
  buildPlateIdentificationUserPrompt,
} from './prompt';

/** The scan tasks the service can run. Nameable at the call site; never branched on inside an adapter. */
export const VISION_MODES = ['plate', 'label'] as const;
export type VisionMode = (typeof VISION_MODES)[number];

/**
 * One scan task, fully described. `TResult` is the task's own result shape —
 * `PlateIdentification` and `LabelReading` share nothing but the optional
 * `usage` an adapter attaches, which is exactly what `ScanResultBase` pins
 * down.
 */
export interface ScanTaskDescriptor<TResult extends ScanResultBase> {
  readonly mode: VisionMode;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** Provider-facing JSON Schema, derived from this task's Zod wire schema. */
  readonly jsonSchema: JsonSchemaNode;
  /** Name for OpenAI's `json_schema` response_format block. */
  readonly schemaName: string;
  /** Anthropic forced-tool-use name + description for this task. */
  readonly toolName: string;
  readonly toolDescription: string;
  /** Free-text fallback path: raw model output → result. */
  readonly parse: (rawText: string) => TResult;
  /** Enforced-structured-output path: an already-parsed JSON value → result. */
  readonly validate: (value: UnvalidatedProviderJson) => TResult;
}

/** Photograph of a plate → the foods worth logging. The original task, unchanged. */
export const PLATE_SCAN_TASK: ScanTaskDescriptor<PlateIdentification> = {
  mode: 'plate',
  systemPrompt: PLATE_IDENTIFICATION_SYSTEM_PROMPT,
  userPrompt: buildPlateIdentificationUserPrompt(),
  jsonSchema: PLATE_IDENTIFICATION_JSON_SCHEMA,
  schemaName: 'plate_identification',
  toolName: 'record_plate_identification',
  toolDescription: 'Record the foods identified on the plate.',
  parse: parsePlateIdentificationJson,
  validate: validatePlateIdentification,
};

/** Photograph of a package nutrition panel → the manufacturer's printed figures. */
export const LABEL_SCAN_TASK: ScanTaskDescriptor<LabelReading> = {
  mode: 'label',
  systemPrompt: LABEL_READING_SYSTEM_PROMPT,
  userPrompt: buildLabelReadingUserPrompt(),
  jsonSchema: LABEL_READING_JSON_SCHEMA,
  schemaName: 'label_reading',
  toolName: 'record_label_reading',
  toolDescription: 'Record the nutrition panel printed on the package.',
  parse: parseLabelReadingJson,
  validate: validateLabelReading,
};

/**
 * Copies a result with the call's token usage attached, or returns it
 * untouched when the provider reported none — usage is never fabricated.
 * Shared by both adapters so "attach usage" stays one behaviour rather than
 * four near-identical expressions.
 */
export function attachScanUsage<TResult extends ScanResultBase>(
  result: TResult,
  usage: ScanTokenUsage | undefined,
): TResult {
  if (!usage) return result;
  return Object.assign({}, result, { usage });
}
