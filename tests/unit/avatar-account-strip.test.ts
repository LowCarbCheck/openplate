/**
 * The account strip at the foot of the avatar menu (M215 spec 02).
 *
 * Two halves again, for the reason `avatar-menu-door.test.ts` gives: the pure
 * line resolver settles WHAT the third line says, and the renders settle that
 * the strip actually draws it. This repo has no DOM test library, so the
 * component is split into a container that reads four hooks and a
 * presentational view that takes props, and both halves are exercised here.
 *
 * THE CONTROL THIS FILE EXISTS FOR is the last suite: on an instance with no
 * sync server the strip must render nothing at all (AGENTS.md). It is paired
 * with a positive render of the same markup, so "no strip" is read against a
 * case that does produce one rather than against an empty string that a broken
 * harness would also produce.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { withI18n } from './trends-i18n-harness';
import {
  ACCOUNT_STRIP_HREF,
  AccountStripView,
  AvatarAccountStrip,
  resolveAllowanceLine,
  type AllowanceLine,
  type AllowanceLineInput,
} from '../../app/components/avatar-account-strip';
import type { SyncMenuState } from '../../app/lib/sync/sync-menu-state';

const ACCOUNT_HREF = `href="${ACCOUNT_STRIP_HREF}"`;

/**
 * A component as real markup, inside an open Radix menu.
 *
 * Same harness as `avatar-menu-door.test.ts`: `DropdownMenuItem` refuses to
 * render outside a `Menu`, and this repo's `DropdownMenuContent` portals,
 * which yields an EMPTY string with no `document` to portal into. So the
 * primitive `Root` is opened and the primitive `Content` mounted directly,
 * skipping only the portal.
 */
function renderInMenu(node: ReturnType<typeof createElement>): string {
  const content = createElement(
    DropdownMenuPrimitive.Root,
    { open: true },
    createElement(DropdownMenuPrimitive.Content, { forceMount: true }, node),
  );
  const router = createMemoryRouter([{ path: '/', element: withI18n(content) }], { initialEntries: ['/'] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** How many menu rows reached the menu. */
function countRows(markup: string): number {
  return markup.split('role="menuitem"').length - 1;
}

/** The strip's view, with the two lines that are not under test held steady. */
function renderStrip({
  state,
  title,
  allowance = { kind: 'none' },
}: {
  state: SyncMenuState;
  title: string | null;
  allowance?: AllowanceLine;
}): string {
  return renderInMenu(createElement(AccountStripView, { state, title, allowance }));
}

describe('resolveAllowanceLine', () => {
  const base: AllowanceLineInput = {
    aiComesFromTheInstance: true,
    dailyAiLimit: 20,
    aiUsedToday: 3,
    plansAvailable: false,
  };

  it('says nothing when the AI does not come from the instance', () => {
    // A BYOK device pays its own provider. The allowance is not a fact about
    // this account there, and `/settings/ai` is the page that owns it.
    assert.deepEqual(resolveAllowanceLine({ ...base, aiComesFromTheInstance: false }), { kind: 'none' });
  });

  it('says nothing while the account view is still unread', () => {
    // `null` IS NOT ZERO. It is the moment after every reload, and "0 of 0
    // used today" there is a lie about somebody's allowance.
    assert.deepEqual(resolveAllowanceLine({ ...base, dailyAiLimit: null, aiUsedToday: null }), { kind: 'none' });
  });

  it('prints today against the cap when there is one', () => {
    assert.deepEqual(resolveAllowanceLine(base), { kind: 'usage', used: 3, limit: 20 });
  });

  it('counts an unread usage figure as none used, never as the whole cap', () => {
    assert.deepEqual(resolveAllowanceLine({ ...base, aiUsedToday: null }), { kind: 'usage', used: 0, limit: 20 });
  });

  it('names no allowance at all when the cap is zero and nothing is for sale', () => {
    assert.deepEqual(resolveAllowanceLine({ ...base, dailyAiLimit: 0, aiUsedToday: 0 }), { kind: 'no-allowance' });
  });

  it('points at the plan instead when this instance sells one', () => {
    assert.deepEqual(resolveAllowanceLine({ ...base, dailyAiLimit: 0, aiUsedToday: 0, plansAvailable: true }), {
      kind: 'plan',
    });
  });

  it('never resolves to an ask-an-administrator line (M212)', () => {
    // The strip must not carry `account.allowance.askAdmin` or the `ask-admin`
    // door kind. Every input combination there is, so a new branch cannot add
    // one without this failing.
    for (const aiComesFromTheInstance of [false, true]) {
      for (const dailyAiLimit of [null, 0, 1, 200]) {
        for (const plansAvailable of [false, true]) {
          const line = resolveAllowanceLine({
            aiComesFromTheInstance,
            dailyAiLimit,
            aiUsedToday: 0,
            plansAvailable,
          });
          assert.ok(
            ['none', 'usage', 'no-allowance', 'plan'].includes(line.kind),
            `${line.kind} is not one of the four the strip may draw`,
          );
        }
      }
    }
  });
});

describe('the strip a signed-in person sees', () => {
  const markup = renderStrip({
    state: { status: 'synced', lastSyncedAt: Date.now() },
    title: 'ada@example.org',
    allowance: { kind: 'usage', used: 3, limit: 20 },
  });

  it('is one tap target, and it opens the account page', () => {
    assert.equal(countRows(markup), 1, markup.slice(0, 800));
    assert.equal(markup.split(ACCOUNT_HREF).length - 1, 1, markup.slice(0, 800));
  });

  it('names the person on top', () => {
    assert.ok(markup.includes('ada@example.org'), markup.slice(0, 800));
  });

  it('carries the sync line under it', () => {
    assert.ok(markup.includes('Synced'), markup.slice(0, 800));
  });

  it('carries the allowance line under that', () => {
    assert.ok(markup.includes('Photo estimates today: 3 of 20'), markup.slice(0, 800));
  });

  it('names no administrator anywhere in it (M212)', () => {
    // THE CONTROL is the assertion above: the allowance line is present and
    // has content, so this is not passing because the strip drew nothing.
    assert.ok(!markup.includes('administrator'), markup.slice(0, 800));
    assert.ok(!markup.includes('Administration'), markup.slice(0, 800));
  });
});

describe('the strip a signed-out person sees', () => {
  const markup = renderStrip({ state: { status: 'not-set-up' }, title: null });

  it('reads as signed out', () => {
    assert.ok(markup.includes('Signed out'), markup.slice(0, 800));
  });

  it('is still the one tap target into the account page', () => {
    assert.equal(countRows(markup), 1, markup.slice(0, 800));
    assert.ok(markup.includes(ACCOUNT_HREF), markup.slice(0, 800));
  });

  it('adds no sync line, because there is no session to describe', () => {
    for (const line of ['Synced', 'Waiting', 'Never synced']) {
      assert.ok(!markup.includes(line), `${line} reached a signed-out strip`);
    }
  });
});

describe('no sync server means no strip at all', () => {
  // `AvatarAccountStrip` reads `useSyncServerUrl()`, which reads the root
  // loader's public config. This router has no `root` route, so the hook gets
  // `undefined` and answers `null`, which is exactly the runtime state of an
  // instance with `SYNC_SERVER_URL` unset.
  const markup = renderInMenu(createElement(AvatarAccountStrip));

  it('renders nothing (AGENTS.md: unset means no sync UI anywhere)', () => {
    assert.equal(countRows(markup), 0, markup.slice(0, 800));
    assert.ok(!markup.includes(ACCOUNT_HREF), markup.slice(0, 800));
    assert.ok(!markup.includes('Signed out'), markup.slice(0, 800));
  });

  it('is a real check and not an empty harness', () => {
    // THE CONTROL FOR THE CONTROL. The same harness, given the view directly,
    // produces a strip. Without this, deleting the strip's markup entirely,
    // or breaking `renderInMenu`, would leave the assertion above green while
    // it measured nothing.
    const present = renderStrip({ state: { status: 'not-set-up' }, title: null });
    assert.equal(countRows(present), 1, present.slice(0, 800));
    assert.ok(present.includes(ACCOUNT_HREF), present.slice(0, 800));
  });
});
