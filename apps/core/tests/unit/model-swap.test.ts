/**
 * THE "ONE FILE" PROOF: changing the production model is one edit, in
 * `ai-tiers.json`, and nothing else in core holds the model.
 *
 * The test clones the shipped file in memory, changes `tiers.standard.model`
 * and NOTHING ELSE, boots the real config on it (`AI_TIERS_FILE` pointing at a
 * temporary copy, through the real loader), and asserts that the body a request
 * is forwarded with and the model `/health` publishes (`instance.ai.model`,
 * which `main.ts` reads as `defaultTierOf(config.aiTiers).model`) are the new
 * id, and that the two forwarded bodies differ in `model` alone.
 *
 * This is only half of the claim. The other half is
 * `model-id-literals.test.ts`: with that guard green, no source file, script or
 * doc of core writes a model id, so there is no second copy that the swap could
 * leave behind. Together they say a swap is one file.
 *
 * Every assertion has a control: the original file forwards the original id, a
 * swap that also touches the price shows up in the diff, and the swap id is a
 * fake (`vendor/swapped-model`) that no real file holds.
 */
import { test, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_MODEL_TIERS, defaultTierOf, policeChatBodyForTier } from '../../src/ai/model-tiers.js';
import { parseConfig, MIN_SERVER_SECRET_LENGTH, type ServiceConfig } from '../../src/config.js';
import { asObject, asString, type JsonObject, type JsonValue } from '../../src/lib/json.js';
import { bareBody, effortBody, photoBody } from './legacy-request-bodies.js';

const SHIPPED_FILE = fileURLToPath(new URL('../../ai-tiers.json', import.meta.url));
const OPENROUTER = 'https://openrouter.ai/api/v1';
const SWAPPED_MODEL = 'vendor/swapped-model';

const directories: string[] = [];
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** The shipped file as a person edits it: read from disk, not imported. */
function readShippedFile(): JsonObject {
  const parsed: JsonValue = JSON.parse(readFileSync(SHIPPED_FILE, 'utf8'));
  const file = asObject(parsed);
  if (file === null) throw new Error('ai-tiers.json is not a JSON object');
  return file;
}

function standardTierOf(file: JsonObject): JsonObject {
  const standard = asObject(asObject(file.tiers)?.standard);
  if (standard === null) throw new Error('ai-tiers.json has no tiers.standard');
  return standard;
}

/** A copy of `file` in which `tiers.standard` holds `patch` on top of what it held, and nothing else differs. */
function withStandardPatch(input: { file: JsonObject; patch: JsonObject }): JsonObject {
  const tiers = asObject(input.file.tiers);
  if (tiers === null) throw new Error('ai-tiers.json has no tiers');
  return {
    ...input.file,
    tiers: { ...tiers, standard: { ...standardTierOf(input.file), ...input.patch } },
  };
}

/** Every leaf of a JSON value as `dotted.path: json`, so two files can be compared key by key. */
function leaves(input: { value: JsonValue | undefined; path: string }): Map<string, string> {
  const object = asObject(input.value);
  if (object === null) return new Map([[input.path, JSON.stringify(input.value)]]);
  const found = new Map<string, string>();
  for (const key of Object.keys(object)) {
    const below = leaves({ value: object[key], path: input.path === '' ? key : `${input.path}.${key}` });
    for (const [path, json] of below) found.set(path, json);
  }
  return found;
}

/** The leaf paths at which two files differ (changed, added or removed). */
function differingPaths(input: { original: JsonObject; edited: JsonObject }): string[] {
  const original = leaves({ value: input.original, path: '' });
  const edited = leaves({ value: input.edited, path: '' });
  const paths = new Set([...original.keys(), ...edited.keys()]);
  return [...paths].filter((path) => original.get(path) !== edited.get(path)).toSorted();
}

function writeTierFile(file: JsonObject): string {
  const directory = mkdtempSync(join(tmpdir(), 'ai-tiers-swap-'));
  directories.push(directory);
  const path = join(directory, 'ai-tiers.json');
  writeFileSync(path, JSON.stringify(file));
  return path;
}

/** The real config, booted on a tier file at `path`. */
function bootOn(path: string): ServiceConfig {
  return parseConfig({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    SERVER_SECRET: 'x'.repeat(MIN_SERVER_SECRET_LENGTH),
    AI_TIERS_FILE: path,
  });
}

/** The body a request is forwarded with, and the name of the tier that decided it. */
interface Forwarded {
  body: JsonObject;
  tier: string;
}

function forwardedOn(input: { config: ServiceConfig; body: JsonObject }): Forwarded {
  const policed = policeChatBodyForTier({
    tiers: input.config.aiTiers,
    body: input.body,
    ceiling: input.config.aiMaxOutputTokens,
    upstreamBaseUrl: OPENROUTER,
  });
  return { body: policed.body, tier: policed.resolved.name };
}

function recipeBody(): JsonObject {
  return {
    model: 'caller-chose-this',
    messages: [{ role: 'user', content: 'what can I cook with eggs' }],
    response_format: { type: 'json_schema', json_schema: { name: 'recipe_proposals', schema: { type: 'object' } } },
  };
}

const REPRESENTATIVE_BODIES: ReadonlyArray<[string, JsonObject]> = [
  ['a plate photo', photoBody],
  ['typed words, no schema', bareBody],
  ['a recipe round', recipeBody()],
  ['a body with an effort', effortBody],
];

test('the swap edits one key of the file: the diff is tiers.standard.model and nothing else', () => {
  const shipped = readShippedFile();
  const swapped = withStandardPatch({ file: shipped, patch: { model: SWAPPED_MODEL } });
  assert.deepEqual(differingPaths({ original: shipped, edited: swapped }), ['tiers.standard.model']);

  // CONTROL: the comparison can see a second key. A swap that also touched the
  // price would not pass for "one key".
  const priceTouched = withStandardPatch({
    file: shipped,
    patch: { model: SWAPPED_MODEL, price: { ...asObject(standardTierOf(shipped).price), inputUsdPerMillion: 99 } },
  });
  assert.deepEqual(differingPaths({ original: shipped, edited: priceTouched }), [
    'tiers.standard.model',
    'tiers.standard.price.inputUsdPerMillion',
  ]);
});

test('the image carries the file on disk, so a swap there is a swap in the image', () => {
  assert.deepEqual(BUNDLED_MODEL_TIERS, readShippedFile());
});

test('with the shipped file, the shipped model is forwarded and published', () => {
  const shippedModel = asString(standardTierOf(readShippedFile()).model);
  assert.ok(shippedModel !== null && shippedModel !== '', 'the shipped file names no model');
  assert.notEqual(shippedModel, SWAPPED_MODEL);

  const config = bootOn(writeTierFile(readShippedFile()));
  assert.equal(defaultTierOf(config.aiTiers).model, shippedModel);
  for (const [name, body] of REPRESENTATIVE_BODIES) {
    const forwarded = forwardedOn({ config, body });
    assert.equal(forwarded.body.model, shippedModel, name);
    assert.equal(forwarded.tier, 'standard', name);
  }
});

test('after the swap, the new id is forwarded and published, and the old id is nowhere', () => {
  const shipped = readShippedFile();
  const shippedModel = asString(standardTierOf(shipped).model);
  const originalConfig = bootOn(writeTierFile(shipped));
  const swappedConfig = bootOn(writeTierFile(withStandardPatch({ file: shipped, patch: { model: SWAPPED_MODEL } })));

  // What /health publishes as instance.ai.model.
  assert.equal(defaultTierOf(swappedConfig.aiTiers).model, SWAPPED_MODEL);
  assert.notEqual(defaultTierOf(originalConfig.aiTiers).model, SWAPPED_MODEL);

  for (const [name, body] of REPRESENTATIVE_BODIES) {
    const original = forwardedOn({ config: originalConfig, body });
    const swapped = forwardedOn({ config: swappedConfig, body });
    assert.equal(swapped.body.model, SWAPPED_MODEL, name);
    assert.equal(original.body.model, shippedModel, name);

    // The swap changed the model and nothing the privacy path depends on: the
    // routing, the cap, the allow list and the tier are the same.
    assert.deepEqual({ ...original.body, model: SWAPPED_MODEL }, swapped.body, name);
    assert.equal(swapped.tier, original.tier, name);
    assert.ok(
      shippedModel !== null && !JSON.stringify(swapped.body).includes(shippedModel),
      `${name}: the old id survived`,
    );
    assert.ok(JSON.stringify(original.body).includes(SWAPPED_MODEL) === false, `${name}: the new id leaked backwards`);
  }
});
