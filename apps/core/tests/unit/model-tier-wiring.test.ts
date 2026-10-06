/**
 * How a proxied request resolves to a tier, and what the body it forwards
 * carries (`policeChatBodyForTier`, the pure function the proxy calls). This is
 * the PRIVACY PATH: the model, the output cap, the reasoning effort and the zero
 * retention routing all come from ONE tier.
 *
 * Fake model ids (`vendor/test-model`) everywhere except the two tests that
 * compare the shipped file with what production ran before the tier file (the
 * model in ai-tiers.json, read from the file so a model switch edits one file
 * and no test). Every assertion has a control: the same input
 * with the one switch flipped must give a different answer, so an assertion
 * that cannot fail does not pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_MODEL_TIERS,
  chatBodyPolicyFor,
  describeModelTiers,
  findDearUnguardedRoutes,
  legacyModelTiers,
  loadModelTiers,
  parseModelTiers,
  policeChatBodyForTier,
  type ModelTier,
  type ModelTiers,
} from '../../src/ai/model-tiers.js';
import { asObject, asString, type JsonObject, type JsonValue } from '../../src/lib/json.js';
import { bareBody, effortBody, photoBody, readLegacyCases, type LegacyCase } from './legacy-request-bodies.js';

const OPENROUTER = 'https://openrouter.ai/api/v1';
const LOCAL = 'http://127.0.0.1:9/v1';
const CEILING = 8192;

// ── Request bodies. The legacy fixture was recorded from exactly these. ──────
// (`legacy-request-bodies.ts`)

const BODIES = new Map<string, JsonObject>([
  ['photoBody', photoBody],
  ['bareBody', bareBody],
  ['effortBody', effortBody],
]);

/** A body that asks for the named structured-output schema. */
function bodyAskingFor(schemaName: string, extra: JsonObject = {}): JsonObject {
  return {
    model: 'attacker/expensive-model',
    messages: [{ role: 'user', content: 'hi' }],
    response_format: { type: 'json_schema', json_schema: { name: schemaName, schema: { type: 'object' } } },
    ...extra,
  };
}

// ── Tier files ───────────────────────────────────────────────────────────────

const PRICE: JsonObject = { inputUsdPerMillion: 1, outputUsdPerMillion: 4, checked: '2026-10-05', source: 'a fixture' };

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

/** `standard` (zdr, one provider) and `audio` (NO zdr, no provider), the second reached by `speech_transcript`. */
function twoTiers(audio: JsonObject = {}): ModelTiers {
  return parseModelTiers({
    version: 1,
    defaultTier: 'standard',
    routes: { speech_transcript: 'audio' },
    tiers: {
      standard: tier(),
      audio: tier({ model: 'vendor/test-audio', routing: { zdr: false, only: [] }, ...audio }),
    },
  });
}

/** The tiers `AI_TIERS_FILE` + `env` give, from a file in memory. */
function fileTiers(input: { file: JsonValue; env?: NodeJS.ProcessEnv }): ModelTiers {
  return loadModelTiers({
    env: { AI_TIERS_FILE: 'bundled', ...input.env },
    bundled: input.file,
    readFile: () => {
      throw new Error('bundled must not read a file');
    },
  }).tiers;
}

const TWO_TIER_FILE: JsonObject = {
  version: 1,
  defaultTier: 'standard',
  routes: { speech_transcript: 'audio' },
  tiers: {
    standard: tier(),
    audio: tier({ model: 'vendor/test-audio', routing: { zdr: false, only: [] } }),
  },
};

function forwarded(input: { tiers: ModelTiers; body: JsonObject; url?: string; ceiling?: number }): JsonObject {
  return policeChatBodyForTier({
    tiers: input.tiers,
    body: input.body,
    ceiling: input.ceiling ?? CEILING,
    upstreamBaseUrl: input.url ?? OPENROUTER,
  }).body;
}

function providerOf(body: JsonObject): JsonObject {
  const provider = asObject(body.provider);
  if (provider === null) throw new Error('the forwarded body has no provider block');
  return provider;
}

// ── (a) Legacy mode is byte for byte what the code built before ──────────────

const LEGACY_ENV = {
  'no model, no routing': {},
  'model only': { AI_ADVERTISED_MODEL: 'vendor/test-model' },
  'model, zdr and only': {
    AI_ADVERTISED_MODEL: 'vendor/test-model',
    UPSTREAM_ZDR: 'true',
    UPSTREAM_PROVIDER_ONLY: 'test-provider',
  },
} satisfies Record<LegacyCase['policyName'], NodeJS.ProcessEnv>;

test('legacy mode forwards byte for byte the body the code built before the tier file', () => {
  const cases = readLegacyCases();
  // A fixture that lost its cases would pass by checking nothing.
  assert.equal(cases.length, 24);
  for (const entry of cases) {
    const body = BODIES.get(entry.bodyName);
    assert.ok(body, `unknown body ${entry.bodyName}`);
    const result = policeChatBodyForTier({
      tiers: legacyModelTiers(LEGACY_ENV[entry.policyName]),
      body,
      ceiling: entry.ceiling,
      upstreamBaseUrl: entry.urlName === 'openrouter' ? OPENROUTER : LOCAL,
    });
    const label = `${entry.bodyName} ${entry.urlName} ${entry.policyName} ceiling ${entry.ceiling}`;
    assert.equal(JSON.stringify(result.body), entry.expected, label);
    assert.equal(result.resolved.name, 'standard', label);
  }
});

test('CONTROL: the legacy comparison fails when the model, the routing or the ceiling differs', () => {
  const cases = readLegacyCases();
  const pick = (policyName: LegacyCase['policyName'], bodyName = 'photoBody'): LegacyCase => {
    const found = cases.find(
      (entry) =>
        entry.bodyName === bodyName &&
        entry.urlName === 'openrouter' &&
        entry.policyName === policyName &&
        entry.ceiling === 8192,
    );
    if (found === undefined) throw new Error(`no fixture for ${policyName}`);
    return found;
  };
  const run = (env: NodeJS.ProcessEnv, ceiling = 8192): string =>
    JSON.stringify(forwarded({ tiers: legacyModelTiers(env), body: photoBody, ceiling }));

  assert.equal(run(LEGACY_ENV['model, zdr and only']), pick('model, zdr and only').expected);
  assert.notEqual(
    run({ ...LEGACY_ENV['model, zdr and only'], AI_ADVERTISED_MODEL: 'vendor/other' }),
    pick('model, zdr and only').expected,
  );
  assert.notEqual(
    run({ ...LEGACY_ENV['model, zdr and only'], UPSTREAM_ZDR: 'false' }),
    pick('model, zdr and only').expected,
  );
  assert.notEqual(run(LEGACY_ENV['model, zdr and only'], 4096), pick('model, zdr and only').expected);
  assert.notEqual(run(LEGACY_ENV['model only']), pick('model, zdr and only').expected);
});

test('legacy mode with no model keeps the caller model, and a tier file never does (control)', () => {
  assert.equal(forwarded({ tiers: legacyModelTiers({}), body: photoBody }).model, 'caller-chose-this');
  assert.equal(forwarded({ tiers: fileTiers({ file: TWO_TIER_FILE }), body: photoBody }).model, 'vendor/test-model');
});

// ── (b) The shipped file equals what Bay production runs today ───────────────

/**
 * The model id of the standard tier in the shipped `ai-tiers.json`, read with
 * `JSON.parse` straight from the file, not through the loader under test.
 */
function readShippedStandardModel(): string {
  const path = fileURLToPath(new URL('../../ai-tiers.json', import.meta.url));
  // SAFETY: the tier file is a JSON file this repository ships.
  const file = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
  const model = asString(asObject(asObject(asObject(file)?.tiers)?.standard)?.model);
  if (model === null) throw new Error('ai-tiers.json has no standard tier model');
  return model;
}

const SHIPPED_MODEL = readShippedStandardModel();

const BAY_PRODUCTION_ENV: NodeJS.ProcessEnv = {
  AI_ADVERTISED_MODEL: SHIPPED_MODEL,
  UPSTREAM_ZDR: 'true',
  UPSTREAM_PROVIDER_ONLY: 'google-vertex',
};

test('the shipped file gives the model and the provider block Bay production gives today', () => {
  const bundled = fileTiers({ file: BUNDLED_MODEL_TIERS });
  const production = legacyModelTiers(BAY_PRODUCTION_ENV);
  for (const body of BODIES.values()) {
    const fromFile = forwarded({ tiers: bundled, body });
    assert.equal(fromFile.model, SHIPPED_MODEL);
    assert.deepEqual(fromFile.provider, {
      zdr: true,
      data_collection: 'deny',
      only: ['google-vertex'],
      allow_fallbacks: false,
    });
    // The WHOLE body, byte for byte, not only the two fields named above. The
    // one field left out is `reasoning`: the shipped file sets a reasoning
    // effort (ADR 0025) that the legacy env has no way to say, and the test
    // for that field is further down.
    assert.equal(
      JSON.stringify(withoutReasoning(fromFile)),
      JSON.stringify(withoutReasoning(forwarded({ tiers: production, body }))),
    );
  }
});

/** The body without its `reasoning` field, the one field the shipped tier file sets and the legacy env cannot. */
function withoutReasoning(body: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(body).filter(([field]) => field !== 'reasoning'));
}

test('CONTROL: the model read from the file is a real id, and the equality fails for another id', () => {
  assert.match(SHIPPED_MODEL, /^[a-z0-9-]+\/[\w.:-]+$/);
  const bundled = fileTiers({ file: BUNDLED_MODEL_TIERS });
  const model = forwarded({ tiers: bundled, body: photoBody }).model;
  assert.equal(model, SHIPPED_MODEL);
  assert.notEqual(model, `${SHIPPED_MODEL}-other`);
  assert.notEqual(model, 'vendor/test-model');
  assert.notEqual(
    describeModelTiers({ tiers: bundled, source: { kind: 'bundled' }, isModelOverridden: false }),
    'AI tiers from bundled: default standard; standard vendor/other (zdr, only google-vertex)',
  );
});

test('CONTROL: a different production env gives a different body than the shipped file', () => {
  const bundled = JSON.stringify(forwarded({ tiers: fileTiers({ file: BUNDLED_MODEL_TIERS }), body: photoBody }));
  for (const env of [
    { ...BAY_PRODUCTION_ENV, AI_ADVERTISED_MODEL: 'vendor/other' },
    { ...BAY_PRODUCTION_ENV, UPSTREAM_PROVIDER_ONLY: 'amazon-bedrock' },
    { ...BAY_PRODUCTION_ENV, UPSTREAM_ZDR: 'false' },
  ]) {
    assert.notEqual(JSON.stringify(forwarded({ tiers: legacyModelTiers(env), body: photoBody })), bundled);
  }
});

// ── (c) THE ZDR FLOOR ────────────────────────────────────────────────────────

test('UPSTREAM_ZDR=true forces zdr on every tier', () => {
  const tiers = fileTiers({ file: TWO_TIER_FILE, env: { UPSTREAM_ZDR: 'true' } });
  for (const schema of ['plate_identification', 'speech_transcript']) {
    assert.equal(providerOf(forwarded({ tiers, body: bodyAskingFor(schema) })).zdr, true, schema);
  }
});

test('CONTROL: without UPSTREAM_ZDR a tier whose zdr is false forwards no zdr', () => {
  const tiers = fileTiers({ file: TWO_TIER_FILE });
  const audio = providerOf(forwarded({ tiers, body: bodyAskingFor('speech_transcript') }));
  assert.equal('zdr' in audio, false);
  assert.deepEqual(audio, { data_collection: 'deny' });
});

test('UPSTREAM_ZDR=false, empty or unset never turns a tier zdr off', () => {
  for (const zdr of ['false', 'FALSE', '', '   ', undefined]) {
    const tiers = fileTiers({ file: TWO_TIER_FILE, env: { UPSTREAM_ZDR: zdr } });
    const standard = providerOf(forwarded({ tiers, body: bodyAskingFor('plate_identification') }));
    assert.equal(standard.zdr, true, `UPSTREAM_ZDR=${String(zdr)}`);
    assert.deepEqual(standard.only, ['test-provider'], `UPSTREAM_ZDR=${String(zdr)}`);
    const unrouted = providerOf(forwarded({ tiers, body: bareBody }));
    assert.equal(unrouted.zdr, true, `UPSTREAM_ZDR=${String(zdr)}, no schema`);
  }
});

test('a tier with zdr true forwards zdr true under every spelling of the env, and for the shipped file', () => {
  const sources: ModelTiers[] = [];
  for (const zdr of ['true', 'false', '', undefined]) {
    sources.push(fileTiers({ file: TWO_TIER_FILE, env: { UPSTREAM_ZDR: zdr } }));
    sources.push(fileTiers({ file: BUNDLED_MODEL_TIERS, env: { UPSTREAM_ZDR: zdr } }));
  }
  assert.equal(sources.length, 8);
  for (const tiers of sources) {
    for (const body of [bareBody, photoBody, bodyAskingFor('plate_identification')]) {
      assert.equal(providerOf(forwarded({ tiers, body })).zdr, true);
    }
  }
});

test('the floor holds for a malformed UPSTREAM_ZDR too: the boot stops instead of reading it as off', () => {
  for (const bad of ['yes', '1', 'tru']) {
    assert.throws(() => fileTiers({ file: TWO_TIER_FILE, env: { UPSTREAM_ZDR: bad } }), /Invalid UPSTREAM_ZDR/);
  }
});

test('UPSTREAM_PROVIDER_ONLY replaces the provider list of every tier and keeps no fallback', () => {
  const tiers = fileTiers({ file: TWO_TIER_FILE, env: { UPSTREAM_PROVIDER_ONLY: 'emergency-provider' } });
  for (const schema of ['plate_identification', 'speech_transcript']) {
    const provider = providerOf(forwarded({ tiers, body: bodyAskingFor(schema) }));
    assert.deepEqual(provider.only, ['emergency-provider'], schema);
    assert.equal(provider.allow_fallbacks, false, schema);
  }
});

test('another upstream gets no provider block at all, whatever the tier says', () => {
  const tiers = fileTiers({ file: TWO_TIER_FILE, env: { UPSTREAM_ZDR: 'true' } });
  assert.equal('provider' in forwarded({ tiers, body: photoBody, url: LOCAL }), false);
  assert.equal('provider' in forwarded({ tiers, body: photoBody, url: OPENROUTER }), true);
});

// ── (d) Routing by schema ────────────────────────────────────────────────────

test('a routed schema gets the routed tier model and routing, any other request gets the default tier', () => {
  const tiers = fileTiers({ file: TWO_TIER_FILE });

  const routed = policeChatBodyForTier({
    tiers,
    body: bodyAskingFor('speech_transcript'),
    ceiling: CEILING,
    upstreamBaseUrl: OPENROUTER,
  });
  assert.equal(routed.resolved.name, 'audio');
  assert.equal(routed.body.model, 'vendor/test-audio');
  assert.deepEqual(routed.body.provider, { data_collection: 'deny' });

  const named = policeChatBodyForTier({
    tiers,
    body: bodyAskingFor('plate_identification'),
    ceiling: CEILING,
    upstreamBaseUrl: OPENROUTER,
  });
  assert.equal(named.resolved.name, 'standard');
  assert.equal(named.body.model, 'vendor/test-model');
  assert.deepEqual(named.body.provider, {
    zdr: true,
    data_collection: 'deny',
    only: ['test-provider'],
    allow_fallbacks: false,
  });

  for (const body of [bareBody, photoBody, { response_format: 'text' }]) {
    const unrouted = policeChatBodyForTier({ tiers, body, ceiling: CEILING, upstreamBaseUrl: OPENROUTER });
    assert.equal(unrouted.resolved.name, 'standard');
    assert.equal(unrouted.body.model, 'vendor/test-model');
  }
});

test('a tier-looking field in the body picks no tier, and is not forwarded', () => {
  const tiers = fileTiers({ file: TWO_TIER_FILE });
  const body = bodyAskingFor('plate_identification', { tier: 'audio', feature: 'speech_transcript' });
  const result = policeChatBodyForTier({ tiers, body, ceiling: CEILING, upstreamBaseUrl: OPENROUTER });
  assert.equal(result.resolved.name, 'standard');
  assert.equal('tier' in result.body, false);
});

// ── (e) The client cannot pick a model or a provider ─────────────────────────

test('a model or a provider named by the client is overwritten, on every tier', () => {
  const tiers = fileTiers({ file: TWO_TIER_FILE });
  const hostile = { provider: { zdr: false, order: ['somebody'], allow_fallbacks: true, only: ['elsewhere'] } };
  for (const [schema, model] of [
    ['plate_identification', 'vendor/test-model'],
    ['speech_transcript', 'vendor/test-audio'],
  ] as const) {
    const body = forwarded({ tiers, body: bodyAskingFor(schema, hostile) });
    assert.equal(body.model, model, schema);
    const provider = providerOf(body);
    assert.notDeepEqual(provider.order, ['somebody'], schema);
    assert.equal('order' in provider, false, schema);
    assert.notEqual(provider.zdr, false, schema);
  }
});

function standardOf(tiers: ModelTiers): ModelTier {
  const found = tiers.tiers.get('standard');
  if (found === undefined) throw new Error('no standard tier');
  return found;
}

// ── (f) Reasoning effort, and the output cap ─────────────────────────────────

test('a tier reasoningEffort is written as reasoning.effort and drops the caller max_tokens', () => {
  const withEffort = fileTiers({
    file: {
      ...TWO_TIER_FILE,
      tiers: { standard: tier({ reasoningEffort: 'minimal' }), audio: tier({ routing: { zdr: false, only: [] } }) },
    },
  });
  const body = forwarded({ tiers: withEffort, body: photoBody });
  // The caller's `effort` is replaced, `exclude` is kept, `max_tokens` is gone.
  assert.deepEqual(body.reasoning, { effort: 'minimal', exclude: true });

  const noReasoning = forwarded({ tiers: withEffort, body: bareBody });
  assert.deepEqual(noReasoning.reasoning, { effort: 'minimal' });
});

test('CONTROL: with no reasoningEffort the caller reasoning is only capped, as before', () => {
  const plain = fileTiers({ file: TWO_TIER_FILE });
  assert.deepEqual(forwarded({ tiers: plain, body: photoBody }).reasoning, {
    max_tokens: CEILING,
    effort: 'high',
    exclude: true,
  });
  assert.equal('reasoning' in forwarded({ tiers: plain, body: bareBody }), false);
  assert.deepEqual(forwarded({ tiers: plain, body: effortBody }).reasoning, { effort: 'low' });
});

/**
 * The `reasoningEffort` of the standard tier in the shipped `ai-tiers.json`,
 * read with `JSON.parse` straight from the file, not through the loader under
 * test. `null` when the file does not set one.
 */
function readShippedStandardReasoningEffort(): string | null {
  const path = fileURLToPath(new URL('../../ai-tiers.json', import.meta.url));
  // SAFETY: the tier file is a JSON file this repository ships.
  const file = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
  return asString(asObject(asObject(asObject(file)?.tiers)?.standard)?.reasoningEffort);
}

test('the shipped tier file sets a reasoning effort, and the default tier forwards exactly that effort', () => {
  const shippedEffort = readShippedStandardReasoningEffort();
  // A removed line fails here, not in the assertions below, which would then compare null with null.
  assert.notEqual(shippedEffort, null, 'ai-tiers.json standard tier sets no reasoningEffort');

  const bundled = fileTiers({ file: BUNDLED_MODEL_TIERS });
  assert.equal(standardOf(bundled).reasoningEffort, shippedEffort);

  // photoBody asks for reasoning.max_tokens 99999, effort high and exclude true.
  const fromPhoto = forwarded({ tiers: bundled, body: photoBody });
  assert.deepEqual(fromPhoto.reasoning, { effort: shippedEffort, exclude: true });
  assert.equal('max_tokens' in (asObject(fromPhoto.reasoning) ?? {}), false);

  // A body with no reasoning gets the effort written in.
  assert.deepEqual(forwarded({ tiers: bundled, body: bareBody }).reasoning, { effort: shippedEffort });

  // The same two bodies for a request that names a schema, so the default tier answers by resolution too.
  const asked = forwarded({
    tiers: bundled,
    body: bodyAskingFor('plate_identification', { reasoning: { max_tokens: 500, effort: 'high' } }),
  });
  assert.deepEqual(asked.reasoning, { effort: shippedEffort });
});

test('CONTROL: the same bodies through a tier with no reasoningEffort keep the caller reasoning and get no effort', () => {
  const shippedEffort = readShippedStandardReasoningEffort();
  assert.notEqual(shippedEffort, null, 'ai-tiers.json standard tier sets no reasoningEffort');

  // The shipped file with only the effort taken out.
  const shipped = asObject(BUNDLED_MODEL_TIERS);
  const shippedStandard = asObject(asObject(shipped?.tiers)?.standard);
  if (shipped === null || shippedStandard === null) throw new Error('ai-tiers.json has no standard tier');
  const { reasoningEffort: _removed, ...standardWithoutEffort } = shippedStandard;
  const withoutEffort = fileTiers({
    file: { ...shipped, tiers: { ...asObject(shipped.tiers), standard: standardWithoutEffort } },
  });
  assert.equal(standardOf(withoutEffort).reasoningEffort, null);

  // The caller's reasoning is capped (99999 becomes the ceiling) and otherwise kept, field for field.
  const fromPhoto = forwarded({ tiers: withoutEffort, body: photoBody });
  assert.equal(
    JSON.stringify(fromPhoto.reasoning),
    JSON.stringify({ max_tokens: CEILING, effort: 'high', exclude: true }),
  );
  assert.equal('reasoning' in forwarded({ tiers: withoutEffort, body: bareBody }), false);
  assert.equal(
    JSON.stringify(forwarded({ tiers: withoutEffort, body: effortBody }).reasoning),
    JSON.stringify(effortBody.reasoning),
  );

  // And the shipped file does differ from it, so the two arms are not the same arm.
  const withEffort = forwarded({ tiers: fileTiers({ file: BUNDLED_MODEL_TIERS }), body: photoBody });
  assert.notEqual(JSON.stringify(withEffort.reasoning), JSON.stringify(fromPhoto.reasoning));
});

test('a tier output cap lowers the ceiling and can never raise it', () => {
  const capped = (maxOutputTokens: number): ModelTiers =>
    fileTiers({
      file: {
        ...TWO_TIER_FILE,
        tiers: { standard: tier({ maxOutputTokens }), audio: tier({ routing: { zdr: false, only: [] } }) },
      },
    });
  assert.equal(forwarded({ tiers: capped(64), body: bareBody }).max_tokens, 64);
  assert.equal(forwarded({ tiers: capped(64), body: effortBody }).max_tokens, 64);
  assert.equal(forwarded({ tiers: capped(100_000), body: bareBody }).max_tokens, CEILING);
  // CONTROL: no tier cap is the ceiling alone.
  assert.equal(forwarded({ tiers: fileTiers({ file: TWO_TIER_FILE }), body: bareBody }).max_tokens, CEILING);

  assert.equal(chatBodyPolicyFor({ tier: standardOf(capped(64)), ceiling: 1000 }).maxOutputTokens, 64);
  assert.equal(chatBodyPolicyFor({ tier: standardOf(capped(5000)), ceiling: 1000 }).maxOutputTokens, 1000);
});

// ── (h) The boot warning for a dear tier that no capability guards ───────────

const DEAR = twoTiers({ price: { ...PRICE, inputUsdPerMillion: 2 } });

test('a routed tier dearer than the default, with its schema unguarded, warns once and names both', () => {
  const warnings = findDearUnguardedRoutes({ tiers: DEAR, schemaMap: new Map() });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /tier "audio".*default tier "standard".*"speech_transcript".*CAPABILITY_SCHEMA_MAP/);
});

test('CONTROL: no warning when the schema is guarded, when the tier is not dearer, or without prices', () => {
  assert.deepEqual(findDearUnguardedRoutes({ tiers: DEAR, schemaMap: new Map([['speech_transcript', 'voice']]) }), []);
  // Same price, and cheaper: not dearer.
  assert.deepEqual(findDearUnguardedRoutes({ tiers: twoTiers(), schemaMap: new Map() }), []);
  assert.deepEqual(
    findDearUnguardedRoutes({
      tiers: twoTiers({ price: { ...PRICE, inputUsdPerMillion: 0.5 } }),
      schemaMap: new Map(),
    }),
    [],
  );
  // Legacy mode has no prices and no routes.
  assert.deepEqual(findDearUnguardedRoutes({ tiers: legacyModelTiers({}), schemaMap: new Map() }), []);
  // The shipped file has one tier and no route.
  assert.deepEqual(findDearUnguardedRoutes({ tiers: parseModelTiers(BUNDLED_MODEL_TIERS), schemaMap: new Map() }), []);
});

// ── The boot log line ────────────────────────────────────────────────────────

test('the boot line names the source, the default and each tier model and routing', () => {
  const bundled = loadModelTiers({
    env: { AI_TIERS_FILE: 'bundled' },
    bundled: BUNDLED_MODEL_TIERS,
    readFile: () => '',
  });
  assert.equal(
    describeModelTiers({ tiers: bundled.tiers, source: bundled.source, isModelOverridden: false }),
    `AI tiers from bundled: default standard; standard ${SHIPPED_MODEL} (zdr, only google-vertex)`,
  );
  assert.equal(
    describeModelTiers({ tiers: bundled.tiers, source: bundled.source, isModelOverridden: true }),
    `AI tiers from bundled: default standard; standard ${SHIPPED_MODEL} (zdr, only google-vertex) (model overridden by AI_ADVERTISED_MODEL)`,
  );
  assert.equal(
    describeModelTiers({ tiers: legacyModelTiers({}), source: { kind: 'legacy' }, isModelOverridden: false }),
    "AI tiers from legacy: default standard; standard the caller's model (no zdr, any provider)",
  );
  const two = twoTiers();
  assert.equal(
    describeModelTiers({ tiers: two, source: { kind: 'file', path: '/etc/ai-tiers.json' }, isModelOverridden: false }),
    'AI tiers from file: default standard; standard vendor/test-model (zdr, only test-provider); audio vendor/test-audio (no zdr, any provider)',
  );
});
