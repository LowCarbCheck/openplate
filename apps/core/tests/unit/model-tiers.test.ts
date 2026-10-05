/**
 * The model tier file and its parser (`src/ai/model-tiers.ts`), as pure
 * functions: no server, no database.
 *
 * Every refusal here is paired with its CONTROL: the same file with the one
 * fault fixed is accepted. Without the pair a rule that refuses everything, or
 * a message regex that matches any error, would pass.
 *
 * Test files use fake model ids such as `vendor/test-model`, so a real model
 * swap never touches this file. The shipped `ai-tiers.json` is the one real
 * input, and its test checks what must stay true across any swap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEmergencyOverrides,
  BUNDLED_MODEL_TIERS,
  legacyModelTiers,
  loadModelTiers,
  parseModelTiers,
  resolveTier,
  type ModelTiers,
} from '../../src/ai/model-tiers.js';
import { parseOpenRouterRouting, PROVIDER_SLUG } from '../../src/ai/openrouter-routing.js';
import type { JsonObject, JsonValue } from '../../src/lib/json.js';

const PRICE: JsonObject = {
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 4,
  checked: '2026-10-05',
  source: 'a test fixture',
};

/** One valid tier. `patch` replaces keys; a key set to `undefined` is absent. */
function tier(patch: JsonObject = {}): JsonObject {
  return {
    use: 'A test tier.',
    model: 'vendor/test-model',
    routing: { zdr: true, only: ['test-provider'] },
    price: PRICE,
    disclose: ['Test Model'],
    ...patch,
  };
}

/** A valid file with one tier, `standard`. `patch` replaces top-level keys. */
function file(patch: JsonObject = {}): JsonObject {
  return { version: 1, defaultTier: 'standard', routes: {}, tiers: { standard: tier() }, ...patch };
}

/** A valid file with a second tier `audio`, reached by the route `speech_transcript`. */
function twoTierFile(patch: { audio?: JsonObject; routes?: JsonObject } = {}): JsonObject {
  return file({
    routes: patch.routes ?? { speech_transcript: 'audio' },
    tiers: { standard: tier(), audio: tier({ model: 'vendor/test-audio', routing: { zdr: false, only: [] } }) },
  });
}

function accepts(json: JsonValue): ModelTiers {
  return parseModelTiers(json);
}

function refuses(json: JsonValue, message: RegExp): void {
  assert.throws(() => parseModelTiers(json), message);
}

function inTier(patch: JsonObject): JsonObject {
  return file({ tiers: { standard: tier(patch) } });
}

// ── the shipped file ─────────────────────────────────────────────────────────

test('the shipped ai-tiers.json parses, and every tier keeps zero data retention, a price and a disclosure', () => {
  // This runs in the push gate: a bad file never reaches a tag.
  const tiers = accepts(BUNDLED_MODEL_TIERS);
  assert.ok(tiers.tiers.has(tiers.defaultTier));
  for (const [name, entry] of tiers.tiers) {
    assert.ok(entry.model !== null && entry.model !== '', `${name} names a model`);
    assert.equal(entry.routing.zeroDataRetention, true, `${name} asks for zero data retention`);
    assert.ok(entry.price !== null, `${name} has a price`);
    assert.ok(entry.disclose.length > 0, `${name} has a disclosure`);
  }
  // THE CONTROL: the assertion above can fail. The same loop on a file with zdr off must trip it.
  const off = accepts(inTier({ routing: { zdr: false, only: [] } }));
  assert.equal(off.tiers.get('standard')?.routing.zeroDataRetention, false);
  assert.throws(() => parseModelTiers({}), /version/);
});

// ── the twelve boot rules ────────────────────────────────────────────────────

test('rule 1: a version other than 1 is refused and names version', () => {
  refuses(file({ version: 2 }), /version/);
  refuses(file({ version: '1' }), /version/);
  refuses(file({ version: undefined }), /version/);
  assert.equal(accepts(file({ version: 1 })).defaultTier, 'standard');
});

test('rule 2: an unknown key is refused at every level and names the key and where it sits', () => {
  refuses(file({ defaultTeir: 'standard' }), /the top level.*unknown key "defaultTeir"/);
  refuses(inTier({ modle: 'x' }), /tiers\.standard.*unknown key "modle"/);
  refuses(
    inTier({ routing: { zdr: true, only: [], fallback: true } }),
    /tiers\.standard\.routing.*unknown key "fallback"/,
  );
  refuses(inTier({ price: { ...PRICE, currency: 'EUR' } }), /tiers\.standard\.price.*unknown key "currency"/);
  // THE CONTROL: the same file without the typo is accepted.
  accepts(file());
});

test('rule 3: tiers must not be empty, and a tier name must match the pattern', () => {
  refuses(file({ tiers: {} }), /tiers.*at least one tier/);
  refuses(file({ defaultTier: 'Standard', tiers: { Standard: tier() } }), /tier name "Standard"/);
  refuses(file({ defaultTier: '1st', tiers: { '1st': tier() } }), /tier name "1st"/);
  const tooLong = 'a'.repeat(25);
  refuses(file({ defaultTier: tooLong, tiers: { [tooLong]: tier() } }), /tier name "a{25}"/);
  // THE CONTROL: a dash and a digit are allowed, and 24 characters is the limit.
  const longest = 'a'.repeat(24);
  accepts(file({ defaultTier: longest, tiers: { [longest]: tier() } }));
  accepts(file({ defaultTier: 'audio-2', tiers: { 'audio-2': tier() } }));
});

test('rule 4: defaultTier must name a tier', () => {
  refuses(file({ defaultTier: 'missing' }), /defaultTier.*"missing"/);
  refuses(file({ defaultTier: undefined }), /defaultTier/);
  accepts(file({ defaultTier: 'standard' }));
});

test('rule 5: a route must point at a tier, and its key must be a schema name', () => {
  refuses(twoTierFile({ routes: { speech_transcript: 'lite' } }), /route "speech_transcript".*"lite"/);
  refuses(twoTierFile({ routes: { 'Speech-Transcript': 'audio' } }), /route key "Speech-Transcript"/);
  refuses(twoTierFile({ routes: { speech_transcript: 7 } }), /route "speech_transcript"/);
  // THE CONTROL: the same route to an existing tier is accepted.
  assert.equal(accepts(twoTierFile()).routes.get('speech_transcript'), 'audio');
});

test('rule 6: a tier that nothing uses is refused, and the same file with the route is accepted', () => {
  accepts(twoTierFile());
  refuses(twoTierFile({ routes: {} }), /tiers\.audio.*used by nothing/);
});

test('rule 7: a model must be a non-empty model id that does not end in latest', () => {
  refuses(inTier({ model: '' }), /tiers\.standard.*model/);
  refuses(inTier({ model: undefined }), /tiers\.standard.*model/);
  refuses(inTier({ model: 'vendor test model' }), /tiers\.standard.*model "vendor test model"/);
  refuses(inTier({ model: 'vendor/test-model:latest' }), /tiers\.standard.*"latest"/);
  refuses(inTier({ model: 'vendor/test-latest' }), /tiers\.standard.*"latest"/);
  refuses(inTier({ model: 'a'.repeat(65) }), /tiers\.standard.*model/);
  // THE CONTROL: an ordinary id with a version, a colon and a dot is accepted.
  assert.equal(
    accepts(inTier({ model: 'vendor/test-model-1.5:beta' })).tiers.get('standard')?.model,
    'vendor/test-model-1.5:beta',
  );
});

test('rule 8: zdr must be a boolean and every only entry a provider slug', () => {
  refuses(inTier({ routing: { zdr: 'yes', only: [] } }), /tiers\.standard\.routing.*zdr/);
  refuses(inTier({ routing: { only: [] } }), /tiers\.standard\.routing.*zdr/);
  refuses(inTier({ routing: { zdr: true, only: ['Google Vertex'] } }), /tiers\.standard\.routing.*"Google Vertex"/);
  refuses(inTier({ routing: { zdr: true, only: [''] } }), /tiers\.standard\.routing.*only entry/);
  refuses(inTier({ routing: { zdr: true, only: [7] } }), /tiers\.standard\.routing.*only entry/);
  refuses(inTier({ routing: { zdr: true, only: 'google-vertex' } }), /tiers\.standard\.routing.*only/);
  refuses(inTier({ routing: { zdr: true } }), /tiers\.standard\.routing.*only/);
  // THE CONTROL: false and an empty list are legal, a slug with a dot and a slash too, and a repeat is dropped.
  const routing = accepts(inTier({ routing: { zdr: false, only: [] } })).tiers.get('standard')?.routing;
  assert.deepEqual(routing, { zeroDataRetention: false, onlyProviders: [] });
  const pinned = accepts(inTier({ routing: { zdr: true, only: ['deepinfra/turbo', 'a.b', 'a.b'] } }));
  assert.deepEqual(pinned.tiers.get('standard')?.routing.onlyProviders, ['deepinfra/turbo', 'a.b']);
});

test('rule 9: maxOutputTokens and audioTokensPerSecond must be positive when present', () => {
  for (const bad of [0, -1, 1.5, '64', null]) {
    refuses(inTier({ maxOutputTokens: bad }), /tiers\.standard.*maxOutputTokens/);
  }
  for (const bad of [0, -5, '25', null]) {
    refuses(inTier({ audioTokensPerSecond: bad }), /tiers\.standard.*audioTokensPerSecond/);
  }
  // THE CONTROL: present and positive is accepted and kept; absent is null.
  const withBoth = accepts(inTier({ maxOutputTokens: 64, audioTokensPerSecond: 0.5 })).tiers.get('standard');
  assert.equal(withBoth?.maxOutputTokens, 64);
  assert.equal(withBoth?.audioTokensPerSecond, 0.5);
  const without = accepts(file()).tiers.get('standard');
  assert.equal(without?.maxOutputTokens, null);
  assert.equal(without?.audioTokensPerSecond, null);
});

test('rule 10: reasoningEffort must be one of the four values when present', () => {
  refuses(inTier({ reasoningEffort: 'extreme' }), /tiers\.standard.*reasoningEffort/);
  refuses(inTier({ reasoningEffort: 3 }), /tiers\.standard.*reasoningEffort/);
  refuses(inTier({ reasoningEffort: null }), /tiers\.standard.*reasoningEffort/);
  // THE CONTROL: all four are accepted, kept as written, and absent is null.
  for (const effort of ['minimal', 'low', 'medium', 'high']) {
    assert.equal(accepts(inTier({ reasoningEffort: effort })).tiers.get('standard')?.reasoningEffort, effort);
  }
  assert.equal(accepts(file()).tiers.get('standard')?.reasoningEffort, null);
});

test('rule 11: a price needs its numbers, none negative, and a real YYYY-MM-DD checked day', () => {
  refuses(inTier({ price: { ...PRICE, inputUsdPerMillion: undefined } }), /tiers\.standard\.price.*inputUsdPerMillion/);
  refuses(inTier({ price: { ...PRICE, outputUsdPerMillion: '4' } }), /tiers\.standard\.price.*outputUsdPerMillion/);
  refuses(inTier({ price: { ...PRICE, inputUsdPerMillion: -0.1 } }), /tiers\.standard\.price.*inputUsdPerMillion/);
  refuses(
    inTier({ price: { ...PRICE, audioInputUsdPerMillion: -1 } }),
    /tiers\.standard\.price.*audioInputUsdPerMillion/,
  );
  refuses(inTier({ price: { ...PRICE, checked: '05-10-2026' } }), /tiers\.standard\.price.*checked/);
  refuses(inTier({ price: { ...PRICE, checked: '2026-13-01' } }), /tiers\.standard\.price.*checked/);
  refuses(inTier({ price: { ...PRICE, checked: '2026-02-30' } }), /tiers\.standard\.price.*checked/);
  refuses(inTier({ price: { ...PRICE, checked: undefined } }), /tiers\.standard\.price.*checked/);
  refuses(inTier({ price: { ...PRICE, source: '' } }), /tiers\.standard\.price.*source/);
  refuses(inTier({ price: undefined }), /tiers\.standard\.price/);
  // THE CONTROL: zero is a price (a free model), the last day of February is a date, audio is optional.
  const price = accepts(
    inTier({ price: { ...PRICE, inputUsdPerMillion: 0, checked: '2028-02-29', audioInputUsdPerMillion: 1.5 } }),
  ).tiers.get('standard')?.price;
  assert.equal(price?.inputUsdPerMillion, 0);
  assert.equal(price?.audioInputUsdPerMillion, 1.5);
  assert.equal(accepts(file()).tiers.get('standard')?.price?.audioInputUsdPerMillion, null);
});

test('rule 12: disclose must be a non-empty list of non-empty words', () => {
  refuses(inTier({ disclose: [] }), /tiers\.standard\.disclose.*at least one/);
  refuses(inTier({ disclose: undefined }), /tiers\.standard\.disclose/);
  refuses(inTier({ disclose: [''] }), /tiers\.standard\.disclose.*empty/);
  refuses(inTier({ disclose: ['Test Model', '   '] }), /tiers\.standard\.disclose.*empty/);
  refuses(inTier({ disclose: 'Test Model' }), /tiers\.standard\.disclose/);
  // THE CONTROL: words are kept as written.
  assert.deepEqual(accepts(inTier({ disclose: ['Test Model', 'Test Cloud'] })).tiers.get('standard')?.disclose, [
    'Test Model',
    'Test Cloud',
  ]);
});

test('a tier must say who uses it, and a tier must be an object', () => {
  refuses(inTier({ use: undefined }), /tiers\.standard.*use/);
  refuses(inTier({ use: '  ' }), /tiers\.standard.*use/);
  refuses(file({ tiers: { standard: 'google/gemini' } }), /tiers\.standard.*object/);
  refuses([], /top level/);
  accepts(file());
});

// ── resolving a request to a tier ────────────────────────────────────────────

function bodyNaming(schemaName: string): JsonObject {
  return { model: 'caller', response_format: { type: 'json_schema', json_schema: { name: schemaName } } };
}

test('resolveTier: a routed schema gets its tier, any other schema the default, and no response_format the default', () => {
  const tiers = accepts(twoTierFile());
  assert.equal(resolveTier({ tiers, body: bodyNaming('speech_transcript') }).name, 'audio');
  assert.equal(resolveTier({ tiers, body: bodyNaming('speech_transcript') }).tier.model, 'vendor/test-audio');
  assert.equal(resolveTier({ tiers, body: bodyNaming('plate_identification') }).name, 'standard');
  assert.equal(resolveTier({ tiers, body: { model: 'caller', messages: [] } }).name, 'standard');
  assert.equal(resolveTier({ tiers, body: { response_format: { type: 'json_object' } } }).name, 'standard');
  assert.equal(resolveTier({ tiers, body: {} }).tier.model, 'vendor/test-model');
});

test('resolveTier: the caller cannot reach a route by anything but the schema name', () => {
  const tiers = accepts(twoTierFile());
  // The header is the client's word and is not an input to the function at all; the model field is ignored.
  assert.equal(resolveTier({ tiers, body: { model: 'audio', feature: 'audio' } }).name, 'standard');
  // THE CONTROL: the same body with the schema name is routed.
  assert.equal(resolveTier({ tiers, body: bodyNaming('speech_transcript') }).name, 'audio');
});

// ── legacy mode ──────────────────────────────────────────────────────────────

test('legacy mode with an empty environment is one standard tier, no model, no routing, no price', () => {
  const tiers = legacyModelTiers({});
  assert.equal(tiers.defaultTier, 'standard');
  assert.equal(tiers.routes.size, 0);
  assert.deepEqual([...tiers.tiers.keys()], ['standard']);
  assert.deepEqual(tiers.tiers.get('standard'), {
    use: 'Legacy mode: the model and the routing come from the environment.',
    model: null,
    routing: { zeroDataRetention: false, onlyProviders: [] },
    maxOutputTokens: null,
    reasoningEffort: null,
    audioTokensPerSecond: null,
    price: null,
    disclose: [],
  });
  // The caller's model passes through: resolving any body gives the null model.
  assert.equal(resolveTier({ tiers, body: { model: 'caller' } }).tier.model, null);
});

test('legacy mode reads AI_ADVERTISED_MODEL, UPSTREAM_ZDR and UPSTREAM_PROVIDER_ONLY exactly as the old config did', () => {
  const env = {
    AI_ADVERTISED_MODEL: ' vendor/test-model ',
    UPSTREAM_ZDR: 'TRUE',
    UPSTREAM_PROVIDER_ONLY: 'google-vertex, google-vertex',
  };
  const standard = legacyModelTiers(env).tiers.get('standard');
  assert.equal(standard?.model, 'vendor/test-model');
  assert.deepEqual(standard?.routing, parseOpenRouterRouting(env));
  assert.deepEqual(standard?.routing, { zeroDataRetention: true, onlyProviders: ['google-vertex'] });
  // A blank model is no model.
  assert.equal(legacyModelTiers({ AI_ADVERTISED_MODEL: '  ' }).tiers.get('standard')?.model, null);
});

test('legacy mode still refuses a malformed routing variable, so a typo stops the boot', () => {
  assert.throws(() => legacyModelTiers({ UPSTREAM_ZDR: 'yes' }), /UPSTREAM_ZDR/);
  assert.throws(() => legacyModelTiers({ UPSTREAM_PROVIDER_ONLY: 'a,,b' }), /UPSTREAM_PROVIDER_ONLY/);
  legacyModelTiers({ UPSTREAM_ZDR: 'false', UPSTREAM_PROVIDER_ONLY: 'a,b' });
});

test('the routing parser keeps its messages and its slug rule', () => {
  assert.throws(() => parseOpenRouterRouting({ UPSTREAM_ZDR: 'yes' }), /Invalid UPSTREAM_ZDR: expected true.*"yes"/);
  assert.throws(
    () => parseOpenRouterRouting({ UPSTREAM_PROVIDER_ONLY: 'Google Vertex' }),
    /Invalid UPSTREAM_PROVIDER_ONLY entry "Google Vertex"/,
  );
  assert.equal(PROVIDER_SLUG.test('google-vertex'), true);
  assert.equal(PROVIDER_SLUG.test('Google'), false);
  assert.deepEqual(parseOpenRouterRouting({}), { zeroDataRetention: false, onlyProviders: [] });
});

// ── the emergency overrides ──────────────────────────────────────────────────

function twoTiers(): ModelTiers {
  return accepts(
    file({
      routes: { speech_transcript: 'audio' },
      tiers: {
        standard: tier({ routing: { zdr: true, only: ['google-vertex'] } }),
        audio: tier({ model: 'vendor/test-audio', routing: { zdr: false, only: [] } }),
      },
    }),
  );
}

test('AI_ADVERTISED_MODEL overrides the default tier only, and warns with both values', () => {
  const tiers = twoTiers();
  const result = applyEmergencyOverrides({ tiers, env: { AI_ADVERTISED_MODEL: 'vendor/emergency' } });
  assert.equal(result.tiers.tiers.get('standard')?.model, 'vendor/emergency');
  assert.equal(result.tiers.tiers.get('audio')?.model, 'vendor/test-audio');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? '', /AI_ADVERTISED_MODEL.*"standard".*vendor\/test-model.*vendor\/emergency/);
  // THE CONTROL: with no override nothing changes and nothing is said.
  const quiet = applyEmergencyOverrides({ tiers, env: {} });
  assert.equal(quiet.tiers.tiers.get('standard')?.model, 'vendor/test-model');
  assert.deepEqual(quiet.warnings, []);
  // The input is not changed.
  assert.equal(tiers.tiers.get('standard')?.model, 'vendor/test-model');
});

test('UPSTREAM_ZDR=true is a floor on every tier', () => {
  const tiers = twoTiers();
  assert.equal(tiers.tiers.get('audio')?.routing.zeroDataRetention, false);
  const result = applyEmergencyOverrides({ tiers, env: { UPSTREAM_ZDR: 'true' } });
  assert.equal(result.tiers.tiers.get('audio')?.routing.zeroDataRetention, true);
  assert.equal(result.tiers.tiers.get('standard')?.routing.zeroDataRetention, true);
  assert.deepEqual(result.warnings, []);
});

test("UPSTREAM_ZDR=false does NOT turn a tier's zdr off", () => {
  const tiers = twoTiers();
  for (const env of [{ UPSTREAM_ZDR: 'false' }, { UPSTREAM_ZDR: '' }, {}]) {
    const result = applyEmergencyOverrides({ tiers, env });
    assert.equal(result.tiers.tiers.get('standard')?.routing.zeroDataRetention, true);
  }
  // THE CONTROL: a tier whose own zdr is false stays false under `false`, so the test can see a change.
  const audio = applyEmergencyOverrides({ tiers, env: { UPSTREAM_ZDR: 'false' } }).tiers.tiers.get('audio');
  assert.equal(audio?.routing.zeroDataRetention, false);
});

test('UPSTREAM_PROVIDER_ONLY replaces only on every tier and warns', () => {
  const tiers = twoTiers();
  const result = applyEmergencyOverrides({ tiers, env: { UPSTREAM_PROVIDER_ONLY: 'amazon-bedrock' } });
  assert.deepEqual(result.tiers.tiers.get('standard')?.routing.onlyProviders, ['amazon-bedrock']);
  assert.deepEqual(result.tiers.tiers.get('audio')?.routing.onlyProviders, ['amazon-bedrock']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? '', /UPSTREAM_PROVIDER_ONLY.*standard, audio.*amazon-bedrock/);
  // THE CONTROL: unset keeps the file's list and says nothing.
  const quiet = applyEmergencyOverrides({ tiers, env: {} });
  assert.deepEqual(quiet.tiers.tiers.get('standard')?.routing.onlyProviders, ['google-vertex']);
  assert.deepEqual(quiet.warnings, []);
});

test('the overrides still refuse a malformed routing variable', () => {
  const tiers = twoTiers();
  assert.throws(() => applyEmergencyOverrides({ tiers, env: { UPSTREAM_ZDR: 'yes' } }), /UPSTREAM_ZDR/);
  assert.throws(
    () => applyEmergencyOverrides({ tiers, env: { UPSTREAM_PROVIDER_ONLY: 'A B' } }),
    /UPSTREAM_PROVIDER_ONLY/,
  );
});

// ── AI_TIERS_FILE ────────────────────────────────────────────────────────────

/** A readFile for a file that is not there. */
function failToRead(): string {
  throw new Error('ENOENT: no such file');
}

/** A readFile that fails the test when it is called. */
function neverRead(path: string): string {
  throw new Error(`readFile must not be called, it was called with ${path}`);
}

test('AI_TIERS_FILE unset or blank is legacy mode, without reading anything, and without warnings', () => {
  for (const env of [{}, { AI_TIERS_FILE: '' }, { AI_TIERS_FILE: '   ' }]) {
    const loaded = loadModelTiers({ env, bundled: BUNDLED_MODEL_TIERS, readFile: neverRead });
    assert.deepEqual(loaded.source, { kind: 'legacy' });
    assert.equal(loaded.tiers.tiers.get('standard')?.model, null);
    assert.deepEqual(loaded.warnings, []);
  }
  // Legacy mode IS the variables, so AI_ADVERTISED_MODEL is the model and not an override.
  const withModel = loadModelTiers({
    env: { AI_ADVERTISED_MODEL: 'vendor/test-model' },
    bundled: BUNDLED_MODEL_TIERS,
    readFile: neverRead,
  });
  assert.equal(withModel.tiers.tiers.get('standard')?.model, 'vendor/test-model');
  assert.deepEqual(withModel.warnings, []);
});

test('AI_TIERS_FILE=bundled parses the file inside the image and applies the overrides', () => {
  const plain = loadModelTiers({ env: { AI_TIERS_FILE: 'bundled' }, bundled: file(), readFile: neverRead });
  assert.deepEqual(plain.source, { kind: 'bundled' });
  assert.equal(plain.tiers.tiers.get('standard')?.model, 'vendor/test-model');
  assert.deepEqual(plain.warnings, []);

  const overridden = loadModelTiers({
    env: { AI_TIERS_FILE: 'bundled', AI_ADVERTISED_MODEL: 'vendor/emergency' },
    bundled: file(),
    readFile: neverRead,
  });
  assert.equal(overridden.tiers.tiers.get('standard')?.model, 'vendor/emergency');
  assert.equal(overridden.warnings.length, 1);
});

test('AI_TIERS_FILE=bundled refuses a bad bundled file with the rule that fails', () => {
  assert.throws(
    () => loadModelTiers({ env: { AI_TIERS_FILE: 'bundled' }, bundled: file({ version: 9 }), readFile: neverRead }),
    /version/,
  );
});

test('AI_TIERS_FILE with an absolute path reads the file once through readFile', () => {
  const reads: string[] = [];
  const loaded = loadModelTiers({
    env: { AI_TIERS_FILE: '/etc/openplate/ai-tiers.json' },
    bundled: {},
    readFile: (path) => {
      reads.push(path);
      return JSON.stringify(twoTierFile());
    },
  });
  assert.deepEqual(reads, ['/etc/openplate/ai-tiers.json']);
  assert.deepEqual(loaded.source, { kind: 'file', path: '/etc/openplate/ai-tiers.json' });
  assert.deepEqual([...loaded.tiers.tiers.keys()], ['standard', 'audio']);
});

test('AI_TIERS_FILE naming a missing or unreadable file is refused and names the path', () => {
  assert.throws(
    () => loadModelTiers({ env: { AI_TIERS_FILE: '/nowhere/ai-tiers.json' }, bundled: {}, readFile: failToRead }),
    /AI_TIERS_FILE \/nowhere\/ai-tiers\.json cannot be read/,
  );
});

test('AI_TIERS_FILE with a relative path, or a path-like word that is not bundled, is refused without reading', () => {
  for (const setting of ['ai-tiers.json', './ai-tiers.json', '../ai-tiers.json', 'Bundled', 'bundle']) {
    assert.throws(
      () => loadModelTiers({ env: { AI_TIERS_FILE: setting }, bundled: BUNDLED_MODEL_TIERS, readFile: neverRead }),
      /Invalid AI_TIERS_FILE .*absolute path/,
      setting,
    );
  }
});

test('AI_TIERS_FILE naming a file that is not JSON is refused, and the message holds the path and none of the text', () => {
  const secret = 'sk-or-v1-your-key-here';
  assert.throws(
    () =>
      loadModelTiers({
        env: { AI_TIERS_FILE: '/etc/ai-tiers.json' },
        bundled: {},
        readFile: () => `{ not json ${secret}`,
      }),
    (error: Error) => /\/etc\/ai-tiers\.json is not valid JSON/.test(error.message) && !error.message.includes(secret),
  );
});

test('AI_TIERS_FILE naming a file with a bad key is refused with the rule that fails', () => {
  assert.throws(
    () =>
      loadModelTiers({
        env: { AI_TIERS_FILE: '/etc/ai-tiers.json' },
        bundled: {},
        readFile: () => JSON.stringify(file({ tiers: { standard: tier({ modle: 'x' }) } })),
      }),
    /tiers\.standard.*unknown key "modle"/,
  );
});
