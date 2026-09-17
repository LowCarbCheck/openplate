/**
 * The admin contract's literals, as this repository transcribes them (M234
 * spec 07).
 *
 * ── WHY A TEST AND NOT A SHARED PACKAGE ──────────────────────────────────
 *
 * `openplate` and `openplate-core` cannot import each other, so the wire is
 * written out twice and `openplate-core/PROTOCOL.md` is the normative
 * document. Each side pins ITS OWN transcription against a literal copied from
 * that document, never against the other repository, and the two tests are
 * what makes a one-sided edit fail instead of leaving both suites green while
 * the repositories silently disagree. The other side of this file is
 * `openplate-core/tests/unit/admin-contract.test.ts`, which drives its real
 * router with the same bodies.
 *
 * ── THE BODIES BELOW ARE COPIED, NOT BUILT ───────────────────────────────
 *
 * Every fixture here is written out by hand from `PROTOCOL.md` §5.6 and §5.20.
 * A fixture built from this repository's own schema would be a test of nothing:
 * it would follow any edit the schema made, which is precisely the drift this
 * file exists to catch (`adminStatsResponseSchema`'s own header records the
 * afternoon that cost).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_API_PREFIX,
  NUTRIENT_REFERENCE_BASES,
  instanceSettingsResponseSchema,
  nutrientReferenceBasisSchema,
} from '../../app/lib/admin/admin-wire';
import { readHandshakeInstance } from '../../app/lib/sync/engine/protocol';

/** `PATCH /v1/admin/settings`, spelled out as `PROTOCOL.md` §5.20's route table gives it. */
const SETTINGS_PATH = '/v1/admin/settings';

test('the settings endpoint is the path the protocol names', () => {
  assert.equal(`${ADMIN_API_PREFIX}/settings`, SETTINGS_PATH);
});

test('the three published bases are exactly dge, efsa and us', () => {
  assert.deepEqual([...NUTRIENT_REFERENCE_BASES], ['dge', 'efsa', 'us']);

  for (const basis of ['dge', 'efsa', 'us']) {
    assert.equal(nutrientReferenceBasisSchema.safeParse(basis).success, true);
  }
  // THE CONTROL. A schema that took any string would pass every line above.
  assert.equal(nutrientReferenceBasisSchema.safeParse('eu').success, false);
  assert.equal(nutrientReferenceBasisSchema.safeParse('DGE').success, false);
});

test('the settings response is wrapped, exactly like every other admin answer', () => {
  // `{"settings": {...}}`, copied from PROTOCOL.md §5.20.
  const body = { settings: { nutrientReferenceBasis: 'efsa' } };
  assert.deepEqual(instanceSettingsResponseSchema.parse(body).settings, { nutrientReferenceBasis: 'efsa' });

  // THE CONTROL, and the shape of the defect this file exists for: the
  // unwrapped body must not parse, or a client reading the envelope and a
  // service sending none would look identical here.
  assert.equal(instanceSettingsResponseSchema.safeParse({ nutrientReferenceBasis: 'efsa' }).success, false);
});

test('the handshake carries the basis, and a service older than the field carries none', () => {
  // `/health`, copied from PROTOCOL.md §5.6's own example body.
  const health = {
    protocolVersion: 2,
    envelopeVersion: 1,
    serviceVersion: '0.6.0',
    instance: {
      name: 'openplate',
      language: 'de',
      mail: true,
      nutrientReferenceBasis: 'dge',
      ai: { model: 'google/gemini-3.7-flash' },
    },
  };
  assert.equal(readHandshakeInstance(health)?.nutrientReferenceBasis, 'dge');

  // ABSENT, NOT A DEFAULT, on a service built before M234 and on one with no
  // answer to give. The browser then names no basis and takes the server's
  // own, which is the only honest degradation: a `dge` invented here would
  // show German numbers under an American instance's name.
  const older = {
    protocolVersion: 2,
    envelopeVersion: 1,
    serviceVersion: '0.6.0',
    instance: { name: 'openplate', language: 'en', mail: false, ai: null },
  };
  assert.equal(readHandshakeInstance(older)?.nutrientReferenceBasis, undefined);

  // A fourth name is dropped rather than believed, and it must not take the
  // rest of the block down with it: the instance is still usable for AI.
  const unknown = {
    protocolVersion: 2,
    envelopeVersion: 1,
    serviceVersion: '0.6.0',
    instance: { name: 'openplate', language: 'en', mail: false, ai: { model: 'x' }, nutrientReferenceBasis: 'eu' },
  };
  assert.equal(readHandshakeInstance(unknown)?.nutrientReferenceBasis, undefined);
  assert.deepEqual(readHandshakeInstance(unknown)?.ai, { model: 'x' });
});
