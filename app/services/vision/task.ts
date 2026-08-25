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
import { LABEL_MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION } from '#app/lib/photo-constraints';
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
  /**
   * Longest edge (px) the capture is downscaled to before it is sent, for THIS
   * task (`downscaleToJpeg`'s per-call override in `#app/lib/photo-constraints`).
   *
   * It lives on the descriptor for the same reason the prompt and the schema
   * do: how much detail a job needs is a property of the job. A plate needs
   * shapes; a nutrition panel needs legible 6-point type. Putting it here means
   * the route reads it off whichever task was selected — an
   * `if (mode === 'label')` around the downscale call in `scan.tsx` would
   * reintroduce, one layer up, exactly the fork this descriptor removed from
   * the adapters.
   */
  readonly captureMaxDimension: number;
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
  // The app-wide default: a plate is read from shapes and colours, so the extra
  // pixels a panel needs would be paid for on every scan and buy nothing.
  captureMaxDimension: MAX_IMAGE_DIMENSION,
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
  // Small printed text: see `LABEL_MAX_IMAGE_DIMENSION` for why this is a
  // second ceiling rather than a raise of the shared one.
  captureMaxDimension: LABEL_MAX_IMAGE_DIMENSION,
  parse: parseLabelReadingJson,
  validate: validateLabelReading,
};

/**
 * Every scan task, keyed by its mode — the one place a `VisionMode` (which is
 * what a UI control can actually hold) is turned back into the task that mode
 * names.
 *
 * It exists so no caller ever writes `mode === 'label' ? … : …` to reach a
 * task's DATA. A route selects the task once, then reads whatever it needs off
 * the descriptor (`captureMaxDimension`, and the prompt/schema/parse the
 * adapter reads). Adding a third task means adding a member here and nowhere
 * else.
 *
 * `satisfies`, not an annotation: the constraint checks that every mode has a
 * task, while the inferred type keeps each key's OWN result type — annotating
 * it as `Record<VisionMode, ScanTaskDescriptor<ScanResultBase>>` would erase
 * which task returns which shape at every read site.
 */
export const SCAN_TASK_BY_MODE = {
  plate: PLATE_SCAN_TASK,
  label: LABEL_SCAN_TASK,
} satisfies Record<VisionMode, ScanTaskDescriptor<ScanResultBase>>;

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
