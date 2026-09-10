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
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { withI18n } from './trends-i18n-harness';
import { AccountDoor } from '../../app/components/avatar-menu';
import { resolveAvatarMenuDoor, type AvatarMenuDoor } from '../../app/lib/sync/sync-menu-state';

const SIGN_IN_HREF = 'href="/sign-in"';
const ACCOUNT_HREF = 'href="/settings/account"';

/**
 * The door's rows as real markup.
 *
 * Radix's `MenuItem` refuses to render outside a `Menu`, and this repo's
 * `DropdownMenuContent` wraps its children in a portal, which produces an
 * EMPTY string under `renderToStaticMarkup` (there is no `document` to portal
 * into). So the harness opens the primitive `Root` and mounts the primitive
 * `Content` directly, skipping only the portal. Everything below it, including
 * every row this component ships, is the real thing.
 */
function renderDoor(door: AvatarMenuDoor): string {
  const content = createElement(
    DropdownMenuPrimitive.Root,
    { open: true },
    createElement(DropdownMenuPrimitive.Content, { forceMount: true }, createElement(AccountDoor, { door })),
  );
  const router = createMemoryRouter([{ path: '/', element: withI18n(content) }], { initialEntries: ['/'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** How many menu rows the door put in the menu. */
function countRows(markup: string): number {
  return markup.split('role="menuitem"').length - 1;
}

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

  it('offers BOTH doors on an open instance that merely has sync configured', () => {
    // The conflation this milestone warns about: sync configured is not the
    // same question as accounts required, and a self-hoster who turned sync on
    // for themselves can genuinely make an account. What that instance is not
    // is a place where nobody has one yet, and this returned 'create-account'
    // alone, and a person already holding an account had no way in.
    assert.equal(
      resolveAvatarMenuDoor({ hasSyncServer: true, hasSession: false, requiresAccount: false }),
      'sign-in-or-create',
    );
  });

  it('pins every input combination there is', () => {
    // Eight rows for three booleans, so a new branch cannot be added without
    // an answer here changing. `hasSyncServer: false` swallows the other two
    // by design (AGENTS.md: no sync server, no account UI anywhere).
    const table: Array<{ input: Parameters<typeof resolveAvatarMenuDoor>[0]; door: AvatarMenuDoor }> = [
      { input: { hasSyncServer: false, hasSession: false, requiresAccount: false }, door: 'none' },
      { input: { hasSyncServer: false, hasSession: false, requiresAccount: true }, door: 'none' },
      { input: { hasSyncServer: false, hasSession: true, requiresAccount: false }, door: 'none' },
      { input: { hasSyncServer: false, hasSession: true, requiresAccount: true }, door: 'none' },
      { input: { hasSyncServer: true, hasSession: true, requiresAccount: false }, door: 'sign-out' },
      { input: { hasSyncServer: true, hasSession: true, requiresAccount: true }, door: 'sign-out' },
      { input: { hasSyncServer: true, hasSession: false, requiresAccount: true }, door: 'sign-in' },
      { input: { hasSyncServer: true, hasSession: false, requiresAccount: false }, door: 'sign-in-or-create' },
    ];

    for (const { input, door } of table) {
      assert.equal(resolveAvatarMenuDoor(input), door, JSON.stringify(input));
    }
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

  it('no longer carries a mid-menu create-account row', () => {
    // M215 spec 02. The row pointed at `/settings/account`, which is exactly
    // where the footer strip goes, so the menu offered one destination behind
    // two same-weight items and said nothing about the account on either.
    assert.doesNotMatch(source, /sync\.profileCard\.setUp/);
    assert.doesNotMatch(source, /CreateAccountRow/);
  });

  it('no longer carries a mid-menu sync row either', () => {
    assert.doesNotMatch(source, /settings\.rows\.sync\.title/);
    assert.doesNotMatch(source, /function SyncRow/);
  });

  it('keeps exactly one row that opens the settings hub', () => {
    // THE CONTROL for the two assertions above: removing rows must not have
    // removed the one row this menu is supposed to keep, and a second copy of
    // it would be the same defect wearing a different label.
    assert.equal(source.split('to="/settings"').length - 1, 1, source);
    assert.match(source, /nav\.settings/);
  });

  it('reaches the account through the strip, and only through the strip', () => {
    // No literal `/settings/account` is left in this file at all: the strip
    // owns that destination now (`avatar-account-strip.tsx`).
    assert.equal(source.split('"/settings/account"').length - 1, 0, source);
    assert.match(source, /<AvatarAccountStrip \/>/);
  });

  it('never names an administrator in the header menu (M212)', () => {
    assert.doesNotMatch(source, /askAdmin/);
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

describe('the rows the door renders', () => {
  describe('signed out on an open instance', () => {
    const markup = renderDoor('sign-in-or-create');

    it('carries the way in, as the one row', () => {
      // Still the way in: a person who already had an account and had been
      // signed out must reach sign-in from the header, which is the defect
      // M201 fixed and this spec must not undo.
      assert.ok(markup.includes(SIGN_IN_HREF), markup.slice(0, 800));
      assert.equal(countRows(markup), 1, markup.slice(0, 800));
    });

    it('sends account creation to the footer strip instead of a second row', () => {
      // M215 spec 02: the creation row pointed at `/settings/account` and the
      // strip goes to the same page, so the row was a duplicate destination
      // sitting at the same weight as sign-in.
      assert.ok(!markup.includes(ACCOUNT_HREF), markup.slice(0, 800));
      assert.ok(!markup.includes('Create account'), markup.slice(0, 800));
    });

    it('reuses the copy the row already had', () => {
      assert.ok(markup.includes('Sign in'));
    });
  });

  describe('signed out on a managed instance', () => {
    const markup = renderDoor('sign-in');

    it('shows exactly one door, the way in', () => {
      assert.equal(countRows(markup), 1, markup.slice(0, 800));
      assert.ok(markup.includes(SIGN_IN_HREF));
    });

    it('still promises nobody an account they cannot create', () => {
      assert.ok(!markup.includes('Create account'), markup.slice(0, 800));
      assert.ok(!markup.includes(ACCOUNT_HREF));
    });
  });

  describe('the unchanged states', () => {
    it('renders one row, the way out, when a session is open', () => {
      const markup = renderDoor('sign-out');
      assert.equal(countRows(markup), 1, markup.slice(0, 800));
      assert.ok(markup.includes('Sign out'));
      assert.ok(!markup.includes(SIGN_IN_HREF));
    });

    it('renders no row at all on an instance with no sync server', () => {
      // AGENTS.md: unset SYNC_SERVER_URL means no sync UI renders anywhere,
      // and an account is sync UI.
      const markup = renderDoor('none');
      assert.equal(countRows(markup), 0, markup.slice(0, 800));
      assert.ok(!markup.includes('Sign in'));
      assert.ok(!markup.includes('Create account'));
    });
  });
});
