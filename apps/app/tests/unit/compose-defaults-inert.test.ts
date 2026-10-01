/**
 * With an EMPTY `.env`, every compose file that runs the app boots it exactly
 * as its minimal environment would. Forwarding a variable must never change
 * what an existing install runs.
 *
 * WHY. `compose-env-surface.test.ts` makes each file forward every name the
 * server reads. Each forward carries a default, and a default is a value:
 * `MATOMO_EVENT_LEVEL=product` is the code's own default and still stops the
 * boot when the Matomo pair is unset. This test says each default is inert by
 * asking the real parsers rather than reading the YAML.
 *
 * HOW. For each file it builds the environment the container gets with an
 * empty `.env`: the image's own ENV (read from `Dockerfile.pnpm`), then every
 * `environment:` entry at its default. It parses that with the three things
 * that read the environment at boot, `parseAppConfig`, `parseContentDirectory`
 * and `resolveServerBind`, and compares the result with the parse of the
 * minimal environment alone: the image ENV, the values the file fixes
 * (`NODE_ENV`, `PORT`), and the few values a topology sets on purpose
 * (`TOPOLOGY`, each with its reason).
 *
 * The controls at the bottom change one default and watch the comparison fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAppConfig } from '../../app/config/index';
import { parseContentDirectory } from '../../app/lib/content/content.server';
import { resolveServerBind } from '../../app/lib/server-bind';
import { findComposeService, readEnvironment, readImageEnvironment, resolveEnvironment } from '../compose-env';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(APP_ROOT, '../..');

/** The container port every compose file publishes. */
const CONTAINER_PORT = 3000;

/** Values a compose file decides itself, never from `.env` directly. */
const FIXED = ['NODE_ENV', 'PORT'];

/**
 * Values a topology sets ON PURPOSE to something other than the code default.
 * Each must earn its place: dropping it from the minimal environment has to
 * change the parse for at least one file, or it is hiding nothing and goes.
 */
const TOPOLOGY: readonly { name: string; reason: string }[] = [
  {
    name: 'APP_URL',
    reason: 'the inference topology fills it from PUBLIC_APP_URL with a LAN example address',
  },
  {
    name: 'SYNC_SERVER_URL',
    reason: 'the sync topologies fill it from PUBLIC_SYNC_URL: it is what turns sync on',
  },
  {
    name: 'DEFAULT_INFERENCE_BASE_URL',
    reason: 'the inference topologies fill it from PUBLIC_INFERENCE_URL: it is what draws the one-tap AI card',
  },
  {
    name: 'DEFAULT_INFERENCE_API_KEY',
    reason: 'the inference topologies fill it from INFERENCE_API_KEY, the key the inference container accepts',
  },
];

const IMAGE_ENV = readImageEnvironment(readFileSync(join(APP_ROOT, 'Dockerfile.pnpm'), 'utf8'));

const SERVICES_RUNNING_APP = [
  { file: 'docker/compose.yml', service: 'app' },
  { file: 'docker/topologies/compose.core.yml', service: 'app' },
  { file: 'docker/topologies/compose.full.yml', service: 'app' },
  { file: 'docker/topologies/compose.inference.yml', service: 'openplate' },
];

/** The environment with an empty `.env`, and the minimal one. */
interface EnvironmentPair {
  container: NodeJS.ProcessEnv;
  minimal: NodeJS.ProcessEnv;
}

function environments(input: { composeText: string; service: string; kept: readonly string[] }): EnvironmentPair {
  const entries = readEnvironment(findComposeService({ composeText: input.composeText, name: input.service }));
  const resolved = resolveEnvironment({ entries, supplied: new Map() });
  const keep = new Set([...FIXED, ...input.kept]);
  return {
    container: Object.fromEntries([...IMAGE_ENV, ...resolved]),
    minimal: Object.fromEntries([...IMAGE_ENV, ...[...resolved].filter(([name]) => keep.has(name))]),
  };
}

/** Everything the server derives from its environment at boot. */
interface BootReading {
  config: ReturnType<typeof parseAppConfig>;
  contentDirectory: string | null;
  bind: ReturnType<typeof resolveServerBind>;
}

function readBoot(env: NodeJS.ProcessEnv): BootReading {
  return {
    config: parseAppConfig(env),
    contentDirectory: parseContentDirectory(env.CONTENT_DIR),
    bind: resolveServerBind({ env, port: CONTAINER_PORT }),
  };
}

/** Throws unless the container environment reads exactly like the minimal one. */
function assertInert(input: { composeText: string; service: string }): void {
  const { container, minimal } = environments({ ...input, kept: TOPOLOGY.map((entry) => entry.name) });
  assert.deepEqual(readBoot(container), readBoot(minimal));
}

function composeText(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8');
}

describe('compose defaults change nothing the app server reads', () => {
  it('reads NODE_ENV=production from the image', () => {
    assert.equal(IMAGE_ENV.get('NODE_ENV'), 'production');
  });

  for (const { file, service } of SERVICES_RUNNING_APP) {
    it(`${file}: an empty .env reads like the minimal environment`, () => {
      assertInert({ composeText: composeText(file), service });
    });
  }

  for (const { name } of TOPOLOGY) {
    it(`${name} earns its place on the topology list`, () => {
      const kept = TOPOLOGY.map((entry) => entry.name).filter((each) => each !== name);
      const changes = SERVICES_RUNNING_APP.some(({ file, service }) => {
        const { container, minimal } = environments({ composeText: composeText(file), service, kept });
        return JSON.stringify(readBoot(container)) !== JSON.stringify(readBoot(minimal));
      });
      assert.ok(changes, `${name} changes no reading, take it off the list`);
    });
  }
});

describe('the controls: a default that is not inert is caught', () => {
  it('a default that turns a feature off fails', () => {
    const text = composeText('docker/compose.yml');
    const changed = text.replace('${UPDATE_CHECK:-}', '${UPDATE_CHECK:-off}');
    assert.notEqual(changed, text, 'the control found no UPDATE_CHECK default to change');
    assert.throws(() => assertInert({ composeText: changed, service: 'app' }), assert.AssertionError);
  });

  it("the code's own default, written out where the parser refuses it alone, fails", () => {
    const text = composeText('docker/compose.yml');
    const changed = text.replace('${MATOMO_EVENT_LEVEL:-}', '${MATOMO_EVENT_LEVEL:-product}');
    assert.notEqual(changed, text, 'the control found no MATOMO_EVENT_LEVEL default to change');
    assert.throws(() => assertInert({ composeText: changed, service: 'app' }), /MATOMO_EVENT_LEVEL is set/);
  });
});
