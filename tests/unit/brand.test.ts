/**
 * The brand constants (`app/lib/brand.ts`) — M146 spec 01.
 *
 * Three properties, each of which fails silently in production if it drifts:
 *
 * 1. **The repository URL is written down exactly once in `app/`.** A fork is
 *    supposed to be one edit; a second hand-written `github.com/...` in a
 *    component would leave the forker advertising OUR repository as theirs from
 *    a surface they never found. Nothing else in the repo can catch that.
 * 2. **The licence URL is derived from the repository URL**, so the same one
 *    edit moves it.
 * 3. **`APP_VERSION` equals `package.json`'s `version`.** It is a hand-copied
 *    string (importing the manifest would inline every dependency name into the
 *    browser bundle to read one field), so it needs a guard: a stale version on
 *    `/settings/about` makes every bug report point at the wrong build.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { z } from 'zod';

import { APP_VERSION, REPO_LICENSE_URL, REPO_URL } from '../../app/lib/brand';

const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** Every source file under `app/`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('REPO_URL', () => {
  it('is the openplate repository', () => {
    assert.equal(REPO_URL, 'https://github.com/LowCarbCheck/openplate');
  });

  it('appears as a literal in exactly one file — a fork is one edit', () => {
    const carriers = sourceFiles(APP_DIR).filter((path) => readFileSync(path, 'utf8').includes(REPO_URL));
    assert.deepEqual(
      carriers.map((path) => path.slice(APP_DIR.length + 1)),
      ['lib/brand.ts'],
    );
  });

  it('derives the licence URL, so the fork edit carries it too', () => {
    assert.ok(REPO_LICENSE_URL.startsWith(`${REPO_URL}/`));
    assert.match(REPO_LICENSE_URL, /\/LICENSE$/);
  });
});

describe('APP_VERSION', () => {
  it('matches package.json — the version shown on /settings/about is the build', () => {
    const manifest = z
      .object({ version: z.string() })
      .parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')));
    assert.equal(APP_VERSION, manifest.version);
  });
});
