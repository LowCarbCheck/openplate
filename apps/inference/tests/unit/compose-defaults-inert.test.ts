/**
 * With an EMPTY `.env`, every compose file that runs openplate-inference boots
 * it exactly as its minimal environment would. Forwarding a variable must never
 * change what an existing install runs.
 *
 * WHY. `compose-env-surface.test.ts` makes each file forward every name this
 * service and its entrypoint read. Each forward carries a default, and a
 * default is a value. A forwarded `CONTEXT_SIZE` overrides the image's own
 * ENV line, so its default has to land on the same number the image sets.
 *
 * HOW. For each file it builds the environment the container gets with an
 * empty `.env`: the image's own ENV (read from the Dockerfile), then every
 * `environment:` entry at its default. It reads that environment twice, the
 * way the container does. The node half is `parseConfig`, with
 * `MODEL_RUNTIME_URL` set to the loopback address the entrypoint always
 * exports in bundled mode. The shell half is every `${NAME:-default}` in the
 * entrypoint and in `fetch-weights.sh`, resolved by POSIX rules. Both are
 * compared with the same reading of the minimal environment: the image ENV
 * and the one value a topology sets on purpose (`TOPOLOGY`).
 *
 * The entrypoint's other exports (`CONCURRENCY`, `PROFILE`) are functions of
 * expansions the shell half already compares, so they are not replayed.
 *
 * The controls at the bottom change one default in each half and watch the
 * comparison fail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, type ServiceConfig } from '../../src/config.js';
import {
  findComposeService,
  readEnvironment,
  readImageEnvironment,
  readShellExpansions,
  resolveEnvironment,
  resolveShellExpansion,
  type ShellExpansion,
} from '../support/compose-env.js';

const INFERENCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(INFERENCE_ROOT, '../..');

/**
 * Values a topology sets ON PURPOSE to something other than the code default.
 * Each must earn its place: dropping it from the minimal environment has to
 * change the reading for at least one file, or it is hiding nothing and goes.
 */
const TOPOLOGY: readonly { name: string; reason: string }[] = [
  {
    name: 'API_KEYS',
    reason: 'a fixed placeholder key, so a first trial keeps one key across restarts instead of a new one each boot',
  },
];

const IMAGE_ENV = readImageEnvironment(readFileSync(join(INFERENCE_ROOT, 'Dockerfile'), 'utf8'));

const EXPANSIONS: readonly ShellExpansion[] = ['scripts/docker-entrypoint.sh', 'scripts/fetch-weights.sh'].flatMap(
  (script) => readShellExpansions(readFileSync(join(INFERENCE_ROOT, script), 'utf8')),
);

const SERVICES_RUNNING_INFERENCE = [
  { file: 'apps/inference/docker/compose.yml', service: 'inference' },
  { file: 'docker/topologies/compose.full.yml', service: 'inference' },
  { file: 'docker/topologies/compose.inference.yml', service: 'inference' },
];

/** The environment with an empty `.env`, and the minimal one. */
interface EnvironmentPair {
  container: Map<string, string>;
  minimal: Map<string, string>;
}

function environments(input: { composeText: string; service: string; kept: readonly string[] }): EnvironmentPair {
  const entries = readEnvironment(findComposeService({ composeText: input.composeText, name: input.service }));
  const resolved = resolveEnvironment({ entries, supplied: new Map() });
  const keep = new Set(input.kept);
  return {
    container: new Map([...IMAGE_ENV, ...resolved]),
    minimal: new Map([...IMAGE_ENV, ...[...resolved].filter(([name]) => keep.has(name))]),
  };
}

/** Everything the container derives from its environment at boot. */
interface BootReading {
  config: ServiceConfig;
  shell: Record<string, string>;
}

function readBoot(env: Map<string, string>): BootReading {
  const shell = Object.fromEntries(
    EXPANSIONS.map((expansion) => [expansion.text, resolveShellExpansion({ expansion, env })]),
  );
  const runtimePort = shell['${RUNTIME_PORT:-8080}'];
  if (runtimePort === undefined) throw new Error('the entrypoint no longer reads ${RUNTIME_PORT:-8080}');
  return {
    config: parseConfig({ ...Object.fromEntries(env), MODEL_RUNTIME_URL: `http://127.0.0.1:${runtimePort}` }),
    shell,
  };
}

/** Fails unless the container environment reads exactly like the minimal one. */
function expectInert(input: { composeText: string; service: string }): void {
  const { container, minimal } = environments({ ...input, kept: TOPOLOGY.map((entry) => entry.name) });
  expect(readBoot(container)).toEqual(readBoot(minimal));
}

function composeText(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8');
}

describe('compose defaults change nothing openplate-inference reads', () => {
  it('reads the image ENV and the entrypoint expansions the comparison needs', () => {
    expect(IMAGE_ENV.get('CONTEXT_SIZE')).toBe('8192');
    expect(EXPANSIONS.map((expansion) => expansion.name)).toContain('LLAMA_THREADS');
  });

  for (const { file, service } of SERVICES_RUNNING_INFERENCE) {
    it(`${file}: an empty .env reads like the minimal environment`, () => {
      expectInert({ composeText: composeText(file), service });
    });
  }

  for (const { name } of TOPOLOGY) {
    it(`${name} earns its place on the topology list`, () => {
      const kept = TOPOLOGY.map((entry) => entry.name).filter((each) => each !== name);
      const changes = SERVICES_RUNNING_INFERENCE.some(({ file, service }) => {
        const { container, minimal } = environments({ composeText: composeText(file), service, kept });
        return JSON.stringify(readBoot(container)) !== JSON.stringify(readBoot(minimal));
      });
      expect(changes, `${name} changes no reading, take it off the list`).toBe(true);
    });
  }
});

describe('the controls: a default that is not inert is caught', () => {
  it('a service default that sheds load fails', () => {
    const text = composeText('apps/inference/docker/compose.yml');
    const changed = text.replace('${LATENCY_CEILING_MS:-0}', '${LATENCY_CEILING_MS:-10000}');
    expect(changed, 'the control found no LATENCY_CEILING_MS default to change').not.toBe(text);
    expect(() => expectInert({ composeText: changed, service: 'inference' })).toThrow();
  });

  it('an entrypoint default that differs from the image ENV fails', () => {
    const text = composeText('docker/topologies/compose.inference.yml');
    const changed = text.replace('${CONTEXT_SIZE:-8192}', '${CONTEXT_SIZE:-4096}');
    expect(changed, 'the control found no CONTEXT_SIZE default to change').not.toBe(text);
    expect(() => expectInert({ composeText: changed, service: 'inference' })).toThrow();
  });
});
