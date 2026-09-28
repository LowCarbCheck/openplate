/**
 * All THREE paths from `/` into the app consult the same decision (M201 spec
 * 01).
 *
 * The spec is explicit that a fix to one of the three is not a fix, and the
 * three are in different layers: a server loader that cannot see a session, a
 * client loader that can, and an effect that repairs a hard load. There is no
 * DOM test library here, so this reads the route and checks each path reaches
 * the pure decision rather than restating one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../app/routes/index.tsx', import.meta.url), 'utf8');

function slice(from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + 1);
  assert.ok(start !== -1 && end > start, `could not find ${from} .. ${to} in index.tsx`);
  return source.slice(start, end);
}

describe('a managed dashboard redirect proves a session, on every path', () => {
  it('the server loader asks the policy instead of trusting the cookie', () => {
    const loader = slice('export async function loader(', 'function landingSections(');
    assert.match(loader, /homeCookieProvesSession/);
    assert.match(loader, /instancePolicyForMode/);
  });

  it('the client loader reads the session on an instance where the cookie does not prove one', () => {
    const clientLoader = slice('export async function clientLoader(', 'function useHomeHintRepair(');
    assert.match(clientLoader, /readInstancePolicy/);
    assert.match(clientLoader, /hasDeviceSyncSession/);
    assert.match(clientLoader, /resolveClientLandingEntry/);
  });

  it('the hard-load repair effect makes the same check rather than its own', () => {
    const repair = slice('function useHomeHintRepair(', '// Product imagery');
    assert.match(repair, /useInstancePolicy/);
    assert.match(repair, /hasDeviceSyncSession/);
    assert.match(repair, /resolveClientLandingEntry/);
    // The pre-M201 early return is now conditional: a present hint is exactly
    // what this path has to inspect on a managed instance.
    assert.match(repair, /homeCookieProvesSession && readHomeHint\(\)/);
  });

  it('none of the three decides for itself what a hint means', () => {
    // No path may compare the cookie to a session on its own; both questions
    // go through `home-entry.ts`.
    const decisions = source.match(/resolveClientLandingEntry|resolveLandingRedirect/g) ?? [];
    assert.ok(decisions.length >= 3, `expected all three paths to call a resolver, found ${decisions.length}`);
  });
});

describe('sign out clears the home hint, so the server has nothing stale to read', () => {
  const syncActions = readFileSync(new URL('../../app/lib/sync/sync-actions.ts', import.meta.url), 'utf8');

  it('clears it inside signOutOfSync, so every door gets it', () => {
    const signOut = syncActions.slice(
      syncActions.indexOf('export async function signOutOfSync'),
      syncActions.indexOf('// Passphrase change'),
    );
    assert.match(signOut, /clearHomeHint\(\)/);
  });
});
