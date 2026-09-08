/**
 * Intake-task descriptors, the seam that lets one vision service run two very
 * different jobs from one transport.
 *
 * A task descriptor bundles everything that DIFFERS between reading a
 * photograph and reading a person's own words: the system prompt, the user
 * prompt, the JSON Schema handed to the provider for enforced structured
 * output, and the two parse entry points (the enforced-output validator and
 * the free-text fallback). Everything an adapter does around that, transport,
 * the structured-output retry, HTTP failure classification, token and cost
 * accounting, is task-blind and shared.
 *
 * WHY A DESCRIPTOR AND NOT A MODE STRING: both adapters used to hardcode the
 * plate prompt AND the plate JSON schema AND the plate parse. Threading a bare
 * mode string would have grown three `if` branches per adapter, two copies of
 * the same drift-prone fork. With a descriptor there is nothing left to branch
 * on. If a future task seems to need a branch inside an adapter, the
 * descriptor is missing a field: add the field.
 *
 * ── Two tasks, not three (amends ADR-0005, 2026-09-08) ───────────────────
 *
 * There used to be a third, `label`, with its own prompt, its own schema, its
 * own result type and its own capture resolution, selected by a mode the
 * person picked before the shutter. It is gone: one photo prompt now decides
 * per item whether it is estimating food or transcribing a printed panel, and
 * both answers come back in the same `foods` array. What that removed is not
 * only the second task but the whole idea of a task the CALLER has to choose
 * between two photographs, which is why nothing here is keyed by a UI mode any
 * more.
 */
import type { PlateIdentification, ScanResultBase, ScanTokenUsage } from './types';
import { PLATE_IDENTIFICATION_JSON_SCHEMA, parsePlateIdentificationJson, validatePlateIdentification } from './schema';
import type { JsonSchemaNode, UnvalidatedProviderJson } from './schema';
import {
  PLATE_IDENTIFICATION_SYSTEM_PROMPT,
  TEXT_INTAKE_SYSTEM_PROMPT,
  buildPlateIdentificationUserPrompt,
  buildTextIntakeUserPrompt,
} from './prompt';

/**
 * Every intake job the service can run.
 *
 * Two members, and neither is a control on a screen: a photograph goes to the
 * photo task and words go to the text task, decided by which one the person
 * produced rather than by anything they were asked to pick.
 */
export const INTAKE_MODES = ['photo', 'text'] as const;
export type IntakeMode = (typeof INTAKE_MODES)[number];

/**
 * One intake task, fully described. `TResult` is the task's own result shape.
 *
 * Both tasks answer with `PlateIdentification` today, and that is the point
 * rather than an accident: one shape means one review screen. The generic
 * stays because `ScanResultBase` is what the shared transport actually depends
 * on, so a future task with its own result costs an adapter nothing.
 */
export interface IntakeTaskDescriptor<TResult extends ScanResultBase> {
  readonly mode: IntakeMode;
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

/**
 * A photograph → the foods worth logging, whatever the photograph shows.
 *
 * ONE PHOTO TASK IS THE WHOLE POINT. A plate, a single apple, a packet and a
 * nutrition panel all arrive here, and the prompt sorts them out per item. The
 * capture resolution went with the second task: there is one ceiling now
 * (`MAX_IMAGE_DIMENSION`), so there is nothing left for a descriptor to carry
 * and a field that always answers the same thing would be a drift trap wearing
 * the look of a decision.
 */
export const PHOTO_INTAKE_TASK: IntakeTaskDescriptor<PlateIdentification> = {
  mode: 'photo',
  systemPrompt: PLATE_IDENTIFICATION_SYSTEM_PROMPT,
  userPrompt: buildPlateIdentificationUserPrompt(),
  jsonSchema: PLATE_IDENTIFICATION_JSON_SCHEMA,
  schemaName: 'plate_identification',
  toolName: 'record_plate_identification',
  toolDescription: 'Record the foods identified in the photo.',
  parse: parsePlateIdentificationJson,
  validate: validatePlateIdentification,
};

/**
 * The person's own words → the foods worth logging.
 *
 * SAME RESULT AS A PHOTOGRAPH, on purpose: the same schema, the same
 * `foods` array, the same parse, so the review screen, the confirm action and
 * every downstream builder are reached unchanged. What differs is the subject
 * the model is reading, and that lives entirely in the prompt.
 */
export const TEXT_INTAKE_TASK: IntakeTaskDescriptor<PlateIdentification> = {
  mode: 'text',
  systemPrompt: TEXT_INTAKE_SYSTEM_PROMPT,
  userPrompt: buildTextIntakeUserPrompt(),
  jsonSchema: PLATE_IDENTIFICATION_JSON_SCHEMA,
  // The SAME schema name and tool name the photo task uses, because it is the
  // same schema. A second name for one shape would only invite a second shape.
  schemaName: 'plate_identification',
  toolName: 'record_plate_identification',
  toolDescription: 'Record the foods the person described eating.',
  parse: parsePlateIdentificationJson,
  validate: validatePlateIdentification,
};

/**
 * Every intake task, keyed by its mode: the single pairing of prompt with
 * schema, and the one place a mode is turned back into the task it names.
 *
 * `satisfies`, not an annotation: the constraint checks that every mode has a
 * task, while the inferred type keeps each key's OWN result type. Annotating
 * it as `Record<IntakeMode, IntakeTaskDescriptor<ScanResultBase>>` would erase
 * which task returns which shape at every read site.
 */
export const INTAKE_TASK_BY_MODE = {
  photo: PHOTO_INTAKE_TASK,
  text: TEXT_INTAKE_TASK,
} satisfies Record<IntakeMode, IntakeTaskDescriptor<ScanResultBase>>;

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
