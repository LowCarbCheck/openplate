/**
 * The invitations behind their chips: what each chip counts, what it shows, and
 * what a pending invitation says about its end.
 *
 * Every state is reachable (operator decision, 2026-10-11) and pending is the
 * default. The clock is fixed, and the "soon" boundary is read from both sides.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  countInvites,
  DEFAULT_INVITE_STATUS,
  EXPIRES_SOON_DAYS,
  INVITE_STATUS_FILTERS,
  inviteExpiry,
  readInviteStatus,
  selectInvites,
  writeInviteStatus,
} from '../../app/lib/admin/invite-filter';
import type { InviteView } from '../../app/lib/admin/admin-wire';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const DAY = 86_400_000;

function at(days: number): string {
  return new Date(NOW.getTime() + days * DAY).toISOString();
}

function invite(overrides: Partial<InviteView> & { id: number }): InviteView {
  return {
    email: `invite${overrides.id}@example.org`,
    displayName: null,
    role: 'member',
    dailyAiLimit: 200,
    expiresAt: at(5),
    status: 'pending',
    createdAt: at(-1),
    redeemedAccountId: null,
    ...overrides,
  };
}

const SOME: InviteView[] = [
  invite({ id: 1, status: 'pending', createdAt: at(-1) }),
  invite({ id: 2, status: 'pending', createdAt: at(-5) }),
  invite({ id: 3, status: 'expired', createdAt: at(-9) }),
  invite({ id: 4, status: 'revoked', createdAt: at(-12) }),
  invite({ id: 5, status: 'redeemed', createdAt: at(-3), redeemedAccountId: 9 }),
  invite({ id: 6, status: 'redeemed', createdAt: at(-4), redeemedAccountId: 10 }),
];

test('the chips are pending, expired, revoked, accepted and all, and pending is where the tab opens', () => {
  assert.deepEqual([...INVITE_STATUS_FILTERS], ['pending', 'expired', 'revoked', 'redeemed', 'all']);
  assert.equal(DEFAULT_INVITE_STATUS, 'pending');
});

test('each chip counts its own state, and "all" counts every invitation', () => {
  assert.deepEqual(countInvites(SOME), { pending: 2, expired: 1, revoked: 1, redeemed: 2, all: 6 });
  assert.deepEqual(countInvites([]), { pending: 0, expired: 0, revoked: 0, redeemed: 0, all: 0 });
});

test('a chip shows only its state, newest first, and "all" shows everything', () => {
  assert.deepEqual(
    selectInvites({ invites: SOME, status: 'pending' }).map((one) => one.id),
    [1, 2],
  );
  assert.deepEqual(
    selectInvites({ invites: SOME, status: 'redeemed' }).map((one) => one.id),
    [5, 6],
  );
  assert.deepEqual(
    selectInvites({ invites: SOME, status: 'all' }).map((one) => one.id),
    [1, 5, 6, 2, 3, 4],
  );
  // CONTROL: the order is by when it was sent, not the order the service sent them in.
  assert.deepEqual(
    selectInvites({ invites: SOME.toReversed(), status: 'all' }).map((one) => one.id),
    [1, 5, 6, 2, 3, 4],
  );
});

test('invitations sent at the same instant go to the later number first, and the input is never reordered', () => {
  const same = at(-2);
  const input = [invite({ id: 10, createdAt: same }), invite({ id: 11, createdAt: same })];
  assert.deepEqual(
    selectInvites({ invites: input, status: 'all' }).map((one) => one.id),
    [11, 10],
  );
  assert.deepEqual(
    input.map((one) => one.id),
    [10, 11],
  );
});

test('a pending invitation says how many whole days are left, and flags fewer than three', () => {
  const left = (days: number) => inviteExpiry({ invite: invite({ id: 1, expiresAt: at(days) }), now: NOW });

  assert.deepEqual(left(5.2), { kind: 'in-days', days: 5, isSoon: false });
  assert.deepEqual(left(3), { kind: 'in-days', days: 3, isSoon: false });
  assert.equal(EXPIRES_SOON_DAYS, 3);
  // 2.9 days left is "2 days" and flagged: the number and the flag agree.
  assert.deepEqual(left(2.9), { kind: 'in-days', days: 2, isSoon: true });
  assert.deepEqual(left(0.4), { kind: 'in-days', days: 0, isSoon: true });
  // Past its end but not yet marked expired by the service: zero, never negative.
  assert.deepEqual(left(-1), { kind: 'in-days', days: 0, isSoon: true });
});

test('an expired invitation says when it ended and the others say nothing about expiry', () => {
  const ended = at(-2);
  assert.deepEqual(inviteExpiry({ invite: invite({ id: 1, status: 'expired', expiresAt: ended }), now: NOW }), {
    kind: 'ended',
    iso: ended,
  });
  assert.deepEqual(inviteExpiry({ invite: invite({ id: 2, status: 'revoked' }), now: NOW }), { kind: 'none' });
  assert.deepEqual(inviteExpiry({ invite: invite({ id: 3, status: 'redeemed' }), now: NOW }), { kind: 'none' });
  // An end date that does not parse is not a number of days.
  assert.deepEqual(inviteExpiry({ invite: invite({ id: 4, expiresAt: 'garbage' }), now: NOW }), { kind: 'none' });
});

test('the chip lives in the address as ?status=, the default is never written, and junk reads as the default', () => {
  assert.equal(writeInviteStatus('pending').toString(), '');
  assert.equal(writeInviteStatus('expired').toString(), 'status=expired');
  assert.equal(writeInviteStatus('redeemed').toString(), 'status=redeemed');
  for (const status of INVITE_STATUS_FILTERS) {
    assert.equal(readInviteStatus(writeInviteStatus(status)), status);
  }
  assert.equal(readInviteStatus(new URLSearchParams('status=EXPIRED')), 'pending');
  assert.equal(readInviteStatus(new URLSearchParams('status=accepted')), 'pending');
  assert.equal(readInviteStatus(new URLSearchParams('')), 'pending');
});
