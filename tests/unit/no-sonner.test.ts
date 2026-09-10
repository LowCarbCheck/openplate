/**
 * The toast layer is gone, and stays gone.
 *
 * The owner's decision on 2026-09-10 was that every notification rides in the
 * app header's title slot (`#app/components/header-status`). A stray `sonner`
 * import would not fail a build, a typecheck or any other test in this suite:
 * the package would simply be reinstalled and a floating toast would come back
 * on one screen, over the bottom nav, while the rest of the app spoke through
 * the header. This file is the only thing that notices.
 *
 * Two halves, because either one alone is a hole. The dependency can be gone
 * from `package.json` while a source file still imports it (a broken build, but
 * only at build time), and a source file can be clean while the dependency
 * lingers in the tree for the next person to reach for.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const APP = path.join(REPO, 'app');

/** Every source file under `app/`, recursively. Locale JSON included: a key can name a dead library too. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|css|json)$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe('sonner is gone', () => {
  it('is not a dependency of any kind', () => {
    const manifest = readFileSync(path.join(REPO, 'package.json'), 'utf8');
    // The raw text, not a parsed field list: a `pnpm.overrides` entry or a
    // `resolutions` block would name it too, and neither is a dependency field.
    assert.equal(
      manifest.includes('sonner'),
      false,
      'package.json still names sonner, so the package is still in the tree',
    );
  });

  it('is named nowhere under app/', () => {
    const offenders = sourceFiles(APP)
      .filter((file) => readFileSync(file, 'utf8').includes('sonner'))
      .map((file) => path.relative(REPO, file));
    assert.deepEqual(offenders, [], `sonner is still named in: ${offenders.join(', ')}`);
  });

  it('has left no toaster mount behind', () => {
    const offenders = sourceFiles(APP)
      .filter((file) => /Toaster|data-sonner|\.toaster\b/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(REPO, file));
    assert.deepEqual(offenders, [], `a toast host survives in: ${offenders.join(', ')}`);
  });

  it('found files to check at all', () => {
    // CONTROL for the three sweeps above: a zero-file walk would pass every one
    // of them while proving nothing.
    const files = sourceFiles(APP);
    assert.ok(files.length > 200, `expected the whole app tree, walked ${files.length} files`);
    assert.ok(
      files.some((file) => file.endsWith(path.join('app', 'root.tsx'))),
      'the walk missed app/root.tsx, which is where the toast host used to be mounted',
    );
  });
});
