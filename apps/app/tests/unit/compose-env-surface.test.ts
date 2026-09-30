/**
 * Every variable the openplate app server reads can be set from `.env` under
 * every shipped compose file that runs it, and `.env.example` names each one.
 *
 * WHY. Compose passes a container only the names its `environment:` block
 * lists. A `.env` line whose name is not there never arrives, and nothing says
 * so: an operator sets `MATOMO_URL`, restarts, and counts nothing. Until
 * 2026-09-30 no compose file forwarded `CONTENT_DIR`, the Matomo trio, the
 * newsletter pair or `NUTRIENT_REFERENCE_BASIS` at all.
 *
 * HOW. The names come from the sources, not from a list: `scanFiles` reads
 * everything under `app/config/`, the content reader, the bind rule,
 * `server.ts`, the logger and `vite.config.ts` for every way this app reads a
 * variable. A new read therefore fails here until each compose file forwards
 * it and `.env.example` names it, or until it joins `EXCLUDED` with a reason.
 * The compose files are found by the image they run, so a new topology file is
 * checked the day it lands.
 *
 * The two controls at the bottom prove each check can fail: a compose file with
 * one line removed, and a source with one new read nobody forwards.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
} from '../compose-env';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(APP_ROOT, '../..');

const CONFIG_FILES = readdirSync(join(APP_ROOT, 'app/config'), { recursive: true, encoding: 'utf8' })
  .filter((entry) => entry.endsWith('.ts'))
  .map((entry) => join(APP_ROOT, 'app/config', entry));

/** Every file the server reads its environment in. */
const SOURCES: readonly { path: string; language: SourceLanguage }[] = [
  ...CONFIG_FILES.map((path) => ({ path, language: 'typescript' as const })),
  { path: join(APP_ROOT, 'app/lib/content/content.server.ts'), language: 'typescript' },
  { path: join(APP_ROOT, 'app/lib/server-bind.ts'), language: 'typescript' },
  { path: join(APP_ROOT, 'app/lib/logger.ts'), language: 'typescript' },
  { path: join(APP_ROOT, 'server.ts'), language: 'typescript' },
  { path: join(APP_ROOT, 'vite.config.ts'), language: 'typescript' },
];

/**
 * Names this app reads that no compose file forwards from `.env`, each with
 * the reason. `fixed` names may appear with a value the file decides;
 * `absent` names must not appear at all.
 */
const EXCLUDED: readonly { name: string; kind: 'fixed' | 'absent'; reason: string }[] = [
  { name: 'NODE_ENV', kind: 'fixed', reason: 'every compose file runs the production build, NODE_ENV=production' },
  { name: 'PORT', kind: 'fixed', reason: 'the published mapping targets container port 3000; move the host side instead' },
  {
    name: 'GATEWAY_URL',
    kind: 'absent',
    reason: 'refused since M192: a non-empty value stops the boot, so there is nothing to forward',
  },
  {
    name: 'OPENPLATE_BUILD_SHA',
    kind: 'absent',
    reason: 'a Docker build argument stamped into the bundle; only the dev server reads it at run time',
  },
  {
    name: 'VITE_ALLOWED_HOSTS',
    kind: 'absent',
    reason: 'the Vite dev server host list; the image runs no Vite server',
  },
];

/** The compose services that run the app. Discovery must find exactly these. */
const SERVICES_RUNNING_APP = [
  { file: 'docker/compose.yml', service: 'app' },
  { file: 'docker/topologies/compose.full.yml', service: 'app' },
  { file: 'docker/topologies/compose.inference.yml', service: 'openplate' },
  { file: 'docker/topologies/compose.sync.yml', service: 'app' },
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
const ENV_EXAMPLE = readFileSync(join(APP_ROOT, '.env.example'), 'utf8');

function composeText(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8');
}

describe('the scan finds what the app server reads', () => {
  it('finds a name for every way the sources read one', () => {
    // process.env.X in config, an options-object helper, the content reader,
    // the bind rule, and the dev-only read in vite.config.ts.
    for (const name of ['MATOMO_URL', 'APP_URL', 'CONTENT_DIR', 'HOST', 'VITE_ALLOWED_HOSTS']) {
      assert.ok(SCANNED.has(name), `the scan missed ${name}`);
    }
    assert.ok(REQUIRED.length >= 20, `only ${REQUIRED.length} names to forward, the scan is broken`);
  });

  it('keeps no stale exclusion: every excluded name is still read', () => {
    const stale = [...EXCLUDED_NAMES].filter((name) => !SCANNED.has(name));
    assert.deepEqual(stale, []);
  });

  it('finds the compose services that run the app, and only those', () => {
    assert.deepEqual(findServicesRunning({ repoRoot: REPO_ROOT, image: 'openplate' }), SERVICES_RUNNING_APP);
  });
});

describe('every compose file that runs the app forwards everything it reads', () => {
  for (const { file, service } of SERVICES_RUNNING_APP) {
    it(`${file} takes every name from .env`, () => {
      assert.deepEqual(unforwarded({ composeText: composeText(file), service, required: REQUIRED }), []);
    });

    it(`${file} passes no name that must stay out`, () => {
      const present = new Set(
        readEnvironment(findComposeService({ composeText: composeText(file), name: service })).map((entry) => entry.name),
      );
      const leaked = EXCLUDED.filter((entry) => entry.kind === 'absent' && present.has(entry.name));
      assert.deepEqual(
        leaked.map((entry) => entry.name),
        [],
      );
    });
  }

  it('.env.example has an entry for every name', () => {
    assert.deepEqual(missingFromEnvExample({ envExample: ENV_EXAMPLE, required: REQUIRED }), []);
  });
});

describe('the controls: each check above can fail', () => {
  it('a compose file with one forwarded line removed is caught', () => {
    const text = composeText('docker/compose.yml');
    const withoutLine = text.replace(/^ {6}FOOD_DB_API_KEY:.*\n/m, '');
    assert.notEqual(withoutLine, text, 'the control found no FOOD_DB_API_KEY line to remove');
    assert.deepEqual(unforwarded({ composeText: withoutLine, service: 'app', required: REQUIRED }), [
      'FOOD_DB_API_KEY',
    ]);
  });

  it('a new read that no compose file forwards is caught everywhere', () => {
    const source = `${readFileSync(join(APP_ROOT, 'app/config/index.ts'), 'utf8')}\nconst probe = process.env.NOT_FORWARDED;\n`;
    const scanned = new Set([...SCANNED, ...scanEnvironmentReads({ source, language: 'typescript' })]);
    const required = requiredNames(scanned);
    for (const { file, service } of SERVICES_RUNNING_APP) {
      assert.deepEqual(unforwarded({ composeText: composeText(file), service, required }), ['NOT_FORWARDED'], file);
    }
    assert.deepEqual(missingFromEnvExample({ envExample: ENV_EXAMPLE, required }), ['NOT_FORWARDED']);
  });
});
