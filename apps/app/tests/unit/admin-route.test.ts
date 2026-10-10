/**
 * What the administration console PUTS ON SCREEN, in the states that matter.
 *
 * ── Rendered, not inspected ──────────────────────────────────────────────
 *
 * These are `renderToStaticMarkup` assertions against the real shipped English
 * catalog, so a key renamed in a component but not in `en/common.json` fails
 * here rather than showing an administrator `admin.people.empty` where a
 * sentence belongs. The components are presentational by construction, which
 * is what makes this possible without a session, a server or a network.
 *
 * ── What the console became ──────────────────────────────────────────────
 *
 * Three tabs over one layout, a list whose rows are links and carry nothing
 * dangerous, and a page per person that carries every action. The tests below
 * are ordered the way an operator meets those screens.
 *
 *  1. NOT AN ADMINISTRATOR. One card, no data, and a way out. This is what a
 *     signed-out visitor, an ordinary account and a just-demoted administrator
 *     all see, and it must never be a blank page.
 *  2. THE TABS. Which one is lit, including on a person's page, which is
 *     somewhere the people list leads rather than a fourth place.
 *  3. THE PEOPLE LIST. Compact rows that are links, a filter that narrows
 *     them, and an empty result that names the filter that emptied it.
 *  4. THE STRIPS. Seven squares beside a row, and a list that still renders
 *     when the batch activity request failed.
 *  4b. THE NAMES OF THE VALUES. A row ends in two figures and a date, and no
 *     width may leave any of them unlabelled: a header where the row is a row,
 *     an inline label per value where it is not. The counts below are what
 *     makes that falsifiable: one occurrence is a header alone, and the rows
 *     underneath would be bare numbers again.
 *  5. THE PERSON PAGE. Every action, and the two the service would refuse on
 *     your own account, which are absent rather than explained.
 *  3b. FINDING SOMEBODY (2026-10-11). Newest first with a "New" badge and band
 *     headings, quick-view chips that carry their counts, a result line that
 *     keeps its box, sortable column headings, a label menu, and the usage bar
 *     and the amber "never signed in" in the row.
 *  6. THE INVITATIONS TAB. Every state behind a chip, pending first.
 *  7. THE INVITE RESULT, with and without mail.
 *  8. A HAND-PASSED LINK THAT OPENS ANOTHER ADDRESS than the page, which
 *     says so under the link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { AdminTabs } from '../../app/components/admin/admin-tabs';
import { StatsRow } from '../../app/components/admin/stats-row';
import { NotAnAdministratorCard } from '../../app/components/admin/not-an-administrator';
import { CopyableLinkView, InviteResult } from '../../app/components/admin/invite-result';
import { InviteTable } from '../../app/components/admin/invite-table';
import { ActivityOverview } from '../../app/components/admin/activity-overview';
import { PeopleTable } from '../../app/components/admin/people-table';
import { PersonDetail } from '../../app/components/admin/person-detail';
import { PersonEditor } from '../../app/components/admin/person-actions';
import { EMPTY_PEOPLE_FILTER, type PeopleFilter } from '../../app/lib/admin/people-filter';
import type { InviteStatusFilter } from '../../app/lib/admin/invite-filter';
import type { ActivityByAccount } from '../../app/lib/admin/activity-strip';
import type {
  AdminAccountActivity,
  AdminAccountView,
  AdminActivityDay,
  InviteView,
} from '../../app/lib/admin/admin-wire';

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
  allowanceExpiresAt: null,
  freeDailyAiLimit: 0,
  suspendedAt: null,
  invitesLeft: null,
  trialScans: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  lastSeenAt: '2026-09-06T18:30:00.000Z',
  label: null,
};

const SUSPENDED_PERSON: AdminAccountView = {
  id: 2,
  email: 'anna@example.org',
  displayName: null,
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 7,
  allowanceExpiresAt: null,
  freeDailyAiLimit: 0,
  suspendedAt: '2026-09-03T09:00:00.000Z',
  invitesLeft: null,
  trialScans: null,
  createdAt: '2026-08-20T09:00:00.000Z',
  lastSeenAt: '2026-09-05T07:15:00.000Z',
  label: null,
};

/** Somebody who was invited and never arrived. `lastSeenAt` is null and the screen owes them a sentence. */
const NEVER_ARRIVED: AdminAccountView = {
  id: 3,
  email: 'carla@example.org',
  displayName: 'Carla',
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 0,
  allowanceExpiresAt: null,
  freeDailyAiLimit: 0,
  suspendedAt: null,
  invitesLeft: null,
  trialScans: null,
  createdAt: '2026-09-05T09:00:00.000Z',
  lastSeenAt: null,
  label: null,
};

/** A window of `days` days ending on 2026-09-07, with the counts given for the days named. */
function activityDays(days: number, counted: Readonly<Record<string, number>>): AdminActivityDay[] {
  const end = Date.parse('2026-09-07T00:00:00.000Z');
  return Array.from({ length: days }, (_entry, index) => {
    const day = new Date(end - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10);
    return { day, count: counted[day] ?? 0 };
  });
}

const ACTIVITY: AdminAccountActivity = {
  accountId: 2,
  lastSeenAt: '2026-09-05T07:15:00.000Z',
  window: { days: 90, fromDay: '2026-06-10', toDay: '2026-09-07' },
  days: activityDays(90, { '2026-09-05': 4, '2026-09-06': 0, '2026-09-07': 1 }),
};

/** The seven day strips the people list draws beside its rows. */
const WEEK_BY_ACCOUNT: ActivityByAccount = new Map([
  [ADMIN.id, activityDays(7, { '2026-09-07': 3 })],
  [SUSPENDED_PERSON.id, activityDays(7, {})],
]);

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

/**
 * The clock every age in these renders is measured against. A fixed instant:
 * "joined 2 days ago" is a fact about two instants, and a render that read the
 * real clock would be a different test every week. Noon UTC, so no time zone
 * reads another day.
 */
const NOW = new Date('2026-09-07T12:00:00.000Z');

/** A filter with the parts a test names set and every other part at its default. */
function filterOf(overrides: Partial<PeopleFilter>): PeopleFilter {
  return { ...EMPTY_PEOPLE_FILTER, ...overrides };
}

/** The people list with no strips and no filter set, which is what it looks like on a first load. */
function peopleList(input: {
  people: AdminAccountView[];
  currentAccountId?: number;
  activity?: ActivityByAccount | null;
  filter?: PeopleFilter;
}): string {
  return render(
    createElement(PeopleTable, {
      people: input.people,
      currentAccountId: input.currentAccountId ?? 99,
      activity: input.activity ?? null,
      filter: input.filter ?? EMPTY_PEOPLE_FILTER,
      onFilterChange: () => {
        throw new Error('a render must not change the filter');
      },
      now: NOW,
    }),
  );
}

/** Callbacks that would fail the test if a render triggered one. Nothing here should call the network. */
const NEVER_ACTS = {
  onSave: () => Promise.reject(new Error('a render must not save')),
  onSetSuspended: () => Promise.reject(new Error('a render must not suspend')),
  onSendResetMail: () => Promise.reject(new Error('a render must not send mail')),
  onDelete: () => Promise.reject(new Error('a render must not delete')),
  onRetryActivity: () => undefined,
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
// 2. The tabs
// ---------------------------------------------------------------------------

test('the three tabs are links, and the people tab is the one lit at /admin', () => {
  const html = render(createElement(AdminTabs, { pathname: '/admin', hasFeedback: false }));

  // The attributes come out in React's order, `aria-current` before `href`.
  assert.match(html, /aria-current="page"[^>]*href="\/admin"/, 'a tab is a link, not a widget with state');
  assert.match(html, /href="\/admin\/invitations"/);
  assert.match(html, /href="\/admin\/activity"/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1, 'exactly one tab is current');
});

test("a person's page lights the people tab, because it is where the list leads", () => {
  const html = render(createElement(AdminTabs, { pathname: '/admin/people/2', hasFeedback: false }));

  assert.match(html, /aria-current="page"[^>]*href="\/admin"/);
  assert.doesNotMatch(html, /aria-current="page"[^>]*href="\/admin\/activity"/);
});

test('the invitation form lights the invitations tab rather than nothing at all', () => {
  const html = render(createElement(AdminTabs, { pathname: '/admin/invite', hasFeedback: false }));

  assert.match(html, /aria-current="page"[^>]*href="\/admin\/invitations"/);
});

// ---------------------------------------------------------------------------
// 3. The people list
// ---------------------------------------------------------------------------

test('the list shows two people, their usage and their standing', () => {
  const html = peopleList({ people: [ADMIN, SUSPENDED_PERSON] });

  assert.match(html, /owner@example\.org/);
  assert.match(html, /anna@example\.org/);
  // "used of limit", never a bare number: 7 means nothing without the 200.
  assert.match(html, /12 of 500/);
  assert.match(html, /7 of 200/);
  assert.match(html, /Administrator/);
  // A person with no name is not a blank cell.
  assert.match(html, /No name/);
});

test('a row is a real link to that person, and carries nothing that changes them', () => {
  const html = peopleList({ people: [ADMIN, SUSPENDED_PERSON] });

  assert.match(html, /href="\/admin\/people\/1"/, 'middle click and the back button need a real link');
  assert.match(html, /href="\/admin\/people\/2"/);
  // EVERY action left the row. A button in the list would also be a click
  // target nested inside the link that wraps the row. The controls above the
  // rows (chips, sort headings) are buttons; no ROW is.
  const rows = html.split('<li>').slice(1);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.doesNotMatch(row, /<button/, 'a list is for finding somebody, not for acting on them');
  assert.doesNotMatch(html, /Send a reset link|Delete|Bring back/);
  // CONTROL: the page does have buttons, so the loop above is not reading a page without any.
  assert.match(html, /<button/);
});

test('an account that has never signed in renders words, not an epoch', () => {
  const html = peopleList({ people: [NEVER_ARRIVED] });

  assert.match(html, /Never signed in/);
  assert.doesNotMatch(html, /1970/, 'a null timestamp is not the first of January 1970');
});

test('an allowance of zero is its own sentence, not "0 of 0"', () => {
  const html = peopleList({ people: [{ ...SUSPENDED_PERSON, dailyAiLimit: 0, aiUsedToday: 0 }] });

  assert.match(html, /No photos/);
  assert.doesNotMatch(html, /0 of 0/);
});

test('an empty instance says so instead of rendering an empty box', () => {
  assert.match(peopleList({ people: [] }), /Nobody has an account here yet/);
});

test('the search narrows the rows to the people it matches, by name or by address', () => {
  const people = [ADMIN, SUSPENDED_PERSON, NEVER_ARRIVED];

  const byAddress = peopleList({ people, filter: filterOf({ query: '  ANNA ' }) });
  assert.match(byAddress, /anna@example\.org/, 'trimmed and case insensitive');
  assert.doesNotMatch(byAddress, /owner@example\.org/);
  assert.doesNotMatch(byAddress, /carla@example\.org/);

  const byName = peopleList({ people, filter: filterOf({ query: 'carl' }) });
  assert.match(byName, /carla@example\.org/);
  assert.doesNotMatch(byName, /owner@example\.org/);
});

test('a quick view narrows the rows to a standing, a role, or a sign-in state', () => {
  const people = [ADMIN, SUSPENDED_PERSON, NEVER_ARRIVED];

  const suspended = peopleList({ people, filter: filterOf({ view: 'suspended' }) });
  assert.match(suspended, /anna@example\.org/);
  assert.doesNotMatch(suspended, /owner@example\.org|carla@example\.org/);

  const admins = peopleList({ people, filter: filterOf({ view: 'administrators' }) });
  assert.match(admins, /owner@example\.org/);
  assert.doesNotMatch(admins, /carla@example\.org|anna@example\.org/);

  const never = peopleList({ people, filter: filterOf({ view: 'never' }) });
  assert.match(never, /carla@example\.org/);
  assert.doesNotMatch(never, /owner@example\.org|anna@example\.org/);
});

test('a filter that matches nobody names the filter, and never says only "no results"', () => {
  const people = [ADMIN, SUSPENDED_PERSON];

  const byQuery = peopleList({ people, filter: filterOf({ query: 'zoe' }) });
  assert.match(byQuery, /Nobody here matches &quot;zoe&quot;\./, 'the search term is quoted back');
  assert.doesNotMatch(byQuery, /Nobody has an account here yet/, 'an instance with people is not an empty instance');

  const byGroup = peopleList({ people: [ADMIN], filter: filterOf({ view: 'suspended' }) });
  assert.match(
    byGroup,
    /Nobody here is in &quot;Suspended&quot;\./,
    'the view is named, because it is easy to forget',
  );

  const byBoth = peopleList({ people, filter: filterOf({ query: 'zoe', view: 'administrators' }) });
  assert.match(byBoth, /Nobody in &quot;Administrators&quot; matches &quot;zoe&quot;\./);
});

// ---------------------------------------------------------------------------
// 3b. Finding somebody
// ---------------------------------------------------------------------------

/** Joined a day ago, signed in an hour ago, and half the allowance spent. */
const FRESH_MEMBER: AdminAccountView = {
  ...NEVER_ARRIVED,
  id: 7,
  email: 'fresh@example.org',
  displayName: 'Fresh Member',
  createdAt: '2026-09-06T09:00:00.000Z',
  lastSeenAt: '2026-09-07T11:00:00.000Z',
  dailyAiLimit: 10,
  aiUsedToday: 5,
};

/** The markup of one person's row, so a badge or a bar on another row cannot satisfy the assertion. */
function rowOf(html: string, email: string): string {
  return html.split('<li>').find((item) => item.includes(email)) ?? '';
}

test('somebody who joined in the last week carries a New badge, and nobody else does', () => {
  const html = peopleList({ people: [ADMIN, FRESH_MEMBER, NEVER_ARRIVED] });

  assert.match(rowOf(html, 'fresh@example.org'), /data-new-badge/);
  assert.match(rowOf(html, 'carla@example.org'), /data-new-badge/, 'joined 2026-09-05, two days before NOW');
  // CONTROL: the administrator joined in August.
  assert.doesNotMatch(rowOf(html, 'owner@example.org'), /data-new-badge/);
});

test('the Joined column says today, yesterday, days ago, and then a short date', () => {
  const html = peopleList({ people: [ADMIN, FRESH_MEMBER, NEVER_ARRIVED] });

  assert.match(rowOf(html, 'fresh@example.org'), /Yesterday/);
  assert.match(rowOf(html, 'carla@example.org'), /2 days ago/);
  assert.match(rowOf(html, 'owner@example.org'), /1 Aug/, 'past a week it is a date, without the year this year');
});

test('the list opens newest first, under This week and This month and Earlier', () => {
  const html = peopleList({ people: [ADMIN, SUSPENDED_PERSON, FRESH_MEMBER, NEVER_ARRIVED] });

  const order = ['fresh@example.org', 'carla@example.org', 'anna@example.org', 'owner@example.org'].map((email) =>
    html.indexOf(email),
  );
  assert.deepEqual(
    order,
    order.toSorted((a, b) => a - b),
    'newest sign-up first, whatever order the service sent',
  );
  assert.ok(order.every((index) => index > -1));
  assert.match(html, />This week</);
  assert.match(html, />This month</, 'anna joined 18 days before NOW');
  assert.match(html, />Earlier</, 'the administrator joined in August');
});

test('a sort that is not by sign-up date draws no band headings', () => {
  const people = [ADMIN, SUSPENDED_PERSON, FRESH_MEMBER];
  const byName = peopleList({ people, filter: filterOf({ sort: 'name' }) });
  assert.doesNotMatch(byName, />This week<|>This month<|>Earlier</);
  // CONTROL: the same people, by sign-up, do have them.
  assert.match(peopleList({ people, filter: filterOf({ sort: 'oldest' }) }), />Earlier</);
});

test('every quick view is a toggle button with its count, and the pressed one says so', () => {
  const html = peopleList({ people: [ADMIN, SUSPENDED_PERSON, FRESH_MEMBER, NEVER_ARRIVED], filter: filterOf({ view: 'new' }) });

  const chip = (id: string) => html.match(new RegExp(`<button[^>]*data-chip="${id}"[^>]*>.*?</button>`))?.[0] ?? '';
  assert.match(chip('all'), /aria-pressed="false"[^>]*>All<span[^>]*>4</);
  assert.match(chip('new'), /aria-pressed="true"[^>]*>New this week<span[^>]*>2</);
  assert.match(chip('never'), />Never signed in<span[^>]*>1</);
  assert.match(chip('suspended'), />Suspended<span[^>]*>1</);
  assert.match(chip('administrators'), />Administrators<span[^>]*>1</);
  assert.equal((html.match(/data-chip="/g) ?? []).length, 7);
  assert.equal((html.match(/aria-pressed="true"[^>]*data-chip=/g) ?? []).length, 1, 'exactly one chip is pressed');
});

test('a chip with nothing behind it is dimmed but still a button, and a pressed one is not dimmed', () => {
  const html = peopleList({ people: [ADMIN], filter: filterOf({ view: 'never' }) });
  const never = html.match(/<button[^>]*data-chip="never"[^>]*>/)?.[0] ?? '';
  const suspended = html.match(/<button[^>]*data-chip="suspended"[^>]*>/)?.[0] ?? '';

  assert.match(suspended, /opacity-50/, 'nobody is suspended');
  assert.doesNotMatch(suspended, /disabled/, 'dimmed is not disabled: the question was worth asking');
  assert.doesNotMatch(never, /opacity-50/, 'the pressed chip is never dimmed, even at zero');
});

/** The Clear filters button of a rendered list, or an empty string. */
function clear(html: string): string {
  return html.match(/<button[^>]*>Clear filters<\/button>/)?.[0] ?? '';
}

test('the result line counts the rows against the instance, and keeps Clear filters in its box', () => {
  const people = [ADMIN, SUSPENDED_PERSON, NEVER_ARRIVED];
  const unfiltered = peopleList({ people });
  assert.match(unfiltered, /<output[^>]*>3 of 3 people<\/output>/);

  // THE BUTTON IS THERE EITHER WAY, and only its visibility differs.
  assert.match(clear(unfiltered), /invisible/, 'nothing is filtered, so it is not drawn');

  const filtered = peopleList({ people, filter: filterOf({ view: 'suspended' }) });
  assert.match(filtered, /<output[^>]*>1 of 3 people<\/output>/);
  assert.ok(clear(filtered).length > 0, 'present in the box');
  assert.doesNotMatch(clear(filtered), /invisible/);

  // A sort alone filters nothing.
  assert.match(clear(peopleList({ people, filter: filterOf({ sort: 'name' }) })), /invisible/);
});

test('a label menu is offered only where somebody carries a label, and lists each label once', () => {
  const withLabels = peopleList({
    people: [
      { ...ADMIN, label: 'Family' },
      { ...SUSPENDED_PERSON, label: 'Beta supporter' },
      { ...NEVER_ARRIVED, label: 'Family' },
    ],
  });
  const menu = withLabels.match(/<select id="admin-people-label".*?<\/select>/)?.[0] ?? '';
  assert.match(menu, />Any label</);
  assert.match(menu, />No label</);
  assert.equal((menu.match(/>Family</g) ?? []).length, 1);
  assert.equal((menu.match(/>Beta supporter</g) ?? []).length, 1);

  // CONTROL: with no label anywhere there is no such menu.
  assert.doesNotMatch(peopleList({ people: [ADMIN, SUSPENDED_PERSON] }), /admin-people-label/);
});

test('the label filter narrows the rows, and the search also reads the label', () => {
  const people = [{ ...ADMIN, label: 'Family' }, SUSPENDED_PERSON];

  const named = peopleList({ people, filter: filterOf({ label: { kind: 'named', label: 'Family' } }) });
  assert.match(named, /owner@example\.org/);
  assert.doesNotMatch(named, /anna@example\.org/);

  const none = peopleList({ people, filter: filterOf({ label: { kind: 'none' } }) });
  assert.match(none, /anna@example\.org/);
  assert.doesNotMatch(none, /owner@example\.org/);

  const bySearch = peopleList({ people, filter: filterOf({ query: 'famil' }) });
  assert.match(bySearch, /owner@example\.org/);
  assert.doesNotMatch(bySearch, /anna@example\.org/);
});

test('an empty result for a label, or for several filters, still names what emptied it', () => {
  const people = [ADMIN, SUSPENDED_PERSON];

  const label = peopleList({ people: [{ ...ADMIN, label: 'Family' }], filter: filterOf({ label: { kind: 'named', label: 'Beta' } }) });
  // The label menu would not offer "Beta", but a stale filter can still ask for it.
  assert.match(label, /Nobody here has the label &quot;Beta&quot;\./);

  const several = peopleList({ people, filter: filterOf({ query: 'zoe', view: 'suspended', label: { kind: 'none' } }) });
  assert.match(several, /Nobody here matches &quot;zoe&quot;, &quot;Suspended&quot;, no label\./);
});

test('the four sortable headings are buttons, and only the active one shows its arrow', () => {
  const html = peopleList({ people: [ADMIN, FRESH_MEMBER] });

  for (const column of ['person', 'joined', 'usedToday', 'lastSeen']) {
    assert.match(html, new RegExp(`data-sort-column="${column}"`), column);
  }
  const heading = (column: string) => html.match(new RegExp(`<button[^>]*data-sort-column="${column}".*?</button>`))?.[0] ?? '';
  assert.match(heading('joined'), /aria-pressed="true"/, 'newest first is the default, so Joined is active');
  assert.doesNotMatch(heading('joined'), /invisible/, 'its arrow is drawn');
  assert.match(heading('person'), /aria-pressed="false"/);
  assert.match(heading('person'), /invisible/, 'an idle heading keeps its arrow in the box and does not draw it');

  const oldest = peopleList({ people: [ADMIN, FRESH_MEMBER], filter: filterOf({ sort: 'oldest' }) });
  assert.match(oldest.match(/<button[^>]*data-sort-column="joined".*?<\/button>/)?.[0] ?? '', /lucide-arrow-up/);
  assert.match(heading('joined'), /lucide-arrow-down/);
});

test('Used today draws a thin bar, amber from eighty percent of the allowance', () => {
  const nearly = { ...FRESH_MEMBER, aiUsedToday: 8 };
  const html = peopleList({ people: [nearly, ADMIN] });

  assert.match(rowOf(html, 'fresh@example.org'), /data-usage-bar="hot"[^>]*bg-accent-amber[^>]*width:80%/);
  // CONTROL: 12 of 500 is under the threshold and stays the primary colour.
  assert.match(rowOf(html, 'owner@example.org'), /data-usage-bar="ok"[^>]*bg-primary[^>]*width:2%/);
  // And 7 of 10 is just under it.
  const under = peopleList({ people: [{ ...FRESH_MEMBER, aiUsedToday: 7 }] });
  assert.match(under, /data-usage-bar="ok"/);
});

test('somebody who never signed in is told so in amber, and somebody who did is not', () => {
  const html = peopleList({ people: [NEVER_ARRIVED, FRESH_MEMBER] });

  const never = rowOf(html, 'carla@example.org');
  assert.match(never, /text-accent-amber[^>]*data-last-seen="never"[^>]*>/);
  // The sentence is always in the markup for a screen reader; from the wide form on only the short word is drawn.
  assert.match(never, /<span class="@2xl:sr-only">Never signed in<\/span>/);
  assert.match(never, /<span class="hidden @2xl:inline" aria-hidden="true"[^>]*>Never<\/span>/);
  // CONTROL: somebody who did sign in has neither.
  assert.doesNotMatch(rowOf(html, 'fresh@example.org'), /data-last-seen-short|Never/);
  assert.doesNotMatch(rowOf(html, 'fresh@example.org'), /data-last-seen="never"/);
  assert.match(rowOf(html, 'fresh@example.org'), /Today/, 'signed in an hour before NOW');
});

test('the counts at the top are doors: people, administrators and open invitations are links', () => {
  const stats = { accounts: 12, admins: 2, pendingInvites: 3, aiRequestsToday: 40 };
  const html = render(createElement(StatsRow, { stats }));

  assert.match(html, /<a aria-label="People: 12"[^>]*href="\/admin"/);
  assert.match(html, /href="\/admin\?view=administrators"/);
  assert.match(html, /href="\/admin\/invitations"/);
  // THE CONTROL: photos read today has no list behind it, so it is a plain cell.
  assert.equal((html.match(/<a /g) ?? []).length, 3);
  assert.match(html, /Photos read today/);
  assert.match(html, />40</);
});

test('the counts keep their box while they are unread: invisible, not absent', () => {
  const html = render(createElement(StatsRow, { stats: null }));
  assert.match(html, /<dl class="[^"]*\binvisible\b/);
  assert.equal((html.match(/<dt/g) ?? []).length, 4);
});

// ---------------------------------------------------------------------------
// 4. The strips beside a row
// ---------------------------------------------------------------------------

test('a row draws seven squares, and a quiet day is one of them', () => {
  const html = peopleList({ people: [ADMIN], activity: WEEK_BY_ACCOUNT });

  assert.match(html, /2026-09-07: 3/, 'the square carries its day and its count as text');
  assert.match(html, /2026-09-06: 0/, 'a quiet day is drawn, not skipped');
  // One `<li>` for the row, seven for the week.
  assert.equal((html.match(/<li/g) ?? []).length, 8);
});

test('a failed activity request costs the strips and never the list', () => {
  // This is what an instance whose server predates the batch endpoint looks
  // like: the request 404s, the route catches it, and `activity` is null.
  const html = peopleList({ people: [ADMIN, SUSPENDED_PERSON], activity: null });

  assert.match(html, /owner@example\.org/, 'the people are the page; the squares are an ornament on it');
  assert.match(html, /anna@example\.org/);
  assert.match(html, /12 of 500/);
  assert.doesNotMatch(html, /2026-09-/, 'no strip is drawn at all');
  assert.equal((html.match(/<li/g) ?? []).length, 2, 'two rows, and no squares');
});

// ---------------------------------------------------------------------------
// 4b. Every value in a row has a name
// ---------------------------------------------------------------------------

/** How often a label appears in the markup. One header, plus one per row that carries the value. */
function occurrences(html: string, label: string): number {
  return (html.match(new RegExp(label, 'g')) ?? []).length;
}

test('the people list heads its columns, and every row still names its own values', () => {
  const html = peopleList({ people: [ADMIN, SUSPENDED_PERSON], activity: WEEK_BY_ACCOUNT });

  // The header, drawn once, for the widths that can carry it.
  assert.match(html, /Person/, 'the column of names is named');
  assert.match(html, /Last 7 days/, 'the strip says what window it covers');
  assert.match(html, /Used today/, '"12 of 500" is not self-explanatory');
  assert.match(html, /Last sign-in/, 'a bare date reads as a joining date just as easily');

  // ONE OF EACH IS THE HEADER. The rows must carry their own labels too,
  // because below the breakpoint the row reflows and a header over it would
  // name nothing. Two people, so three of each: fail if a row loses its label.
  assert.equal(occurrences(html, 'Used today'), 3, 'the header, and one label inside each of the two rows');
  assert.equal(occurrences(html, 'Last sign-in'), 3);
  assert.equal(occurrences(html, 'Last 7 days'), 3);
});

test('a list drawn without strips names no strip column', () => {
  const html = peopleList({ people: [ADMIN], activity: null });

  assert.doesNotMatch(html, /Last 7 days/, 'a heading over an absence is a promise the page is not keeping');
  assert.equal(occurrences(html, 'Used today'), 2, 'the columns that are still drawn are still named');
  assert.equal(occurrences(html, 'Last sign-in'), 2);
});

test('a row looks like it goes somewhere: a chevron at its end, and a hover background', () => {
  const html = peopleList({ people: [ADMIN, SUSPENDED_PERSON] });

  // The chevron is the part a pointerless screen can also see. `(hover: hover)`
  // is false in a headless browser, so the hover class is asserted here rather
  // than looked for in a screenshot.
  assert.equal((html.match(/lucide-chevron-right/g) ?? []).length, 2, 'one per row, at the end of the row');
  assert.match(html, /hover:bg-muted\/50/, 'the background the app already uses for a hovered list row');
});

test('the chevron is hidden below the wide form, where it would sit alone in a cell', () => {
  // Below the container's `@2xl` the row is two columns of labelled cells, and
  // the chevron, being the last item with nothing to sit beside, would land
  // alone in a cell of its own, pointing at nothing. The whole row is already
  // the link at every width, so the chevron is a hint, never the only
  // affordance, and hiding it there costs nothing.
  const html = peopleList({ people: [ADMIN] });

  assert.match(
    html,
    /class="lucide lucide-chevron-right hidden h-4 w-4 shrink-0 text-muted-foreground @2xl:block"/,
    'hidden by default, shown again once the container is wide enough for columns',
  );
});

test('the activity list names the date under each name, at every width', () => {
  const html = render(
    createElement(ActivityOverview, {
      people: [ADMIN, SUSPENDED_PERSON],
      state: {
        kind: 'ready',
        window: { days: 7, fromDay: '2026-09-01', toDay: '2026-09-07' },
        activity: WEEK_BY_ACCOUNT,
      },
      requestedDays: 7,
      onRequestDays: () => undefined,
      onRetry: () => undefined,
    }),
  );

  // This is the defect: the date under a name was the last sign in and said so
  // nowhere. Three occurrences is the header plus one label per row.
  assert.equal(occurrences(html, 'Last sign-in'), 3);
  assert.equal(occurrences(html, 'Photos read'), 3, 'and the total beside it is a bare number without its name');
  assert.equal(occurrences(html, 'Last 7 days'), 3);
  assert.match(html, /Person/);
});

test('the activity list names no strip column while the strips are still loading', () => {
  const html = render(
    createElement(ActivityOverview, {
      people: [ADMIN],
      state: { kind: 'loading' },
      requestedDays: 30,
      onRequestDays: () => undefined,
      onRetry: () => undefined,
    }),
  );

  assert.doesNotMatch(html, /Photos read/, 'nothing is read on screen yet, so nothing is headed');
  assert.equal(occurrences(html, 'Last sign-in'), 2, 'the one column that is drawn is still named');
});

// ---------------------------------------------------------------------------
// 5. One person's page
// ---------------------------------------------------------------------------

test("a person's page carries every action that left the row", () => {
  const html = render(
    createElement(PersonDetail, {
      person: SUSPENDED_PERSON,
      activity: { kind: 'ready', activity: ACTIVITY },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );

  assert.match(html, /anna@example\.org/);
  assert.match(html, />Change</, 'role and allowance');
  assert.match(html, /Send a reset link/);
  assert.match(html, /Bring back/, 'a suspended person is brought back rather than suspended again');
  assert.match(html, /Delete/);
  assert.match(html, /href="\/admin"/, 'and a way back to the list');
});

test('an active person is offered suspension, and a suspended one is not offered it twice', () => {
  const html = render(
    createElement(PersonDetail, {
      person: NEVER_ARRIVED,
      activity: { kind: 'loading' },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );

  assert.match(html, />Suspend</);
  assert.doesNotMatch(html, /Bring back/);
});

test('your own page refuses the two changes that could lock you out, and says nothing false about the rest', () => {
  const html = render(
    createElement(PersonDetail, {
      person: ADMIN,
      activity: { kind: 'ready', activity: ACTIVITY },
      isSelf: true,
      ...NEVER_ACTS,
    }),
  );

  assert.match(html, /owner@example\.org/);
  assert.match(html, />You</, 'the page says whose it is');
  assert.doesNotMatch(html, />Suspend</, 'the last administrator must not be able to lock themselves out');
  assert.doesNotMatch(html, /Delete/);
  // Looking is not changing, and neither is a reset link an administrator
  // sends to their own mailbox.
  assert.match(html, />Change</);
  assert.match(html, /Send a reset link/);
  assert.match(html, /cannot lock themselves out/, 'an absent button is explained rather than merely missing');
});

test('the detail view shows the four facts and no diary content', () => {
  const html = render(
    createElement(PersonDetail, {
      person: SUSPENDED_PERSON,
      activity: { kind: 'ready', activity: ACTIVITY },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );

  assert.match(html, /Last sign-in/);
  assert.match(html, /Joined/);
  assert.match(html, /7 of 200/, "today's usage is shown against the allowance, as in the list");
  assert.match(html, /Photos read per day/);
  assert.match(html, /The last 90 days, 2026-06-10 to 2026-09-07/, 'the window is stated, in day keys');
  assert.match(html, /encrypted on their own device/, 'the absence of diary content is said, not left to be assumed');
});

test('the strip draws one square per day the service sent, and a quiet day is one of them', () => {
  const html = render(
    createElement(PersonDetail, {
      person: SUSPENDED_PERSON,
      activity: { kind: 'ready', activity: ACTIVITY },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );

  assert.equal((html.match(/<li /g) ?? []).length, 90, 'ninety days in the window, ninety squares');
  // A quiet day carries its own reading, so it can never be confused with a
  // day that is simply not in the answer.
  assert.match(html, /2026-09-06: 0/);
  assert.match(html, /2026-09-05: 4/);
  assert.match(html, /Photos read in this window: 5/);
});

test('a window with nothing in it says so rather than showing an empty box', () => {
  const html = render(
    createElement(PersonDetail, {
      person: NEVER_ARRIVED,
      activity: {
        kind: 'ready',
        activity: { ...ACTIVITY, accountId: 3, lastSeenAt: null, days: activityDays(90, {}) },
      },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );

  assert.match(html, /Never signed in/);
  assert.match(html, /Nothing has been read in this window/);
  assert.equal((html.match(/<li /g) ?? []).length, 90, 'the days still exist, they are just all zero');
});

test('a failed strip offers its own retry and does not take the person with it', () => {
  const html = render(
    createElement(PersonDetail, {
      person: SUSPENDED_PERSON,
      activity: { kind: 'failed' },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );

  assert.match(html, /anna@example\.org/, 'the facts already in hand stay on screen');
  assert.match(html, /The daily counts could not be loaded/);
  assert.match(html, /Try again/);
  assert.match(html, /Delete/, 'and the actions are still there');
});

// ---------------------------------------------------------------------------
// 6. The invitations tab
// ---------------------------------------------------------------------------

/** The invitation table with nothing wired: a render must not resend, revoke or change the chip. */
function inviteList(input: { invites: InviteView[]; status?: InviteStatusFilter }): string {
  return render(
    createElement(InviteTable, {
      invites: input.invites,
      status: input.status ?? 'pending',
      onStatusChange: () => {
        throw new Error('a render must not change the status');
      },
      now: NOW,
      onResend: () => Promise.reject(new Error('a render must not resend')),
      onRevoke: () => Promise.reject(new Error('a render must not revoke')),
    }),
  );
}

test('the invitations tab shows the one that is pending, with what was sent and when it ends', () => {
  const html = inviteList({ invites: [PENDING_INVITE] });

  assert.match(html, /bea@example\.org/);
  assert.match(html, /Bea/);
  assert.match(html, /Sent 3 days ago/, 'sent 2026-09-04, read at 2026-09-07 noon');
  assert.match(html, /200 photos a day/);
  assert.match(html, /Expires in 3 days/, 'expires 2026-09-11 09:00, so three whole days and some');
  assert.match(html, /Send again/);
  assert.match(html, /Withdraw/);
});

test('an invitation that ends in under three days says so in amber, and one that ends later does not', () => {
  const soon = inviteList({ invites: [{ ...PENDING_INVITE, expiresAt: '2026-09-09T09:00:00.000Z' }] });
  assert.match(soon, /text-accent-amber[^>]*>Expires in 1 day</, 'the number and the flag agree: one whole day left');

  const today = inviteList({ invites: [{ ...PENDING_INVITE, expiresAt: '2026-09-07T20:00:00.000Z' }] });
  assert.match(today, /text-accent-amber[^>]*>Expires today</);

  // THE CONTROL: three whole days is not "soon", and draws no amber at all.
  const later = inviteList({ invites: [PENDING_INVITE] });
  assert.doesNotMatch(later, /text-accent-amber/);
});

test('every state is reachable behind its chip, and pending is the default view', () => {
  const invites: InviteView[] = [
    PENDING_INVITE,
    { ...PENDING_INVITE, id: 13, email: 'redeemed@example.org', status: 'redeemed', redeemedAccountId: 4 },
    { ...PENDING_INVITE, id: 14, email: 'revoked@example.org', status: 'revoked' },
    { ...PENDING_INVITE, id: 15, email: 'expired@example.org', status: 'expired' },
  ];

  const pending = inviteList({ invites });
  assert.match(pending, /bea@example\.org/);
  assert.doesNotMatch(pending, /redeemed@example\.org|revoked@example\.org|expired@example\.org/);

  const expired = inviteList({ invites, status: 'expired' });
  assert.match(expired, /expired@example\.org/);
  assert.doesNotMatch(expired, /bea@example\.org|revoked@example\.org/);
  assert.match(expired, /Send again/, 'an expired invitation can be sent again');
  assert.doesNotMatch(expired, /Withdraw/, 'and has nothing left to withdraw');

  const redeemed = inviteList({ invites, status: 'redeemed' });
  assert.match(redeemed, /redeemed@example\.org/);
  assert.doesNotMatch(redeemed, /Send again|Withdraw/, 'an accepted invitation is a person, and offers nothing');

  assert.equal((inviteList({ invites, status: 'all' }).match(/data-invite-status=/g) ?? []).length, 4);
});

test('each chip carries the count it would leave, whichever chip is pressed', () => {
  const invites: InviteView[] = [
    PENDING_INVITE,
    { ...PENDING_INVITE, id: 13, status: 'expired' },
    { ...PENDING_INVITE, id: 14, status: 'expired' },
  ];
  const html = inviteList({ invites, status: 'expired' });

  assert.match(html, /data-chip="pending"[^>]*>Pending<span[^>]*>1</);
  assert.match(html, /data-chip="expired"[^>]*>Expired<span[^>]*>2</);
  assert.match(html, /data-chip="all"[^>]*>All<span[^>]*>3</);
  assert.match(html, /aria-pressed="true"[^>]*data-chip="expired"/, 'the pressed chip says so');
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test('an empty chip names the state that is empty, not just "nothing"', () => {
  const html = inviteList({ invites: [PENDING_INVITE], status: 'revoked' });

  assert.match(html, /No invitation has been revoked\./);
  assert.doesNotMatch(html, /bea@example\.org/);
  assert.match(inviteList({ invites: [], status: 'pending' }), /No invitation is waiting\./);
});

// ---------------------------------------------------------------------------
// 7. The invite result
// ---------------------------------------------------------------------------

test('with mail configured the result names the address and shows NO link', () => {
  const html = render(
    createElement(InviteResult, {
      email: 'bea@example.org',
      delivery: { emailed: true, link: null },
      next: { kind: 'invite-another', onClick: () => undefined },
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
      next: { kind: 'invite-another', onClick: () => undefined },
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
      next: { kind: 'invite-another', onClick: () => undefined },
    }),
  );

  assert.match(html, /Invitation ready for/);
  assert.match(html, /Copy the link/);
});

// ---------------------------------------------------------------------------
// 8. A hand-passed link that opens another address
// ---------------------------------------------------------------------------

/** What the compose files make the core build when PUBLIC_APP_URL and PUBLIC_SYNC_URL are unset. */
const LOCALHOST_INVITE_LINK = 'http://localhost:3000/join#server=http%3A%2F%2Flocalhost%3A3001&invite=si_abc';

/** The warning line, found by its slot so its wording stays the wordsmith's. */
const ORIGIN_WARNING = 'data-slot="link-origin-warning"';

test('a link that opens another origin than the page says so under the link, and names the address and the fix', () => {
  const html = render(createElement(CopyableLinkView, { link: LOCALHOST_INVITE_LINK, pageOrigin: 'http://bluefin:3000' }));

  assert.ok(html.includes(ORIGIN_WARNING), 'the warning line is drawn');
  // Read INSIDE the line: the link above it holds the same address.
  const warningAt = html.indexOf(ORIGIN_WARNING);
  const line = html.slice(warningAt, html.indexOf('</p>', warningAt));
  assert.ok(line.includes('http://localhost:3000'), `it names the address the link opens: ${line}`);
  assert.ok(!line.includes('bluefin'), 'it names the link, not the page');
  assert.match(line, /PUBLIC_APP_URL/);
  assert.match(line, /PUBLIC_SYNC_URL/);
  // UNDER the link and ABOVE the copy button: the order a person reads in.
  const linkAt = html.indexOf(LOCALHOST_INVITE_LINK.replaceAll('&', '&amp;'));
  const copyAt = html.indexOf('Copy the link');
  assert.ok(linkAt >= 0 && linkAt < warningAt && warningAt < copyAt, `link ${linkAt}, warning ${warningAt}, copy ${copyAt}`);
});

test('a link on the page origin whose server= names this machine warns in the same line, naming PUBLIC_SYNC_URL', () => {
  const page = 'https://openplate.family.example';
  const link = `${page}/join#server=http%3A%2F%2Flocalhost%3A3001&invite=si_abc`;
  const html = render(createElement(CopyableLinkView, { link, pageOrigin: page }));

  assert.ok(html.includes(ORIGIN_WARNING), 'the same one-line box');
  const warningAt = html.indexOf(ORIGIN_WARNING);
  const line = html.slice(warningAt, html.indexOf('</p>', warningAt));
  assert.ok(line.includes('http://localhost:3001'), `it names the core server the link points at: ${line}`);
  assert.match(line, /PUBLIC_SYNC_URL/);
  assert.doesNotMatch(line, /PUBLIC_APP_URL/, 'the app address is right, so it is not the setting to change');
  // Still one line: the two warnings never stack.
  assert.equal(html.split(ORIGIN_WARNING).length - 1, 1);
});

test('CONTROL: a link on the page origin with an https core server on a real host draws no line', () => {
  const page = 'https://openplate.family.example';
  const link = `${page}/join#server=https%3A%2F%2Fsync.family.example&invite=si_abc`;
  const html = render(createElement(CopyableLinkView, { link, pageOrigin: page }));
  assert.match(html, /Copy the link/);
  assert.ok(!html.includes(ORIGIN_WARNING));
});

test('CONTROL: a link on the page origin draws no warning line', () => {
  const html = render(createElement(CopyableLinkView, { link: LOCALHOST_INVITE_LINK, pageOrigin: 'http://localhost:3000' }));
  // The link itself is there, so an empty render cannot pass this.
  assert.match(html, /Copy the link/);
  assert.ok(!html.includes(ORIGIN_WARNING), 'a link on this address needs no warning');
});

test('the server render of the invite result draws no warning line, so hydration matches it', () => {
  // `renderToStaticMarkup` takes the server snapshot of `usePageOrigin`, the
  // same one React hydrates with. The browser's origin arrives after that.
  const html = render(
    createElement(InviteResult, {
      email: 'bea@example.org',
      delivery: { emailed: false, link: LOCALHOST_INVITE_LINK },
      next: { kind: 'invite-another', onClick: () => undefined },
    }),
  );
  assert.match(html, /Copy the link/);
  assert.ok(!html.includes(ORIGIN_WARNING));
});

test('a resend result offers the way back to the list, and a new invitation offers the next one', () => {
  const delivery = { emailed: false, link: 'https://app.example.test/join#server=https%3A%2F%2Fsync.example.test&invite=si_abc' };
  const resent = render(
    createElement(InviteResult, {
      email: 'bea@example.org',
      delivery,
      next: { kind: 'back-to-list', onClick: () => undefined },
    }),
  );
  assert.match(resent, /Back to the list/);
  assert.doesNotMatch(resent, /Invite somebody else/);
  // The rest of the card is the one a new invitation gets.
  assert.match(resent, /Invitation ready for bea@example\.org/);
  assert.match(resent, /Copy the link/);

  // THE CONTROL: the invite page's own result still offers the next invitation.
  const invited = render(
    createElement(InviteResult, { email: 'bea@example.org', delivery, next: { kind: 'invite-another', onClick: () => undefined } }),
  );
  assert.match(invited, /Invite somebody else/);
  assert.doesNotMatch(invited, /Back to the list/);
});

test("a person with a scan trial shows the free scans used against those given (M253/05)", () => {
  const withTrial = { ...SUSPENDED_PERSON, trialScans: { granted: 10, left: 3 } };
  const html = render(
    createElement(PersonDetail, {
      person: withTrial,
      activity: { kind: 'loading' },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );
  assert.match(html, /data-slot="person-trial-scans"/);
  assert.match(html, /7 of 10 used/);

  // THE CONTROL: the same person with no scan trial shows no such cell.
  const without = render(
    createElement(PersonDetail, {
      person: SUSPENDED_PERSON,
      activity: { kind: 'loading' },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );
  assert.doesNotMatch(without, /person-trial-scans/);
});

// ---------------------------------------------------------------------------
// 9. The operator's label
// ---------------------------------------------------------------------------

/** The chip's own marker. Counted, so a second chip, or one on the wrong row, is seen. */
const LABEL_CHIP = /data-slot="account-label"/g;

test('a labelled person carries the label as a chip on their row, and nobody else does', () => {
  const labelled = { ...NEVER_ARRIVED, label: 'Beta supporter' };
  const html = peopleList({ people: [ADMIN, labelled, SUSPENDED_PERSON] });

  assert.equal(html.match(LABEL_CHIP)?.length, 1, 'exactly one chip, for the one labelled person');
  assert.match(html, /data-slot="account-label"[^>]*title="Beta supporter"[^>]*>(<span[^>]*>)Beta supporter<\/span>/);
  // The chip sits in the labelled person's own row, on the address line, after
  // the address: nothing on the row follows it, so it moves nothing.
  const row = html.split('<li>').find((item) => item.includes('carla@example.org')) ?? '';
  assert.match(row, /<span class="truncate">carla@example\.org<\/span><span data-slot="account-label"/);

  // THE CONTROL: the same list with no label anywhere draws no chip at all.
  assert.equal(peopleList({ people: [ADMIN, NEVER_ARRIVED, SUSPENDED_PERSON] }).match(LABEL_CHIP), null);
});

test("a labelled person's page shows the chip beside the role and the standing", () => {
  const html = render(
    createElement(PersonDetail, {
      person: { ...SUSPENDED_PERSON, label: 'Beta supporter' },
      activity: { kind: 'loading' },
      isSelf: false,
      ...NEVER_ACTS,
    }),
  );
  assert.equal(html.match(LABEL_CHIP)?.length, 1);
  assert.match(html, />Beta supporter</);

  // THE CONTROL: no label, no chip, and the text is nowhere on the page.
  const without = render(
    createElement(PersonDetail, { person: SUSPENDED_PERSON, activity: { kind: 'loading' }, isSelf: false, ...NEVER_ACTS }),
  );
  assert.equal(without.match(LABEL_CHIP), null);
  assert.doesNotMatch(without, /Beta supporter/);
});

test('the Change form carries the standing free grant, filled with its current value (2026-09-30)', () => {
  const html = render(
    createElement(PersonEditor, {
      person: { ...SUSPENDED_PERSON, freeDailyAiLimit: 10 },
      isBusy: false,
      onCancel: () => undefined,
      onSave: () => {
        throw new Error('a render must not save');
      },
    }),
  );
  assert.match(html, /<label[^>]*for="free-limit-2"[^>]*>Free photos per day<\/label>/);
  const input = /<input[^>]*id="free-limit-2"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(input, /value="10"/);
  assert.match(input, /max="10000"/);

  // THE CONTROL: the paid limit keeps its own field and its own value.
  const paid = /<input[^>]*id="limit-2"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(paid, /value="200"/);
});

test('the Change form carries the label field, filled with the current label and bounded at 40', () => {
  const html = render(
    createElement(PersonEditor, {
      person: { ...SUSPENDED_PERSON, label: 'Beta supporter' },
      isBusy: false,
      onCancel: () => undefined,
      onSave: () => {
        throw new Error('a render must not save');
      },
    }),
  );
  assert.match(html, /<label[^>]*for="label-2"[^>]*>Label<\/label>/);
  assert.match(html, /<input[^>]*id="label-2"[^>]*>/);
  const input = /<input[^>]*id="label-2"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(input, /maxLength="40"/);
  assert.match(input, /value="Beta supporter"/);
  assert.match(html, /At most 40 characters/, 'the hint names the bound, interpolated');

  // THE CONTROL: a person with no label gets the same field, empty.
  const empty = render(
    createElement(PersonEditor, {
      person: SUSPENDED_PERSON,
      isBusy: false,
      onCancel: () => undefined,
      onSave: () => {
        throw new Error('a render must not save');
      },
    }),
  );
  const emptyInput = /<input[^>]*id="label-2"[^>]*>/.exec(empty)?.[0] ?? '';
  assert.match(emptyInput, /value=""/);
});
