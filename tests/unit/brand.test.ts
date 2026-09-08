/**
 * The brand constants (`app/lib/brand.ts`) — M146 spec 01.
 *
 * Two properties, each of which fails silently in production if it drifts:
 *
 * 1. **The repository URL is written down exactly once in `app/`.** A fork is
 *    supposed to be one edit; a second hand-written `github.com/...` in a
 *    component would leave the forker advertising OUR repository as theirs from
 *    a surface they never found. Nothing else in the repo can catch that.
 * 2. **The licence URL is derived from the repository URL**, so the same one
 *    edit moves it.
 *
 * A third one used to live here: `APP_VERSION` equals `package.json`'s
 * `version`. That pin is gone with the literal it pinned (M203). The version is
 * injected by the build now (`app/lib/build-info.ts`), read straight out of the
 * manifest by `vite.config.ts`, so there is no second copy left to drift.
 * `tests/unit/build-info.test.ts` covers what replaced it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { REPO_LICENSE_URL, REPO_URL } from '../../app/lib/brand';

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
