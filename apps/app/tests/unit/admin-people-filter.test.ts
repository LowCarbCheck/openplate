/**
 * Narrowing, ordering and banding the list of people, the counts on the quick
 * views, the sentence an empty result gets, and the address the choices live in.
 *
 * ── Every rule here has a control beside it ─────────────────────────────
 *
 * A boundary is tested from both sides (6.9 days is new, 7.0 days is not), a
 * count is tested before and after the thing that must not change it, and a
 * sort is tested against the input order it must not follow. An assertion that
 * a filter "returns the right people" passes on a filter that returns everybody
 * unless some test names a person who must be missing.
 *
 * ── The clock is a parameter ────────────────────────────────────────────
 *
 * `NOW` is fixed and `ago(days)` builds an instant relative to it, so no test
 * here reads the real clock and none can drift.
 *
 * The rule that made the EMPTY RESULT a module rather than three lines in a
 * component: an empty list has several different causes, and the screen has to
 * say which one. "No results" over an instance with twenty people and a chip
 * still pressed on "Suspended" is how an operator concludes their instance is
 * broken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bandPeople,
  countByView,
  EMPTY_PEOPLE_FILTER,
  emptyReasonFor,
  filterPeople,
  isActiveColumn,
  isPeopleFiltered,
  isSameLabelFilter,
  labelsOf,
  PEOPLE_SORTS,
  PEOPLE_VIEWS,
  readPeopleFilter,
  selectPeople,
  sortArrow,
  sortForColumn,
  sortPeople,
  writePeopleFilter,
  type PeopleFilter,
} from '../../app/lib/admin/people-filter';
import type { AdminAccountView } from '../../app/lib/admin/admin-wire';

/** Noon UTC, so no time zone reads another day. */
const NOW = new Date('2026-10-11T12:00:00.000Z');

const DAY = 86_400_000;

/** The instant `days` before `NOW`, as the service sends it. */
function ago(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

function person(overrides: Partial<AdminAccountView> & { id: number; email: string }): AdminAccountView {
  return {
    displayName: null,
    role: 'member',
    dailyAiLimit: 200,
    aiUsedToday: 0,
    allowanceExpiresAt: null,
    freeDailyAiLimit: 0,
    suspendedAt: null,
    invitesLeft: null,
    trialScans: null,
    createdAt: ago(100),
    lastSeenAt: null,
    label: null,
    ...overrides,
  };
}

function filterOf(overrides: Partial<PeopleFilter>): PeopleFilter {
  return { ...EMPTY_PEOPLE_FILTER, ...overrides };
}

function ids(people: readonly AdminAccountView[]): number[] {
  return people.map((one) => one.id);
}

// A small instance with one person for every view, so each view has somebody
// in it and somebody out of it.
const OWNER = person({
  id: 1,
  email: 'owner@example.org',
  displayName: 'Owner',
  role: 'admin',
  createdAt: ago(120),
  lastSeenAt: ago(0.5),
});
const ANNA = person({
  id: 2,
  email: 'anna@example.org',
  suspendedAt: ago(3),
  createdAt: ago(40),
  lastSeenAt: ago(20),
  label: 'Beta supporter',
});
const CARLA = person({
  id: 3,
  email: 'carla@example.org',
  displayName: 'Carla Meier',
  createdAt: ago(2),
  lastSeenAt: null,
});
const DINA = person({
  id: 4,
  email: 'dina@example.org',
  displayName: 'Dina',
  createdAt: ago(10),
  lastSeenAt: ago(3),
  label: 'Family',
});
const EVERYBODY = [OWNER, ANNA, CARLA, DINA];

// ─── the search ────────────────────────────────────────────────────────────

test('the search reads the address, the name and the label, trimmed and case insensitive', () => {
  assert.deepEqual(ids(filterPeople({ people: EVERYBODY, filter: filterOf({ query: '  ANNA@ ' }), now: NOW })), [2]);
  assert.deepEqual(ids(filterPeople({ people: EVERYBODY, filter: filterOf({ query: 'meier' }), now: NOW })), [3]);
  assert.deepEqual(ids(filterPeople({ people: EVERYBODY, filter: filterOf({ query: 'FAMILY' }), now: NOW })), [4]);
  // CONTROL: the label text is not an address, so a person with no label
  // is not found by a word that only a label contains.
  assert.deepEqual(ids(filterPeople({ people: [CARLA], filter: filterOf({ query: 'family' }), now: NOW })), []);
});

test('an empty search matches everybody, in the order they arrived', () => {
  const found = filterPeople({ people: EVERYBODY, filter: filterOf({ query: '   ' }), now: NOW });
  assert.deepEqual(ids(found), [1, 2, 3, 4]);
  // CONTROL: the order is the input's, not a sort of ours.
  const reversed = filterPeople({ people: EVERYBODY.toReversed(), filter: filterOf({ query: '' }), now: NOW });
  assert.deepEqual(ids(reversed), [4, 3, 2, 1]);
});

// ─── the views ─────────────────────────────────────────────────────────────

test('"new this week" is a sign-up under seven days old, and seven days is already not new', () => {
  const justInside = person({ id: 10, email: 'in@example.org', createdAt: ago(6.99) });
  const justOutside = person({ id: 11, email: 'out@example.org', createdAt: ago(7) });
  const found = filterPeople({ people: [justInside, justOutside], filter: filterOf({ view: 'new' }), now: NOW });
  assert.deepEqual(ids(found), [10]);
});

test('"seen this week" is a sign-in under seven days ago, and nobody who never signed in', () => {
  const justInside = person({ id: 10, email: 'in@example.org', lastSeenAt: ago(6.99) });
  const justOutside = person({ id: 11, email: 'out@example.org', lastSeenAt: ago(7) });
  const never = person({ id: 12, email: 'never@example.org', lastSeenAt: null });
  const found = filterPeople({
    people: [justInside, justOutside, never],
    filter: filterOf({ view: 'seen' }),
    now: NOW,
  });
  assert.deepEqual(ids(found), [10]);
});

test('"gone quiet" is signed in once and not for fourteen days, and a person who never signed in has not gone anywhere', () => {
  const justInside = person({ id: 10, email: 'in@example.org', lastSeenAt: ago(14) });
  const justOutside = person({ id: 11, email: 'out@example.org', lastSeenAt: ago(13.99) });
  const never = person({ id: 12, email: 'never@example.org', lastSeenAt: null });
  const found = filterPeople({
    people: [justInside, justOutside, never],
    filter: filterOf({ view: 'quiet' }),
    now: NOW,
  });
  assert.deepEqual(ids(found), [10]);
});

test('"never signed in" is a null last sign-in and nothing else', () => {
  const found = filterPeople({ people: EVERYBODY, filter: filterOf({ view: 'never' }), now: NOW });
  assert.deepEqual(ids(found), [3]);
});

test('"suspended" is a standing and "administrators" is a role, and they are not the same question', () => {
  assert.deepEqual(ids(filterPeople({ people: EVERYBODY, filter: filterOf({ view: 'suspended' }), now: NOW })), [2]);
  assert.deepEqual(
    ids(filterPeople({ people: EVERYBODY, filter: filterOf({ view: 'administrators' }), now: NOW })),
    [1],
  );

  // An administrator who is suspended is still an administrator: the role
  // view must not quietly mean "active administrators".
  const suspendedAdmin = { ...OWNER, suspendedAt: ago(1) };
  const admins = filterPeople({
    people: [suspendedAdmin, CARLA],
    filter: filterOf({ view: 'administrators' }),
    now: NOW,
  });
  assert.deepEqual(ids(admins), [1]);
});

test('a view, a search and a label narrow together', () => {
  const both = filterPeople({
    people: EVERYBODY,
    filter: filterOf({ view: 'quiet', query: 'example.org' }),
    now: NOW,
  });
  assert.deepEqual(ids(both), [2]);

  const withLabel = filterPeople({
    people: EVERYBODY,
    filter: filterOf({ view: 'seen', label: { kind: 'named', label: 'Family' } }),
    now: NOW,
  });
  assert.deepEqual(ids(withLabel), [4]);

  // CONTROL: the same view with the other label finds nobody, so the label
  // really took part.
  const wrongLabel = filterPeople({
    people: EVERYBODY,
    filter: filterOf({ view: 'seen', label: { kind: 'named', label: 'Beta supporter' } }),
    now: NOW,
  });
  assert.deepEqual(ids(wrongLabel), []);
});

test('every view is offered, "all" is first, and only "all" hides nobody', () => {
  assert.deepEqual([...PEOPLE_VIEWS], ['all', 'new', 'seen', 'quiet', 'never', 'suspended', 'administrators']);
  for (const view of PEOPLE_VIEWS) {
    const found = filterPeople({ people: EVERYBODY, filter: filterOf({ view }), now: NOW });
    if (view === 'all') assert.equal(found.length, EVERYBODY.length);
    else assert.ok(found.length < EVERYBODY.length, `${view} narrows the list`);
  }
});

// ─── the counts on the chips ───────────────────────────────────────────────

test('each chip counts what it would leave, with the search and the label as they are now', () => {
  const counts = countByView({ people: EVERYBODY, filter: EMPTY_PEOPLE_FILTER, now: NOW });
  assert.deepEqual(counts, {
    all: 4,
    new: 1,
    seen: 2,
    quiet: 1,
    never: 1,
    suspended: 1,
    administrators: 1,
  });

  // The search changes every chip: it is part of "what would I get".
  const searched = countByView({ people: EVERYBODY, filter: filterOf({ query: 'dina' }), now: NOW });
  assert.equal(searched.all, 1);
  assert.equal(searched.seen, 1);
  assert.equal(searched.suspended, 0);

  // And so does the label.
  const labelled = countByView({
    people: EVERYBODY,
    filter: filterOf({ label: { kind: 'named', label: 'Beta supporter' } }),
    now: NOW,
  });
  assert.equal(labelled.all, 1);
  assert.equal(labelled.suspended, 1);
  assert.equal(labelled.seen, 0);
});

test('the pressed view does not change the counts, so no other chip falls to zero when one is pressed', () => {
  const unpressed = countByView({ people: EVERYBODY, filter: EMPTY_PEOPLE_FILTER, now: NOW });
  const pressed = countByView({ people: EVERYBODY, filter: filterOf({ view: 'suspended' }), now: NOW });
  assert.deepEqual(pressed, unpressed);
  // CONTROL: the rows DO change with the view, so this is not a count that
  // simply ignores the filter altogether.
  assert.notDeepEqual(
    ids(filterPeople({ people: EVERYBODY, filter: filterOf({ view: 'suspended' }), now: NOW })),
    ids(filterPeople({ people: EVERYBODY, filter: EMPTY_PEOPLE_FILTER, now: NOW })),
  );
});

test('a count on screen is the number of rows the view leaves', () => {
  const counts = countByView({ people: EVERYBODY, filter: filterOf({ query: 'example' }), now: NOW });
  for (const view of PEOPLE_VIEWS) {
    const rows = filterPeople({ people: EVERYBODY, filter: filterOf({ query: 'example', view }), now: NOW });
    assert.equal(counts[view], rows.length, view);
  }
});

// ─── the label ─────────────────────────────────────────────────────────────

test('the label filter is any, none or one named label', () => {
  const any = filterPeople({ people: EVERYBODY, filter: filterOf({ label: { kind: 'any' } }), now: NOW });
  assert.deepEqual(ids(any), [1, 2, 3, 4]);
  const none = filterPeople({ people: EVERYBODY, filter: filterOf({ label: { kind: 'none' } }), now: NOW });
  assert.deepEqual(ids(none), [1, 3]);
  const named = filterPeople({
    people: EVERYBODY,
    filter: filterOf({ label: { kind: 'named', label: 'Family' } }),
    now: NOW,
  });
  assert.deepEqual(ids(named), [4]);
});

test('a label called "none" is a label, and an empty label is no label', () => {
  const oddlyNamed = person({ id: 20, email: 'odd@example.org', label: 'none' });
  const emptyLabel = person({ id: 21, email: 'empty@example.org', label: '' });
  const plain = person({ id: 22, email: 'plain@example.org', label: null });
  const people = [oddlyNamed, emptyLabel, plain];

  const named = filterPeople({
    people,
    filter: filterOf({ label: { kind: 'named', label: 'none' } }),
    now: NOW,
  });
  assert.deepEqual(ids(named), [20]);
  const none = filterPeople({ people, filter: filterOf({ label: { kind: 'none' } }), now: NOW });
  assert.deepEqual(ids(none), [21, 22]);
});

test('the labels on offer are the distinct ones present, sorted, and never the empty one', () => {
  const people = [
    person({ id: 1, email: 'a@example.org', label: 'Family' }),
    person({ id: 2, email: 'b@example.org', label: 'Beta supporter' }),
    person({ id: 3, email: 'c@example.org', label: 'Family' }),
    person({ id: 4, email: 'd@example.org', label: '' }),
    person({ id: 5, email: 'e@example.org', label: null }),
  ];
  assert.deepEqual(labelsOf(people), ['Beta supporter', 'Family']);
  assert.deepEqual(labelsOf([person({ id: 6, email: 'f@example.org' })]), []);
});

// ─── ordering ──────────────────────────────────────────────────────────────

test('newest first puts the latest sign-up on top, and a tie goes to the later account number', () => {
  const sameInstant = ago(5);
  const first = person({ id: 30, email: 'first@example.org', createdAt: sameInstant });
  const second = person({ id: 31, email: 'second@example.org', createdAt: sameInstant });
  const older = person({ id: 32, email: 'older@example.org', createdAt: ago(50) });
  const newest = person({ id: 33, email: 'newest@example.org', createdAt: ago(1) });

  const sorted = sortPeople({ people: [first, older, second, newest], sort: 'newest', now: NOW });
  assert.deepEqual(ids(sorted), [33, 31, 30, 32]);

  // CONTROL: the result does not depend on the order the people arrived in.
  const shuffled = sortPeople({ people: [newest, second, older, first], sort: 'newest', now: NOW });
  assert.deepEqual(ids(shuffled), [33, 31, 30, 32]);
});

test('oldest first is the exact reverse of newest first, ties included', () => {
  const sameInstant = ago(5);
  const people = [
    person({ id: 30, email: 'a@example.org', createdAt: sameInstant }),
    person({ id: 31, email: 'b@example.org', createdAt: sameInstant }),
    person({ id: 32, email: 'c@example.org', createdAt: ago(50) }),
    person({ id: 33, email: 'd@example.org', createdAt: ago(1) }),
  ];
  const newest = ids(sortPeople({ people, sort: 'newest', now: NOW }));
  const oldest = ids(sortPeople({ people, sort: 'oldest', now: NOW }));
  assert.deepEqual(oldest, newest.toReversed());
  assert.notDeepEqual(oldest, newest);
});

test('a sign-up date that does not parse is the oldest there is', () => {
  const broken = person({ id: 40, email: 'broken@example.org', createdAt: 'not a date' });
  const fine = person({ id: 41, email: 'fine@example.org', createdAt: ago(900) });
  assert.deepEqual(ids(sortPeople({ people: [broken, fine], sort: 'newest', now: NOW })), [41, 40]);
  assert.deepEqual(ids(sortPeople({ people: [broken, fine], sort: 'oldest', now: NOW })), [40, 41]);
});

test('last seen puts the most recent sign-in first and somebody who never signed in after everybody who did', () => {
  const never = person({ id: 50, email: 'never@example.org', lastSeenAt: null, createdAt: ago(1) });
  const neverOlder = person({ id: 51, email: 'never2@example.org', lastSeenAt: null, createdAt: ago(9) });
  const recent = person({ id: 52, email: 'recent@example.org', lastSeenAt: ago(0.1) });
  const old = person({ id: 53, email: 'old@example.org', lastSeenAt: ago(60) });

  const sorted = sortPeople({ people: [never, old, neverOlder, recent], sort: 'seen', now: NOW });
  // The two who never signed in keep their own order, newest sign-up first.
  assert.deepEqual(ids(sorted), [52, 53, 50, 51]);
});

test('last seen breaks a tie by the newer sign-up', () => {
  const instant = ago(2);
  const a = person({ id: 60, email: 'a@example.org', lastSeenAt: instant, createdAt: ago(30) });
  const b = person({ id: 61, email: 'b@example.org', lastSeenAt: instant, createdAt: ago(3) });
  assert.deepEqual(ids(sortPeople({ people: [a, b], sort: 'seen', now: NOW })), [61, 60]);
  assert.deepEqual(ids(sortPeople({ people: [b, a], sort: 'seen', now: NOW })), [61, 60]);
});

test('most scans today is the share of the allowance first, then the count', () => {
  const nine = person({ id: 70, email: 'nine@example.org', dailyAiLimit: 10, aiUsedToday: 9 }); // 0.9
  const ninety = person({ id: 71, email: 'ninety@example.org', dailyAiLimit: 100, aiUsedToday: 90 }); // 0.9, more scans
  const full = person({ id: 72, email: 'full@example.org', dailyAiLimit: 10, aiUsedToday: 10 }); // 1.0
  const light = person({ id: 73, email: 'light@example.org', dailyAiLimit: 200, aiUsedToday: 20 }); // 0.1
  const unused = person({ id: 74, email: 'unused@example.org', dailyAiLimit: 200, aiUsedToday: 0 });

  const sorted = sortPeople({ people: [unused, light, nine, ninety, full], sort: 'usage', now: NOW });
  assert.deepEqual(ids(sorted), [72, 71, 70, 73, 74]);
});

test('somebody with no allowance is not a share of zero over zero', () => {
  const none = person({ id: 80, email: 'none@example.org', dailyAiLimit: 0, aiUsedToday: 0 });
  const some = person({ id: 81, email: 'some@example.org', dailyAiLimit: 200, aiUsedToday: 4 });
  const sorted = sortPeople({ people: [none, some], sort: 'usage', now: NOW });
  assert.deepEqual(ids(sorted), [81, 80]);
});

test('a weekly allowance is measured by the week count, and with no week count it has no share', () => {
  const weekly = person({
    id: 90,
    email: 'weekly@example.org',
    dailyAiLimit: 10,
    aiLimitPeriod: 'week',
    aiUsedToday: 0,
    aiUsedThisWeek: 8,
  });
  const weeklyUnknown = person({
    id: 91,
    email: 'unknown@example.org',
    dailyAiLimit: 10,
    aiLimitPeriod: 'week',
    aiUsedToday: 9,
    aiUsedThisWeek: null,
  });
  const daily = person({ id: 92, email: 'daily@example.org', dailyAiLimit: 10, aiUsedToday: 5 });

  // 0.8 beats 0.5. Today's 9 beside a weekly limit would be 0.9 and would put
  // the unknown one on top: it must not.
  const sorted = sortPeople({ people: [weeklyUnknown, daily, weekly], sort: 'usage', now: NOW });
  assert.deepEqual(ids(sorted), [90, 92, 91]);
});

test('name sorts A to Z without regard to case, and a person with no name is filed under their address', () => {
  const zoe = person({ id: 100, email: 'z@example.org', displayName: 'zoe' });
  const adam = person({ id: 101, email: 'a@example.org', displayName: 'Adam' });
  const noName = person({ id: 102, email: 'berta@example.org', displayName: null });
  const sorted = sortPeople({ people: [zoe, noName, adam], sort: 'name', now: NOW });
  assert.deepEqual(ids(sorted), [101, 102, 100]);
});

test('name breaks a tie by address and then by account number, so the order is the same on every load', () => {
  const twinA = person({ id: 110, email: 'b@example.org', displayName: 'Sam' });
  const twinB = person({ id: 111, email: 'a@example.org', displayName: 'Sam' });
  const sameBoth1 = person({ id: 113, email: 'c@example.org', displayName: 'Sam' });
  const sameBoth2 = person({ id: 112, email: 'c@example.org', displayName: 'Sam' });
  const sorted = sortPeople({ people: [twinA, sameBoth1, twinB, sameBoth2], sort: 'name', now: NOW });
  assert.deepEqual(ids(sorted), [111, 110, 112, 113]);
});

test('sorting never touches the list it was given', () => {
  const input = [...EVERYBODY];
  const before = ids(input);
  sortPeople({ people: input, sort: 'name', now: NOW });
  assert.deepEqual(ids(input), before);
});

test('every sort is offered, and "newest" is the default', () => {
  assert.deepEqual([...PEOPLE_SORTS], ['newest', 'oldest', 'seen', 'usage', 'name']);
  assert.equal(EMPTY_PEOPLE_FILTER.sort, 'newest');
});

test('what the list shows is the narrowed people in the chosen order', () => {
  const shown = selectPeople({ people: EVERYBODY, filter: filterOf({ view: 'seen', sort: 'oldest' }), now: NOW });
  // OWNER (sign-up 120 days ago) and DINA (10 days ago) were seen this week; oldest first.
  assert.deepEqual(ids(shown), [1, 4]);
  const newest = selectPeople({ people: EVERYBODY, filter: filterOf({ view: 'seen' }), now: NOW });
  assert.deepEqual(ids(newest), [4, 1]);
});

// ─── the band headings ─────────────────────────────────────────────────────

test('a list by sign-up date is split into this week, this month and earlier', () => {
  const people = [
    person({ id: 120, email: 'a@example.org', createdAt: ago(0.1) }),
    person({ id: 121, email: 'b@example.org', createdAt: ago(6.99) }),
    person({ id: 122, email: 'c@example.org', createdAt: ago(7) }),
    person({ id: 123, email: 'd@example.org', createdAt: ago(29.99) }),
    person({ id: 124, email: 'e@example.org', createdAt: ago(30) }),
    person({ id: 125, email: 'f@example.org', createdAt: ago(300) }),
  ];
  const groups = bandPeople({ people: sortPeople({ people, sort: 'newest', now: NOW }), sort: 'newest', now: NOW });
  assert.deepEqual(
    groups.map((group) => [group.band, ids(group.people)]),
    [
      ['week', [120, 121]],
      ['month', [122, 123]],
      ['earlier', [124, 125]],
    ],
  );
});

test('oldest first shows the bands in the opposite order, with no second sort', () => {
  const people = [
    person({ id: 130, email: 'a@example.org', createdAt: ago(1) }),
    person({ id: 131, email: 'b@example.org', createdAt: ago(300) }),
  ];
  const groups = bandPeople({ people: sortPeople({ people, sort: 'oldest', now: NOW }), sort: 'oldest', now: NOW });
  assert.deepEqual(
    groups.map((group) => group.band),
    ['earlier', 'week'],
  );
});

test('a band that nobody is in gets no heading', () => {
  const onlyEarlier = [person({ id: 140, email: 'a@example.org', createdAt: ago(400) })];
  const groups = bandPeople({ people: onlyEarlier, sort: 'newest', now: NOW });
  assert.deepEqual(
    groups.map((group) => group.band),
    ['earlier'],
  );
});

test('any other sort has one run of rows and no headings, because the bands would be scattered', () => {
  const people = [
    person({ id: 150, email: 'a@example.org', createdAt: ago(1) }),
    person({ id: 151, email: 'b@example.org', createdAt: ago(300) }),
    person({ id: 152, email: 'c@example.org', createdAt: ago(2) }),
  ];
  for (const sort of ['seen', 'usage', 'name'] as const) {
    const groups = bandPeople({ people, sort, now: NOW });
    assert.equal(groups.length, 1, sort);
    assert.equal(groups[0]?.band, null, sort);
    assert.deepEqual(ids(groups[0]?.people ?? []), [150, 151, 152], `${sort} keeps the order it was given`);
  }
  // CONTROL: the same people DO get headings under a sign-up sort.
  assert.ok(bandPeople({ people, sort: 'newest', now: NOW }).length > 1);
});

test('an empty list has no groups at all', () => {
  assert.deepEqual(bandPeople({ people: [], sort: 'newest', now: NOW }), []);
  assert.deepEqual(bandPeople({ people: [], sort: 'name', now: NOW }), []);
});

// ─── the column headings ───────────────────────────────────────────────────

test('Joined toggles between newest and oldest, and the other headings each ask for one sort', () => {
  assert.equal(sortForColumn({ column: 'joined', current: 'newest' }), 'oldest');
  assert.equal(sortForColumn({ column: 'joined', current: 'oldest' }), 'newest');
  // From any other sort, the first press asks for the newest.
  assert.equal(sortForColumn({ column: 'joined', current: 'name' }), 'newest');
  assert.equal(sortForColumn({ column: 'person', current: 'newest' }), 'name');
  assert.equal(sortForColumn({ column: 'usedToday', current: 'newest' }), 'usage');
  assert.equal(sortForColumn({ column: 'lastSeen', current: 'newest' }), 'seen');
  // These do not toggle: pressing the active one again changes nothing.
  assert.equal(sortForColumn({ column: 'person', current: 'name' }), 'name');
  assert.equal(sortForColumn({ column: 'lastSeen', current: 'seen' }), 'seen');
});

test('exactly one heading is active under each sort, and Joined stays active in both directions', () => {
  const columns = ['person', 'joined', 'usedToday', 'lastSeen'] as const;
  for (const sort of PEOPLE_SORTS) {
    const active = columns.filter((column) => isActiveColumn({ column, sort }));
    assert.equal(active.length, 1, sort);
  }
  assert.equal(isActiveColumn({ column: 'joined', sort: 'oldest' }), true);
  assert.equal(isActiveColumn({ column: 'joined', sort: 'seen' }), false);
});

test('the arrow points up for the sorts that read upward and down for the rest', () => {
  assert.equal(sortArrow('name'), 'up');
  assert.equal(sortArrow('oldest'), 'up');
  assert.equal(sortArrow('newest'), 'down');
  assert.equal(sortArrow('seen'), 'down');
  assert.equal(sortArrow('usage'), 'down');
});

// ─── the empty result ──────────────────────────────────────────────────────

test('an empty result names which filter emptied it', () => {
  const none: AdminAccountView[] = [];
  assert.equal(emptyReasonFor({ people: EVERYBODY, filter: filterOf({ query: 'zoe' }), visible: none }), 'query');
  assert.equal(
    emptyReasonFor({ people: [OWNER], filter: filterOf({ view: 'suspended' }), visible: none }),
    'view',
    'a view that nobody is in is not an empty instance',
  );
  assert.equal(
    emptyReasonFor({
      people: [OWNER],
      filter: filterOf({ label: { kind: 'named', label: 'Family' } }),
      visible: none,
    }),
    'label',
  );
  assert.equal(
    emptyReasonFor({ people: EVERYBODY, filter: filterOf({ query: 'zoe', view: 'suspended' }), visible: none }),
    'query-and-view',
  );
});

test('any other mix of filters is "several", and a label with the search is one of them', () => {
  const none: AdminAccountView[] = [];
  assert.equal(
    emptyReasonFor({
      people: EVERYBODY,
      filter: filterOf({ query: 'zoe', label: { kind: 'none' } }),
      visible: none,
    }),
    'several',
  );
  assert.equal(
    emptyReasonFor({
      people: EVERYBODY,
      filter: filterOf({ query: 'zoe', view: 'new', label: { kind: 'none' } }),
      visible: none,
    }),
    'several',
  );
});

test('an instance with nobody on it is its own answer, whatever the filter says', () => {
  assert.equal(
    emptyReasonFor({ people: [], filter: filterOf({ query: 'zoe', view: 'suspended' }), visible: [] }),
    'nobody-here',
  );
});

test('a list with rows on it is not empty and gets no sentence at all', () => {
  assert.equal(emptyReasonFor({ people: EVERYBODY, filter: EMPTY_PEOPLE_FILTER, visible: EVERYBODY }), 'not-empty');
});

// ─── "is anything filtered" ────────────────────────────────────────────────

test('only a search, a view or a label counts as filtered; the sort reorders and hides nobody', () => {
  assert.equal(isPeopleFiltered(EMPTY_PEOPLE_FILTER), false);
  assert.equal(isPeopleFiltered(filterOf({ sort: 'name' })), false, 'CONTROL: a sort is not a filter');
  assert.equal(isPeopleFiltered(filterOf({ query: 'x' })), true);
  assert.equal(isPeopleFiltered(filterOf({ query: '   ' })), false, 'spaces are not a search');
  assert.equal(isPeopleFiltered(filterOf({ view: 'new' })), true);
  assert.equal(isPeopleFiltered(filterOf({ label: { kind: 'none' } })), true);
});

test('two label filters are the same when they mean the same thing', () => {
  assert.equal(isSameLabelFilter({ kind: 'any' }, { kind: 'any' }), true);
  assert.equal(isSameLabelFilter({ kind: 'none' }, { kind: 'none' }), true);
  assert.equal(isSameLabelFilter({ kind: 'named', label: 'A' }, { kind: 'named', label: 'A' }), true);
  assert.equal(isSameLabelFilter({ kind: 'named', label: 'A' }, { kind: 'named', label: 'B' }), false);
  assert.equal(isSameLabelFilter({ kind: 'none' }, { kind: 'any' }), false);
});

// ─── the address ───────────────────────────────────────────────────────────

const KNOWN = ['Beta supporter', 'Family'];

function read(search: string, knownLabels: readonly string[] = KNOWN): PeopleFilter {
  return readPeopleFilter({ params: new URLSearchParams(search), knownLabels });
}

test('an address with nothing in it is the default filter, and the default filter writes nothing', () => {
  assert.deepEqual(read(''), EMPTY_PEOPLE_FILTER);
  assert.equal(writePeopleFilter(EMPTY_PEOPLE_FILTER).toString(), '');
});

test('a filter survives the trip through the address', () => {
  const filters: PeopleFilter[] = [
    filterOf({ view: 'new' }),
    filterOf({ sort: 'oldest' }),
    filterOf({ query: 'anna smith' }),
    filterOf({ label: { kind: 'named', label: 'Beta supporter' } }),
    filterOf({ label: { kind: 'none' } }),
    { query: 'x&y=z', view: 'quiet', label: { kind: 'named', label: 'Family' }, sort: 'usage' },
  ];
  for (const filter of filters) {
    assert.deepEqual(read(writePeopleFilter(filter).toString()), filter, JSON.stringify(filter));
  }
});

test('a default is never written, so the address stays short', () => {
  assert.equal(writePeopleFilter(filterOf({ view: 'new' })).toString(), 'view=new');
  assert.equal(writePeopleFilter(filterOf({ sort: 'newest', view: 'all' })).toString(), '');
  assert.equal(writePeopleFilter(filterOf({ query: '   ' })).toString(), '', 'spaces are not a search');
  assert.equal(writePeopleFilter(filterOf({ label: { kind: 'none' } })).toString(), 'label=');
  // CONTROL: and a non-default IS written, so the empty strings above are not
  // an address writer that writes nothing at all.
  assert.equal(writePeopleFilter(filterOf({ sort: 'oldest', query: 'a' })).toString(), 'sort=oldest&q=a');
});

test('a value this build does not know reads as the default', () => {
  assert.equal(read('view=everybody').view, 'all');
  assert.equal(read('view=NEW').view, 'all', 'case matters: it is a name, not a phrase');
  assert.equal(read('sort=sideways').sort, 'newest');
  assert.equal(read('view=&sort=').view, 'all');
  assert.deepEqual(read('label=No such label').label, { kind: 'any' }, 'a label the instance does not have');
  // CONTROL: a value it DOES know is kept, so the fallbacks above are not a
  // reader that ignores the address.
  assert.equal(read('view=suspended').view, 'suspended');
  assert.equal(read('sort=name').sort, 'name');
});

test('an empty label parameter is "no label", and a named one must be one the instance has', () => {
  assert.deepEqual(read('label=').label, { kind: 'none' });
  assert.deepEqual(read('label=Family').label, { kind: 'named', label: 'Family' });
  assert.deepEqual(read('label=family').label, { kind: 'any' }, 'labels match exactly');
  // No labels on the instance: no label control exists, so no label filter can apply.
  assert.deepEqual(read('label=Family', []).label, { kind: 'any' });
  assert.deepEqual(read('label=', []).label, { kind: 'any' });
});

test('the search is read as typed, except that spaces alone are nothing', () => {
  assert.equal(read('q=anna ').query, 'anna ', 'a trailing space is a character the person typed');
  assert.equal(read('q=%20%20').query, '');
  assert.equal(read('').query, '');
});

test('parameters this build does not know are dropped when the address is rewritten', () => {
  const filter = read('view=new&utm_source=mail&foo=bar');
  assert.equal(writePeopleFilter(filter).toString(), 'view=new');
});
