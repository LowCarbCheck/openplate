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
 *  6. THE INVITATIONS TAB. The pending invitations that used to sit under the
 *     people list.
 *  7. THE INVITE RESULT, with and without mail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { AdminTabs } from '../../app/components/admin/admin-tabs';
import { NotAnAdministratorCard } from '../../app/components/admin/not-an-administrator';
import { InviteResult } from '../../app/components/admin/invite-result';
import { InviteTable } from '../../app/components/admin/invite-table';
import { ActivityOverview } from '../../app/components/admin/activity-overview';
import { PeopleTable } from '../../app/components/admin/people-table';
import { PersonDetail } from '../../app/components/admin/person-detail';
import { EMPTY_PEOPLE_FILTER, type PeopleFilter } from '../../app/lib/admin/people-filter';
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
  suspendedAt: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  lastSeenAt: '2026-09-06T18:30:00.000Z',
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
  lastSeenAt: '2026-09-05T07:15:00.000Z',
};

/** Somebody who was invited and never arrived. `lastSeenAt` is null and the screen owes them a sentence. */
const NEVER_ARRIVED: AdminAccountView = {
  id: 3,
  email: 'carla@example.org',
  displayName: 'Carla',
  role: 'member',
  dailyAiLimit: 200,
  aiUsedToday: 0,
  suspendedAt: null,
  createdAt: '2026-09-05T09:00:00.000Z',
  lastSeenAt: null,
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
  // target nested inside the link that wraps the row.
  assert.doesNotMatch(html, /<button/, 'a list is for finding somebody, not for acting on them');
  assert.doesNotMatch(html, /Send a reset link|Delete|Bring back/);
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

  const byAddress = peopleList({ people, filter: { query: '  ANNA ', group: 'everybody' } });
  assert.match(byAddress, /anna@example\.org/, 'trimmed and case insensitive');
  assert.doesNotMatch(byAddress, /owner@example\.org/);
  assert.doesNotMatch(byAddress, /carla@example\.org/);

  const byName = peopleList({ people, filter: { query: 'carl', group: 'everybody' } });
  assert.match(byName, /carla@example\.org/);
  assert.doesNotMatch(byName, /owner@example\.org/);
});

test('the group control narrows the rows to a standing or to a role', () => {
  const people = [ADMIN, SUSPENDED_PERSON, NEVER_ARRIVED];

  const suspended = peopleList({ people, filter: { query: '', group: 'suspended' } });
  assert.match(suspended, /anna@example\.org/);
  assert.doesNotMatch(suspended, /owner@example\.org|carla@example\.org/);

  const active = peopleList({ people, filter: { query: '', group: 'active' } });
  assert.match(active, /owner@example\.org/);
  assert.doesNotMatch(active, /anna@example\.org/);

  const admins = peopleList({ people, filter: { query: '', group: 'administrators' } });
  assert.match(admins, /owner@example\.org/);
  assert.doesNotMatch(admins, /carla@example\.org/);
});

test('a filter that matches nobody names the filter, and never says only "no results"', () => {
  const people = [ADMIN, SUSPENDED_PERSON];

  const byQuery = peopleList({ people, filter: { query: 'zoe', group: 'everybody' } });
  assert.match(byQuery, /Nobody here matches &quot;zoe&quot;\./, 'the search term is quoted back');
  assert.doesNotMatch(byQuery, /Nobody has an account here yet/, 'an instance with people is not an empty instance');

  const byGroup = peopleList({ people: [ADMIN], filter: { query: '', group: 'suspended' } });
  assert.match(
    byGroup,
    /Nobody here is in &quot;Suspended&quot;\./,
    'the group is named, because it is easy to forget',
  );

  const byBoth = peopleList({ people, filter: { query: 'zoe', group: 'administrators' } });
  assert.match(byBoth, /Nobody in &quot;Administrators&quot; matches &quot;zoe&quot;\./);
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

test('the chevron is hidden below sm, where a fixed-width flex child would land alone on its own line', () => {
  // Below `sm` the row wraps onto stacked lines, and the chevron, being the
  // last and only fixed-width item with nothing left to sit beside, would
  // wrap onto a line of its own at the bottom left, pointing at nothing. The
  // whole row is already the link at every width, so the chevron is a hint,
  // never the only affordance, and hiding it there costs nothing.
  const html = peopleList({ people: [ADMIN] });

  assert.match(
    html,
    /class="lucide lucide-chevron-right hidden h-4 w-4 shrink-0 text-muted-foreground sm:block"/,
    'hidden by default, shown again at sm and up once the row no longer wraps',
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

test('the invitations tab shows the one that is pending, with its expiry', () => {
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
// 7. The invite result
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
