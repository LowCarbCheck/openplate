/**
 * Sign-out keeps the remembered sign-in name; only account deletion and the
 * explicit "Not you?" link clear it (M183 spec 04).
 *
 * `signOutOfSync` and `deleteSyncAccount` both live in `sync-actions.ts`,
 * which is the composition root for the whole sync feature and cannot be
 * exercised in isolation without a real (or heavily faked) `SyncVault` — see
 * that file's own header on why the wiring lives in one place. Rather than
 * fake a vault, this pins the same invariant the spec's own verification
 * commands do: read the two function bodies and assert which one calls
 * `clearAccountHint()`. `tests/unit/sign-in-flow.test.ts` already uses this
 * same source-inspection idiom for `/sign-in`'s wiring.
 *
 * A name is not a credential — it unlocks nothing — and keeping it across
 * sign-out is what turns a returning visitor's NEXT visit into a sign-in
 * instead of a sign-up. Before this milestone, sign-out cleared it, so every
 * device that signed out (including the one that just did) was offered
 * "Create account" first.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../app/lib/sync/sync-actions.ts', import.meta.url), 'utf8');

/**
 * Extracts one exported function's body, from its signature to its closing
 * brace.
 *
 * Anchors on a brace ALONE on its own line (`/^}$/m`), not the first line
 * starting with `}` — `deleteSyncAccount`'s destructured signature closes
 * with `}: { passphrase: string } & SyncActionOptions): Promise<void> {`,
 * which itself starts with `}` and would end the range one line into the
 * function. Spec 02's worklog hit the same trap in a `sed` range for a
 * different resolver.
 */
function extractFunctionBody(functionName: string): string {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.ok(start !== -1, `${functionName} is no longer in sync-actions.ts`);
  const closingBrace = /^}$/m.exec(source.slice(start));
  assert.ok(closingBrace !== null, `${functionName} has no closing brace alone on its own line`);
  return source.slice(start, start + closingBrace.index);
}

describe('signOutOfSync', () => {
  const body = extractFunctionBody('signOutOfSync');

  it('does not forget the remembered sign-in name', () => {
    assert.doesNotMatch(body, /clearAccountHint/);
  });

  it('still revokes the device session and drops the vault', () => {
    assert.match(body, /\.logout\(\)/);
    assert.match(body, /closeSyncSession\(\)/);
  });
});

describe('deleteSyncAccount', () => {
  const body = extractFunctionBody('deleteSyncAccount');

  it('still forgets the remembered sign-in name — there is no account left to offer', () => {
    assert.match(body, /clearAccountHint\(\)/);
  });
});
