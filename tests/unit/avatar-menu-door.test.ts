/**
 * The account door in the header menu (M201 spec 02, plus the signed-out state
 * spec 03's header covers in public).
 *
 * Two halves, and the second is why the first is not enough. The pure resolver
 * settles which door each instance shows; the source reads below settle that
 * the menu actually renders the resolver's answer, because there is no DOM
 * test library in this repo and a correct decision nothing consults is exactly
 * the fault this milestone is made of.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveAvatarMenuDoor } from '../../app/lib/sync/sync-menu-state';

describe('resolveAvatarMenuDoor', () => {
  it('offers the way out whenever a session is open, on any instance', () => {
    for (const requiresAccount of [false, true]) {
      assert.equal(resolveAvatarMenuDoor({ hasSyncServer: true, hasSession: true, requiresAccount }), 'sign-out');
    }
  });

  it('offers sign in on a managed instance with no session, never account creation', () => {
    const door = resolveAvatarMenuDoor({ hasSyncServer: true, hasSession: false, requiresAccount: true });
    assert.equal(door, 'sign-in');
    assert.notEqual(door, 'create-account', 'an invite-only instance must not promise self-service signup');
  });

  it('keeps create account on an open instance that merely has sync configured', () => {
    // The conflation this milestone warns about: sync configured is not the
    // same question as accounts required, and a self-hoster who turned sync on
    // for themselves can genuinely make one.
    assert.equal(
      resolveAvatarMenuDoor({ hasSyncServer: true, hasSession: false, requiresAccount: false }),
      'create-account',
    );
  });

  it('says nothing at all on an instance with no sync server', () => {
    for (const hasSession of [false, true]) {
      assert.equal(resolveAvatarMenuDoor({ hasSyncServer: false, hasSession, requiresAccount: false }), 'none');
    }
  });
});

describe('the menu renders the door it was given', () => {
  const source = readFileSync(new URL('../../app/components/avatar-menu.tsx', import.meta.url), 'utf8');

  it('reaches sign out from the header menu, in one action', () => {
    assert.match(source, /resolveAvatarMenuDoor/);
    assert.match(source, /SignOutDialog/);
    assert.match(source, /signOut\.menuItem/);
  });

  it('sends the signed-out managed state to the sign-in door', () => {
    assert.match(source, /to="\/sign-in"/);
    assert.match(source, /requiresAccount/);
  });

  it('leaves the create-account row for the open-instance branch alone', () => {
    assert.match(source, /sync\.profileCard\.setUp/);
  });
});

describe('both doors open the same dialog', () => {
  const settings = readFileSync(new URL('../../app/routes/settings.account.tsx', import.meta.url), 'utf8');

  it('keeps the /settings/account control working, through the shared dialog', () => {
    assert.match(settings, /SignOutDialog/);
    assert.match(settings, /account\.signOut\.cta/);
  });

  it('no longer signs out on a bare click with no confirmation', () => {
    assert.doesNotMatch(settings, /onClick=\{\(\) => void signOutOfSync\(\)/);
  });
});
