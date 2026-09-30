/**
 * With an EMPTY `.env`, every compose file that runs openplate-core boots it
 * exactly as its minimal environment would. Forwarding a variable must never
 * change what an existing install runs.
 *
 * WHY. `compose-env-surface.test.ts` makes each file forward every name this
 * service reads. Each forward carries a default, and a default is a value: an
 * empty `LOG_LEVEL` stops this service's boot, and `MEMBER_INVITE_LIFETIME_CAP`
 * set without its pair does too. This test is what says each default is
 * inert, by asking the real parser rather than reading the YAML.
 *
 * HOW. For each file it builds the environment the container gets with an
 * empty `.env`: the image's own ENV (read from the Dockerfile), then every
 * `environment:` entry at its default. It parses that with `parseConfig` and
 * compares the result with the parse of the minimal environment alone: the
 * image ENV, the values the file fixes (`PORT`, `DATABASE_URL`), the one value
 * the operator must supply (`SERVER_SECRET`), and the few values a topology
 * sets on purpose (`TOPOLOGY`, each with its reason).
 *
 * The controls at the bottom change one default and watch the comparison fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_SERVER_SECRET_LENGTH, parseConfig } from '../../src/config.js';
import { findComposeService, readEnvironment, readImageEnvironment, resolveEnvironment } from './compose-env.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(CORE_ROOT, '../..');

/** What the operator must put in `.env` before `docker compose up` works at all. */
const SUPPLIED = new Map([['SERVER_SECRET', 's'.repeat(MIN_SERVER_SECRET_LENGTH)]]);

/** Values a compose file decides itself, never from `.env` directly. */
const FIXED = ['PORT', 'DATABASE_URL'];

/**
 * Values a topology sets ON PURPOSE to something other than the code default.
 * Each must earn its place: dropping it from the minimal environment has to
 * change the parse for at least one file, or it is hiding nothing and goes.
 */
const TOPOLOGY: readonly { name: string; reason: string }[] = [
  {
    name: 'SERVER_PUBLIC_URL',
    reason: 'the sync topologies fill it from PUBLIC_SYNC_URL, one half of every invitation link',
  },
  {
    name: 'CLIENT_BASE_URL',
    reason: 'the sync topologies fill it from PUBLIC_APP_URL, the other half of every invitation link',
  },
  {
    name: 'TRUST_PROXY',
    reason: 'writes 0 hops out: it parses to 0 where unset parses to false, and Express trusts no hop for either',
  },
];

const IMAGE_ENV = readImageEnvironment(readFileSync(join(CORE_ROOT, 'Dockerfile'), 'utf8'));

const SERVICES_RUNNING_CORE = [
  { file: 'apps/core/docker/compose.yml', service: 'sync' },
  { file: 'docker/topologies/compose.full.yml', service: 'sync' },
  { file: 'docker/topologies/compose.sync.yml', service: 'sync' },
];

/** The environment with an empty `.env`, and the minimal one, for one service. */
interface EnvironmentPair {
  container: NodeJS.ProcessEnv;
  minimal: NodeJS.ProcessEnv;
}

function environments(input: { composeText: string; service: string; kept: readonly string[] }): EnvironmentPair {
  const entries = readEnvironment(findComposeService({ composeText: input.composeText, name: input.service }));
  const resolved = resolveEnvironment({ entries, supplied: SUPPLIED });
  const keep = new Set([...FIXED, ...SUPPLIED.keys(), ...input.kept]);
  const minimal = new Map([...IMAGE_ENV, ...[...resolved].filter(([name]) => keep.has(name))]);
  return {
    container: Object.fromEntries([...IMAGE_ENV, ...resolved]),
    minimal: Object.fromEntries(minimal),
  };
}

/** Throws unless the container environment parses exactly like the minimal one. */
function assertInert(input: { composeText: string; service: string }): void {
  const { container, minimal } = environments({ ...input, kept: TOPOLOGY.map((entry) => entry.name) });
  assert.deepEqual(parseConfig(container), parseConfig(minimal));
}

function composeText(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8');
}

describe('compose defaults change nothing openplate-core parses', () => {
  it('reads NODE_ENV=production from the image, so the production checks run', () => {
    assert.equal(IMAGE_ENV.get('NODE_ENV'), 'production');
  });

  for (const { file, service } of SERVICES_RUNNING_CORE) {
    it(`${file}: an empty .env parses like the minimal environment`, () => {
      assertInert({ composeText: composeText(file), service });
    });
  }

  for (const { name } of TOPOLOGY) {
    it(`${name} earns its place on the topology list`, () => {
      const kept = TOPOLOGY.map((entry) => entry.name).filter((each) => each !== name);
      const changes = SERVICES_RUNNING_CORE.some(({ file, service }) => {
        const { container, minimal } = environments({ composeText: composeText(file), service, kept });
        return JSON.stringify(parseConfig(container)) !== JSON.stringify(parseConfig(minimal));
      });
      assert.ok(changes, `${name} changes no parse, take it off the list`);
    });
  }
});

describe('the controls: a default that is not inert is caught', () => {
  it('a default that turns a feature on fails', () => {
    const text = composeText('docker/topologies/compose.sync.yml');
    const changed = text.replace('${SYNC_SHARING:-false}', '${SYNC_SHARING:-true}');
    assert.notEqual(changed, text, 'the control found no SYNC_SHARING default to change');
    assert.throws(() => assertInert({ composeText: changed, service: 'sync' }), assert.AssertionError);
  });

  it('an empty default where this parser refuses empty fails', () => {
    const text = composeText('apps/core/docker/compose.yml');
    const changed = text.replace('${LOG_LEVEL:-info}', '${LOG_LEVEL:-}');
    assert.notEqual(changed, text, 'the control found no LOG_LEVEL default to change');
    assert.throws(() => assertInert({ composeText: changed, service: 'sync' }), /Invalid LOG_LEVEL/);
  });
});
