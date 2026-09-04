/**
 * What the administration page PUTS ON SCREEN, in the four states that matter.
 *
 * ── Rendered, not inspected ──────────────────────────────────────────────
 *
 * These are `renderToStaticMarkup` assertions against the real shipped English
 * catalog, so a key renamed in a component but not in `en/common.json` fails
 * here rather than showing an administrator `admin.people.empty` where a
 * sentence belongs. The components are presentational by construction, which
 * is what makes this possible without a session, a server or a network.
 *
 * ── The four states ──────────────────────────────────────────────────────
 *
 *  1. NOT AN ADMINISTRATOR. One card, no data, and a way out. This is what a
 *     signed-out visitor, an ordinary account and a just-demoted administrator
 *     all see, and it must never be a blank page.
 *  2. THE LIST, with two people and one invitation. Pins the row's contents:
 *     usage as "used of limit", your own row without controls, a suspended row
 *     marked as such.
 *  3. THE INVITE RESULT WITH MAIL. The address, and NO link: on an instance
 *     with mail the link exists in one place, the mailbox.
 *  4. THE INVITE RESULT WITHOUT MAIL. The link, plus the sentence that says
 *     what it is. An administrator who reads it as a convenience pastes it
 *     into a group chat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { NotAnAdministratorCard } from '../../app/components/admin/not-an-administrator';
import { InviteResult } from '../../app/components/admin/invite-result';
import { InviteTable } from '../../app/components/admin/invite-table';
import { PeopleTable } from '../../app/components/admin/people-table';
import type { AdminAccountView, InviteView } from '../../app/lib/admin/admin-wire';

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, withI18n(element)));
}

const ADMIN: AdminAccountView = {
  id: 1,
  email: 'owner@example.org',
  displayName: 'Owner',
  role: 'admin',
  dailyAiLimit: 500,
  aiUsedToday: 12,
  suspendedAt: null,
  createdAt: '2026-08-01T09:00:00.000Z',
};

const SUSPENDED_PERSON: AdminAccountView = {
  id: 2,
  email: 'anna@example.org',
  displayName: null,
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 7,
  suspendedAt: '2026-09-03T09:00:00.000Z',
  createdAt: '2026-08-20T09:00:00.000Z',
};

const PENDING_INVITE: InviteView = {
  id: 12,
  email: 'bea@example.org',
  displayName: 'Bea',
  role: 'member',
  dailyAiLimit: 200,
  expiresAt: '2026-09-11T09:00:00.000Z',
  status: 'pending',
  createdAt: '2026-09-04T09:00:00.000Z',
  redeemedAccountId: null,
};

/** Callbacks that would fail the test if a render triggered one. Nothing here should call the network. */
const NEVER = {
  onSave: () => Promise.reject(new Error('a render must not save')),
  onSetSuspended: () => Promise.reject(new Error('a render must not suspend')),
  onSendResetMail: () => Promise.reject(new Error('a render must not send mail')),
  onDelete: () => Promise.reject(new Error('a render must not delete')),
};

// ---------------------------------------------------------------------------
// 1. Not an administrator
// ---------------------------------------------------------------------------

test('the not-an-administrator card says what to do, and names no status code', () => {
  const html = render(createElement(NotAnAdministratorCard));

  assert.match(html, /You do not run this instance/);
  assert.match(html, /Ask one of them/);
  assert.match(html, /href="\/settings"/, 'a refusal must offer a way out');
  assert.doesNotMatch(html, /403|Forbidden|error/i, 'a fact about a request is not a sentence for a person');
});

// ---------------------------------------------------------------------------
// 2. The list
// ---------------------------------------------------------------------------

test('the list shows two people, their usage and their standing', () => {
  const html = render(createElement(PeopleTable, { people: [ADMIN, SUSPENDED_PERSON], currentAccountId: 1, ...NEVER }));

  assert.match(html, /owner@example\.org/);
  assert.match(html, /anna@example\.org/);
  // "used of limit", never a bare number: 7 means nothing without the 200.
  assert.match(html, /12 of 500/);
  assert.match(html, /7 of 200/);
  assert.match(html, /Administrator/);
  assert.match(html, /Standard/);
  assert.match(html, /Suspended/);
  // A person with no name is not a blank cell.
  assert.match(html, /No name/);
});

test('your own row carries no controls, because the service would refuse them', () => {
  const alone = render(createElement(PeopleTable, { people: [ADMIN], currentAccountId: 1, ...NEVER }));
  assert.match(alone, /You/);
  assert.doesNotMatch(alone, /Suspend/, 'the last administrator must not be able to lock themselves out');
  assert.doesNotMatch(alone, /Delete/);

  const somebodyElse = render(createElement(PeopleTable, { people: [ADMIN], currentAccountId: 99, ...NEVER }));
  assert.match(somebodyElse, /Suspend/, 'and the same row DOES carry them for somebody else');
  assert.match(somebodyElse, /Send a reset link/);
});

test('a suspended row offers to bring them back rather than to suspend them again', () => {
  const html = render(createElement(PeopleTable, { people: [SUSPENDED_PERSON], currentAccountId: 1, ...NEVER }));

  assert.match(html, /Bring back/);
  assert.doesNotMatch(html, />Suspend</);
});

test('an allowance of zero is its own sentence, not "0 of 0"', () => {
  const noAi: AdminAccountView = { ...SUSPENDED_PERSON, dailyAiLimit: 0, aiUsedToday: 0 };
  const html = render(createElement(PeopleTable, { people: [noAi], currentAccountId: 1, ...NEVER }));

  assert.match(html, /No photos/);
  assert.doesNotMatch(html, /0 of 0/);
});

test('an empty instance says so instead of rendering an empty box', () => {
  const html = render(createElement(PeopleTable, { people: [], currentAccountId: 1, ...NEVER }));
  assert.match(html, /Nobody has an account here yet/);
});

test('the invitation list shows the one that is pending, with its expiry', () => {
  const html = render(
    createElement(InviteTable, {
      invites: [PENDING_INVITE],
      onResend: () => Promise.reject(new Error('a render must not resend')),
      onRevoke: () => Promise.reject(new Error('a render must not revoke')),
    }),
  );

  assert.match(html, /bea@example\.org/);
  assert.match(html, /Bea/);
  assert.match(html, /Valid until/);
  assert.match(html, /Send again/);
  assert.match(html, /Withdraw/);
});

test('a redeemed or revoked invitation is not listed: it is a person, or it is nothing', () => {
  const html = render(
    createElement(InviteTable, {
      invites: [
        { ...PENDING_INVITE, id: 13, email: 'redeemed@example.org', status: 'redeemed', redeemedAccountId: 4 },
        { ...PENDING_INVITE, id: 14, email: 'revoked@example.org', status: 'revoked' },
        { ...PENDING_INVITE, id: 15, email: 'expired@example.org', status: 'expired' },
      ],
      onResend: () => Promise.reject(new Error('a render must not resend')),
      onRevoke: () => Promise.reject(new Error('a render must not revoke')),
    }),
  );

  assert.match(html, /No invitation is waiting/);
  assert.doesNotMatch(html, /redeemed@example\.org|revoked@example\.org|expired@example\.org/);
});

// ---------------------------------------------------------------------------
// 3 and 4. The invite result
// ---------------------------------------------------------------------------

test('with mail configured the result names the address and shows NO link', () => {
  const html = render(
    createElement(InviteResult, {
      email: 'bea@example.org',
      delivery: { emailed: true, link: null },
      onInviteAnother: () => undefined,
    }),
  );

  assert.match(html, /Invitation sent to bea@example\.org/);
  // Checked as the ABSENCE OF THE LINK BLOCK rather than of a URL: an icon in
  // this card carries an `xmlns` that any `https?://` pattern matches, and a
  // test that passed on that would pass on anything.
  assert.doesNotMatch(html, /font-mono/, 'the link lives in the mailbox, not in a screenshot');
  assert.doesNotMatch(html, /Copy the link/);
});

test('without mail the result shows the link, and says what holding it means', () => {
  const link = 'https://app.example.test/join#server=https%3A%2F%2Fsync.example.test&invite=si_abc';
  const html = render(
    createElement(InviteResult, {
      email: 'bea@example.org',
      delivery: { emailed: false, link },
      onInviteAnother: () => undefined,
    }),
  );

  assert.match(html, /Invitation ready for bea@example\.org/);
  assert.ok(html.includes(link.replaceAll('&', '&amp;')), 'the link is readable, not only copyable');
  assert.match(html, /Copy the link/);
  assert.match(html, /Anyone who has it can open the account/, 'a link is a credential and has to read as one');
});

test('a server that reports mail AND hands back a link is treated as the link case', () => {
  // The safe direction. An instance that answers `emailed: true` with a link
  // has done something unusual, and hiding a link somebody may need is worse
  // than showing one they do not.
  const html = render(
    createElement(InviteResult, {
      email: 'bea@example.org',
      delivery: { emailed: true, link: 'https://app.example.test/join#invite=si_abc' },
      onInviteAnother: () => undefined,
    }),
  );

  assert.match(html, /Invitation ready for/);
  assert.match(html, /Copy the link/);
});
