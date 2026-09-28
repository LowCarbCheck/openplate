/**
 * `/settings/goals` is a redirect now, and it has to stay one.
 *
 * M215 spec 03 split that page into `/settings/profile` (the body facts) and
 * `/settings/nutrition` (the eating style and the four targets). The old
 * address is in bookmarks, in screenshots and in every release note before
 * this one, so it keeps resolving. What it must NOT do is 404, and what it
 * must not do either is quietly point at the wrong half of the split: the
 * targets are what "Goals" meant to whoever saved the link.
 *
 * Read off the route module rather than driven through a router, because the
 * claim is about the module itself: there is a `loader` (a SERVER redirect, so
 * a cold navigation never paints a frame of the old page), it names the
 * targets page, and the module carries no component, no client loader and no
 * action that could keep the old page alive by accident.
 *
 * Every predicate below is run against `settings.sync.tsx` as the CONTROL. It
 * is the same shape of file, redirecting somewhere else, so a predicate that
 * matched any redirect route at all fails there and is caught here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function routeSource(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/routes/${file}`, import.meta.url)), 'utf8');
}

const GOALS = routeSource('settings.goals.tsx');
/** The other bare redirect in the tree, which points at `/settings/account`. */
const SYNC = routeSource('settings.sync.tsx');

/** Does this route module redirect to the targets page from a server loader? */
function redirectsToNutrition(source: string): boolean {
  return /export function loader\(\)\s*{\s*return redirect\('\/settings\/nutrition'\);/.test(source);
}

describe('the /settings/goals redirect', () => {
  it('sends a server-side redirect to /settings/nutrition', () => {
    assert.equal(redirectsToNutrition(GOALS), true, GOALS);
  });

  it('CONTROL: the same predicate is false for the other bare redirect route', () => {
    // `settings.sync.tsx` redirects to `/settings/account`. If this passed, the
    // assertion above would be matching "any redirect route", not this target.
    assert.equal(redirectsToNutrition(SYNC), false);
    assert.match(SYNC, /return redirect\('\/settings\/account'\);/);
  });

  it('keeps nothing else of the old page: no component, no client loader, no action', () => {
    for (const forbidden of ['export default', 'clientLoader', 'clientAction', 'HydrateFallback']) {
      assert.ok(!GOALS.includes(forbidden), `the redirect route still carries ${forbidden}`);
    }
  });

  it('is registered, so the address resolves instead of falling through to the 404 route', () => {
    const routes = readFileSync(fileURLToPath(new URL('../../app/routes.ts', import.meta.url)), 'utf8');
    assert.ok(routes.includes("route('/settings/goals', 'routes/settings.goals.tsx')"));
    // The two pages it split into are registered too, or the redirect would
    // land on the catch-all.
    assert.ok(routes.includes("route('/settings/profile', 'routes/settings.profile.tsx')"));
    assert.ok(routes.includes("route('/settings/nutrition', 'routes/settings.nutrition.tsx')"));
  });
});
