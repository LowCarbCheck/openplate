/**
 * What an OpenAI-compatible endpoint says it can do, read from its own
 * `GET {baseUrl}/models`.
 *
 * A self-hosted openplate-inference service puts a `capabilities` object on
 * its model entry: which intake tasks it runs, how far its food flags reach,
 * which languages it names foods in, and whether it reads nutrition labels.
 * Every other server sends no such key, and an extra key on a model entry is
 * harmless to a client that does not read it.
 *
 * ── Absent means full, and so does every failure ────────────────────────
 *
 * A server that says nothing about itself is a cloud provider or a service
 * older than the field, and both did everything before this module existed.
 * So a missing `capabilities` object, a missing key inside it, a value this
 * build does not know, a model that is not listed, a non-2xx answer, a body
 * that is not JSON and a probe that times out ALL read as full capabilities.
 * The probe can narrow what the app offers; it can never block a task by
 * failing. The per-food signals (`flags` absent, `flagsCoverage: 'partial'`)
 * stay the safety net for what a food was checked for.
 *
 * Pure apart from `fetchProviderCapabilities`, which owns the one request and
 * the per-session cache. The request itself is the key check's
 * (`probeProviderEndpoint` in `#app/services/vision/verify-key`), so the two
 * agree on where `/models` lives and on what a failure is.
 *
 * No strings for people here: `describeMissing` answers ids, and the screen
 * that reads them owns the words.
 */
import { z } from 'zod';

import { probeProviderEndpoint } from '#app/services/vision/verify-key';
import type { UnvalidatedProviderJson } from '#app/services/vision/schema';

/** The intake tasks a service can say it runs, in the order the service lists them. */
export const PROVIDER_TASKS = ['plateImage', 'describe', 'pantryImage', 'pantryText', 'recipes'] as const;
export type ProviderTask = (typeof PROVIDER_TASKS)[number];

/** How far a service's food flags reach: none at all, what a food contains only, or a full answer. */
export const FLAGS_CAPABILITY_VALUES = ['none', 'partial', 'complete'] as const;
export type FlagsCapability = (typeof FLAGS_CAPABILITY_VALUES)[number];

/** Which languages a service names foods in: none, the one the request asked for, or every app language. */
export const TRANSLATIONS_CAPABILITY_VALUES = ['none', 'request-language', 'all'] as const;
export type TranslationsCapability = (typeof TRANSLATIONS_CAPABILITY_VALUES)[number];

/** How long the probe waits for `/models` before it reads as full capabilities. */
export const CAPABILITY_PROBE_TIMEOUT_MS = 5000;

/** A task the service did not mention, or mentioned with a non-boolean, is assumed to run. */
const lenientTask = z.boolean().catch(true);

const ProviderTasksSchema = z.object({
  plateImage: lenientTask,
  describe: lenientTask,
  pantryImage: lenientTask,
  pantryText: lenientTask,
  recipes: lenientTask,
});

/**
 * The `capabilities` object, LENIENT ALL THE WAY DOWN. Every key falls back
 * to its full value when it is missing or holds something this build does
 * not know, so a newer service's new enum value narrows nothing instead of
 * failing the probe. The `tasks` fallback is a function so no two parses share
 * one object.
 */
const ProviderCapabilitiesSchema = z.object({
  tasks: ProviderTasksSchema.catch(() => ({
    plateImage: true,
    describe: true,
    pantryImage: true,
    pantryText: true,
    recipes: true,
  })),
  flags: z.enum(FLAGS_CAPABILITY_VALUES).catch('complete'),
  translations: z.enum(TRANSLATIONS_CAPABILITY_VALUES).catch('all'),
  labels: z.boolean().catch(true),
});

/** What one endpoint can do, every field filled. */
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

/** Everything on: what a cloud provider, an older service, and every failed probe read as. */
export const FULL_PROVIDER_CAPABILITIES: ProviderCapabilities = Object.freeze({
  tasks: Object.freeze({ plateImage: true, describe: true, pantryImage: true, pantryText: true, recipes: true }),
  flags: 'complete',
  translations: 'all',
  labels: true,
});

/**
 * One entry of the OpenAI `GET /models` list, read only for its id and the
 * capabilities. `z.json()` keeps the capabilities a closed JSON value until
 * `ProviderCapabilitiesSchema` reads it, and lets any other key through.
 */
const ModelEntrySchema = z.object({
  id: z.string(),
  capabilities: z.json().optional(),
});

/**
 * The list envelope, `{ data: [...] }`. An entry that is not a model entry
 * reads as `null` and is skipped, so one odd entry never hides the others.
 */
const ModelsResponseSchema = z.object({
  data: z.array(ModelEntrySchema.nullable().catch(null)),
});

/**
 * The capabilities a `/models` answer states for one model.
 *
 * Pure. Every way the answer can fall short reads as
 * `FULL_PROVIDER_CAPABILITIES`: a body that is not a list, a list without the
 * model, a model entry without `capabilities`. Only a `capabilities` value
 * that is not an object at all is read as "said nothing", because there is
 * nothing in it to keep.
 *
 * @param modelsResponseJson - the parsed body of `GET {baseUrl}/models`.
 * @param modelId - the model the person configured; matched exactly.
 * @returns the capabilities, every field filled.
 */
export function parseProviderCapabilities(
  modelsResponseJson: UnvalidatedProviderJson,
  modelId: string,
): ProviderCapabilities {
  const models = ModelsResponseSchema.safeParse(modelsResponseJson);
  if (!models.success) return FULL_PROVIDER_CAPABILITIES;
  const entry = models.data.data.find((candidate) => candidate?.id === modelId);
  if (entry?.capabilities === undefined || entry.capabilities === null) return FULL_PROVIDER_CAPABILITIES;
  const capabilities = ProviderCapabilitiesSchema.safeParse(entry.capabilities);
  if (!capabilities.success) return FULL_PROVIDER_CAPABILITIES;
  return capabilities.data;
}

/**
 * Whether the endpoint runs one intake task.
 *
 * @param capabilities - what the endpoint said, or the full default.
 * @param task - the task a route is about to offer.
 * @returns `true` unless the endpoint said it does not run the task.
 */
export function taskSupported(capabilities: ProviderCapabilities, task: ProviderTask): boolean {
  return capabilities.tasks[task];
}

/** One thing an endpoint falls short on: a task it does not run, or a reach below full. */
export type MissingCapability = ProviderTask | 'flags' | 'translations' | 'labels';

/**
 * Everything an endpoint falls short on, as ids for a screen to name.
 *
 * Tasks come first, in `PROVIDER_TASKS` order, then `flags` when they are not
 * `complete`, `translations` when they are not `all`, and `labels` when the
 * endpoint does not read them. The LEVEL of a partial answer (`partial`
 * against `none`, `request-language` against `none`) stays on the
 * capabilities object, which the screen reads alongside this list.
 *
 * @param capabilities - what the endpoint said, or the full default.
 * @returns the ids, empty for an endpoint with nothing missing.
 */
export function describeMissing(capabilities: ProviderCapabilities): MissingCapability[] {
  const missing: MissingCapability[] = PROVIDER_TASKS.filter((task) => !capabilities.tasks[task]);
  if (capabilities.flags !== 'complete') missing.push('flags');
  if (capabilities.translations !== 'all') missing.push('translations');
  if (!capabilities.labels) missing.push('labels');
  return missing;
}

////////////////////////////////////////////////////////////////////////////////
// The probe and its per-session cache
////////////////////////////////////////////////////////////////////////////////

/**
 * One answer per endpoint and model for the life of this page. Only an
 * ANSWER is kept: a probe that failed is retried on the next call, so a
 * service that was down when the tab opened is asked again once it is up.
 */
const capabilitiesCache = new Map<string, ProviderCapabilities>();

/** The cache key: the base URL as the request composes it, and the model id. */
function capabilitiesCacheKey({ baseUrl, modelId }: { baseUrl: string; modelId: string }): string {
  return JSON.stringify([baseUrl.trim().replace(/\/$/, ''), modelId]);
}

/** Forgets every probed answer. For the unit tier, and for a settings change that should be asked again. */
export function clearProviderCapabilitiesCache(): void {
  capabilitiesCache.clear();
}

export interface FetchProviderCapabilitiesInput {
  /** The endpoint's base URL, the one the scan call composes `/chat/completions` from. */
  baseUrl: string;
  /** The bearer key; `''` for an endpoint that takes none (see `buildPresetAiSettings`). */
  apiKey: string;
  /** The model the person configured. */
  modelId: string;
  /** The `fetch` to call. Defaults to the global one. */
  fetchImpl?: typeof fetch;
  /** A caller's own abort, on top of the timeout. */
  signal?: AbortSignal;
  /** How long to wait. Defaults to `CAPABILITY_PROBE_TIMEOUT_MS`; the unit tier shortens it. */
  timeoutMs?: number;
}

/**
 * The capabilities answer, or `null` when the endpoint gave none worth
 * keeping: no answer, a non-2xx answer, or a body that is not JSON.
 */
async function probeProviderCapabilities(input: FetchProviderCapabilitiesInput): Promise<ProviderCapabilities | null> {
  const outcome = await probeProviderEndpoint({
    provider: 'openai-compatible',
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? CAPABILITY_PROBE_TIMEOUT_MS,
  });
  if (outcome.kind !== 'answered' || !outcome.response.ok) return null;
  let body: UnvalidatedProviderJson;
  try {
    body = await outcome.response.json();
  } catch {
    return null;
  }
  return parseProviderCapabilities(body, input.modelId);
}

/**
 * What an OpenAI-compatible endpoint says it can do for one model, asked once
 * per session.
 *
 * FAILS OPEN, never throws: any failure, a missing base URL included, answers
 * `FULL_PROVIDER_CAPABILITIES`, because a capability probe that blocks a scan
 * would turn a slow `/models` into a broken app. A failure is not cached.
 *
 * @param input - the endpoint, its key, the model, and the test seams.
 * @returns the capabilities, every field filled.
 */
export async function fetchProviderCapabilities(input: FetchProviderCapabilitiesInput): Promise<ProviderCapabilities> {
  const key = capabilitiesCacheKey({ baseUrl: input.baseUrl, modelId: input.modelId });
  const cached = capabilitiesCache.get(key);
  if (cached !== undefined) return cached;
  const probed = await probeProviderCapabilities(input);
  if (probed === null) return FULL_PROVIDER_CAPABILITIES;
  capabilitiesCache.set(key, probed);
  return probed;
}
