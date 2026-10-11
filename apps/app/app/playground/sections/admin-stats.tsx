/**
 * Admin: the stats row, the four counts across the top of the console.
 *
 * The row takes `stats` and nothing else. `null` is its own state: the row keeps
 * its box and draws nothing in it, so the tab bar below does not move when the
 * counts arrive.
 */
import type { ReactElement } from 'react';

import { StatsRow } from '#app/components/admin/stats-row';
import { Card, Group, Section, type SectionDef } from '../layout';
import { BUSY_STATS, FRESH_INSTANCE_STATS, ZERO_STATS } from '../fixtures/stats';

export const DEF: SectionDef = {
  id: 'admin-stats',
  title: 'Admin: stats row',
  intent:
    'The four counts above the admin tabs. The cells People, Administrators and Open invitations are real links; Photos read today is a plain cell.',
};

export default function AdminStatsSection(): ReactElement {
  return (
    <Section def={DEF}>
      <Group title="Counts">
        <Card
          state="stats-zero"
          label="All zero"
          reach="Not reachable on a live instance, which always counts its administrator. The row takes any numbers, and this shows how its cells draw a zero."
        >
          <StatsRow stats={ZERO_STATS} />
        </Card>
        <Card
          state="stats-fresh-instance"
          label="Just set up"
          reach="Open /admin on an instance where only the administrator exists."
        >
          <StatsRow stats={FRESH_INSTANCE_STATS} />
        </Card>
        <Card
          state="stats-busy"
          label="Busy instance"
          reach="Open /admin on an instance with thousands of accounts. Five-figure counts have to fit their cells."
        >
          <StatsRow stats={BUSY_STATS} />
        </Card>
      </Group>
      <Group title="Not read yet">
        <Card
          state="stats-unread"
          label="No counts (loading or failed)"
          reach="Open /admin and look before the counts arrive, or while the stats read fails."
          note="The row is there but invisible: it keeps its box so nothing below it moves. The empty space under this label is the row."
        >
          <StatsRow stats={null} />
        </Card>
      </Group>
    </Section>
  );
}
