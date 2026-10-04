/**
 * The capability labels, lists and instance settings (`lib/capabilities.ts`),
 * and the pure gate decision (`ai/capability-gate.ts`).
 *
 * THE RULE EVERYTHING ELSE HANGS ON: `null` is "no record" or "no check", and
 * an empty list is "nothing". The tests keep the two apart, and each refusal
 * has a control that shows the same input passing where it should.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowsCapability,
  effectiveCapabilities,
  isCapabilityLabel,
  MAX_CAPABILITIES,
  normalizeCapabilities,
  parseCapabilityArray,
  parseCapabilityLabels,
  parseCapabilitySchemaMap,
  parseDefaultCapabilities,
} from '../../src/lib/capabilities.js';
import { decideCapability, schemaNameOf } from '../../src/ai/capability-gate.js';

test('a label is a lower case letter then up to 31 lower case letters, digits and hyphens', () => {
  for (const good of ['scan', 'recipes', 'a', 'meal-plan', 'v2', 'a'.repeat(32)]) {
    assert.equal(isCapabilityLabel(good), true, good);
  }
  for (const bad of ['', 'Scan', '1scan', '-scan', 'scan_result', 'scan result', 'a'.repeat(33), 'scän', ' scan']) {
    assert.equal(isCapabilityLabel(bad), false, JSON.stringify(bad));
  }
});

test('"none" is reserved: it is a word for the default, never a label', () => {
  assert.equal(isCapabilityLabel('none'), false);
  const refused = parseCapabilityLabels(['scan', 'none']);
  assert.equal(refused.ok, false);
  // The control: a label that merely starts with it is fine.
  assert.equal(isCapabilityLabel('nonetheless'), true);
});

test('a list is deduplicated and sorted, so the same grant is always the same list', () => {
  assert.deepEqual(normalizeCapabilities(['scan', 'recipes', 'scan']), ['recipes', 'scan']);
  assert.deepEqual(parseCapabilityLabels(['scan', 'recipes', 'scan']), { ok: true, value: ['recipes', 'scan'] });
  assert.deepEqual(parseCapabilityLabels([]), { ok: true, value: [] });
});

test('a list is bounded at 32 labels', () => {
  const labels = Array.from({ length: MAX_CAPABILITIES }, (_, index) => `label-${index}`);
  assert.equal(parseCapabilityLabels(labels).ok, true);
  assert.equal(parseCapabilityLabels([...labels, 'one-more']).ok, false);
});

test('a JSON value must be an array of strings that are labels', () => {
  assert.deepEqual(parseCapabilityArray(['scan']), { ok: true, value: ['scan'] });
  assert.deepEqual(parseCapabilityArray([]), { ok: true, value: [] });
  for (const bad of ['scan', 7, { scan: true }, ['scan', 1], ['Scan'], ['none'], null, undefined]) {
    assert.equal(parseCapabilityArray(bad).ok, false, JSON.stringify(bad));
  }
});

test('DEFAULT_CAPABILITIES: unset, empty and blank are "no check", and "none" is the empty list', () => {
  assert.equal(parseDefaultCapabilities(undefined), null);
  // The compose files forward an unset variable as the empty string, so empty has to mean unset.
  assert.equal(parseDefaultCapabilities(''), null);
  assert.equal(parseDefaultCapabilities('   '), null);
  assert.deepEqual(parseDefaultCapabilities('none'), []);
  assert.deepEqual(parseDefaultCapabilities(' none '), []);
  assert.deepEqual(parseDefaultCapabilities('scan'), ['scan']);
  assert.deepEqual(parseDefaultCapabilities('recipes, scan,scan'), ['recipes', 'scan']);
});

test('DEFAULT_CAPABILITIES refuses a malformed list and names the variable', () => {
  for (const bad of ['scan,', ',scan', 'Scan', 'scan recipes', 'scan,none', 'none,scan']) {
    assert.throws(() => parseDefaultCapabilities(bad), /DEFAULT_CAPABILITIES is not valid/, bad);
  }
});

test('CAPABILITY_SCHEMA_MAP: unset or empty is an empty map, pairs are read, a bad pair stops the boot', () => {
  assert.equal(parseCapabilitySchemaMap(undefined).size, 0);
  assert.equal(parseCapabilitySchemaMap('').size, 0);
  assert.deepEqual(
    [...parseCapabilitySchemaMap('scan_result:scan, recipe-list:recipes')],
    [
      ['scan_result', 'scan'],
      ['recipe-list', 'recipes'],
    ],
  );
  for (const bad of [
    'scan_result',
    'scan_result:',
    ':scan',
    'scan_result:scan:extra',
    'scan result:scan',
    'scan_result:Scan',
    'scan_result:none',
    'scan_result:scan,scan_result:recipes',
    'scan_result:scan,',
  ]) {
    assert.throws(() => parseCapabilitySchemaMap(bad), /CAPABILITY_SCHEMA_MAP/, bad);
  }
});

test('the effective value is the own record, else the default, else null, and null allows everything', () => {
  assert.equal(effectiveCapabilities({ own: null, instanceDefault: null }), null);
  assert.deepEqual(effectiveCapabilities({ own: null, instanceDefault: ['scan'] }), ['scan']);
  assert.deepEqual(effectiveCapabilities({ own: ['recipes'], instanceDefault: ['scan'] }), ['recipes']);
  // An EMPTY own record is a record: it does not fall through to the default.
  assert.deepEqual(effectiveCapabilities({ own: [], instanceDefault: ['scan'] }), []);

  assert.equal(allowsCapability({ effective: null, label: 'anything' }), true);
  assert.equal(allowsCapability({ effective: [], label: 'scan' }), false);
  assert.equal(allowsCapability({ effective: ['scan'], label: 'scan' }), true);
  assert.equal(allowsCapability({ effective: ['scan'], label: 'recipes' }), false);
});

test('the schema name is read from response_format.json_schema.name and nowhere else', () => {
  assert.equal(
    schemaNameOf({ response_format: { type: 'json_schema', json_schema: { name: 'scan_result' } } }),
    'scan_result',
  );
  assert.equal(schemaNameOf({ response_format: { type: 'json_object' } }), null);
  assert.equal(schemaNameOf({ response_format: 'json' }), null);
  assert.equal(schemaNameOf({ response_format: { json_schema: { name: 7 } } }), null);
  assert.equal(schemaNameOf({ name: 'scan_result' }), null);
  assert.equal(schemaNameOf({}), null);
});

test('the gate: mapped label first, then the header, and a null effective value is never refused', () => {
  const map = new Map([['scan_result', 'scan']]);
  const scanBody = { response_format: { json_schema: { name: 'scan_result' } } };

  assert.deepEqual(decideCapability({ effective: null, featureHeader: 'BAD', schemaMap: map, body: scanBody }), {
    kind: 'allowed',
  });
  assert.deepEqual(
    decideCapability({ effective: ['recipes'], featureHeader: 'recipes', schemaMap: map, body: scanBody }),
    { kind: 'refused', status: 403, error: 'capability-required', capability: 'scan' },
  );
  // Both missing: the mapped label is the one reported.
  assert.deepEqual(decideCapability({ effective: [], featureHeader: 'recipes', schemaMap: map, body: scanBody }), {
    kind: 'refused',
    status: 403,
    error: 'capability-required',
    capability: 'scan',
  });
  assert.deepEqual(decideCapability({ effective: ['scan'], featureHeader: 'recipes', schemaMap: map, body: {} }), {
    kind: 'refused',
    status: 403,
    error: 'capability-required',
    capability: 'recipes',
  });
  assert.deepEqual(decideCapability({ effective: ['scan'], featureHeader: 'Bad Label', schemaMap: map, body: {} }), {
    kind: 'refused',
    status: 400,
    error: 'feature-header-invalid',
  });
  // Naming nothing the gate can compare passes.
  assert.deepEqual(decideCapability({ effective: [], featureHeader: undefined, schemaMap: map, body: {} }), {
    kind: 'allowed',
  });
  assert.deepEqual(decideCapability({ effective: ['scan'], featureHeader: 'scan', schemaMap: map, body: scanBody }), {
    kind: 'allowed',
  });
});
