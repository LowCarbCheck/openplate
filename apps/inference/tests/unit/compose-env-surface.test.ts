/**
 * Every variable openplate-inference reads can be set from `.env` under every
 * shipped compose file that runs it, and `.env.example` names each one.
 *
 * WHY. Compose passes a container only the names its `environment:` block
 * lists. A `.env` line whose name is not there never arrives, and nothing says
 * so. Until 2026-09-30 the compose files forwarded five or six names and wrote
 * the rest as literals, so an operator who wanted their own runtime or a
 * different queue depth had to edit the file.
 *
 * HOW. The names come from the sources, not from a list: `scanFiles` reads the
 * zod `EnvSchema` in `src/config.ts`, and every `${NAME:-...}` in the two
 * scripts the container runs before the service, `scripts/docker-entrypoint.sh`
 * and `scripts/fetch-weights.sh`. A new read therefore fails here until each
 * compose file forwards it and `.env.example` names it, or until it joins
 * `EXCLUDED` with a reason. The compose files are found by the image they run,
 * so a new topology file is checked the day it lands.
 *
 * The two controls at the bottom prove each check can fail: a compose file with
 * one line removed, and a source with one new read nobody forwards.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findComposeService,
  findServicesRunning,
  hasEnvExampleEntry,
  isSettable,
  readEnvironment,
  scanEnvironmentReads,
  scanFiles,
  type SourceLanguage,
} from '../support/compose-env.js';

const INFERENCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(INFERENCE_ROOT, '../..');

/** The service's config, and the two scripts the entrypoint runs before it. */
const SOURCES: readonly { path: string; language: SourceLanguage }[] = [
  { path: join(INFERENCE_ROOT, 'src/config.ts'), language: 'typescript' },
  { path: join(INFERENCE_ROOT, 'scripts/docker-entrypoint.sh'), language: 'shell' },
  { path: join(INFERENCE_ROOT, 'scripts/fetch-weights.sh'), language: 'shell' },
];

/** Names this service reads that no compose file forwards, each with the reason. None may appear. */
const EXCLUDED: readonly { name: string; reason: string }[] = [
  {
    name: 'PORT',
    reason: 'the image sets PORT=8300, and the published mapping and the image healthcheck target it',
  },
  { name: 'MODELS_DIR', reason: 'must stay /models, the volume the weights are kept on' },
  {
    name: 'NVIDIA_VISIBLE_DEVICES',
    reason: 'the NVIDIA container runtime sets it when a GPU is reserved; a forwarded value would compete with it',
  },
  { name: 'RUNTIME_PID', reason: 'a shell variable the entrypoint sets itself, never an input' },
];

/** The compose services that run openplate-inference. Discovery must find exactly these. */
const SERVICES_RUNNING_INFERENCE = [
  { file: 'apps/inference/docker/compose.yml', service: 'inference' },
  { file: 'docker/topologies/compose.full.yml', service: 'inference' },
  { file: 'docker/topologies/compose.inference.yml', service: 'inference' },
];

const EXCLUDED_NAMES = new Set(EXCLUDED.map((entry) => entry.name));

/** What every compose file must forward, given the names the sources read. */
function requiredNames(scanned: ReadonlySet<string>): string[] {
  return [...scanned].filter((name) => !EXCLUDED_NAMES.has(name)).toSorted();
}

/** The required names a service's `environment:` block does not take from `.env`. */
function unforwarded(input: { composeText: string; service: string; required: readonly string[] }): string[] {
  const entries = readEnvironment(findComposeService({ composeText: input.composeText, name: input.service }));
  const settable = new Set(entries.filter((entry) => isSettable(entry.value)).map((entry) => entry.name));
  return input.required.filter((name) => !settable.has(name));
}

/** The required names `.env.example` has no entry for. */
function missingFromEnvExample(input: { envExample: string; required: readonly string[] }): string[] {
  return input.required.filter((name) => !hasEnvExampleEntry({ envExample: input.envExample, name }));
}

const SCANNED = scanFiles(SOURCES);
const REQUIRED = requiredNames(SCANNED);
const ENV_EXAMPLE = readFileSync(join(INFERENCE_ROOT, '.env.example'), 'utf8');

/**
 * The three copies of `compose-env.ts`, by path from the repository root. Each
 * app's gate runs only its own tree, so the helper is copied, and this check,
 * present in all three apps, stops a lone edit to one copy from passing. The
 * comparison lives here and not in the helper, so an edit to one copy cannot
 * switch off its own check.
 */
const HELPER_COPIES = [
  'apps/app/tests/compose-env.ts',
  'apps/core/tests/unit/compose-env.ts',
  'apps/inference/tests/support/compose-env.ts',
];

/** One copy of the helper and its bytes. */
interface HelperCopy {
  path: string;
  bytes: Buffer;
}

/** The copies whose bytes differ from the first one. */
function differingCopies(copies: readonly HelperCopy[]): string[] {
  const first = copies[0];
  if (first === undefined) throw new Error('there is no copy of the helper to compare');
  return copies.filter((copy) => !copy.bytes.equals(first.bytes)).map((copy) => copy.path);
}

/** The copies with the last byte of the last one flipped, in memory only. */
function withOneByteChanged(copies: readonly HelperCopy[]): HelperCopy[] {
  const last = copies.at(-1);
  if (last === undefined) throw new Error('there is no copy of the helper to change');
  const bytes = Buffer.from(last.bytes);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
  return [...copies.slice(0, -1), { path: last.path, bytes }];
}

const COPIES: HelperCopy[] = HELPER_COPIES.map((path) => ({ path, bytes: readFileSync(join(REPO_ROOT, path)) }));

function composeText(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8');
}

describe('the scan finds what openplate-inference reads', () => {
  it('finds a name for every way the sources read one', () => {
    // A zod EnvSchema key, an entrypoint expansion, a fetch-weights expansion.
    for (const name of ['MODEL_RUNTIME_URL', 'OFF_API_URL', 'LLAMA_EXTRA_ARGS', 'WEIGHTS_MIRROR_BASE']) {
      expect(SCANNED.has(name), `the scan missed ${name}`).toBe(true);
    }
    expect(REQUIRED.length).toBeGreaterThanOrEqual(25);
  });

  it('keeps no stale exclusion: every excluded name is still read', () => {
    expect([...EXCLUDED_NAMES].filter((name) => !SCANNED.has(name))).toEqual([]);
  });

  it('finds the compose services that run openplate-inference, and only those', () => {
    expect(findServicesRunning({ repoRoot: REPO_ROOT, image: 'openplate-inference' })).toEqual(
      SERVICES_RUNNING_INFERENCE,
    );
  });
});

describe('every compose file that runs openplate-inference forwards everything it reads', () => {
  for (const { file, service } of SERVICES_RUNNING_INFERENCE) {
    it(`${file} takes every name from .env`, () => {
      expect(unforwarded({ composeText: composeText(file), service, required: REQUIRED })).toEqual([]);
    });

    it(`${file} passes no name that must stay out`, () => {
      const present = readEnvironment(findComposeService({ composeText: composeText(file), name: service })).map(
        (entry) => entry.name,
      );
      expect(present.filter((name) => EXCLUDED_NAMES.has(name))).toEqual([]);
    });
  }

  it('.env.example has an entry for every name', () => {
    expect(missingFromEnvExample({ envExample: ENV_EXAMPLE, required: REQUIRED })).toEqual([]);
  });
});

describe('the controls: each check above can fail', () => {
  it('a compose file with one forwarded line removed is caught', () => {
    const text = composeText('apps/inference/docker/compose.yml');
    const withoutLine = text.replace(/^ {6}MAX_QUEUE_DEPTH:.*\n/m, '');
    expect(withoutLine, 'the control found no MAX_QUEUE_DEPTH line to remove').not.toBe(text);
    expect(unforwarded({ composeText: withoutLine, service: 'inference', required: REQUIRED })).toEqual([
      'MAX_QUEUE_DEPTH',
    ]);
  });

  it('a new read that no compose file forwards is caught everywhere', () => {
    const source = `${readFileSync(join(INFERENCE_ROOT, 'src/config.ts'), 'utf8')}\nconst probe = process.env.NOT_FORWARDED;\n`;
    const scanned = new Set([...SCANNED, ...scanEnvironmentReads({ source, language: 'typescript' })]);
    const required = requiredNames(scanned);
    for (const { file, service } of SERVICES_RUNNING_INFERENCE) {
      expect(unforwarded({ composeText: composeText(file), service, required }), file).toEqual(['NOT_FORWARDED']);
    }
    expect(missingFromEnvExample({ envExample: ENV_EXAMPLE, required })).toEqual(['NOT_FORWARDED']);
  });
});

describe('the compose-env helper is one file in three places', () => {
  it('all three copies are byte-identical', () => {
    expect(differingCopies(COPIES)).toEqual([]);
  });

  it('the control: one changed byte in one copy is caught', () => {
    expect(differingCopies(withOneByteChanged(COPIES))).toEqual(['apps/inference/tests/support/compose-env.ts']);
  });
});
