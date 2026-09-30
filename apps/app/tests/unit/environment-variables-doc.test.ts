/**
 * `docs/environment-variables.md` lists every variable the three containers read, and no other.
 *
 * The page is a self-hoster's one list of settings for the app, the sync service (openplate-core)
 * and the inference service. Without a check it rots two ways. A variable added to a config parser
 * never reaches the page, so nobody learns it exists. A variable deleted from a parser stays on the
 * page, and somebody sets a name that nothing reads. This test reads each service's config SOURCE
 * as text, collects the names it reads, and compares them, service by service, with the names the
 * page lists.
 *
 * TEXT, NEVER AN IMPORT. Importing a config module runs its parser against this process's
 * environment, and importing another app's source into this tier would load dependencies this
 * package does not have. A regular expression over the file needs neither.
 *
 * WHAT COUNTS AS A READ. In TypeScript: `env.NAME` and `process.env.NAME`, the app's
 * `optionalEnv('NAME', ...)` family, core's `helper(env, 'NAME', ...)` calls, core's
 * `const X_VARIABLES = [...]` name lists, and the keys of inference's `EnvSchema`. In shell: a
 * `${NAME:-default}` expansion, which is how the inference entrypoint reads its settings. Comments
 * are removed first, so a comment that names a variable reads nothing.
 *
 * WHAT COUNTS AS LISTED. A code span in the FIRST cell of a table row inside that service's `##`
 * section, or a row of the refused-names table whose second cell names that service. A name in a
 * sentence is prose, and a sentence may name a compose file's variable that no container reads.
 *
 * THE CONTROLS at the bottom run the same two checks over a page with one row deleted, a page with
 * an invented row, and a row filed under the wrong service, and they feed the scanner a name that
 * only a comment mentions. None of the checks can pass by seeing nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

type ServiceName = 'app' | 'core' | 'inference';

const SERVICES = ['app', 'core', 'inference'] as const satisfies readonly ServiceName[];

const APP_ROOT = new URL('../../', import.meta.url);

const PAGE_PATH = 'docs/environment-variables.md';

function readText(relativePath: string): string {
  return readFileSync(new URL(relativePath, APP_ROOT), 'utf8');
}

/** Every `.ts` file under `app/config/`, found rather than listed, so a new config module is scanned the day it lands. */
function listConfigModules(): string[] {
  return readdirSync(new URL('app/config/', APP_ROOT), { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `app/config/${entry}`)
    .toSorted();
}

/** The files one service reads its environment in, relative to `apps/app/`. */
interface ScannedSources {
  typescript: readonly string[];
  shell: readonly string[];
}

const SOURCES = {
  app: {
    typescript: [
      ...listConfigModules(),
      'app/lib/content/content.server.ts',
      'app/lib/server-bind.ts',
      'app/lib/logger.ts',
      'server.ts',
    ],
    shell: [],
  },
  core: {
    typescript: ['../core/src/config.ts', '../core/src/main.ts', '../core/src/version.ts'],
    shell: [],
  },
  inference: {
    typescript: ['../inference/src/config.ts'],
    shell: ['../inference/scripts/docker-entrypoint.sh', '../inference/scripts/fetch-weights.sh'],
  },
} satisfies Readonly<Record<ServiceName, ScannedSources>>;

/** The first capture group of every match. */
function captureAll(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '').filter((name) => name !== '');
}

function withoutTypeScriptComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

function withoutShellComments(source: string): string {
  return source.replaceAll(/^\s*#.*$/gm, '');
}

/** `env.NAME`, `process.env.NAME`, `optionalEnv('NAME'`, and core's `helper(env, 'NAME'`. */
const TYPESCRIPT_READS: readonly RegExp[] = [
  /\benv\.([A-Z][A-Z0-9_]*)\b/g,
  /\b(?:optionalEnv|optionalIntEnv|optionalBoolEnv|requireEnv)\(\s*'([A-Z][A-Z0-9_]*)'/g,
  /\(\s*env,\s*'([A-Z][A-Z0-9_]*)'/g,
];

/** Core names a block once, `const MAIL_VARIABLES = ['MAIL_API_URL', ...]`, and reads it as `env[name]`. */
function namesInNameLists(code: string): string[] {
  return captureAll(code, /\bconst [A-Z][A-Z0-9_]*_VARIABLES?\s*=\s*([^;]*);/g).flatMap((list) =>
    captureAll(list, /'([A-Z][A-Z0-9_]*)'/g),
  );
}

/** Inference declares every variable it parses as a key of one zod object. */
function namesInEnvSchema(code: string): string[] {
  const schema = /const EnvSchema = z\.object\(\{([\s\S]*?)\n\}\);/.exec(code)?.[1] ?? '';
  return captureAll(schema, /^ {2}([A-Z][A-Z0-9_]*):/gm);
}

function namesReadByTypeScript(source: string): string[] {
  const code = withoutTypeScriptComments(source);
  return [
    ...TYPESCRIPT_READS.flatMap((pattern) => captureAll(code, pattern)),
    ...namesInNameLists(code),
    ...namesInEnvSchema(code),
  ];
}

function namesReadByShell(source: string): string[] {
  return captureAll(withoutShellComments(source), /\$\{([A-Z][A-Z0-9_]*):?-/g);
}

function collectReads(service: ServiceName): Set<string> {
  const sources = SOURCES[service];
  return new Set([
    ...sources.typescript.flatMap((path) => namesReadByTypeScript(readText(path))),
    ...sources.shell.flatMap((path) => namesReadByShell(readText(path))),
  ]);
}

const SECTION_HEADINGS = {
  app: '## The app',
  core: '## The sync service (openplate-core)',
  inference: '## The inference service (openplate-inference)',
} as const satisfies Readonly<Record<ServiceName, string>>;

const REFUSED_HEADING = '### Refused names';

function headingLevel(line: string): number {
  return /^(#{1,6}) /.exec(line)?.[1]?.length ?? 0;
}

/**
 * The lines under `heading`, up to the next heading of the same level or above.
 *
 * A line inside a code fence is never a heading, so a `# comment` in a shell example cannot end a
 * section early. A heading that is missing throws: a renamed section must fail here rather than
 * check an empty list and pass.
 */
function sectionUnder(options: { markdown: string; heading: string }): string[] {
  const lines = options.markdown.split('\n');
  const start = lines.indexOf(options.heading);
  if (start === -1) throw new Error(`${PAGE_PATH} has no "${options.heading}" heading`);
  const level = headingLevel(options.heading);
  const body: string[] = [];
  let isInFence = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('```')) isInFence = !isInFence;
    const found = isInFence ? 0 : headingLevel(line);
    if (found !== 0 && found <= level) break;
    body.push(line);
  }
  return body;
}

/** The trimmed cells of a table row, or none for any other line and for the `| --- |` rule. */
function cellsOf(line: string): string[] {
  if (!line.startsWith('|')) return [];
  if (/^\|[\s:|-]+$/.test(line)) return [];
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function codeNames(cell: string): string[] {
  return captureAll(cell, /`([A-Z][A-Z0-9_]*)`/g);
}

function refusingService(label: string): ServiceName {
  if (label === 'the app') return 'app';
  if (label === 'the sync service') return 'core';
  if (label === 'the inference service') return 'inference';
  throw new Error(`the refused-names table names "${label}", which is none of the three services`);
}

function listedNames(options: { markdown: string; service: ServiceName }): Set<string> {
  const own = sectionUnder({ markdown: options.markdown, heading: SECTION_HEADINGS[options.service] }).flatMap(
    (line) => codeNames(cellsOf(line)[0] ?? ''),
  );
  const refused = sectionUnder({ markdown: options.markdown, heading: REFUSED_HEADING })
    .map(cellsOf)
    .filter((cells) => codeNames(cells[0] ?? '').length > 0)
    .filter((cells) => refusingService(cells[1] ?? '') === options.service)
    .flatMap((cells) => codeNames(cells[0] ?? ''));
  return new Set([...own, ...refused]);
}

/** One name one service reads or lists, and why the page may disagree about it. */
interface Allowance {
  service: ServiceName;
  name: string;
  reason: string;
}

/** Read by the service and deliberately NOT a row on the page. */
const NOT_SETTINGS: readonly Allowance[] = [
  {
    service: 'app',
    name: 'OPENPLATE_BUILD_SHA',
    reason:
      'A Docker build argument that stamps the commit into the bundle. The page names it in its note on ' +
      'building an image, because it is not a setting of a running container.',
  },
  {
    service: 'inference',
    name: 'RUNTIME_PID',
    reason:
      'A local variable of docker-entrypoint.sh, the process id of llama-server. The script reads it as ' +
      '${RUNTIME_PID:-} only because it runs under `set -u`.',
  },
];

/** A row on the page that Node.js reads itself, so no line of our source ever will. */
const READ_BY_NODE: readonly Allowance[] = [
  {
    service: 'core',
    name: 'NODE_EXTRA_CA_CERTS',
    reason:
      'Node.js reads it at start and adds the certificate authorities in that file to its trust store, which ' +
      'is how the SMTP transport trusts a relay signed by a private CA. The compose files forward it.',
  },
];

function isAllowed(options: { list: readonly Allowance[]; service: ServiceName; name: string }): boolean {
  return options.list.some((entry) => entry.service === options.service && entry.name === options.name);
}

/** Names the service reads that the page does not list, allowances aside. */
function findMissingRows(options: {
  read: ReadonlySet<string>;
  listed: ReadonlySet<string>;
  service: ServiceName;
}): string[] {
  const { read, listed, service } = options;
  return [...read]
    .filter((name) => !listed.has(name))
    .filter((name) => !isAllowed({ list: NOT_SETTINGS, service, name }))
    .toSorted();
}

/** Names the page lists that the service does not read, allowances aside. */
function findStaleRows(options: {
  read: ReadonlySet<string>;
  listed: ReadonlySet<string>;
  service: ServiceName;
}): string[] {
  const { read, listed, service } = options;
  return [...listed]
    .filter((name) => !read.has(name))
    .filter((name) => !isAllowed({ list: READ_BY_NODE, service, name }))
    .toSorted();
}

/** A page with the first listed row of one section deleted, and the name that row carried. */
interface RowRemoval {
  markdown: string;
  name: string;
}

function withoutFirstRow(options: { markdown: string; heading: string }): RowRemoval {
  const lines = options.markdown.split('\n');
  const start = lines.indexOf(options.heading);
  const index = lines.findIndex((line, at) => at > start && codeNames(cellsOf(line)[0] ?? '').length > 0);
  const name = codeNames(cellsOf(lines[index] ?? '')[0] ?? '')[0] ?? '';
  return { markdown: lines.filter((_, at) => at !== index).join('\n'), name };
}

function withExtraRow(options: { markdown: string; heading: string; name: string }): string {
  const table = ['', '| Variable | Default | What it does |', '| --- | --- | --- |', `| \`${options.name}\` | unset | Nothing. |`];
  return options.markdown.replace(options.heading, [options.heading, ...table].join('\n'));
}

const PAGE = readText(PAGE_PATH);

const READS = {
  app: collectReads('app'),
  core: collectReads('core'),
  inference: collectReads('inference'),
} satisfies Readonly<Record<ServiceName, Set<string>>>;

describe('the scanner finds what the three services read', () => {
  it('finds the app names read through each of its four paths', () => {
    for (const name of ['NODE_ENV', 'GATEWAY_URL', 'HOST', 'CONTENT_DIR', 'LOG_LEVEL', 'FOOD_DB_API_KEY']) {
      assert.ok(READS.app.has(name), `the app scan missed ${name}`);
    }
    assert.ok(READS.app.size >= 25, `only ${READS.app.size} app names`);
  });

  it('finds the core names read through env., helper calls, name lists and the refusal list', () => {
    for (const name of [
      'SERVER_SECRET',
      'SIGNUP_MODE',
      'PIGEON_BASE_URL',
      'MEMBER_INVITE_LIFETIME_CAP',
      'TRIAL_TIME_ZONE',
      'TURNSTILE_SITE_KEY',
      'MAIL_OPERATOR_EMAIL',
      'MIGRATIONS_DIR',
      'SERVICE_VERSION',
    ]) {
      assert.ok(READS.core.has(name), `the core scan missed ${name}`);
    }
    assert.ok(READS.core.size >= 60, `only ${READS.core.size} core names`);
  });

  it('finds the inference names in its schema and in both shell scripts', () => {
    for (const name of ['IMAGE_MAX_LONG_EDGE', 'EMBEDDING_RUNTIME_API_KEY', 'NVIDIA_VISIBLE_DEVICES', 'WEIGHTS_MIRROR_BASE']) {
      assert.ok(READS.inference.has(name), `the inference scan missed ${name}`);
    }
    assert.ok(READS.inference.size >= 28, `only ${READS.inference.size} inference names`);
  });

  it('does not take a compose name that core quotes in an error message for a read', () => {
    assert.ok(!READS.core.has('PUBLIC_APP_URL'), 'PUBLIC_APP_URL is a compose-file name, core never reads it');
  });

  it('reads nothing from a comment', () => {
    const source = "/* process.env.GHOST_A */\n// optionalEnv('GHOST_B', 'x')\nconst real = process.env.REAL_ONE;";
    assert.deepEqual(namesReadByTypeScript(source), ['REAL_ONE']);
    assert.deepEqual(namesReadByShell('# ${GHOST_C:-x}\nA="${REAL_TWO:-y}"'), ['REAL_TWO']);
  });
});

describe(`${PAGE_PATH} lists every variable, under the service that reads it`, () => {
  for (const service of SERVICES) {
    const listed = listedNames({ markdown: PAGE, service });

    it(`lists every variable ${service} reads`, () => {
      assert.deepEqual(findMissingRows({ read: READS[service], listed, service }), []);
    });

    it(`lists nothing ${service} no longer reads`, () => {
      assert.deepEqual(findStaleRows({ read: READS[service], listed, service }), []);
    });
  }

  it('files the refused names under the service that refuses them', () => {
    const refusedByCore = listedNames({ markdown: PAGE, service: 'core' });
    assert.ok(refusedByCore.has('SMTP_SECURE'), 'SMTP_SECURE is refused by the sync service');
    assert.ok(listedNames({ markdown: PAGE, service: 'app' }).has('GATEWAY_URL'), 'GATEWAY_URL is refused by the app');
  });
});

describe('the allowances are still true', () => {
  it('names a read variable in every NOT_SETTINGS entry, and none of them is a row', () => {
    for (const entry of NOT_SETTINGS) {
      assert.ok(READS[entry.service].has(entry.name), `${entry.name} is no longer read: delete its entry`);
      assert.ok(!listedNames({ markdown: PAGE, service: entry.service }).has(entry.name), `${entry.name} is a row`);
    }
  });

  it('names a listed variable no source reads in every READ_BY_NODE entry', () => {
    for (const entry of READ_BY_NODE) {
      assert.ok(!READS[entry.service].has(entry.name), `${entry.name} is read by the source now: delete its entry`);
      assert.ok(listedNames({ markdown: PAGE, service: entry.service }).has(entry.name), `${entry.name} is no row`);
    }
  });
});

describe('the checks fire on a broken page', () => {
  it('reports a row deleted from the sync service section as missing', () => {
    const removal = withoutFirstRow({ markdown: PAGE, heading: SECTION_HEADINGS.core });
    assert.notEqual(removal.name, '', 'the core section has no row to delete');
    const listed = listedNames({ markdown: removal.markdown, service: 'core' });
    assert.deepEqual(findMissingRows({ read: READS.core, listed, service: 'core' }), [removal.name]);
  });

  it('reports an invented row in the app section as stale', () => {
    const markdown = withExtraRow({ markdown: PAGE, heading: SECTION_HEADINGS.app, name: 'OPENPLATE_NOT_A_SETTING' });
    const listed = listedNames({ markdown, service: 'app' });
    assert.deepEqual(findStaleRows({ read: READS.app, listed, service: 'app' }), ['OPENPLATE_NOT_A_SETTING']);
  });

  it('reports a sync service variable filed under the inference service as stale there', () => {
    const markdown = withExtraRow({ markdown: PAGE, heading: SECTION_HEADINGS.inference, name: 'SERVER_SECRET' });
    const listed = listedNames({ markdown, service: 'inference' });
    assert.deepEqual(findStaleRows({ read: READS.inference, listed, service: 'inference' }), ['SERVER_SECRET']);
  });

  it('throws when a service heading is renamed, instead of checking an empty section', () => {
    const markdown = PAGE.replace(SECTION_HEADINGS.inference, '## Inference');
    assert.throws(() => listedNames({ markdown, service: 'inference' }), /has no "## The inference service/);
  });
});
