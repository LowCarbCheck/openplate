/**
 * Every variable openplate-core reads can be set from `.env` under every
 * shipped compose file that runs it, and `.env.example` names each one.
 *
 * WHY. Compose passes a container only the names its `environment:` block
 * lists. A `.env` line whose name is not there never arrives, and nothing says
 * so: the operator sets `OPEN_SIGNUP=true`, restarts, and the instance stays
 * invite-only. Until 2026-09-30 the two topology files forwarded a subset and
 * told the reader to "add a line here" for the rest.
 *
 * HOW. The names come from the sources, not from a list: `scanFiles` reads
 * `src/config.ts`, `src/main.ts` and `src/version.ts` for every way this
 * service reads a variable. A new read therefore fails here until each compose
 * file forwards it and `.env.example` names it, or until it joins
 * `EXCLUDED` with a reason. The compose files are found by the image they
 * run, so a new topology file is checked the day it lands.
 *
 * The two controls at the bottom prove each check can fail: a compose file with
 * one line removed, and a source with one new read nobody forwards.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findComposeService,
  findServicesRunning,
  hasEnvExampleEntry,
  isIncludeStub,
  isSettable,
  readComposeServices,
  readEnvironment,
  scanEnvironmentReads,
  scanFiles,
  type SourceLanguage,
} from './compose-env.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(CORE_ROOT, '../..');

/** The files this service reads its environment in. `src/main.ts` says it is the only reader besides these. */
const SOURCES: readonly { path: string; language: SourceLanguage }[] = [
  { path: join(CORE_ROOT, 'src/config.ts'), language: 'typescript' },
  { path: join(CORE_ROOT, 'src/main.ts'), language: 'typescript' },
  { path: join(CORE_ROOT, 'src/version.ts'), language: 'typescript' },
  // The tier file and the routing settings are read here, not in config.ts:
  // `AI_TIERS_FILE`, `UPSTREAM_ZDR` and `UPSTREAM_PROVIDER_ONLY` stay visible
  // to this scan only while these two files are listed.
  { path: join(CORE_ROOT, 'src/ai/model-tiers.ts'), language: 'typescript' },
  { path: join(CORE_ROOT, 'src/ai/openrouter-routing.ts'), language: 'typescript' },
];

/**
 * Names this service reads that no compose file forwards from `.env`, each
 * with the reason. `fixed` names may appear with a value the file decides;
 * `absent` names must not appear at all.
 */
const EXCLUDED: readonly { name: string; kind: 'fixed' | 'absent'; reason: string }[] = [
  {
    name: 'NODE_ENV',
    kind: 'absent',
    reason: 'the image sets NODE_ENV=production, and the production-only checks rely on it',
  },
  {
    name: 'PORT',
    kind: 'fixed',
    reason: 'the published mapping targets container port 3000; SYNC_PORT moves the host side',
  },
  {
    name: 'DATABASE_URL',
    kind: 'fixed',
    reason: 'built from POSTGRES_* so it always names the bundled Postgres',
  },
  {
    name: 'MIGRATIONS_DIR',
    kind: 'absent',
    reason: 'names a folder inside the image; an empty value resolves to the working directory',
  },
  {
    name: 'SERVICE_VERSION',
    kind: 'absent',
    reason: 'the build stamps the version; an empty value would report an empty version on /health',
  },
  { name: 'SIGNUP_MODE', kind: 'absent', reason: 'refused: any value, even an empty one, stops the boot' },
  { name: 'SIGNUPS_OPEN', kind: 'absent', reason: 'refused: any value, even an empty one, stops the boot' },
  {
    name: 'REQUIRE_EMAIL_VERIFICATION',
    kind: 'absent',
    reason: 'refused: any value, even an empty one, stops the boot',
  },
  { name: 'EMAIL_FROM', kind: 'absent', reason: 'refused: any value, even an empty one, stops the boot' },
  { name: 'SMTP_SECURE', kind: 'absent', reason: 'refused: any value, even an empty one, stops the boot' },
  { name: 'PIGEON_API_KEY', kind: 'absent', reason: 'refused: any value, even an empty one, stops the boot' },
  { name: 'PIGEON_BASE_URL', kind: 'absent', reason: 'refused: any value, even an empty one, stops the boot' },
];

/** Names no scanned source reads that every compose file must still forward. */
const EXTRA: readonly { name: string; reason: string }[] = [
  {
    name: 'NODE_EXTRA_CA_CERTS',
    reason: 'Node reads it at start, so SMTP through nodemailer can trust a private certificate authority',
  },
];

/** The compose services that run openplate-core. Discovery must find exactly these. */
const SERVICES_RUNNING_CORE = [
  { file: 'apps/core/docker/compose.yml', service: 'core' },
  { file: 'docker/topologies/compose.core.yml', service: 'core' },
  { file: 'docker/topologies/compose.full.yml', service: 'core' },
];

const EXCLUDED_NAMES = new Set(EXCLUDED.map((entry) => entry.name));

/** What every compose file must forward, given the names the sources read. */
function requiredNames(scanned: ReadonlySet<string>): string[] {
  const names = new Set([...scanned].filter((name) => !EXCLUDED_NAMES.has(name)));
  for (const extra of EXTRA) names.add(extra.name);
  return [...names].toSorted();
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
const ENV_EXAMPLE = readFileSync(join(CORE_ROOT, '.env.example'), 'utf8');

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

describe('the scan finds what openplate-core reads', () => {
  it('finds a name for every way config.ts, main.ts and version.ts read one', () => {
    // One name per read form: env.X, a helper called with (env, 'X'), a
    // `const X_VARIABLES` list, a `const X_VARIABLE`, main.ts, version.ts.
    for (const name of [
      'HOST',
      'PORT',
      'VAPID_SUBJECT',
      'MEMBER_INVITE_TRIAL',
      'MIGRATIONS_DIR',
      'SERVICE_VERSION',
      // Read in `ai/model-tiers.ts` and `ai/openrouter-routing.ts`, not in config.ts.
      'AI_TIERS_FILE',
      'UPSTREAM_ZDR',
      'UPSTREAM_PROVIDER_ONLY',
    ]) {
      assert.ok(SCANNED.has(name), `the scan missed ${name}`);
    }
    assert.ok(REQUIRED.length >= 50, `only ${REQUIRED.length} names to forward, the scan is broken`);
  });

  it('keeps no stale exclusion: every excluded name is still read', () => {
    const stale = [...EXCLUDED_NAMES].filter((name) => !SCANNED.has(name));
    assert.deepEqual(stale, []);
  });

  it('finds the compose services that run openplate-core, and only those', () => {
    assert.deepEqual(findServicesRunning({ repoRoot: REPO_ROOT, image: 'openplate-core' }), SERVICES_RUNNING_CORE);
  });
});

describe('every compose file that runs openplate-core forwards everything it reads', () => {
  for (const { file, service } of SERVICES_RUNNING_CORE) {
    it(`${file} takes every name from .env`, () => {
      assert.deepEqual(unforwarded({ composeText: composeText(file), service, required: REQUIRED }), []);
    });

    it(`${file} passes no name that must stay out`, () => {
      const present = new Set(
        readEnvironment(findComposeService({ composeText: composeText(file), name: service })).map(
          (entry) => entry.name,
        ),
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
    const text = composeText('docker/topologies/compose.core.yml');
    const withoutLine = text.replace(/^ {6}SMTP_HOST:.*\n/m, '');
    assert.notEqual(withoutLine, text, 'the control found no SMTP_HOST line to remove');
    assert.deepEqual(unforwarded({ composeText: withoutLine, service: 'core', required: REQUIRED }), ['SMTP_HOST']);
  });

  it('a new read that no compose file forwards is caught everywhere', () => {
    const source = `${readFileSync(join(CORE_ROOT, 'src/config.ts'), 'utf8')}\nconst probe = process.env.NOT_FORWARDED;\n`;
    const scanned = new Set([...SCANNED, ...scanEnvironmentReads({ source, language: 'typescript' })]);
    const required = requiredNames(scanned);
    for (const { file, service } of SERVICES_RUNNING_CORE) {
      assert.deepEqual(unforwarded({ composeText: composeText(file), service, required }), ['NOT_FORWARDED'], file);
    }
    assert.deepEqual(missingFromEnvExample({ envExample: ENV_EXAMPLE, required }), ['NOT_FORWARDED']);
  });
});

describe('a deprecated include stub declares no service of its own', () => {
  it('reads compose.sync.yml as a stub and compose.core.yml as a file with services', () => {
    assert.equal(isIncludeStub(composeText('docker/topologies/compose.sync.yml')), true);
    assert.equal(isIncludeStub(composeText('docker/topologies/compose.core.yml')), false);
  });

  it('does not list the stub among the files that run a service', () => {
    assert.deepEqual(
      SERVICES_RUNNING_CORE.filter(({ file }) => file.endsWith('compose.sync.yml')),
      [],
    );
  });

  it('the control: a file with neither services nor include is still refused', () => {
    assert.equal(isIncludeStub('name: x\n'), false);
    assert.throws(() => readComposeServices('name: x\n'), /no top-level services/);
  });
});

describe('the compose-env helper is one file in three places', () => {
  it('all three copies are byte-identical', () => {
    assert.deepEqual(differingCopies(COPIES), []);
  });

  it('the control: one changed byte in one copy is caught', () => {
    assert.deepEqual(differingCopies(withOneByteChanged(COPIES)), ['apps/inference/tests/support/compose-env.ts']);
  });
});
