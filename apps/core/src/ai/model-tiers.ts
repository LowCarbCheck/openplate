/**
 * The model tier file: which model, which routing and which price a managed AI
 * request gets, decided in ONE file (`ai-tiers.json` at the root of this app).
 *
 * WHY A FILE. The production model used to be one env line in the deployment
 * inventory, and the facts that depend on it (the privacy text, the contract
 * row, the price comments) were scattered prose nobody could check. A tier
 * names a level of capability; its `model`, `routing`, `price` and `disclose`
 * words sit together, so a model swap is one reviewed edit and a release.
 *
 * ── WHAT LIVES HERE, AND WHAT DOES NOT ──────────────────────────────────────
 * A property of the MODEL lives in the tier. A policy of the INSTANCE stays
 * env (`AI_MAX_OUTPUT_TOKENS` is the ceiling a tier can only lower).
 *
 * ── THREE WAYS TO RUN, CHOSEN BY `AI_TIERS_FILE` ────────────────────────────
 *  - unset or empty: LEGACY MODE, exactly the behaviour from before this file
 *    existed. One implicit tier `standard` is built from `AI_ADVERTISED_MODEL`,
 *    `UPSTREAM_ZDR` and `UPSTREAM_PROVIDER_ONLY`. With no model the tier has
 *    `model: null` and the caller's model passes through (a self-hosted
 *    instance may let its people pick). There is no price and no disclosure.
 *  - `bundled`: the file inside the image.
 *  - an absolute path: a mounted file, read once. A missing or unreadable file,
 *    or a relative path, is a boot failure.
 *
 * THE FILE IS REFUSED, NEVER REPAIRED. Every rule in {@link parseModelTiers}
 * throws an error that names the key or the tier, so a typo is found on the day
 * it is made and a key that means "off" can never be misspelt into silence. No
 * message carries a file's content beyond the key and the value it rejects.
 *
 * Pure except {@link loadModelTiers}, which reads a mounted file through the
 * function it is given. It logs nothing: the boot warnings come back as strings.
 */
import { isAbsolute } from 'node:path';
import tiersJson from '../../ai-tiers.json' with { type: 'json' };
import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asPositiveInteger,
  asString,
  asTrimmedString,
  type JsonObject,
  type JsonValue,
} from '../lib/json.js';
import { schemaNameOf } from './capability-gate.js';
import { applyChatBodyPolicy, type ChatBodyPolicy, type OpenRouterRouting } from './chat-body-policy.js';
import { parseOpenRouterRouting, PROVIDER_SLUG } from './openrouter-routing.js';
import { SAFE_MODEL_NAME } from './usage-tap.js';

/** The file that ships in the image, as parsed JSON. Run it through {@link parseModelTiers}. */
export const BUNDLED_MODEL_TIERS: JsonValue = tiersJson;

/** The only file version this code reads. A new version is new code, never a silent fallback. */
const SUPPORTED_VERSION = 1;

/** A tier name: lowercase, digits and `-`, at most 24 characters. */
const TIER_NAME = /^[a-z][a-z0-9-]{0,23}$/;

/** A route key is a structured-output schema name: lowercase, digits and `_`, at most 64 characters. */
const ROUTE_KEY = /^[a-z][a-z0-9_]{0,63}$/;

/** The shape of a `checked` date. A real calendar day is checked on top of it. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The values OpenRouter's `reasoning.effort` takes. */
const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const TOP_LEVEL_KEYS = ['version', 'defaultTier', 'routes', 'tiers'];
const TIER_KEYS = [
  'use',
  'model',
  'routing',
  'maxOutputTokens',
  'reasoningEffort',
  'audioTokensPerSecond',
  'price',
  'disclose',
];
const ROUTING_KEYS = ['zdr', 'only'];
const PRICE_KEYS = ['inputUsdPerMillion', 'outputUsdPerMillion', 'audioInputUsdPerMillion', 'checked', 'source'];

/** What a tier costs, as the operator last read it. The cost log uses the price the provider reports, not this. */
export interface TierPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  /** Only on a tier that takes audio. */
  audioInputUsdPerMillion: number | null;
  /** The day the operator read the price, `YYYY-MM-DD`. */
  checked: string;
  /** Where it was read. */
  source: string;
}

/**
 * One tier, as the proxy reads it.
 *
 * `model` and `price` are `null` and `disclose` is empty ONLY in legacy mode.
 * A tier that comes out of {@link parseModelTiers} always has a model, a price
 * and at least one disclosure word.
 */
export interface ModelTier {
  /** One sentence: who uses this tier. JSON has no comments, so this is the comment. */
  use: string;
  /** The OpenRouter model id, or `null` in legacy mode with no `AI_ADVERTISED_MODEL` (the caller's model passes through). */
  model: string | null;
  /** The routing in the form the body policy takes: `zdr` is `zeroDataRetention`, `only` is `onlyProviders`. */
  routing: OpenRouterRouting;
  /** A lower output cap for this tier, or `null` for the instance ceiling alone. */
  maxOutputTokens: number | null;
  /** Written as `reasoning.effort` when set, or `null` to keep today's behaviour. */
  reasoningEffort: ReasoningEffort | null;
  /** Only on an audio tier. */
  audioTokensPerSecond: number | null;
  price: TierPrice | null;
  /** The exact words every privacy page must contain for this tier. */
  disclose: readonly string[];
}

/** The whole file, parsed. */
export interface ModelTiers {
  /** The tier a request gets when its schema is not in {@link routes}. Always a key of {@link tiers}. */
  defaultTier: string;
  /** Structured-output schema name to tier name. Every value is a key of {@link tiers}. */
  routes: ReadonlyMap<string, string>;
  tiers: ReadonlyMap<string, ModelTier>;
}

/** The tier a request resolved to, with its name for the log line. */
export interface ResolvedTier {
  name: string;
  tier: ModelTier;
}

function invalid(where: string, problem: string): Error {
  return new Error(`Invalid AI tiers file, ${where}: ${problem}`);
}

function readObject(input: { value: JsonValue | undefined; where: string }): JsonObject {
  const object = asObject(input.value);
  if (object === null) throw invalid(input.where, 'expected an object');
  return object;
}

/** Rule 2: a key nobody reads is a typo, and a typo must not mean "off". */
function rejectUnknownKeys(input: { object: JsonObject; allowed: readonly string[]; where: string }): void {
  for (const key of Object.keys(input.object)) {
    if (input.allowed.includes(key)) continue;
    throw invalid(input.where, `unknown key "${key}", the keys are ${input.allowed.join(', ')}`);
  }
}

function readText(input: { value: JsonValue | undefined; where: string; key: string }): string {
  const text = asTrimmedString(input.value);
  if (text === null) throw invalid(input.where, `${input.key} must be a non-empty string`);
  return text;
}

/** Rule 7: a model id the usage tap can log, and not an alias that re-points without a review. */
function parseModel(input: { value: JsonValue | undefined; where: string }): string {
  const model = asString(input.value);
  if (model === null || model === '') throw invalid(input.where, 'model must be a non-empty string');
  if (!SAFE_MODEL_NAME.test(model)) {
    throw invalid(input.where, `model "${model}" does not look like a model id (letters, digits and . _ : / @ + -)`);
  }
  if (model.toLowerCase().endsWith('latest')) {
    throw invalid(input.where, `model "${model}" ends in "latest", an alias that re-points silently; name a version`);
  }
  return model;
}

/** Rule 8: `zdr` is a boolean and every `only` entry is a provider slug. */
function parseRouting(input: { value: JsonValue | undefined; where: string }): OpenRouterRouting {
  const where = `${input.where}.routing`;
  const object = readObject({ value: input.value, where });
  rejectUnknownKeys({ object, allowed: ROUTING_KEYS, where });
  const zdr = asBoolean(object.zdr);
  if (zdr === null) throw invalid(where, 'zdr must be true or false');
  const only = asArray(object.only);
  if (only === null) throw invalid(where, 'only must be a list of provider slugs, which may be empty');
  const slugs: string[] = [];
  for (const entry of only) {
    const slug = asString(entry);
    if (slug === null || !PROVIDER_SLUG.test(slug)) {
      throw invalid(
        where,
        `only entry ${JSON.stringify(entry)} is not a lowercase provider slug such as google-vertex`,
      );
    }
    slugs.push(slug);
  }
  return { zeroDataRetention: zdr, onlyProviders: [...new Set(slugs)] };
}

/** Rule 9, for `maxOutputTokens`: absent is `null`, present must be a positive whole number (it becomes `max_tokens`). */
function parseOptionalTokenCap(input: { value: JsonValue | undefined; where: string; key: string }): number | null {
  if (input.value === undefined) return null;
  const count = asPositiveInteger(input.value);
  if (count === null) throw invalid(input.where, `${input.key} must be a positive whole number when present`);
  return count;
}

/** Rule 9, for `audioTokensPerSecond`: absent is `null`, present must be a positive number. */
function parseOptionalPositiveNumber(input: {
  value: JsonValue | undefined;
  where: string;
  key: string;
}): number | null {
  if (input.value === undefined) return null;
  const number = asNumber(input.value);
  if (number === null || number <= 0) throw invalid(input.where, `${input.key} must be a positive number when present`);
  return number;
}

/** Rule 10. */
function parseReasoningEffort(input: { value: JsonValue | undefined; where: string }): ReasoningEffort | null {
  if (input.value === undefined) return null;
  const text = asString(input.value);
  const effort = REASONING_EFFORTS.find((candidate) => candidate === text);
  if (effort === undefined) {
    throw invalid(input.where, `reasoningEffort must be one of ${REASONING_EFFORTS.join(', ')} when present`);
  }
  return effort;
}

function isCalendarDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function readPriceNumber(input: { value: JsonValue | undefined; where: string; key: string }): number {
  const number = asNumber(input.value);
  if (number === null || number < 0) throw invalid(input.where, `${input.key} must be a number of zero or more`);
  return number;
}

/** Rule 11: two numbers, never negative, a real `checked` day, and a source. */
function parsePrice(input: { value: JsonValue | undefined; where: string }): TierPrice {
  const where = `${input.where}.price`;
  const object = readObject({ value: input.value, where });
  rejectUnknownKeys({ object, allowed: PRICE_KEYS, where });
  const checked = asString(object.checked);
  if (checked === null || !isCalendarDate(checked)) {
    throw invalid(where, `checked must be a date written YYYY-MM-DD, got ${JSON.stringify(object.checked)}`);
  }
  return {
    inputUsdPerMillion: readPriceNumber({ value: object.inputUsdPerMillion, where, key: 'inputUsdPerMillion' }),
    outputUsdPerMillion: readPriceNumber({ value: object.outputUsdPerMillion, where, key: 'outputUsdPerMillion' }),
    audioInputUsdPerMillion:
      object.audioInputUsdPerMillion === undefined
        ? null
        : readPriceNumber({ value: object.audioInputUsdPerMillion, where, key: 'audioInputUsdPerMillion' }),
    checked,
    source: readText({ value: object.source, where, key: 'source' }),
  };
}

/** Rule 12: at least one word, none of them empty. */
function parseDisclose(input: { value: JsonValue | undefined; where: string }): string[] {
  const words = asArray(input.value);
  if (words === null || words.length === 0) {
    throw invalid(input.where, 'disclose must list at least one word the privacy pages name');
  }
  return words.map((word) => {
    const text = asTrimmedString(word);
    if (text === null) throw invalid(input.where, 'disclose must not hold an empty word');
    return text;
  });
}

function parseTier(input: { name: string; value: JsonValue | undefined }): ModelTier {
  const where = `tiers.${input.name}`;
  const object = readObject({ value: input.value, where });
  rejectUnknownKeys({ object, allowed: TIER_KEYS, where });
  return {
    use: readText({ value: object.use, where, key: 'use' }),
    model: parseModel({ value: object.model, where }),
    routing: parseRouting({ value: object.routing, where }),
    maxOutputTokens: parseOptionalTokenCap({ value: object.maxOutputTokens, where, key: 'maxOutputTokens' }),
    reasoningEffort: parseReasoningEffort({ value: object.reasoningEffort, where }),
    audioTokensPerSecond: parseOptionalPositiveNumber({
      value: object.audioTokensPerSecond,
      where,
      key: 'audioTokensPerSecond',
    }),
    price: parsePrice({ value: object.price, where }),
    disclose: parseDisclose({ value: object.disclose, where: `${where}.disclose` }),
  };
}

/** Rule 3: at least one tier, every name a tier name. */
function parseTierMap(value: JsonValue | undefined): Map<string, ModelTier> {
  const object = readObject({ value, where: 'tiers' });
  const names = Object.keys(object);
  if (names.length === 0) throw invalid('tiers', 'expected at least one tier');
  const tiers = new Map<string, ModelTier>();
  for (const name of names) {
    if (!TIER_NAME.test(name)) {
      throw invalid('tiers', `tier name "${name}" must be lowercase letters, digits and -, starting with a letter`);
    }
    tiers.set(name, parseTier({ name, value: object[name] }));
  }
  return tiers;
}

/** Rule 5: a route key is a schema name and its value names a tier. */
function parseRouteMap(input: {
  value: JsonValue | undefined;
  tiers: ReadonlyMap<string, ModelTier>;
}): Map<string, string> {
  const object = readObject({ value: input.value, where: 'routes' });
  const routes = new Map<string, string>();
  for (const key of Object.keys(object)) {
    if (!ROUTE_KEY.test(key)) {
      throw invalid('routes', `route key "${key}" must be a schema name: lowercase letters, digits and _`);
    }
    const target = asString(object[key]);
    if (target === null || !input.tiers.has(target)) {
      throw invalid('routes', `route "${key}" points at ${JSON.stringify(object[key])}, which is not a tier`);
    }
    routes.set(key, target);
  }
  return routes;
}

/**
 * Parses the tier file. Throws an `Error` that names the key or the tier for
 * every one of the twelve rules the design lists:
 *
 *  1. `version` is `1`.
 *  2. No key is unknown, at any level.
 *  3. There is a tier, and every tier name is a tier name.
 *  4. `defaultTier` names a tier.
 *  5. A route key is a schema name and its tier exists.
 *  6. Every tier is used: the default, or the target of a route. Dead config rots.
 *  7. `model` is a model id and does not end in `latest`.
 *  8. `routing.zdr` is a boolean and `routing.only` holds provider slugs.
 *  9. `maxOutputTokens` and `audioTokensPerSecond`, when present, are positive.
 * 10. `reasoningEffort`, when present, is one of the four values.
 * 11. `price` has its numbers (none negative) and a real `checked` day.
 * 12. `disclose` is not empty and holds no empty word.
 */
export function parseModelTiers(json: JsonValue): ModelTiers {
  const object = readObject({ value: json, where: 'the top level' });
  if (asNumber(object.version) !== SUPPORTED_VERSION) {
    throw invalid('version', `must be ${SUPPORTED_VERSION}, got ${JSON.stringify(object.version)}`);
  }
  rejectUnknownKeys({ object, allowed: TOP_LEVEL_KEYS, where: 'the top level' });

  const tiers = parseTierMap(object.tiers);
  const defaultTier = asString(object.defaultTier);
  if (defaultTier === null || !tiers.has(defaultTier)) {
    throw invalid('defaultTier', `${JSON.stringify(object.defaultTier)} is not a tier in tiers`);
  }
  const routes = parseRouteMap({ value: object.routes, tiers });

  const used = new Set([defaultTier, ...routes.values()]);
  for (const name of tiers.keys()) {
    if (!used.has(name)) {
      throw invalid(`tiers.${name}`, 'is used by nothing: it is not the defaultTier and no route points at it');
    }
  }
  return { defaultTier, routes, tiers };
}

/**
 * LEGACY MODE: one implicit tier `standard` from the three variables a
 * deployment set before the tier file existed. No price, no disclosure, and
 * `model: null` when `AI_ADVERTISED_MODEL` is unset so the caller's model passes
 * through, exactly as it did. A malformed `UPSTREAM_ZDR` or
 * `UPSTREAM_PROVIDER_ONLY` throws, as it always has.
 */
export function legacyModelTiers(env: NodeJS.ProcessEnv): ModelTiers {
  const standard: ModelTier = {
    use: 'Legacy mode: the model and the routing come from the environment.',
    model: env.AI_ADVERTISED_MODEL?.trim() || null,
    routing: parseOpenRouterRouting(env),
    maxOutputTokens: null,
    reasoningEffort: null,
    audioTokensPerSecond: null,
    price: null,
    disclose: [],
  };
  return { defaultTier: 'standard', routes: new Map(), tiers: new Map([['standard', standard]]) };
}

/** The default tier, or a thrown error: a `ModelTiers` that names a default it does not hold is a bug in its builder. */
export function defaultTierOf(tiers: ModelTiers): ModelTier {
  const tier = tiers.tiers.get(tiers.defaultTier);
  if (tier === undefined) throw new Error(`The default AI tier "${tiers.defaultTier}" is not among the tiers`);
  return tier;
}

/** The tiers after the emergency overrides, and one warning per override that was set. */
export interface EmergencyOverrides {
  tiers: ModelTiers;
  warnings: string[];
}

/**
 * The precedence between a tier file and the three variables that predate it.
 * Apply it to a tier FILE only: legacy mode already is those variables.
 *
 *  - `AI_ADVERTISED_MODEL` replaces the model of the DEFAULT tier alone, and
 *    warns, naming both values. It is the emergency knob: one deployment line,
 *    no release.
 *  - `UPSTREAM_ZDR=true` is a FLOOR. It turns `zdr` on for every tier and can
 *    never turn a tier's own `zdr` off, so `false` and unset change nothing.
 *  - `UPSTREAM_PROVIDER_ONLY` replaces `only` on every tier, and warns. An
 *    emergency reroute.
 *
 * A malformed `UPSTREAM_ZDR` or `UPSTREAM_PROVIDER_ONLY` throws, as it does in
 * legacy mode. Returns new objects; the input is not changed. Logs nothing: the
 * caller prints the warnings.
 */
export function applyEmergencyOverrides(input: { tiers: ModelTiers; env: NodeJS.ProcessEnv }): EmergencyOverrides {
  const model = input.env.AI_ADVERTISED_MODEL?.trim() || null;
  const routing = parseOpenRouterRouting(input.env);
  const hasProviderOverride = routing.onlyProviders.length > 0;

  const tiers = new Map<string, ModelTier>();
  for (const [name, tier] of input.tiers.tiers) {
    tiers.set(name, {
      ...tier,
      model: name === input.tiers.defaultTier && model !== null ? model : tier.model,
      routing: {
        zeroDataRetention: tier.routing.zeroDataRetention || routing.zeroDataRetention,
        onlyProviders: hasProviderOverride ? routing.onlyProviders : tier.routing.onlyProviders,
      },
    });
  }

  const warnings: string[] = [];
  if (model !== null) {
    warnings.push(
      `AI_ADVERTISED_MODEL overrides the model of the default tier "${input.tiers.defaultTier}": ` +
        `the tier file says ${defaultTierOf(input.tiers).model}, the environment says ${model}. ` +
        'This is the emergency override. Remove it once the tier file is right.',
    );
  }
  if (hasProviderOverride) {
    warnings.push(
      `UPSTREAM_PROVIDER_ONLY replaces the provider list of every tier (${[...tiers.keys()].join(', ')}) ` +
        `with ${routing.onlyProviders.join(', ')}. This is the emergency override. Remove it once the tier file is right.`,
    );
  }
  return { tiers: { ...input.tiers, tiers }, warnings };
}

/** Where the tiers came from, for the boot log line. */
export type ModelTiersSource = { kind: 'legacy' } | { kind: 'bundled' } | { kind: 'file'; path: string };

/** The tiers a process runs with, where they came from, and the warnings to print once at boot. */
export interface LoadedModelTiers {
  tiers: ModelTiers;
  source: ModelTiersSource;
  warnings: string[];
}

function readTiersFile(input: { path: string; readFile: (path: string) => string }): JsonValue {
  let text: string;
  try {
    text = input.readFile(input.path);
  } catch (cause) {
    throw new Error(`AI_TIERS_FILE ${input.path} cannot be read: it must exist and be readable by this process`, {
      cause,
    });
  }
  try {
    // SAFETY: `JSON.parse` returns JSON by construction; `parseModelTiers`
    // re-establishes every key and type before anything is used.
    return JSON.parse(text) as JsonValue;
  } catch (cause) {
    throw new Error(`AI_TIERS_FILE ${input.path} is not valid JSON`, { cause });
  }
}

/** {@link parseModelTiers}, with the setting that chose the file named in the message, so a boot log points at the variable. */
function parseNamed(input: { json: JsonValue; setting: string }): ModelTiers {
  try {
    return parseModelTiers(input.json);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'the file did not parse';
    throw new Error(`Invalid AI_TIERS_FILE ${input.setting}: ${reason}`, { cause });
  }
}

/**
 * Chooses the tiers for this process from `AI_TIERS_FILE`.
 *
 * @param input.env - the process environment; also read for the three emergency variables.
 * @param input.bundled - the file inside the image ({@link BUNDLED_MODEL_TIERS}), used for `bundled`.
 * @param input.readFile - reads a mounted file as text. Called at most once, for an absolute path.
 * @returns legacy tiers (no overrides: they already are the variables), or a parsed file with the overrides applied.
 */
export function loadModelTiers(input: {
  env: NodeJS.ProcessEnv;
  bundled: JsonValue;
  readFile: (path: string) => string;
}): LoadedModelTiers {
  const setting = input.env.AI_TIERS_FILE?.trim() ?? '';
  if (setting === '') return { tiers: legacyModelTiers(input.env), source: { kind: 'legacy' }, warnings: [] };

  const isBundled = setting === 'bundled';
  if (!isBundled && !isAbsolute(setting)) {
    throw new Error(`Invalid AI_TIERS_FILE "${setting}": expected bundled, an absolute path, or leave it unset`);
  }
  const json = isBundled ? input.bundled : readTiersFile({ path: setting, readFile: input.readFile });
  const overridden = applyEmergencyOverrides({ tiers: parseNamed({ json, setting }), env: input.env });
  return {
    tiers: overridden.tiers,
    source: isBundled ? { kind: 'bundled' } : { kind: 'file', path: setting },
    warnings: overridden.warnings,
  };
}

/**
 * The tier a request gets: the one its structured-output schema is routed to,
 * else the default.
 *
 * THE SCHEMA NAME IS THE CALLER'S WORD (`schemaNameOf`), so a client can pick a
 * tier by naming a schema. It can only pick a tier the operator defined. Never
 * route on the `X-Openplate-Feature` header: that one is the client's word and
 * guards nothing.
 */
export function resolveTier(input: { tiers: ModelTiers; body: JsonObject }): ResolvedTier {
  const schemaName = schemaNameOf(input.body);
  const routed = schemaName === null ? undefined : input.tiers.routes.get(schemaName);
  const name = routed ?? input.tiers.defaultTier;
  const tier = input.tiers.tiers.get(name);
  if (tier === undefined) throw new Error(`The AI tier "${name}" is not among the tiers`);
  return { name, tier };
}

/**
 * The body policy one tier gives a request: its model, its reasoning effort,
 * and the smaller of its own output cap and the instance ceiling
 * (`AI_MAX_OUTPUT_TOKENS`). A tier can lower the ceiling and never raise it.
 *
 * In legacy mode the one implicit tier has no cap and no effort, so this is
 * `{ model: AI_ADVERTISED_MODEL, maxOutputTokens: AI_MAX_OUTPUT_TOKENS }`,
 * which is what the proxy built before tiers existed.
 */
export function chatBodyPolicyFor(input: { tier: ModelTier; ceiling: number }): ChatBodyPolicy {
  const own = input.tier.maxOutputTokens;
  return {
    model: input.tier.model,
    maxOutputTokens: own === null ? input.ceiling : Math.min(own, input.ceiling),
    reasoningEffort: input.tier.reasoningEffort,
  };
}

/** The body to forward, and the tier that decided it. */
export interface PolicedChatBody {
  resolved: ResolvedTier;
  body: JsonObject;
}

/**
 * The body the provider receives, and the tier that decided it.
 *
 * THIS IS THE WHOLE PRIVACY PATH OF A PROXIED REQUEST IN ONE PURE FUNCTION. The
 * tier is resolved from the CALLER's body, and then ONE tier supplies the model,
 * the output cap, the reasoning effort and the zero retention routing, so no
 * request can carry one tier's model under another tier's routing. The caller's
 * own `model` and `provider` never survive (`applyChatBodyPolicy`).
 *
 * Legacy mode gives exactly the body the proxy built before tiers existed.
 */
export function policeChatBodyForTier(input: {
  tiers: ModelTiers;
  body: JsonObject;
  /** `AI_MAX_OUTPUT_TOKENS`. */
  ceiling: number;
  upstreamBaseUrl: string;
}): PolicedChatBody {
  const resolved = resolveTier({ tiers: input.tiers, body: input.body });
  const body = applyChatBodyPolicy({
    body: input.body,
    policy: chatBodyPolicyFor({ tier: resolved.tier, ceiling: input.ceiling }),
    upstreamBaseUrl: input.upstreamBaseUrl,
    openRouterRouting: resolved.tier.routing,
  });
  return { resolved, body };
}

/**
 * One boot warning for each route that sends a request to a tier dearer than
 * the default while its schema is not in `CAPABILITY_SCHEMA_MAP`.
 *
 * WHY. A client picks a tier by naming a schema (`resolveTier`), so a dear tier
 * behind a schema no capability guards is reachable by any account that names
 * it. The design allows it, and asks for a warning, not a refusal. "Dearer" is
 * the input price. A tier with no price (legacy mode) never warns.
 */
export function findDearUnguardedRoutes(input: {
  tiers: ModelTiers;
  schemaMap: ReadonlyMap<string, string>;
}): string[] {
  const defaultPrice = defaultTierOf(input.tiers).price;
  if (defaultPrice === null) return [];
  const warnings: string[] = [];
  for (const [schemaName, tierName] of input.tiers.routes) {
    const price = input.tiers.tiers.get(tierName)?.price ?? null;
    if (price === null || price.inputUsdPerMillion <= defaultPrice.inputUsdPerMillion) continue;
    if (input.schemaMap.has(schemaName)) continue;
    warnings.push(
      `The AI tier "${tierName}" costs more per input token than the default tier "${input.tiers.defaultTier}" ` +
        `(${price.inputUsdPerMillion} against ${defaultPrice.inputUsdPerMillion} USD per million), ` +
        `and its schema "${schemaName}" is not in CAPABILITY_SCHEMA_MAP: any account can reach it by naming that schema. ` +
        'Add the schema to CAPABILITY_SCHEMA_MAP.',
    );
  }
  return warnings;
}

function describeRouting(routing: OpenRouterRouting): string {
  const zdr = routing.zeroDataRetention ? 'zdr' : 'no zdr';
  const providers = routing.onlyProviders.length > 0 ? `only ${routing.onlyProviders.join(', ')}` : 'any provider';
  return `${zdr}, ${providers}`;
}

/**
 * The one boot log line: where the tiers came from, the default, and each
 * tier's model and routing. Names and slugs only: no key is ever in a tier.
 * `isModelOverridden` is true when `AI_ADVERTISED_MODEL` replaced the default
 * tier's model, which only a tier FILE can have (legacy mode is that variable).
 */
export function describeModelTiers(input: {
  tiers: ModelTiers;
  source: ModelTiersSource;
  isModelOverridden: boolean;
}): string {
  const parts = [`default ${input.tiers.defaultTier}`];
  for (const [name, tier] of input.tiers.tiers) {
    const model = tier.model ?? "the caller's model";
    const note =
      name === input.tiers.defaultTier && input.isModelOverridden ? ' (model overridden by AI_ADVERTISED_MODEL)' : '';
    parts.push(`${name} ${model} (${describeRouting(tier.routing)})${note}`);
  }
  return `AI tiers from ${input.source.kind}: ${parts.join('; ')}`;
}
