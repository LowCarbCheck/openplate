/**
 * What a shipped compose file hands a container, and which variable names a
 * service's own sources read. The two compose tests of each app are built on it.
 *
 * THREE COPIES, ONE BODY. `apps/app/tests/compose-env.ts`,
 * `apps/core/tests/unit/compose-env.ts` and
 * `apps/inference/tests/support/compose-env.ts` are the same file, because each
 * app's gate runs only its own tree. Change all three together.
 *
 * NO YAML LIBRARY, on purpose. The compose files follow a narrow line layout
 * that `scripts/quadlet.sh` already depends on: services at indent 2, their
 * keys at indent 4, `environment:` entries at indent 6, one `KEY: value` per
 * line. A reader that accepted more than that layout would let a file drift
 * away from what the Quadlet generator can read. A line it does not recognise
 * inside an `environment:` block is an error, never a skip.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** One service under `services:`: its key and the lines of its block. */
export interface ComposeService {
  name: string;
  lines: readonly string[];
}

/** One `KEY: value` entry of a service's `environment:` block, the value unquoted. */
export interface EnvironmentEntry {
  name: string;
  value: string;
}

/** A variable name read somewhere, as the scanner found it. */
const NAME = '[A-Z][A-Z0-9_]*';

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/** Every service of a compose file, in file order. */
export function readComposeServices(composeText: string): ComposeService[] {
  const lines = composeText.split('\n');
  const start = lines.findIndex((line) => /^services:\s*$/.test(line));
  if (start === -1) throw new Error('the compose file has no top-level services: key');
  const services: ComposeService[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const line of lines.slice(start + 1)) {
    if (indentOf(line) === 0 && !isBlankOrComment(line)) break;
    const key = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (key) {
      current = { name: key[1] ?? '', lines: [] };
      services.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return services;
}

/** The one service called `name`, or an error naming the services there are. */
export function findComposeService(input: { composeText: string; name: string }): ComposeService {
  const services = readComposeServices(input.composeText);
  const service = services.find((candidate) => candidate.name === input.name);
  if (!service) {
    throw new Error(`no service "${input.name}", only ${services.map((each) => each.name).join(', ')}`);
  }
  return service;
}

/**
 * The image repository a service runs, such as `openplate-core`, read from its
 * `image:` line or from the commented `# image:` line a `build:` service keeps
 * beside it (the one `scripts/quadlet.sh` uncomments). `null` for any other image.
 */
export function readServiceImage(service: ComposeService): string | null {
  for (const line of service.lines) {
    const match = /image:\s*ghcr\.io\/lowcarbcheck\/([a-z-]+):/.exec(line);
    if (match) return match[1] ?? null;
  }
  return null;
}

/** One service of one compose file, the file given relative to the repository root. */
export interface ServiceLocation {
  file: string;
  service: string;
}

function composeFilesIn(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => /^compose.*\.ya?ml$/.test(entry))
    .map((entry) => join(directory, entry));
}

/**
 * Every shipped compose file in the repository: `docker/`, `docker/topologies/`
 * and each `apps/<app>/docker/`.
 */
export function findComposeFiles(repoRoot: string): string[] {
  const appsRoot = join(repoRoot, 'apps');
  const appDirectories = existsSync(appsRoot) ? readdirSync(appsRoot).map((app) => join(appsRoot, app, 'docker')) : [];
  return [join(repoRoot, 'docker'), join(repoRoot, 'docker', 'topologies'), ...appDirectories]
    .flatMap(composeFilesIn)
    .map((path) => relative(repoRoot, path))
    .toSorted();
}

/**
 * A deprecated file that only `include:`s another one, such as `compose.sync.yml`. It declares no
 * service of its own, so the file it includes is the one that is read.
 */
export function isIncludeStub(composeText: string): boolean {
  const lines = composeText.split('\n');
  const includes = lines.some((line) => /^include:\s*$/.test(line));
  return includes && !lines.some((line) => /^services:\s*$/.test(line));
}

/** Every service in every shipped compose file that runs `image`, such as `openplate-core`. */
export function findServicesRunning(input: { repoRoot: string; image: string }): ServiceLocation[] {
  return findComposeFiles(input.repoRoot).flatMap((file) => {
    const text = readFileSync(join(input.repoRoot, file), 'utf8');
    if (isIncludeStub(text)) return [];
    return readComposeServices(text)
      .filter((service) => readServiceImage(service) === input.image)
      .map((service) => ({ file, service: service.name }));
  });
}

function unquote(raw: string): string {
  const quoted = /^'(.*)'$/.exec(raw) ?? /^"(.*)"$/.exec(raw);
  return quoted ? (quoted[1] ?? '') : raw;
}

/** The `environment:` block of one service, in file order. */
export function readEnvironment(service: ComposeService): EnvironmentEntry[] {
  const start = service.lines.findIndex((line) => /^ {4}environment:\s*$/.test(line));
  if (start === -1) return [];
  const entries: EnvironmentEntry[] = [];
  const seen = new Set<string>();
  for (const line of service.lines.slice(start + 1)) {
    if (isBlankOrComment(line)) continue;
    if (indentOf(line) <= 4) break;
    const match = /^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/.exec(line);
    if (!match) throw new Error(`service ${service.name}: an environment line this reader does not know: ${line}`);
    const name = match[1] ?? '';
    if (seen.has(name)) throw new Error(`service ${service.name}: ${name} is set twice`);
    seen.add(name);
    entries.push({ name, value: unquote(match[2] ?? '') });
  }
  return entries;
}

/** Whether an entry's value takes anything from the operator's `.env`. */
export function isSettable(value: string): boolean {
  return /\$\{[A-Za-z_]/.test(value);
}

/**
 * The value a container gets when the operator's `.env` is EMPTY: every
 * `${VAR:-default}` and `${VAR-default}` is its default, every bare `${VAR}`
 * is empty, and every `${VAR:?message}` takes the value the caller supplies
 * for it, as the operator must.
 */
export function resolveWithEmptyDotenv(input: { value: string; supplied: ReadonlyMap<string, string> }): string {
  return input.value.replaceAll(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?([-?])([^}]*))?\}/g,
    (_whole, name: string, operator: string | undefined, word: string | undefined) => {
      if (operator === undefined) return '';
      if (operator === '-') return word ?? '';
      const value = input.supplied.get(name);
      if (value === undefined) throw new Error(`${name} is required by the compose file, supply a value for it`);
      return value;
    },
  );
}

/** The whole environment a service gets with an empty `.env`, as a map. */
export function resolveEnvironment(input: {
  entries: readonly EnvironmentEntry[];
  supplied: ReadonlyMap<string, string>;
}): Map<string, string> {
  return new Map(
    input.entries.map((entry) => [
      entry.name,
      resolveWithEmptyDotenv({ value: entry.value, supplied: input.supplied }),
    ]),
  );
}

/** The language a scanned source is written in, which decides what a comment is. */
export type SourceLanguage = 'typescript' | 'shell';

function namesIn(text: string): string[] {
  return [...text.matchAll(new RegExp(`['"](${NAME})['"]`, 'g'))].map((match) => match[1] ?? '');
}

/**
 * Every environment variable name a source reads.
 *
 * TypeScript: `env.NAME` and `process.env.NAME`, `env['NAME']`, a helper
 * called with an env bag and a literal name (`parseBoolean(env, 'NAME', ...)`,
 * `optionalEnv({ env, name: 'NAME' })`), the literals of a
 * `const X_VARIABLE(S) = ...` list, and the keys of a zod `EnvSchema`.
 * Shell: every `${NAME:-...}`, `${NAME-...}`, `${NAME:=...}` and `${NAME:?...}`.
 * Comments are removed first, so a sentence that names a variable is not a read.
 */
export function scanEnvironmentReads(input: { source: string; language: SourceLanguage }): Set<string> {
  const found = new Set<string>();
  if (input.language === 'shell') {
    const code = input.source.replaceAll(/^\s*#.*$/gm, '');
    for (const match of code.matchAll(new RegExp(`\\$\\{(${NAME}):?[-=?]`, 'g'))) found.add(match[1] ?? '');
    return found;
  }
  const code = input.source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  const patterns = [
    new RegExp(`\\benv\\??\\.(${NAME})\\b`, 'g'),
    new RegExp(`\\benv\\[\\s*['"](${NAME})['"]\\s*\\]`, 'g'),
    new RegExp(`\\(\\s*(?:[a-z]\\w*\\.)?env\\s*,\\s*['"](${NAME})['"]`, 'g'),
    new RegExp(`\\bname:\\s*['"](${NAME})['"]`, 'g'),
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.add(match[1] ?? '');
  }
  for (const match of code.matchAll(new RegExp(`\\bconst\\s+${NAME}_VARIABLES?\\b[^=]*=([^;]*);`, 'g'))) {
    for (const name of namesIn(match[1] ?? '')) found.add(name);
  }
  const schema = /\bEnvSchema\s*=\s*z\.object\(\{([\s\S]*?)\n\}\);/.exec(code);
  if (schema) {
    for (const match of (schema[1] ?? '').matchAll(new RegExp(`^ {2}(${NAME}):`, 'gm'))) found.add(match[1] ?? '');
  }
  return found;
}

/** The names every listed source reads, together. */
export function scanFiles(files: readonly { path: string; language: SourceLanguage }[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    for (const name of scanEnvironmentReads({ source: readFileSync(file.path, 'utf8'), language: file.language })) {
      found.add(name);
    }
  }
  return found;
}

/** Whether a `.env.example` has an entry for `name`, set or commented out (`NAME=` or `# NAME=`). */
export function hasEnvExampleEntry(input: { envExample: string; name: string }): boolean {
  return new RegExp(`^\\s*#?\\s*${input.name}=`, 'm').test(input.envExample);
}

/** One shell `${NAME<op>word}` expansion. */
export interface ShellExpansion {
  text: string;
  name: string;
  /** `true` for `:-` and `:=`, where an empty value counts as unset. */
  treatsEmptyAsUnset: boolean;
  word: string;
}

/** Every `${NAME:-word}` and `${NAME-word}` (and the `=` forms) in a script, comments removed. */
export function readShellExpansions(script: string): ShellExpansion[] {
  const code = script.replaceAll(/^\s*#.*$/gm, '');
  return [...code.matchAll(new RegExp(`\\$\\{(${NAME})(:?)([-=])([^}]*)\\}`, 'g'))].map((match) => ({
    text: match[0],
    name: match[1] ?? '',
    treatsEmptyAsUnset: match[2] === ':',
    word: match[4] ?? '',
  }));
}

/** What the shell substitutes for one expansion under `env`, by POSIX rules. */
export function resolveShellExpansion(input: { expansion: ShellExpansion; env: ReadonlyMap<string, string> }): string {
  const value = input.env.get(input.expansion.name);
  if (value === undefined) return input.expansion.word;
  if (value === '' && input.expansion.treatsEmptyAsUnset) return input.expansion.word;
  return value;
}

/** A Dockerfile's build stages: the image each starts from, its alias, and its lines. */
interface DockerStage {
  from: string;
  alias: string | null;
  lines: string[];
}

function readDockerStages(dockerfile: string): DockerStage[] {
  const joined = dockerfile.replaceAll(/\\\n/g, ' ');
  const stages: DockerStage[] = [];
  for (const line of joined.split('\n')) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      stages.push({ from: from[1] ?? '', alias: from[2] ?? null, lines: [] });
      continue;
    }
    stages.at(-1)?.lines.push(line);
  }
  return stages;
}

function substituteDockerVariables(input: { value: string; known: ReadonlyMap<string, string> }): string {
  return input.value.replaceAll(
    /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,
    (_whole, name: string) => input.known.get(name) ?? '',
  );
}

function stageEnvironment(input: { stages: readonly DockerStage[]; index: number }): Map<string, string> {
  const stage = input.stages[input.index];
  if (!stage) return new Map();
  const parentIndex = input.stages.findIndex((candidate, at) => at < input.index && candidate.alias === stage.from);
  const env =
    parentIndex === -1 ? new Map<string, string>() : stageEnvironment({ stages: input.stages, index: parentIndex });
  const args = new Map<string, string>();
  for (const line of stage.lines) {
    const arg = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/.exec(line.trim());
    if (arg) args.set(arg[1] ?? '', unquote((arg[2] ?? '').trim()));
    const envLine = /^ENV\s+(.*)$/.exec(line.trim());
    if (!envLine) continue;
    for (const pair of (envLine[1] ?? '').matchAll(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)/g)) {
      const known = new Map([...args, ...env]);
      env.set(pair[1] ?? '', substituteDockerVariables({ value: unquote(pair[2] ?? ''), known }));
    }
  }
  return env;
}

/**
 * The environment the final stage of a Dockerfile bakes into the image, with
 * the ENV of any earlier stage it builds `FROM` followed, and `$ARG`
 * references resolved to their defaults. Compose layers its `environment:`
 * over exactly this.
 */
export function readImageEnvironment(dockerfile: string): Map<string, string> {
  const stages = readDockerStages(dockerfile);
  return stageEnvironment({ stages, index: stages.length - 1 });
}
