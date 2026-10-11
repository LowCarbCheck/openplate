/**
 * Admin: the people list (`/admin`), the table with its toolbar, chips, ages and
 * seven day strips.
 *
 * ── The filter is local state here, the address in the app ───────────────
 *
 * `PeopleTable` does not read the address. It takes `filter` and
 * `onFilterChange` as props, and the route connects them to `?view=&sort=&q=`
 * through `usePeopleFilter`. The playground connects the same two props to
 * `useState`, started from the filter a card is about. Pressing a chip, typing
 * in the search box and pressing a column heading all work for real, without a
 * URL to keep apart from the other cards on the page. What this does not
 * exercise is the address round trip and the 250 ms typing delay, which the
 * hook owns and the browser tier covers.
 *
 * A click on a row follows its real `Link` to `/admin/people/:id`, which only
 * moves the playground's memory router. There is no person page here.
 */
import { useState, type ReactElement } from 'react';

import { PeopleTable } from '#app/components/admin/people-table';
import type { ActivityByAccount } from '#app/lib/admin/activity-strip';
import type { AdminAccountView } from '#app/lib/admin/admin-wire';
import { EMPTY_PEOPLE_FILTER, type PeopleFilter } from '#app/lib/admin/people-filter';
import { Card, Group, Section, type SectionDef } from '../layout';
import { PLAYGROUND_NOW } from '../fixtures/clock';
import {
  CURRENT_ACCOUNT_ID,
  MIXED_ACTIVITY,
  MIXED_PEOPLE,
  NO_PEOPLE,
  ONE_NEW_ACTIVITY,
  ONE_NEW_SIGN_UP,
} from '../fixtures/people';

export const DEF: SectionDef = {
  id: 'admin-people',
  title: 'Admin: people',
  intent:
    'The people list at /admin. The table is the real component with the real toolbar, chips, day ages and activity strips. Its filter is local state here; in the app it lives in the address.',
};

interface PeopleCardProps {
  people: AdminAccountView[];
  activity: ActivityByAccount | null;
  initialFilter?: PeopleFilter;
}

/** The table with its filter held in state, as the route holds it in the address. */
function PeopleTableDemo({ people, activity, initialFilter = EMPTY_PEOPLE_FILTER }: PeopleCardProps): ReactElement {
  const [filter, setFilter] = useState(initialFilter);
  return (
    <PeopleTable
      people={people}
      currentAccountId={CURRENT_ACCOUNT_ID}
      activity={activity}
      filter={filter}
      onFilterChange={setFilter}
      now={PLAYGROUND_NOW}
    />
  );
}

export default function AdminPeopleSection(): ReactElement {
  return (
    <Section def={DEF}>
      <Group title="Lists">
        <Card
          state="people-empty-instance"
          label="Empty instance"
          reach="Open /admin on an instance where nobody has signed up and the list read returned no accounts."
        >
          <PeopleTableDemo people={NO_PEOPLE} activity={null} />
        </Card>
        <Card
          state="people-one-new-sign-up"
          label="One new sign-up today"
          reach="Invite one person and let them create their account, then open /admin the same day. They sit under This week with a New badge."
        >
          <PeopleTableDemo people={ONE_NEW_SIGN_UP} activity={ONE_NEW_ACTIVITY} />
        </Card>
        <Card
          state="people-mixed"
          label="Mixed list of twelve"
          reach="Open /admin on a live instance. This list holds new sign-ups, a person who never signed in, two labelled Beta supporters, one person at the allowance and one near it, a suspended one, a quiet one and a weekly limit."
          span={2}
        >
          <PeopleTableDemo people={MIXED_PEOPLE} activity={MIXED_ACTIVITY} />
        </Card>
        <Card
          state="people-no-strips"
          label="Activity strips unavailable"
          reach="Open /admin against a core that is older than the activity endpoint. The batch read fails and the rows are drawn without strips, which is not the same picture as a quiet week."
          span={2}
        >
          <PeopleTableDemo people={MIXED_PEOPLE} activity={null} />
        </Card>
      </Group>
      <Group title="Filters">
        <Card
          state="people-filter-new"
          label="Filter: new this week"
          reach="Press the New this week chip on /admin, or open /admin?view=new. The result line counts the people it left."
        >
          <PeopleTableDemo
            people={MIXED_PEOPLE}
            activity={MIXED_ACTIVITY}
            initialFilter={{ ...EMPTY_PEOPLE_FILTER, view: 'new' }}
          />
        </Card>
        <Card
          state="people-filter-never"
          label="Filter: never signed in"
          reach="Press the Never signed in chip on /admin, or open /admin?view=never. Those rows say so in amber."
        >
          <PeopleTableDemo
            people={MIXED_PEOPLE}
            activity={MIXED_ACTIVITY}
            initialFilter={{ ...EMPTY_PEOPLE_FILTER, view: 'never' }}
          />
        </Card>
        <Card
          state="people-filter-label"
          label="Filter: one label"
          reach="Pick a label in the Label menu on /admin, or open /admin?label=Beta%20supporter."
        >
          <PeopleTableDemo
            people={MIXED_PEOPLE}
            activity={MIXED_ACTIVITY}
            initialFilter={{ ...EMPTY_PEOPLE_FILTER, label: { kind: 'named', label: 'Beta supporter' } }}
          />
        </Card>
        <Card
          state="people-filter-sorted-by-usage"
          label="Sorted by usage"
          reach="Pick Most scans today in the Sort menu on /admin, or open /admin?sort=usage. The This week and Earlier headings appear only while the order is by sign-up date."
        >
          <PeopleTableDemo
            people={MIXED_PEOPLE}
            activity={MIXED_ACTIVITY}
            initialFilter={{ ...EMPTY_PEOPLE_FILTER, sort: 'usage' }}
          />
        </Card>
        <Card
          state="people-filter-no-match"
          label="Filter with no match"
          reach="Type a name nobody has into the search box on /admin, or open /admin?q=zz-nobody. The sentence names the search, so a forgotten chip is not mistaken for an empty instance."
        >
          <PeopleTableDemo
            people={MIXED_PEOPLE}
            activity={MIXED_ACTIVITY}
            initialFilter={{ ...EMPTY_PEOPLE_FILTER, query: 'zz-nobody' }}
          />
        </Card>
        <Card
          state="people-filter-no-match-several"
          label="Search and chip, no match"
          reach="Press the Suspended chip on /admin and type a name that no suspended person has. The sentence names both."
        >
          <PeopleTableDemo
            people={MIXED_PEOPLE}
            activity={MIXED_ACTIVITY}
            initialFilter={{ ...EMPTY_PEOPLE_FILTER, query: 'carla', view: 'suspended' }}
          />
        </Card>
      </Group>
    </Section>
  );
}
