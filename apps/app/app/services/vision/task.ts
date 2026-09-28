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
import type { LanguageCode } from '#app/i18n/language-prefs';
import type { PlateIdentification, ScanResultBase, ScanTokenUsage } from './types';
import type { PantryIdentification } from './pantry-schema';
import type { RecipeProposals } from './recipe-schema';
import {
  RECIPE_PROPOSALS_JSON_SCHEMA,
  parseRecipeProposalsJson,
  validateRecipeProposals,
} from './recipe-schema';
import { RECIPE_PROPOSAL_SYSTEM_PROMPT } from './recipe-prompt';
import {
  PANTRY_IDENTIFICATION_JSON_SCHEMA,
  parsePantryIdentificationJson,
  validatePantryIdentification,
} from './pantry-schema';
import {
  buildPantryPhotoSystemPrompt,
  buildPantryPhotoUserPrompt,
  buildPantryTextSystemPrompt,
  buildPantryTextUserPrompt,
} from './pantry-prompt';
import { PLATE_IDENTIFICATION_JSON_SCHEMA, parsePlateIdentificationJson, validatePlateIdentification } from './schema';
import type { JsonSchemaNode, UnvalidatedProviderJson } from './schema';
import {
  buildPlateIdentificationSystemPrompt,
  buildPlateIdentificationUserPrompt,
  buildTextIntakeSystemPrompt,
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
export function photoIntakeTask(language: LanguageCode): IntakeTaskDescriptor<PlateIdentification> {
  return {
    mode: 'photo',
    systemPrompt: buildPlateIdentificationSystemPrompt(language),
    userPrompt: buildPlateIdentificationUserPrompt(),
    jsonSchema: PLATE_IDENTIFICATION_JSON_SCHEMA,
    schemaName: 'plate_identification',
    toolName: 'record_plate_identification',
    toolDescription: 'Record the foods identified in the photo.',
    parse: (rawText) => parsePlateIdentificationJson(rawText, language),
    validate: (value) => validatePlateIdentification(value, language),
  };
}

/**
 * The person's own words → the foods worth logging.
 *
 * SAME RESULT AS A PHOTOGRAPH, on purpose: the same schema, the same
 * `foods` array, the same parse, so the review screen, the confirm action and
 * every downstream builder are reached unchanged. What differs is the subject
 * the model is reading, and that lives entirely in the prompt.
 */
export function textIntakeTask(language: LanguageCode): IntakeTaskDescriptor<PlateIdentification> {
  return {
    mode: 'text',
    systemPrompt: buildTextIntakeSystemPrompt(language),
    userPrompt: buildTextIntakeUserPrompt(),
    jsonSchema: PLATE_IDENTIFICATION_JSON_SCHEMA,
    // The SAME schema name and tool name the photo task uses, because it is the
    // same schema. A second name for one shape would only invite a second shape.
    schemaName: 'plate_identification',
    toolName: 'record_plate_identification',
    toolDescription: 'Record the foods the person described eating.',
    parse: (rawText) => parsePlateIdentificationJson(rawText, language),
    validate: (value) => validatePlateIdentification(value, language),
  };
}

/**
 * A photograph of a fridge, a shelf or a bag, into the list of ingredients a
 * person HAS.
 *
 * THE FIRST TASK WITH A RESULT OF ITS OWN, which is what the generic on
 * `IntakeTaskDescriptor` was always for: `PantryIdentification` is not a
 * `PlateIdentification` with different words, because a pantry row carries no
 * portion and no macros and usually no amount at all (see `./pantry-schema`).
 * Every adapter reaches it unchanged, because everything that differs is data
 * on this object.
 */
export function pantryPhotoTask(language: LanguageCode): IntakeTaskDescriptor<PantryIdentification> {
  return {
    mode: 'photo',
    systemPrompt: buildPantryPhotoSystemPrompt(language),
    userPrompt: buildPantryPhotoUserPrompt(),
    jsonSchema: PANTRY_IDENTIFICATION_JSON_SCHEMA,
    schemaName: 'pantry_identification',
    toolName: 'record_pantry_identification',
    toolDescription: 'Record the ingredients visible in the photo of food storage.',
    parse: (rawText) => parsePantryIdentificationJson(rawText, language),
    validate: (value) => validatePantryIdentification(value, language),
  };
}

/**
 * The person's own words, into the same list.
 *
 * The SAME schema and the same tool name as the photo task above, because it
 * is the same answer arrived at from a different subject; a second name for
 * one shape would only invite a second shape. What differs is the prompt, and
 * one rule inside it: a quantity somebody typed is honoured, while one that
 * could not be read off a package is null.
 */
export function pantryTextTask(language: LanguageCode): IntakeTaskDescriptor<PantryIdentification> {
  return {
    mode: 'text',
    systemPrompt: buildPantryTextSystemPrompt(language),
    userPrompt: buildPantryTextUserPrompt(),
    jsonSchema: PANTRY_IDENTIFICATION_JSON_SCHEMA,
    schemaName: 'pantry_identification',
    toolName: 'record_pantry_identification',
    toolDescription: 'Record the ingredients the person says they have at home.',
    parse: (rawText) => parsePantryIdentificationJson(rawText, language),
    validate: (value) => validatePantryIdentification(value, language),
  };
}

/**
 * The shelf plus the rest of the day, into two or three things to cook next
 * (M233/04).
 *
 * A TEXT TASK WHOSE TEXT IS A PROMPT BLOCK. Nothing is being read here: there
 * is no photograph and no sentence a person wrote, only facts the app already
 * holds, assembled by `buildRecipeProposalUserPrompt` and handed over as the
 * call's text. That is why the static `userPrompt` below is one line of
 * hand-over rather than the instruction: the instruction is in the block, and
 * the block changes with every slot.
 *
 * Its own result type for the same reason the pantry has one: a proposal
 * carries steps and a per-serving nutrition claim, and neither fits a shape
 * built to describe food somebody already ate.
 */
export const RECIPE_PROPOSAL_TASK: IntakeTaskDescriptor<RecipeProposals> = {
  mode: 'text',
  systemPrompt: RECIPE_PROPOSAL_SYSTEM_PROMPT,
  userPrompt:
    'Here is what the person has at home and what is still open in their day. Propose the recipes as the system prompt describes.',
  jsonSchema: RECIPE_PROPOSALS_JSON_SCHEMA,
  schemaName: 'recipe_proposals',
  toolName: 'record_recipe_proposals',
  toolDescription: 'Record the recipes proposed from the pantry for the next meal slot.',
  parse: parseRecipeProposalsJson,
  validate: validateRecipeProposals,
};

/**
 * Every intake task builder, keyed by its mode: the single pairing of prompt
 * with schema, and the one place a mode is turned back into the task it names.
 *
 * BUILDERS, NOT TASKS (M251 spec 02): a task's prompt names the app language,
 * so there is no task until a language is given, and a map of prebuilt tasks
 * would be a map of English ones that a caller could reach for by mistake.
 *
 * `satisfies`, not an annotation: the constraint checks that every mode has a
 * builder, while the inferred type keeps each key's OWN result type.
 */
export const INTAKE_TASK_BY_MODE = {
  photo: photoIntakeTask,
  text: textIntakeTask,
} satisfies Record<IntakeMode, (language: LanguageCode) => IntakeTaskDescriptor<ScanResultBase>>;

/**
 * The same pairing for the PANTRY, and a second map rather than a widened one.
 *
 * A map from a mode to "the task" only answers a question once there is one
 * task per mode, and since M233/02 there are two families. Merging them would
 * need a key naming both the mode and the family, which is a compound key
 * standing in for the thing the two consumers already know: the diary asks for
 * a plate, the pantry asks for a pantry.
 */
export const PANTRY_TASK_BY_MODE = {
  photo: pantryPhotoTask,
  text: pantryTextTask,
} satisfies Record<IntakeMode, (language: LanguageCode) => IntakeTaskDescriptor<ScanResultBase>>;

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
