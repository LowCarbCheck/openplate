/**
 * `useAppNavigate` and `#app/components/link` are the ONLY sanctioned ways to
 * navigate.
 *
 * In the installed app the system Back gesture is the only way out of a
 * screen, so it has to mean UP rather than EARLIER, and that is a claim about
 * the shape of the history stack. The stack is shaped in exactly two places:
 * `app/hooks/use-app-navigate.ts` decides push, replace or pop, and
 * `app/components/link.tsx` routes every link click through it. A route that
 * imports react-router's own `useNavigate`, `Link` or `NavLink` bypasses both
 * and pushes unconditionally, which is invisible in a browser tab and is the
 * whole defect on a phone.
 *
 * A SOURCE sweep rather than a render, because the claim is about imports and
 * a render can only ever show one screen's worth of them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('../../app', import.meta.url));

/** The two files that are ALLOWED to reach for react-router's own navigation. */
const SANCTIONED = ['components/link.tsx', 'hooks/use-app-navigate.ts'];

const SWEPT_DIRECTORIES = ['routes', 'components'];

function sourceFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFilesUnder(path));
      continue;
    }
    if (name.endsWith('.ts') || name.endsWith('.tsx')) found.push(path);
  }
  return found;
}

/**
 * The banned imports in one file's source.
 *
 * Matches an `import ... from 'react-router'` statement, then looks for the
 * three identifiers in its specifier list. `Link as RouterLink` counts: the
 * rename is exactly how `link.tsx` itself takes the escape hatch, and nobody
 * else may.
 */
export function bannedNavigationImports(source: string): string[] {
  const banned: string[] = [];
  for (const match of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'react-router'/g)) {
    const specifiers = (match[1] ?? '').split(',');
    for (const specifier of specifiers) {
      const imported = specifier.trim().split(/\s+as\s+/)[0]?.trim() ?? '';
      if (imported === 'useNavigate' || imported === 'Link' || imported === 'NavLink') banned.push(imported);
    }
  }
  return banned;
}

describe('navigation imports', () => {
  it('the sweep can actually see a violation (control)', () => {
    // Without this, a regex that stopped matching would make every assertion
    // below pass against anything at all.
    assert.deepEqual(bannedNavigationImports("import { useLoaderData, useNavigate } from 'react-router';"), [
      'useNavigate',
    ]);
    assert.deepEqual(bannedNavigationImports("import { Link as RouterLink, NavLink } from 'react-router';"), [
      'Link',
      'NavLink',
    ]);
    assert.deepEqual(bannedNavigationImports("import { useFetcher } from 'react-router';"), []);
    // A same-named import from somewhere else is not a violation.
    assert.deepEqual(bannedNavigationImports("import { Link } from '#app/components/link';"), []);
  });

  it('the sweep reads a plausible number of files (control)', () => {
    const files = SWEPT_DIRECTORIES.flatMap((directory) => sourceFilesUnder(join(appDir, directory)));
    assert.ok(files.length > 100, `only swept ${files.length} files`);
  });

  it('no file under app/routes or app/components imports useNavigate, Link or NavLink from react-router', () => {
    const offenders: string[] = [];
    for (const directory of SWEPT_DIRECTORIES) {
      for (const path of sourceFilesUnder(join(appDir, directory))) {
        const relative = path.slice(appDir.length + 1);
        if (SANCTIONED.includes(relative)) continue;
        const banned = bannedNavigationImports(readFileSync(path, 'utf8'));
        if (banned.length > 0) offenders.push(`${relative}: ${banned.join(', ')}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('the two sanctioned files are real, so the allow-list cannot rot into a blanket', () => {
    for (const relative of SANCTIONED) {
      const source = readFileSync(join(appDir, relative), 'utf8');
      assert.ok(source.length > 0, relative);
    }
    // And `link.tsx` is genuinely the one that takes the escape hatch.
    assert.ok(bannedNavigationImports(readFileSync(join(appDir, 'components/link.tsx'), 'utf8')).length > 0);
  });
});
