/**
 * Narrowing the list of people, and the sentence an empty result gets.
 *
 * The rule under test is the one that made this a module rather than three
 * lines in a component: an empty list has FOUR different causes, and the
 * screen has to say which one. "No results" over an instance with twenty
 * people and a group control still set to "Suspended" is how an operator
 * concludes their instance is broken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyReasonFor, filterPeople, PEOPLE_GROUPS } from '../../app/lib/admin/people-filter';
import type { AdminAccountView } from '../../app/lib/admin/admin-wire';

function person(overrides: Partial<AdminAccountView> & { id: number; email: string }): AdminAccountView {
  return {
    displayName: null,
    role: 'member',
    dailyAiLimit: 200,
    aiUsedToday: 0,
    suspendedAt: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    lastSeenAt: null,
    ...overrides,
  };
}

const OWNER = person({ id: 1, email: 'owner@example.org', displayName: 'Owner', role: 'admin' });
const ANNA = person({ id: 2, email: 'anna@example.org', suspendedAt: '2026-09-03T09:00:00.000Z' });
const CARLA = person({ id: 3, email: 'carla@example.org', displayName: 'Carla Meier' });
const EVERYBODY = [OWNER, ANNA, CARLA];

test('the search reads the address and the name, trimmed and case insensitive', () => {
  const byAddress = filterPeople({ people: EVERYBODY, filter: { query: '  ANNA@ ', group: 'everybody' } });
  assert.deepEqual(
    byAddress.map((found) => found.id),
    [2],
  );

  const byName = filterPeople({ people: EVERYBODY, filter: { query: 'meier', group: 'everybody' } });
  assert.deepEqual(
    byName.map((found) => found.id),
    [3],
  );
});

test('an empty search matches everybody, in the order they arrived', () => {
  const found = filterPeople({ people: EVERYBODY, filter: { query: '   ', group: 'everybody' } });
  assert.deepEqual(
    found.map((one) => one.id),
    [1, 2, 3],
  );
});

test('the groups are a standing and a role, and they are not the same question', () => {
  const suspended = filterPeople({ people: EVERYBODY, filter: { query: '', group: 'suspended' } });
  assert.deepEqual(
    suspended.map((one) => one.id),
    [2],
  );

  const active = filterPeople({ people: EVERYBODY, filter: { query: '', group: 'active' } });
  assert.deepEqual(
    active.map((one) => one.id),
    [1, 3],
  );

  // An administrator who is suspended is still an administrator: the role
  // filter must not quietly mean "active administrators".
  const suspendedAdmin = { ...OWNER, suspendedAt: '2026-09-01T09:00:00.000Z' };
  const admins = filterPeople({ people: [suspendedAdmin, CARLA], filter: { query: '', group: 'administrators' } });
  assert.deepEqual(
    admins.map((one) => one.id),
    [1],
  );
});

test('the two halves narrow together', () => {
  const found = filterPeople({ people: EVERYBODY, filter: { query: 'example.org', group: 'suspended' } });
  assert.deepEqual(
    found.map((one) => one.id),
    [2],
  );
});

test('an empty result names which filter emptied it', () => {
  const filter = { query: 'zoe', group: 'everybody' } as const;
  assert.equal(emptyReasonFor({ people: EVERYBODY, filter, visible: [] }), 'query');

  assert.equal(
    emptyReasonFor({ people: [OWNER], filter: { query: '', group: 'suspended' }, visible: [] }),
    'group',
    'a group that nobody is in is not an empty instance',
  );

  assert.equal(
    emptyReasonFor({ people: EVERYBODY, filter: { query: 'zoe', group: 'suspended' }, visible: [] }),
    'both',
  );
});

test('an instance with nobody on it is its own answer, whatever the filter says', () => {
  assert.equal(
    emptyReasonFor({ people: [], filter: { query: 'zoe', group: 'suspended' }, visible: [] }),
    'nobody-here',
  );
});

test('a list with rows on it is not empty and gets no sentence at all', () => {
  assert.equal(
    emptyReasonFor({ people: EVERYBODY, filter: { query: '', group: 'everybody' }, visible: EVERYBODY }),
    'not-empty',
  );
});

test('every group is offered, and "everybody" is the one that hides nobody', () => {
  assert.deepEqual([...PEOPLE_GROUPS], ['everybody', 'active', 'suspended', 'administrators']);
  for (const group of PEOPLE_GROUPS) {
    const found = filterPeople({ people: EVERYBODY, filter: { query: '', group } });
    if (group === 'everybody') assert.equal(found.length, EVERYBODY.length);
    else assert.ok(found.length < EVERYBODY.length, `${group} narrows the list`);
  }
});
