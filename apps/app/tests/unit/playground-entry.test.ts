/**
 * THE STATES PLAYGROUND IS DEV ONLY, AND STAYS OUT OF EVERYTHING THAT SHIPS.
 *
 * ── WHY THESE FOUR CHECKS ────────────────────────────────────────────────
 *
 * The playground is `playground.html` at the app root plus `app/playground/`,
 * served by its own config (`vite.playground.config.ts`). It reaches a user
 * only if something that ships learns about it. That can happen four ways, and
 * each has a check here:
 *
 * (a) A file outside `app/playground/` imports from it. The production bundle
 *     then pulls in the page, its fixtures and every section.
 * (b) The route table names it. `app/routes.ts` would serve it at an address.
 * (c) The production Vite config names it, for example through a multi-page
 *     `input`. The build would emit the page.
 * (d) A registry row stops being a literal `import('./sections/<id>')`. Vite
 *     can no longer split that section into its own chunk, and the registry's
 *     lazy loading is only a comment.
 *
 * ── THE ROUTE `/dev/playground` IS A DIFFERENT THING ─────────────────────
 *
 * `app/routes/dev.playground.tsx` (a review page for two component variants,
 * with `app/components/playground/`) predates this page and has nothing to do
 * with it. Its name must not trip check (b), so the pattern matches the
 * playground's own entry points and not the word. A control below holds that.
 *
 * ── EVERY CHECK CAN FAIL ─────────────────────────────────────────────────
 *
 * Each rule is a pure function. The real tree is run through it, and so is a
 * small input that is wrong on purpose, which must fail. The first test of each
 * pair is the control: a check that only ever sees clean input proves nothing.
 *
 * Inputs that make each one fail on the real tree, tried once by hand:
 * (a) add `import '#app/playground/app';` to any file under `app/routes/`;
 * (b) add `route('/playground', 'playground/app.tsx')` to `app/routes.ts`;
 * (c) add `build: { rolldownOptions: { input: 'playground.html' } }` to `vite.config.ts`;
 * (d) change one `load` in `app/playground/app.tsx` to `load: () => import(path)`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePath } from '../e2e/select';

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A file of the app, as the text a check reads. `path` is relative to `apps/app`, with forward slashes. */
function readAppFile(path: string): string {
  return readFileSync(`${APP_ROOT}/${path}`, 'utf8');
}

/** Every source file under a folder of the app, as paths relative to `apps/app`. */
function listSourceFiles(folder: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(`${APP_ROOT}/${folder}`, { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) files.push(path);
  }
  return files;
}

////////////////////////////////////////////////////////////////////////////////
// (a) Nothing outside app/playground/ imports from it
////////////////////////////////////////////////////////////////////////////////

/** Module specifiers in `import x from 'y'`, `import 'y'`, `import('y')` and `export ... from 'y'`. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])([^'"`]+)\1/g;

/** True for the playground's folder and anything in it. */
function isPlaygroundPath(path: string): boolean {
  return path === 'app/playground' || path.startsWith('app/playground/');
}

/**
 * The file a specifier points at, relative to `apps/app`, or null for a package.
 * `#app/x` is `app/x`; a relative specifier is resolved against the importing file.
 */
function resolveSpecifier({ file, specifier }: { file: string; specifier: string }): string | null {
  if (specifier.startsWith('#app/')) return `app/${specifier.slice('#app/'.length)}`;
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(file), specifier));
  return null;
}

/** True when the source imports something that lives under `app/playground/`, by alias or by relative path. */
function importsPlayground({ file, source }: { file: string; source: string }): boolean {
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[2];
    if (specifier === undefined) continue;
    const target = resolveSpecifier({ file, specifier });
    if (target !== null && isPlaygroundPath(target)) return true;
  }
  return false;
}

describe('(a) nothing outside app/playground/ imports the playground', () => {
  it('control: the check sees an alias import, a relative import, a dynamic import and a re-export', () => {
    const file = 'app/routes/dashboard.tsx';
    assert.ok(importsPlayground({ file, source: "import { PlaygroundApp } from '#app/playground/app';" }));
    assert.ok(importsPlayground({ file, source: "import { PlaygroundApp } from '../playground/app';" }));
    assert.ok(importsPlayground({ file, source: "const page = await import('#app/playground/app');" }));
    assert.ok(importsPlayground({ file, source: "export * from '../playground';" }));
    assert.ok(importsPlayground({ file, source: "import '#app/playground/main';" }));
  });

  it('control: the review page folder app/components/playground is not the playground', () => {
    const file = 'app/routes/dev.playground.tsx';
    assert.ok(!importsPlayground({ file, source: "import { A } from '#app/components/playground/add-food-actions-variants';" }));
    assert.ok(!importsPlayground({ file, source: "import { A } from '../components/playground/add-food-actions-variants';" }));
    assert.ok(!importsPlayground({ file: 'app/components/x.tsx', source: "import { A } from './playground/y';" }));
  });

  it('holds for every file under app/ outside app/playground/', () => {
    const files = listSourceFiles('app').filter((file) => !isPlaygroundPath(file));
    assert.ok(files.length > 200, `only ${files.length} files read, so the walk found too little to prove anything`);
    const offenders = files.filter((file) => importsPlayground({ file, source: readAppFile(file) }));
    assert.deepEqual(offenders, []);
  });

  it('control: the playground folder itself is walked and does import itself', () => {
    const own = listSourceFiles('app/playground');
    assert.ok(own.includes('app/playground/app.tsx'));
    assert.ok(own.some((file) => importsPlayground({ file, source: readAppFile(file) })));
  });
});

////////////////////////////////////////////////////////////////////////////////
// (b) and (c) The route table and the production config do not name it
////////////////////////////////////////////////////////////////////////////////

/**
 * The playground's entry points, as text in a file that ships: its HTML page,
 * its folder (as `app/playground`, `#app/playground` or a relative `./playground`)
 * or a route at `/playground`. NOT the word on its own, because the unrelated
 * `/dev/playground` route has to pass.
 */
const PLAYGROUND_ENTRY = /playground\.html|\bapp\/playground\b|\.\/playground\b|['"`]\/playground['"`/]/;

describe('(b) the route table does not mention the playground', () => {
  it('control: the pattern matches every way a route could name it', () => {
    assert.ok(PLAYGROUND_ENTRY.test("route('/playground', 'playground/app.tsx')"));
    assert.ok(PLAYGROUND_ENTRY.test("route('/x', '../playground/main.tsx')"));
    assert.ok(PLAYGROUND_ENTRY.test("route('/x', '#app/playground/app.tsx')"));
    assert.ok(PLAYGROUND_ENTRY.test("route('/x', 'app/playground/app.tsx')"));
    assert.ok(PLAYGROUND_ENTRY.test('serve playground.html'));
  });

  it('control: the older /dev/playground review route does not match', () => {
    assert.ok(!PLAYGROUND_ENTRY.test("route('/dev/playground', 'routes/dev.playground.tsx')"));
  });

  it('app/routes.ts has no entry of the playground, and still has the review route (so the control above is real)', () => {
    const routes = readAppFile('app/routes.ts');
    assert.ok(routes.includes('/dev/playground'), 'the review route moved; update the control above');
    assert.ok(!PLAYGROUND_ENTRY.test(routes));
  });
});

describe('(c) the production build does not know the playground', () => {
  it('control: the word is found in a config that names the page', () => {
    assert.ok(/playground/i.test("build: { rolldownOptions: { input: { playground: 'playground.html' } } }"));
  });

  it('vite.config.ts does not contain the word at all', () => {
    // The whole word, not only `playground.html`: the production config has no reason to know the
    // playground exists, so any mention is the start of a leak. The playground's own config
    // imports this one, never the other way round.
    assert.ok(!/playground/i.test(readAppFile('vite.config.ts')));
  });

  it('react-router.config.ts and server.ts do not contain the word either', () => {
    assert.ok(!/playground/i.test(readAppFile('react-router.config.ts')));
    assert.ok(!/playground/i.test(readAppFile('server.ts')));
  });

  it('nothing in public/ is named for it, because everything in public/ is copied into the build', () => {
    const names = readdirSync(`${APP_ROOT}/public`, { recursive: true }).map(String);
    assert.ok(names.length > 3, 'public/ read as empty, so the check proves nothing');
    assert.deepEqual(
      names.filter((name) => /playground/i.test(name)),
      [],
    );
  });

  it('the playground has its own config, which is a separate file from the production one', () => {
    assert.ok(readAppFile('playground.html').includes('/app/playground/main.tsx'));
    assert.ok(readAppFile('vite.playground.config.ts').includes("from './vite.config'"));
  });
});

////////////////////////////////////////////////////////////////////////////////
// (d) Every registry row loads its section with a literal import()
////////////////////////////////////////////////////////////////////////////////

/** The registry's array, as the text between `export const SECTIONS` and its closing `];`. */
function sectionsBlock(source: string): string {
  const block = /export const SECTIONS\b[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source)?.[1];
  if (block === undefined) throw new Error('app/playground/app.tsx has no `export const SECTIONS = [ ... ];`');
  return block;
}

/**
 * What is wrong with the registry's `load` properties, one sentence each; an empty list when none.
 * A row is `{ def: {...}, load: () => import('./sections/<id>') }`. Anything else (a variable, a
 * template string, another folder) hides the path from Vite, which can then not make a chunk of it.
 */
function findLoadProblems(source: string): string[] {
  const block = sectionsBlock(source);
  const rows = block.match(/\bdef\s*:/g)?.length ?? 0;
  const loads = block.match(/\bload\s*:/g)?.length ?? 0;
  const literalLoads = block.match(/\bload\s*:\s*\(\s*\)\s*=>\s*import\(\s*(['"])\.\/sections\/[a-z0-9-]+\1\s*\)/g)?.length ?? 0;
  const problems: string[] = [];
  if (rows === 0) problems.push('the registry has no rows');
  if (loads !== rows) problems.push(`${rows} rows but ${loads} load properties`);
  if (literalLoads !== loads) problems.push(`${loads - literalLoads} of ${loads} loads are not a literal import('./sections/<id>')`);
  return problems;
}

/** A one-row registry whose `load` is the given text. */
function registryWithLoad(load: string): string {
  return `export const SECTIONS: readonly SectionEntry[] = [\n  { def: { id: 'a', title: 'A' }, load: ${load} },\n];\n`;
}

describe('(d) every registry row is a literal import() of a section file', () => {
  it('control: a clean registry has no problem', () => {
    assert.deepEqual(findLoadProblems(registryWithLoad("() => import('./sections/a')")), []);
    assert.deepEqual(findLoadProblems(registryWithLoad('() => import("./sections/with-dash-2")')), []);
  });

  it('control: a path held in a variable is caught', () => {
    assert.notDeepEqual(findLoadProblems(registryWithLoad('() => import(path)')), []);
  });

  it('control: a template string is caught', () => {
    assert.notDeepEqual(findLoadProblems(registryWithLoad('() => import(`./sections/${id}`)')), []);
  });

  it('control: another folder is caught', () => {
    assert.notDeepEqual(findLoadProblems(registryWithLoad("() => import('./elsewhere/a')")), []);
  });

  it('control: a row with no load is caught', () => {
    assert.notDeepEqual(findLoadProblems("export const SECTIONS = [\n  { def: { id: 'a', title: 'A' } },\n];\n"), []);
  });

  it('control: a missing registry throws rather than passing', () => {
    assert.throws(() => findLoadProblems('export const OTHER = [];\n'), /SECTIONS/);
  });

  it('the real registry in app/playground/app.tsx has none', () => {
    const source = readAppFile('app/playground/app.tsx');
    assert.deepEqual(findLoadProblems(source), []);
    assert.ok((sectionsBlock(source).match(/\bdef\s*:/g)?.length ?? 0) >= 5, 'fewer rows than the first cut had');
  });
});

////////////////////////////////////////////////////////////////////////////////
// (e) The browser tier never runs for the playground
////////////////////////////////////////////////////////////////////////////////

describe('(e) the browser tier maps the playground to none', () => {
  it('app/playground/, playground.html and vite.playground.config.ts need no browser spec', () => {
    assert.equal(resolvePath('app/playground/app.tsx'), 'none');
    assert.equal(resolvePath('app/playground/sections/admin-people.tsx'), 'none');
    assert.equal(resolvePath('playground.html'), 'none');
    assert.equal(resolvePath('vite.playground.config.ts'), 'none');
  });

  it('control: the rule is narrow. Shipped code and the production config still run specs', () => {
    assert.equal(resolvePath('vite.config.ts'), 'all');
    assert.equal(resolvePath('app/routes/dashboard.tsx'), 'diary-and-add');
    // The review page's components ship (the /dev/playground route), so they are not exempt.
    assert.notEqual(resolvePath('app/components/playground/add-food-actions-variants.tsx'), 'none');
    assert.notEqual(resolvePath('app/playgroundx/app.tsx'), 'none');
  });
});
