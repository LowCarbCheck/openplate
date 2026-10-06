/**
 * The vision contract: every prompt, schema and upload constraint a managed or
 * BYOK vision call carries, written down as one JSON document the eval harness
 * (`apps/inference/eval`) reads.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * The eval harness used to hold its own copy of the August 2026 photo prompt
 * and a smaller schema. Production moved on (flags, label transcription,
 * translations, six languages, a text task, a pantry, recipes) and the eval
 * kept scoring a request nobody sends. A copy cannot be kept honest by
 * discipline, so there is no copy: this module calls the REAL builders, and the
 * harness reads what they return.
 *
 * ── HOW IT STAYS FRESH ───────────────────────────────────────────────────
 *
 * `pnpm vision:export-contract` writes the committed file. The unit test
 * `tests/unit/vision-contract-export.test.ts` regenerates the contract in
 * memory and fails when the committed file differs, so a prompt edit without a
 * re-export stops the push gate. `generatedFrom` pins the git blob hash of every
 * source file, so the harness can also refuse a stale contract at run time.
 *
 * Pure apart from reading the source files for their hashes, and that read is
 * injected, so the drift test can plant a change without touching the tree.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AiProviderType } from '#types/enums';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type LanguageCode } from '../../app/i18n/language-prefs';
import { describeRemainingDayForPrompt, type RemainingDay } from '../../app/lib/remaining-day';
import {
  ALLOWED_MIME_TYPES,
  JPEG_QUALITY,
  MAX_IMAGE_DIMENSION,
  MAX_PHOTO_BYTES,
  computeScaledDimensions,
} from '../../app/lib/photo-constraints';
import { findCatalogModel } from '../../app/services/vision/catalog';
import { buildOpenAiCompatibleRequestBody } from '../../app/services/vision/openai-compatible';
import { buildRecipeProposalUserPrompt } from '../../app/services/vision/recipe-prompt';
import type { JsonSchemaNode } from '../../app/services/vision/schema';
import {
  RECIPE_PROPOSAL_TASK,
  pantryPhotoTask,
  pantryTextTask,
  photoIntakeTask,
  textIntakeTask,
} from '../../app/services/vision/task';

/** Bumped when the SHAPE of the contract file changes, never for a prompt edit. */
export const CONTRACT_VERSION = 1;

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const REPO_ROOT = resolve(APP_ROOT, '../..');

/** Where the committed contract lives, relative to the repository root. */
export const CONTRACT_REPO_PATH = 'apps/inference/eval/generated/vision-contract.json';

/** Everything the contract is built from, relative to the repository root. A change to any of them needs a re-export. */
export const CONTRACT_SOURCE_FILES: readonly string[] = [
  'apps/app/app/i18n/language-prefs.ts',
  'apps/app/app/lib/photo-constraints.ts',
  'apps/app/app/lib/remaining-day.ts',
  'apps/app/app/services/vision/catalog.ts',
  'apps/app/app/services/vision/openai-compatible.ts',
  'apps/app/app/services/vision/pantry-prompt.ts',
  'apps/app/app/services/vision/pantry-schema.ts',
  'apps/app/app/services/vision/prompt.ts',
  'apps/app/app/services/vision/recipe-prompt.ts',
  'apps/app/app/services/vision/recipe-schema.ts',
  'apps/app/app/services/vision/schema.ts',
  'apps/app/app/services/vision/task.ts',
  'apps/app/app/services/vision/translations.ts',
];

// ── the JSON the file holds ───────────────────────────────────────────────

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const CONTRACT_TASK_KEYS = ['plate_photo', 'plate_text', 'pantry_photo', 'pantry_text', 'recipe'] as const;
export type ContractTaskKey = (typeof CONTRACT_TASK_KEYS)[number];

/** What one task contributes for one language. `userText` exists for the recipe task only. */
export interface ContractLanguageEntry {
  systemPrompt: string;
  userPrompt: string;
  userText?: string;
}

export interface ContractTask {
  inputKind: 'photo' | 'text';
  schemaName: string;
  strict: boolean;
  responseFormatType: string;
  jsonSchema: JsonSchemaNode;
  languages: Record<LanguageCode, ContractLanguageEntry>;
  exampleInput: JsonValue;
}

/** The pieces the harness needs to put the recipe user text together without copying any of its wording. */
export interface RecipeUserTextTemplate {
  template: string;
  pantryLineWithAmount: string;
  pantryLineWithoutAmount: string;
  markers: Record<string, string>;
}

export interface VisionContract {
  contractVersion: number;
  generatedBy: string;
  generatedFrom: { hashAlgorithm: 'git-blob-sha1'; files: Record<string, string> };
  languages: LanguageCode[];
  languageLabels: Record<LanguageCode, string>;
  photoConstraints: {
    maxLongSidePx: number;
    jpegQuality: number;
    maxUploadBytes: number;
    allowedMimeTypes: string[];
    outputMimeType: string;
    scaledDimensionExamples: Array<{ width: number; height: number; scaledWidth: number; scaledHeight: number }>;
  };
  requestLayout: {
    markers: Record<string, string>;
    messagesByInputKind: MessageLayouts;
    /**
     * Whether the app puts a `reasoning` field on the MANAGED request. It does not: the managed catalog is empty
     * (the instance names its model, the person never picks one), so no entry sets `disableReasoning`. A harness
     * that sends `reasoning` anyway is measuring a different request than the app makes.
     */
    appSendsReasoning: boolean;
  };
  recipeUserText: RecipeUserTextTemplate;
  tasks: Record<ContractTaskKey, ContractTask>;
}

// ── the injectable inputs ─────────────────────────────────────────────────

/** What one task puts on the wire, the part a prompt edit changes. */
export interface ContractTaskInput {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: JsonSchemaNode;
  schemaName: string;
}

/** The five tasks, named one by one so a sixth cannot be added without this list and CONTRACT_TASK_KEYS agreeing. */
export interface ContractTaskInputs {
  plate_photo: ContractTaskInput;
  plate_text: ContractTaskInput;
  pantry_photo: ContractTaskInput;
  pantry_text: ContractTaskInput;
  recipe: ContractTaskInput;
}

export interface MessageLayouts {
  photo: JsonValue;
  text: JsonValue;
}

interface ResponseFormatFacts {
  type: string;
  strict: boolean;
}

export interface VisionContractSources {
  /** The five tasks for one language, as the app builds them. */
  tasksFor: (language: LanguageCode) => ContractTaskInputs;
  /** The recipe user text for one language, as the app builds it. */
  recipeUserTextFor: (language: LanguageCode) => string;
  /** The bytes of a repository-relative source file. */
  readSource: (repoPath: string) => Uint8Array;
}

// ── fixed example values, recorded in the file ────────────────────────────

const EXAMPLE_PLATE_TEXT = 'Two scrambled eggs, two slices of rye toast with butter and a black coffee';
const EXAMPLE_PANTRY_TEXT = '6 eggs, 2 kg flour, some cheese, a litre of milk';
const EXAMPLE_RECIPE_SLOT = 'dinner';
const EXAMPLE_RECIPE_PANTRY = [
  { name: 'eggs', amount: 6, unit: 'piece' },
  { name: 'spinach', amount: null, unit: null },
  { name: 'rolled oats', amount: 500, unit: 'g' },
];
/** A fixed rest-of-day, so the recipe block in the file is the block the real builder writes for these numbers. */
const EXAMPLE_REMAINING_DAY: RemainingDay = {
  kcal: { target: 2000, consumed: 650, remaining: 1350, source: 'goal' },
  netCarbs: { target: 100, consumed: 30, remaining: 70, source: 'goal' },
  protein: { target: 90, consumed: 35, remaining: 55, source: 'default' },
  fat: { target: 90, consumed: 25, remaining: 65, source: 'derived' },
  fiber: { target: 30, consumed: 8, remaining: 22, source: 'default' },
  slot: EXAMPLE_RECIPE_SLOT,
  share: 0.5,
  emphasis: ['protein', 'fiber'],
  lens: 'carb',
};
const SCALE_EXAMPLE_SIZES: ReadonlyArray<readonly [number, number]> = [
  [4032, 3024],
  [3024, 4032],
  [1600, 1200],
  [1601, 1000],
  [1000, 800],
  [2400, 1800],
  [2999, 2001],
];

const LAYOUT_MARKERS = {
  system: '@@SYSTEM_PROMPT@@',
  user: '@@USER_PROMPT@@',
  imageBase64: '@@IMAGE_BASE64@@',
  inputText: '@@INPUT_TEXT@@',
};
const RECIPE_MARKERS = {
  pantryLines: '@@PANTRY_LINES@@',
  remainingDayBlock: '@@REMAINING_DAY_BLOCK@@',
  slot: '@@SLOT@@',
  language: '@@LANGUAGE@@',
  name: '@@NAME@@',
  amount: '@@AMOUNT@@',
  unit: '@@UNIT@@',
};
const AMOUNT_SENTINEL = 7777;

// ── the real builders, as the contract reads them ─────────────────────────

function inputOf(task: {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: JsonSchemaNode;
  schemaName: string;
}): ContractTaskInput {
  return {
    systemPrompt: task.systemPrompt,
    userPrompt: task.userPrompt,
    jsonSchema: task.jsonSchema,
    schemaName: task.schemaName,
  };
}

/**
 * Whether the app sends a `reasoning` field for a provider and model, read off the real request builder with the
 * flag the real call site derives from the catalog (`services/vision/index.ts`).
 *
 * @param options - the provider and the model id the call is made with.
 * @returns true when the request body carries a `reasoning` key.
 */
export function requestSendsReasoning(options: { provider: AiProviderType; modelId: string }): boolean {
  const body = buildOpenAiCompatibleRequestBody({
    model: options.modelId,
    input: { kind: 'text', text: LAYOUT_MARKERS.inputText },
    task: photoIntakeTask('en'),
    useStructuredOutput: true,
    disableReasoning: findCatalogModel(options.provider, options.modelId)?.disableReasoning === true,
  });
  return body.reasoning !== undefined;
}

export function recipeUserTextFromApp(language: LanguageCode): string {
  return buildRecipeProposalUserPrompt({
    pantry: EXAMPLE_RECIPE_PANTRY,
    remainingDayBlock: describeRemainingDayForPrompt(EXAMPLE_REMAINING_DAY, language),
    slot: EXAMPLE_RECIPE_SLOT,
    language,
  });
}

export function tasksFromApp(language: LanguageCode): ContractTaskInputs {
  return {
    plate_photo: inputOf(photoIntakeTask(language)),
    plate_text: inputOf(textIntakeTask(language)),
    pantry_photo: inputOf(pantryPhotoTask(language)),
    pantry_text: inputOf(pantryTextTask(language)),
    recipe: inputOf(RECIPE_PROPOSAL_TASK),
  };
}

/** The git blob id of a file's bytes, the same number `git hash-object` prints. Computable without git. */
export function gitBlobSha1(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

function readRepoFile(repoPath: string): Uint8Array {
  return readFileSync(resolve(REPO_ROOT, repoPath));
}

export const REAL_SOURCES: VisionContractSources = {
  tasksFor: tasksFromApp,
  recipeUserTextFor: recipeUserTextFromApp,
  readSource: readRepoFile,
};

// ── building the pieces ───────────────────────────────────────────────────

function jsonOf<TValue>(value: TValue): JsonValue {
  // SAFETY: the argument is built from strings, numbers, booleans, null, arrays and plain objects only; the
  // round trip through JSON.stringify proves it and drops nothing else.
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** The message layout of each input kind, taken from the REAL request builder with marker text in the holes. */
function buildMessageLayouts(): MessageLayouts {
  const stub = {
    ...photoIntakeTask('en'),
    systemPrompt: LAYOUT_MARKERS.system,
    userPrompt: LAYOUT_MARKERS.user,
  };
  const photo = buildOpenAiCompatibleRequestBody({
    model: 'layout-only',
    input: { kind: 'photo', image: { base64: LAYOUT_MARKERS.imageBase64, mimeType: 'image/jpeg' } },
    task: stub,
    useStructuredOutput: true,
  });
  const text = buildOpenAiCompatibleRequestBody({
    model: 'layout-only',
    input: { kind: 'text', text: LAYOUT_MARKERS.inputText },
    task: stub,
    useStructuredOutput: true,
  });
  return { photo: jsonOf(photo.messages), text: jsonOf(text.messages) };
}

function responseFormatOf(task: ContractTaskInput): ResponseFormatFacts {
  const body = buildOpenAiCompatibleRequestBody({
    model: 'layout-only',
    input: { kind: 'text', text: LAYOUT_MARKERS.inputText },
    task: { ...photoIntakeTask('en'), ...task },
    useStructuredOutput: true,
  });
  const format = body.response_format;
  if (!format) throw new Error('The request builder returned no response_format for a structured request');
  return { type: format.type, strict: format.json_schema.strict };
}

/** Throws unless the schema of the five tasks is the same for every language: the file stores it once. */
function assertSameSchemaAcrossLanguages(perLanguage: Record<LanguageCode, ContractTaskInputs>): void {
  const [first, ...rest] = SUPPORTED_LANGUAGES;
  for (const key of CONTRACT_TASK_KEYS) {
    const reference = JSON.stringify(perLanguage[first][key].jsonSchema);
    for (const language of rest) {
      const other = JSON.stringify(perLanguage[language][key].jsonSchema);
      if (other !== reference) throw new Error(`The ${key} schema differs between ${first} and ${language}`);
      if (perLanguage[language][key].schemaName !== perLanguage[first][key].schemaName) {
        throw new Error(`The ${key} schema name differs between ${first} and ${language}`);
      }
    }
  }
}

function replaceOnce(options: { text: string; search: string; replacement: string; what: string }): string {
  const { text, search, replacement, what } = options;
  const first = text.indexOf(search);
  if (first === -1 || text.indexOf(search, first + 1) !== -1) {
    throw new Error(`The recipe user text no longer holds ${what} exactly once; the template cannot be derived`);
  }
  return text.replace(search, () => replacement);
}

/**
 * The recipe user text as a template with marker holes, plus the two pantry line formats. Derived by calling the
 * real builder with marker values and reading the shape of what it wrote. If the builder's layout changes in a
 * way this cannot read, it THROWS: a wrong template would be a quietly wrong eval.
 */
function buildRecipeTemplate(): RecipeUserTextTemplate {
  const written = buildRecipeProposalUserPrompt({
    pantry: [
      { name: RECIPE_MARKERS.name, amount: AMOUNT_SENTINEL, unit: RECIPE_MARKERS.unit },
      { name: RECIPE_MARKERS.name, amount: null, unit: null },
    ],
    remainingDayBlock: RECIPE_MARKERS.remainingDayBlock,
    slot: EXAMPLE_RECIPE_SLOT,
    language: RECIPE_MARKERS.language,
  });
  const lines = written.split('\n');
  const withAmount = lines[1];
  const withoutAmount = lines[2];
  if (withAmount === undefined || withoutAmount === undefined)
    throw new Error('The recipe user text has no pantry lines');
  if (!withAmount.includes(RECIPE_MARKERS.name) || !withAmount.includes(String(AMOUNT_SENTINEL))) {
    throw new Error('The recipe user text pantry line with an amount is not where the template reads it');
  }
  if (!withoutAmount.includes(RECIPE_MARKERS.name) || withoutAmount.includes(RECIPE_MARKERS.unit)) {
    throw new Error('The recipe user text pantry line without an amount is not where the template reads it');
  }
  const framed = [lines[0], RECIPE_MARKERS.pantryLines, ...lines.slice(3)].join('\n');
  const template = replaceOnce({
    text: framed,
    search: `Meal slot to cook for: ${EXAMPLE_RECIPE_SLOT}`,
    replacement: `Meal slot to cook for: ${RECIPE_MARKERS.slot}`,
    what: 'the meal slot line',
  });
  return {
    template,
    pantryLineWithAmount: withAmount.replace(String(AMOUNT_SENTINEL), RECIPE_MARKERS.amount),
    pantryLineWithoutAmount: withoutAmount,
    markers: { ...RECIPE_MARKERS },
  };
}

function exampleInputFor(key: ContractTaskKey): JsonValue {
  if (key === 'plate_text') return { text: EXAMPLE_PLATE_TEXT };
  if (key === 'pantry_text') return { text: EXAMPLE_PANTRY_TEXT };
  if (key === 'recipe') {
    return {
      slot: EXAMPLE_RECIPE_SLOT,
      pantry: jsonOf(EXAMPLE_RECIPE_PANTRY),
      remainingDay: jsonOf(EXAMPLE_REMAINING_DAY),
    };
  }
  return { image: 'a photograph, resized and re-encoded per photoConstraints' };
}

function inputKindFor(key: ContractTaskKey): 'photo' | 'text' {
  return key === 'plate_photo' || key === 'pantry_photo' ? 'photo' : 'text';
}

function buildTasks(sources: VisionContractSources): Record<ContractTaskKey, ContractTask> {
  const perLanguage = Object.fromEntries(SUPPORTED_LANGUAGES.map((language) => [language, sources.tasksFor(language)]));
  // SAFETY: the keys of `perLanguage` are exactly SUPPORTED_LANGUAGES, one entry each, built just above.
  const byLanguage = perLanguage as Record<LanguageCode, ContractTaskInputs>;
  assertSameSchemaAcrossLanguages(byLanguage);

  const built = CONTRACT_TASK_KEYS.map((key): [ContractTaskKey, ContractTask] => {
    const reference = byLanguage.en[key];
    const format = responseFormatOf(reference);
    const languages = Object.fromEntries(
      SUPPORTED_LANGUAGES.map((language): [LanguageCode, ContractLanguageEntry] => {
        const input = byLanguage[language][key];
        const entry: ContractLanguageEntry = { systemPrompt: input.systemPrompt, userPrompt: input.userPrompt };
        if (key === 'recipe') entry.userText = sources.recipeUserTextFor(language);
        return [language, entry];
      }),
    );
    return [
      key,
      {
        inputKind: inputKindFor(key),
        schemaName: reference.schemaName,
        strict: format.strict,
        responseFormatType: format.type,
        jsonSchema: reference.jsonSchema,
        // SAFETY: one entry per SUPPORTED_LANGUAGES member, built by the map just above.
        languages: languages as Record<LanguageCode, ContractLanguageEntry>,
        exampleInput: exampleInputFor(key),
      },
    ];
  });
  // SAFETY: `built` holds one pair per CONTRACT_TASK_KEYS member.
  return Object.fromEntries(built) as Record<ContractTaskKey, ContractTask>;
}

function buildGeneratedFrom(sources: VisionContractSources): VisionContract['generatedFrom'] {
  const files = Object.fromEntries(
    CONTRACT_SOURCE_FILES.map((path): [string, string] => [path, gitBlobSha1(sources.readSource(path))]),
  );
  return { hashAlgorithm: 'git-blob-sha1', files };
}

function buildPhotoConstraints(): VisionContract['photoConstraints'] {
  return {
    maxLongSidePx: MAX_IMAGE_DIMENSION,
    jpegQuality: JPEG_QUALITY,
    maxUploadBytes: MAX_PHOTO_BYTES,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
    outputMimeType: 'image/jpeg',
    scaledDimensionExamples: SCALE_EXAMPLE_SIZES.map(([width, height]) => {
      const scaled = computeScaledDimensions({ width, height, maxDimension: MAX_IMAGE_DIMENSION });
      return { width, height, scaledWidth: scaled.width, scaledHeight: scaled.height };
    }),
  };
}

/**
 * Builds the whole contract from the app's real builders.
 *
 * @param sources - where the prompts and the source bytes come from. The default reads the real app; a test passes
 *   a copy with one string changed to prove the comparison can fail.
 * @returns the contract, ready to serialise.
 */
export function buildVisionContract(sources: VisionContractSources = REAL_SOURCES): VisionContract {
  return {
    contractVersion: CONTRACT_VERSION,
    generatedBy: 'apps/app: pnpm vision:export-contract (scripts/export-vision-contract.ts). Never edit by hand.',
    generatedFrom: buildGeneratedFrom(sources),
    languages: [...SUPPORTED_LANGUAGES],
    languageLabels: { ...LANGUAGE_LABELS },
    photoConstraints: buildPhotoConstraints(),
    requestLayout: {
      markers: { ...LAYOUT_MARKERS },
      messagesByInputKind: buildMessageLayouts(),
      // The managed model is named by the instance at run time, so no id is known here. The managed catalog is
      // empty, which means any id resolves to no entry and no `disableReasoning`.
      appSendsReasoning: requestSendsReasoning({ provider: 'managed', modelId: 'any-managed-model' }),
    },
    recipeUserText: buildRecipeTemplate(),
    tasks: buildTasks(sources),
  };
}

/** The exact text the committed file holds: two-space JSON and one trailing newline. */
export function serializeVisionContract(contract: VisionContract): string {
  return `${JSON.stringify(contract, null, 2)}\n`;
}

/** The committed file, read as text. */
export function readCommittedContract(): string {
  return readFileSync(resolve(REPO_ROOT, CONTRACT_REPO_PATH), 'utf8');
}

const MAX_REPORTED_DIFFERENCES = 8;

/** A plain JSON object, as opposed to an array, a scalar or null. Read from the prototype, which JSON.parse always sets. */
function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return value !== undefined && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Where two JSON texts differ, as short path descriptions, for a failure message that names the changed prompt
 * instead of dumping two 200 KB strings. Empty when the texts are equal.
 */
export function describeContractDifferences(options: { committed: string; regenerated: string }): string[] {
  if (options.committed === options.regenerated) return [];
  const differences: string[] = [];
  const walk = (committed: JsonValue | undefined, regenerated: JsonValue | undefined, path: string): void => {
    if (differences.length >= MAX_REPORTED_DIFFERENCES) return;
    if (JSON.stringify(committed) === JSON.stringify(regenerated)) return;
    if (Array.isArray(committed) && Array.isArray(regenerated)) {
      const length = Math.max(committed.length, regenerated.length);
      for (let index = 0; index < length; index += 1) walk(committed[index], regenerated[index], `${path}.${index}`);
      return;
    }
    if (isJsonObject(committed) && isJsonObject(regenerated)) {
      for (const key of new Set([...Object.keys(committed), ...Object.keys(regenerated)])) {
        walk(committed[key], regenerated[key], `${path}.${key}`);
      }
      return;
    }
    differences.push(path);
  };
  // SAFETY: both strings are serializeVisionContract output or the committed copy of it, which is JSON.
  walk(JSON.parse(options.committed) as JsonValue, JSON.parse(options.regenerated) as JsonValue, '$');
  return differences.length > 0 ? differences : ['$ (same JSON, different text: re-run the export)'];
}
