/**
 * How the image build installs pnpm, against the version `package.json` declares as its
 * `packageManager`.
 *
 * History: the image once ran `npm i -g pnpm@<version>`. When that global pnpm was newer than the
 * `packageManager` field, it self-managed: it downloaded the DECLARED version as a separate binary
 * (`@pnpm/linux-arm64` on that architecture) the first time it ran. No musl build of that binary
 * exists, so it segfaulted on arm64 alpine before printing a single line, and
 * `pnpm i --frozen-lockfile` failed with no output at all. That blocked every publish from
 * 2026-08-06 to 2026-08-18. The fix then was to pin the global install to exactly the
 * `packageManager` version, and this test held the two equal.
 *
 * Corepack installs the version `packageManager` declares itself, so there is no global pnpm to
 * disagree with it and no second binary to fetch. This test now holds `Dockerfile.pnpm` to that
 * path: no `npm i -g pnpm`, no pnpm version literal, `corepack enable` then
 * `corepack prepare --activate` (or `corepack install`), and in every stage that runs that step,
 * `WORKDIR /app` and a copy of `package.json` come first. Without them corepack runs in `/` with
 * no `package.json` and falls back to its own default pnpm. `package.json` must pin an exact
 * `pnpm@<x.y.z>`, since a range would let corepack pick a version.
 *
 * Every assertion here is paired with a CONTROL: the same check fed a deliberately broken input,
 * which must fail. A check that cannot fail records nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { z } from 'zod';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Only the field this test weighs. `package.json` carries plenty more. */
const PackageJsonSchema = z.object({ packageManager: z.string().optional() });

/** One Dockerfile instruction with its continuation lines joined. */
interface Instruction {
  readonly keyword: string;
  readonly args: string;
  /** 1-based line number where the instruction starts. */
  readonly line: number;
}

/**
 * Splits a Dockerfile into instructions. Comment lines are dropped (also inside a continuation),
 * and lines ending in a backslash are joined to the next one.
 */
function parseInstructions(dockerfile: string): Instruction[] {
  const instructions: Instruction[] = [];
  let pending: { text: string; line: number } | null = null;
  for (const [index, rawLine] of dockerfile.split('\n').entries()) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const isContinued = trimmed.endsWith('\\');
    const body = isContinued ? trimmed.slice(0, -1).trim() : trimmed;
    pending = pending ? { text: `${pending.text} ${body}`, line: pending.line } : { text: body, line: index + 1 };
    if (isContinued) continue;
    const [keyword = '', ...rest] = pending.text.split(/\s+/);
    instructions.push({ keyword: keyword.toUpperCase(), args: rest.join(' '), line: pending.line });
    pending = null;
  }
  return instructions;
}

/** Groups instructions into build stages. Each stage starts at its `FROM`. */
function splitStages(instructions: readonly Instruction[]): Instruction[][] {
  const stages: Instruction[][] = [];
  for (const instruction of instructions) {
    if (instruction.keyword === 'FROM' || stages.length === 0) stages.push([]);
    stages.at(-1)?.push(instruction);
  }
  return stages;
}

const COREPACK_ENABLE = /\bcorepack\s+enable\b/;
const COREPACK_STEP = /\bcorepack\s+(prepare|install)\b/;
const NPM_INSTALLS_PNPM = /\bnpm\s+(i|install|add)\b[^|&;]*\bpnpm\b/;
const PNPM_VERSION_LITERAL = /\bpnpm@\S/;

function isWorkdirApp(instruction: Instruction): boolean {
  return instruction.keyword === 'WORKDIR' && /^\/app\/?$/.test(instruction.args);
}

/**
 * True when a COPY puts `package.json` into `/app`: a source of `package.json` (or the whole
 * context `.`) and a destination under `/app`, or a relative destination after `WORKDIR /app`.
 */
function copiesPackageJsonIntoApp(opts: { instruction: Instruction; isInApp: boolean }): boolean {
  const { instruction, isInApp } = opts;
  if (instruction.keyword !== 'COPY') return false;
  const paths = instruction.args.split(/\s+/).filter((token) => !token.startsWith('--'));
  const destination = paths.at(-1);
  const sources = paths.slice(0, -1);
  if (destination === undefined || sources.length === 0) return false;
  const hasPackageJson = sources.some((source) => /(^|\/)package\.json$/.test(source) || /^\.\/?$/.test(source));
  const isAppDestination = destination.startsWith('/app') || (isInApp && !destination.startsWith('/'));
  return hasPackageJson && isAppDestination;
}

/** The ordering faults of one stage's corepack install steps. */
function findStageOrderViolations(stage: readonly Instruction[]): string[] {
  const violations: string[] = [];
  let hasWorkdirApp = false;
  let hasPackageJson = false;
  let hasEnable = false;
  for (const instruction of stage) {
    if (isWorkdirApp(instruction)) hasWorkdirApp = true;
    if (copiesPackageJsonIntoApp({ instruction, isInApp: hasWorkdirApp })) hasPackageJson = true;
    if (instruction.keyword !== 'RUN') continue;
    const stepIndex = instruction.args.search(COREPACK_STEP);
    const enableIndex = instruction.args.search(COREPACK_ENABLE);
    if (stepIndex === -1) {
      if (enableIndex !== -1) hasEnable = true;
      continue;
    }
    const at = `line ${instruction.line}`;
    if (!hasEnable && (enableIndex === -1 || enableIndex > stepIndex)) {
      violations.push(`${at}: corepack prepare or install runs before corepack enable`);
    }
    if (/\bcorepack\s+prepare\b/.test(instruction.args) && !instruction.args.includes('--activate')) {
      violations.push(`${at}: corepack prepare runs without --activate`);
    }
    if (!hasWorkdirApp) violations.push(`${at}: corepack runs before WORKDIR /app`);
    if (!hasPackageJson) violations.push(`${at}: corepack runs before package.json is copied`);
    if (enableIndex !== -1) hasEnable = true;
  }
  return violations;
}

/** Every way a Dockerfile string breaks the corepack install path, as named messages. */
function findDockerfilePnpmViolations(dockerfile: string): string[] {
  const instructions = parseInstructions(dockerfile);
  const runs = instructions.filter((instruction) => instruction.keyword === 'RUN');
  const violations: string[] = [];
  for (const instruction of instructions) {
    if (instruction.keyword === 'RUN' && NPM_INSTALLS_PNPM.test(instruction.args)) {
      violations.push(`line ${instruction.line}: installs pnpm with npm`);
    }
    if (PNPM_VERSION_LITERAL.test(instruction.args)) {
      violations.push(`line ${instruction.line}: hard-codes a pnpm version`);
    }
  }
  if (!runs.some((run) => COREPACK_ENABLE.test(run.args))) violations.push('does not run corepack enable');
  if (!runs.some((run) => COREPACK_STEP.test(run.args))) violations.push('never runs corepack prepare or install');
  for (const stage of splitStages(instructions)) violations.push(...findStageOrderViolations(stage));
  return violations;
}

/**
 * Throws unless the Dockerfile installs pnpm only through corepack, in the right order. This is
 * the check the repository's own file must pass below; the controls prove it can also fail.
 */
function assertDockerfileInstallsPnpmThroughCorepack(dockerfile: string): void {
  const violations = findDockerfilePnpmViolations(dockerfile);
  if (violations.length > 0) throw new Error(`Dockerfile.pnpm:\n${violations.join('\n')}`);
}

/** Throws unless `packageManager` is an exact `pnpm@<x.y.z>`. Returns the version. */
function assertPackageManagerPinned(packageJson: string): string {
  const { packageManager } = PackageJsonSchema.parse(JSON.parse(packageJson));
  if (packageManager === undefined) throw new Error('package.json has no packageManager field');
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager);
  if (!match?.[1]) {
    throw new Error(`package.json packageManager is not an exact pnpm@<x.y.z>: ${packageManager}`);
  }
  return match[1];
}

/** A Dockerfile that follows every rule, the base the controls each break in one place. */
const GOOD_DOCKERFILE = [
  '# History: this image once ran npm i -g pnpm@11.1.1, see the test header.',
  'FROM node:24-alpine AS dependencies-env',
  'WORKDIR /app',
  'COPY ./package.json pnpm-lock.yaml /app/',
  'RUN corepack enable && \\',
  '    corepack prepare --activate',
  'COPY . /app',
  '',
  'FROM dependencies-env AS build-env',
  'RUN pnpm build',
].join('\n');

function assertRefused(dockerfile: string, message: RegExp): void {
  assert.throws(() => assertDockerfileInstallsPnpmThroughCorepack(dockerfile), message);
}

describe('assertDockerfileInstallsPnpmThroughCorepack', () => {
  it('passes a corepack install after WORKDIR /app and the package.json copy', () => {
    assert.doesNotThrow(() => assertDockerfileInstallsPnpmThroughCorepack(GOOD_DOCKERFILE));
  });

  it('passes corepack install in place of corepack prepare --activate', () => {
    const dockerfile = GOOD_DOCKERFILE.replace('corepack prepare --activate', 'corepack install');
    assert.doesNotThrow(() => assertDockerfileInstallsPnpmThroughCorepack(dockerfile));
  });

  it('passes a relative package.json copy after WORKDIR /app', () => {
    const dockerfile = GOOD_DOCKERFILE.replace('COPY ./package.json pnpm-lock.yaml /app/', 'COPY package.json ./');
    assert.doesNotThrow(() => assertDockerfileInstallsPnpmThroughCorepack(dockerfile));
  });

  it('control: the old npm i -g pnpm@<version> install is refused on both counts', () => {
    const dockerfile = 'FROM node:22-alpine\nWORKDIR /app\nCOPY package.json ./\nRUN npm i -g pnpm@11.1.1\n';
    const violations = findDockerfilePnpmViolations(dockerfile);
    assert.ok(
      violations.some((v) => v.endsWith('installs pnpm with npm')),
      violations.join('\n'),
    );
    assert.ok(
      violations.some((v) => v.endsWith('hard-codes a pnpm version')),
      violations.join('\n'),
    );
    assert.ok(violations.includes('does not run corepack enable'), violations.join('\n'));
    assert.ok(violations.includes('never runs corepack prepare or install'), violations.join('\n'));
  });

  it('control: a floating npm install of pnpm with no version is refused', () => {
    assertRefused(`${GOOD_DOCKERFILE}\nRUN npm install --global pnpm\n`, /installs pnpm with npm/);
  });

  it('control: a version literal on corepack prepare is refused', () => {
    const dockerfile = GOOD_DOCKERFILE.replace(
      'corepack prepare --activate',
      'corepack prepare pnpm@11.5.1 --activate',
    );
    assertRefused(dockerfile, /line 5: hard-codes a pnpm version/);
  });

  it('control: a dist-tag literal such as pnpm@latest is refused', () => {
    const dockerfile = GOOD_DOCKERFILE.replace(
      'corepack prepare --activate',
      'corepack prepare pnpm@latest --activate',
    );
    assertRefused(dockerfile, /hard-codes a pnpm version/);
  });

  it('control: a Dockerfile without corepack enable is refused', () => {
    const dockerfile = GOOD_DOCKERFILE.replace('corepack enable && \\', '\\');
    assertRefused(dockerfile, /does not run corepack enable/);
  });

  it('control: corepack enable after corepack prepare is refused', () => {
    const dockerfile = GOOD_DOCKERFILE.replace(
      'RUN corepack enable && \\\n    corepack prepare --activate',
      'RUN corepack prepare --activate && corepack enable',
    );
    assertRefused(dockerfile, /corepack prepare or install runs before corepack enable/);
  });

  it('control: a Dockerfile with corepack enable but no prepare or install is refused', () => {
    const dockerfile = GOOD_DOCKERFILE.replace(
      'corepack enable && \\\n    corepack prepare --activate',
      'corepack enable',
    );
    assertRefused(dockerfile, /never runs corepack prepare or install/);
  });

  it('control: corepack prepare without --activate is refused', () => {
    const dockerfile = GOOD_DOCKERFILE.replace('corepack prepare --activate', 'corepack prepare');
    assertRefused(dockerfile, /corepack prepare runs without --activate/);
  });

  it('control: corepack before WORKDIR /app is refused', () => {
    const dockerfile = [
      'FROM node:24-alpine',
      'COPY package.json /app/',
      'RUN corepack enable && corepack prepare --activate',
      'WORKDIR /app',
    ].join('\n');
    assertRefused(dockerfile, /line 3: corepack runs before WORKDIR \/app/);
  });

  it('control: corepack before the package.json copy is refused', () => {
    const dockerfile = [
      'FROM node:24-alpine',
      'WORKDIR /app',
      'RUN corepack enable && corepack prepare --activate',
      'COPY package.json ./',
    ].join('\n');
    assertRefused(dockerfile, /line 3: corepack runs before package\.json is copied/);
  });

  it('control: a package.json copied outside /app does not count', () => {
    const dockerfile = [
      'FROM node:24-alpine',
      'COPY package.json /tmp/',
      'WORKDIR /app',
      'RUN corepack enable && corepack prepare --activate',
    ].join('\n');
    assertRefused(dockerfile, /corepack runs before package\.json is copied/);
  });

  it('control: WORKDIR and package.json from an earlier stage do not carry over', () => {
    // Each stage is judged on its own, the way the spec's awk check resets at every FROM.
    const dockerfile = [
      'FROM node:24-alpine AS first',
      'WORKDIR /app',
      'COPY package.json ./',
      'RUN corepack enable && corepack prepare --activate',
      'FROM node:24-alpine AS second',
      'RUN corepack enable && corepack install',
    ].join('\n');
    const violations = findDockerfilePnpmViolations(dockerfile);
    assert.deepEqual(violations, [
      'line 6: corepack runs before WORKDIR /app',
      'line 6: corepack runs before package.json is copied',
    ]);
  });
});

describe('assertPackageManagerPinned', () => {
  it('reads an exact pnpm@<x.y.z>', () => {
    assert.equal(assertPackageManagerPinned('{"packageManager":"pnpm@11.5.1"}'), '11.5.1');
  });

  it('control: a package.json with no packageManager is refused', () => {
    assert.throws(() => assertPackageManagerPinned('{}'), /has no packageManager field/);
  });

  it('control: a major-only pnpm@11 is refused', () => {
    assert.throws(
      () => assertPackageManagerPinned('{"packageManager":"pnpm@11"}'),
      /not an exact pnpm@<x\.y\.z>: pnpm@11$/,
    );
  });

  it('control: a caret range is refused', () => {
    assert.throws(() => assertPackageManagerPinned('{"packageManager":"pnpm@^11.5.1"}'), /not an exact pnpm@<x\.y\.z>/);
  });

  it('control: a different package manager is refused', () => {
    assert.throws(() => assertPackageManagerPinned('{"packageManager":"npm@10.9.0"}'), /not an exact pnpm@<x\.y\.z>/);
  });
});

describe('the repository files', () => {
  const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile.pnpm'), 'utf8');
  const packageJson = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');

  it('Dockerfile.pnpm installs pnpm only through corepack, after WORKDIR /app and package.json', () => {
    assert.doesNotThrow(() => assertDockerfileInstallsPnpmThroughCorepack(dockerfile));
  });

  it('package.json pins an exact pnpm@<x.y.z> as its packageManager', () => {
    assert.doesNotThrow(() => assertPackageManagerPinned(packageJson));
  });
});
