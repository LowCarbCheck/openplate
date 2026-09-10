/**
 * Unit tests for `#app/lib/route-tree`, the static table that says what
 * "one level deeper" means, and therefore what earns a history PUSH.
 *
 * The parity test reads `app/routes.ts` AS TEXT rather than importing it,
 * because importing it drags in `@react-router/dev` and every route module
 * with it. Text is also the right granularity here: the claim is "the table
 * and the route file name the same set of paths", and that is a claim about
 * two lists of strings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ROUTE_TREE, parentOf, depthOf, isDeeper } from '../../app/lib/route-tree';

const routesSource = readFileSync(fileURLToPath(new URL('../../app/routes.ts', import.meta.url)), 'utf8');

/**
 * Every `route('<path>', '<module>')` under the `_personal` layout, with the
 * nested `/admin` children resolved to their full paths.
 *
 * RESOURCE ROUTES ARE EXCLUDED. `/api/food-matches` and `/api/nutrients` are
 * `.ts` modules with no component: a browser never rests on one, so it can
 * never be a history entry and has no place in a tree about history.
 */
function personalRoutePaths(): string[] {
  const layoutStart = routesSource.indexOf("layout('routes/_personal.tsx'");
  assert.notEqual(layoutStart, -1, 'app/routes.ts no longer declares a _personal layout');
  const body = routesSource.slice(layoutStart);

  const paths: string[] = [];
  const adminStart = body.indexOf("route('/admin', 'routes/admin.tsx', [");
  const adminEnd = body.indexOf(']),', adminStart);

  for (const match of body.matchAll(/route\('([^']+)',\s*'(routes\/[^']+)'/g)) {
    const [, path, module] = match;
    if (path === undefined || module === undefined) continue;
    if (module.endsWith('.ts')) continue; // resource route, never a location
    const at = match.index ?? 0;
    const isAdminChild = at > adminStart && at < adminEnd && !path.startsWith('/');
    paths.push(isAdminChild ? `/admin/${path}` : path);
  }
  return paths;
}

describe('route-tree parity with app/routes.ts', () => {
  it('reads a plausible number of personal routes out of the route file', () => {
    // The control for the two parity tests below: if the regex ever stops
    // matching, both of them would pass against an empty list.
    const paths = personalRoutePaths();
    assert.ok(paths.length >= 25, `only found ${paths.length} personal routes`);
    assert.ok(paths.includes('/diary'));
    assert.ok(paths.includes('/admin/feedback/:id'));
  });

  it('has a table entry for every personal route', () => {
    const patterns = new Set(ROUTE_TREE.map((entry) => entry.pattern));
    const missing = personalRoutePaths().filter((path) => !patterns.has(path));
    assert.deepEqual(missing, []);
  });

  it('has no table entry that is not a real route', () => {
    const paths = new Set(personalRoutePaths());
    const invented = ROUTE_TREE.map((entry) => entry.pattern).filter((pattern) => !paths.has(pattern));
    assert.deepEqual(invented, []);
  });

  it('names only real routes as parents', () => {
    const paths = new Set(personalRoutePaths());
    const danglingParents = ROUTE_TREE.map((entry) => entry.parent).filter(
      (parent) => parent !== null && !paths.has(parent),
    );
    assert.deepEqual(danglingParents, []);
  });

  it('names only static paths as parents, so parentOf never substitutes a parameter', () => {
    const parameterised = ROUTE_TREE.map((entry) => entry.parent).filter(
      (parent) => parent !== null && parent.includes(':'),
    );
    assert.deepEqual(parameterised, []);
  });
});

describe('parentOf', () => {
  it('answers null for every root the nav catalog reaches in one tap', () => {
    for (const root of ['/dashboard', '/diary', '/scan', '/add', '/trends', '/nutrients', '/fasting', '/settings']) {
      assert.equal(parentOf(root), null, root);
    }
  });

  it('matches a parameter segment and answers the static parent', () => {
    assert.equal(parentOf('/diary/entry/01JABCDEF'), '/diary');
    assert.equal(parentOf('/admin/people/42'), '/admin');
    assert.equal(parentOf('/admin/feedback/42'), '/admin/feedback');
    assert.equal(parentOf('/shared/acct_9'), '/shared');
  });

  it('does not confuse a collection with one of its members', () => {
    assert.equal(parentOf('/admin/feedback'), '/admin');
  });

  it('answers null for a pathname that is not a personal route at all', () => {
    assert.equal(parentOf('/privacy'), null);
    assert.equal(parentOf('/diary/entry'), null);
    assert.equal(parentOf('/diary/entry/1/2'), null);
  });

  it('ignores a trailing slash', () => {
    assert.equal(parentOf('/settings/ai/'), '/settings');
  });
});

describe('depthOf', () => {
  it('is 0 at a root and off the tree', () => {
    assert.equal(depthOf('/diary'), 0);
    assert.equal(depthOf('/privacy'), 0);
  });

  it('counts the whole chain', () => {
    assert.equal(depthOf('/settings/ai'), 1);
    assert.equal(depthOf('/diary/entry/abc'), 1);
    assert.equal(depthOf('/admin'), 1);
    assert.equal(depthOf('/admin/feedback'), 2);
    assert.equal(depthOf('/admin/feedback/7'), 3);
  });
});

describe('isDeeper, the four walks', () => {
  it('walk 1: diary, settings, settings/ai, tab Diary', () => {
    // Root to root is never deeper, in either direction.
    assert.equal(isDeeper('/diary', '/settings'), false);
    // The one push in the whole walk.
    assert.equal(isDeeper('/settings', '/settings/ai'), true);
    // Back out to a tab is not deeper either.
    assert.equal(isDeeper('/settings/ai', '/diary'), false);
  });

  it('walk 2: diary day paging is not a descent', () => {
    // The decision function short-circuits on the pathname before it ever asks
    // this, but the tree has to agree: a day is not a child of the diary.
    assert.equal(isDeeper('/diary', '/diary'), false);
  });

  it('walk 3: a deep link, then the back link', () => {
    assert.equal(isDeeper('/diary', '/diary/entry/abc'), true);
    assert.equal(isDeeper('/diary/entry/abc', '/diary'), false);
  });

  it('walk 4: diary, add, save', () => {
    assert.equal(isDeeper('/diary', '/add'), false);
    assert.equal(isDeeper('/add', '/diary'), false);
  });

  it('refuses a jump that skipped a level', () => {
    // `/admin/feedback/7` is three levels down; arriving from `/diary` skipped
    // `/settings`, `/admin` and `/admin/feedback`, so pushing would give Back
    // a step to a screen the person was never on.
    assert.equal(isDeeper('/diary', '/admin/feedback/7'), false);
    assert.equal(isDeeper('/admin/feedback', '/admin/feedback/7'), true);
  });

  it('refuses a pathname that is not on the tree', () => {
    assert.equal(isDeeper('/diary', '/privacy'), false);
  });
});
