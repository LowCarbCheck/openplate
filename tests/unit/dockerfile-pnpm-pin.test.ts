/**
 * The global pnpm the image build installs, against the version `package.json` declares as its
 * `packageManager`.
 *
 * `Dockerfile.pnpm` line 14 runs `npm i -g pnpm@<version>`. If that version is newer than the
 * `packageManager` field, the newer pnpm self-manages: it downloads the DECLARED version as a
 * separate binary (`@pnpm/linux-arm64` on that architecture) the first time it runs. No musl build
 * of that binary exists, so it segfaults on arm64 alpine before printing a single line, and
 * `pnpm i --frozen-lockfile` fails with no output at all. Pinning the global install to the exact
 * `packageManager` version means pnpm never reaches for a second binary.
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
const PackageJsonSchema = z.object({ packageManager: z.string() });

/**
 * The pnpm version pinned by `RUN npm i -g pnpm@<version>` in a Dockerfile string, or `null` if the
 * install line carries no version at all (a floating `npm i -g pnpm`).
 */
function readDockerfilePnpmPin(dockerfile: string): string | null {
  const match = /^RUN npm i -g pnpm@(\S+)$/m.exec(dockerfile);
  return match?.[1] ?? null;
}

/** The version after `pnpm@` in `package.json`'s `packageManager` field. */
function readPackageManagerVersion(packageJson: string): string {
  const { packageManager } = PackageJsonSchema.parse(JSON.parse(packageJson));
  const match = /^pnpm@(\S+)$/.exec(packageManager);
  if (!match?.[1]) {
    throw new Error(`package.json packageManager field is not a pinned pnpm version: ${packageManager}`);
  }
  return match[1];
}

/**
 * Throws unless the Dockerfile's global pnpm install is pinned to exactly the version
 * `package.json` declares. This is the check the repository's own files must pass below; the
 * `describe` block right after this one proves it can also fail.
 */
function assertDockerfilePinsPackageManager(dockerfile: string, packageJson: string): void {
  const pinned = readDockerfilePnpmPin(dockerfile);
  if (pinned === null) {
    throw new Error('Dockerfile carries no pnpm version pin (`npm i -g pnpm` with no `@<version>`)');
  }
  const declared = readPackageManagerVersion(packageJson);
  if (pinned !== declared) {
    throw new Error(`Dockerfile pins pnpm@${pinned} but package.json declares pnpm@${declared}`);
  }
}

describe('readDockerfilePnpmPin', () => {
  it('reads the pinned version off a real install line', () => {
    assert.equal(readDockerfilePnpmPin('FROM node:22-alpine\nRUN npm i -g pnpm@11.1.1\nCOPY . /app'), '11.1.1');
  });

  it('a floating install with no version reads as null', () => {
    assert.equal(readDockerfilePnpmPin('FROM node:22-alpine\nRUN npm i -g pnpm\nCOPY . /app'), null);
  });
});

describe('assertDockerfilePinsPackageManager', () => {
  it('passes when the two versions agree', () => {
    assert.doesNotThrow(() =>
      assertDockerfilePinsPackageManager('RUN npm i -g pnpm@11.1.1', '{"packageManager":"pnpm@11.1.1"}'),
    );
  });

  it('a Dockerfile with no pin at all throws', () => {
    // Control: this is the exact regression the pin exists to catch. `npm i -g pnpm` with no
    // version installs whatever npm resolves as latest, which is how this broke in the first place.
    assert.throws(
      () => assertDockerfilePinsPackageManager('RUN npm i -g pnpm', '{"packageManager":"pnpm@11.1.1"}'),
      /carries no pnpm version pin/,
    );
  });

  it('a pin that disagrees with package.json throws', () => {
    // Control: proves the equality check itself can fail, not just the presence check above.
    assert.throws(
      () => assertDockerfilePinsPackageManager('RUN npm i -g pnpm@0.0.0', '{"packageManager":"pnpm@11.1.1"}'),
      /pins pnpm@0\.0\.0 but package\.json declares pnpm@11\.1\.1/,
    );
  });
});

describe('the repository files', () => {
  const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile.pnpm'), 'utf8');
  const packageJson = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');

  it("Dockerfile.pnpm's global pnpm install matches package.json's packageManager", () => {
    assert.doesNotThrow(() => assertDockerfilePinsPackageManager(dockerfile, packageJson));
  });
});
