/**
 * The first-run drawings are not reachable from the app's main entry.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * openplate is an offline-first PWA, and a returning person never sees the
 * onboarding wizard again. Three animated icons that only the very first visit
 * renders have no business in the chunk that boots the diary. `FirstFoodStep`
 * therefore reaches them through `lazy(() => import(...))`, so the "which step
 * is this" check happens before the network does.
 *
 * That is one keystroke from being undone. Turning the `lazy` into a plain
 * `import` at the top of `onboarding.tsx` would look like a tidy-up, would
 * typecheck, would pass every other test, and would silently put the module
 * back into the entry graph. This file is the only thing that notices.
 *
 * ── What is EXECUTED ─────────────────────────────────────────────────────
 *
 * A real transitive walk of STATIC imports, starting at `app/root.tsx` (the
 * module every page loads) and at `app/routes/onboarding.tsx` (the only route
 * that references the drawings at all). A dynamic `import()` is deliberately
 * NOT followed: that is exactly the edge Vite cuts a chunk on, and the whole
 * point of the check. Bare specifiers are not followed either, since a
 * dependency cannot import an app-local file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));
const ANIMATION_MODULE = path.join(APP_DIR, 'components/onboarding/ways-to-log-animation.tsx');
const ONBOARDING_ROUTE_PATH = path.join(APP_DIR, 'routes/onboarding.tsx');

const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Resolves an app-local specifier to a file on disk, or `null` when it is not one. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  const relative =
    specifier.startsWith('#app/') ? path.join(APP_DIR, specifier.slice('#app/'.length))
    : specifier.startsWith('.') ? path.resolve(path.dirname(fromFile), specifier)
    : null;
  if (relative === null) return null;
  if (existsSync(relative) && path.extname(relative) !== '') return relative;
  for (const extension of RESOLVABLE_EXTENSIONS) {
    const candidate = `${relative}${extension}`;
    if (existsSync(candidate)) return candidate;
    const index = path.join(relative, `index${extension}`);
    if (existsSync(index)) return index;
  }
  return null;
}

/**
 * Every STATIC import specifier in a module. A dynamic `import(...)` is not
 * one: `import` is only a static edge when a `from '...'` or a bare
 * `import '...'` follows it, never when a `(` does.
 */
function staticSpecifiers(source: string): string[] {
  const withoutDynamic = source.replace(/\bimport\s*\(/g, 'DYNAMIC_IMPORT(');
  const specifiers: string[] = [];
  const fromPattern = /\bfrom\s+'([^']+)'/g;
  const sidePattern = /^import\s+'([^']+)';$/gm;
  for (const match of withoutDynamic.matchAll(fromPattern)) if (match[1]) specifiers.push(match[1]);
  for (const match of withoutDynamic.matchAll(sidePattern)) if (match[1]) specifiers.push(match[1]);
  return specifiers;
}

/** Every app-local file statically reachable from `entries`. */
function staticGraph(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    if (!RESOLVABLE_EXTENSIONS.includes(path.extname(file))) continue;
    for (const specifier of staticSpecifiers(readFileSync(file, 'utf8'))) {
      const resolved = resolveLocal(file, specifier);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

describe('the walker itself finds what is really there', () => {
  it('follows a static import (the onboarding route reaches its own pure logic)', () => {
    const graph = staticGraph([ONBOARDING_ROUTE_PATH]);
    assert.ok(
      graph.has(path.join(APP_DIR, 'lib/onboarding.ts')),
      'the walker cannot follow a real static edge, so its negative results mean nothing',
    );
    assert.ok(
      graph.has(path.join(APP_DIR, 'lib/ways-to-log.ts')),
      'the route no longer statically reaches the ways catalog',
    );
  });

  it('does not follow a dynamic import', () => {
    assert.deepEqual(staticSpecifiers("const x = lazy(() => import('#app/nope'));\n"), []);
    assert.deepEqual(staticSpecifiers("import x from '#app/yes';\n"), ['#app/yes']);
  });
});

describe('the animated module stays out of the entry graph', () => {
  it('exists, so the assertions below are about a real file', () => {
    assert.ok(existsSync(ANIMATION_MODULE));
  });

  it('is not reachable from app/root.tsx', () => {
    const graph = staticGraph([path.join(APP_DIR, 'root.tsx')]);
    assert.ok(
      !graph.has(ANIMATION_MODULE),
      "the first-run drawings are now in the graph every page loads. See this file's header: they belong behind the lazy() in FirstFoodStep.",
    );
  });

  it('is not reachable statically from the onboarding route either, only through lazy()', () => {
    const graph = staticGraph([ONBOARDING_ROUTE_PATH]);
    assert.ok(
      !graph.has(ANIMATION_MODULE),
      'onboarding.tsx now imports the drawings at the top of the file, which merges them back into the route chunk and defeats the whole point of loading them on the last step',
    );
  });

  it('is reached through a dynamic import, not merely deleted', () => {
    const route = readFileSync(ONBOARDING_ROUTE_PATH, 'utf8');
    assert.match(
      route,
      /lazy\(\(\) => import\('#app\/components\/onboarding\/ways-to-log-animation'\)\)/,
      'the lazy() binding for the drawings is gone, so the cards would render an empty box',
    );
    assert.match(route, /<Suspense fallback=/, 'the lazy component is no longer wrapped in a Suspense boundary');
  });
});
