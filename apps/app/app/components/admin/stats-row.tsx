/**
 * The four counts, across the top of the console.
 *
 * ── Above the tabs, because it is about the instance ─────────────────────
 *
 * It sits in the layout rather than on the people tab, so it describes the
 * whole instance rather than whichever list is open. It is read-only, and it
 * is the fastest answer to "is this instance healthy".
 *
 * ── Its box is there before its numbers are ──────────────────────────────
 *
 * The counts arrive after the frame is drawn, and the row used to be added
 * only then, which pushed the tab bar and the open list down by two rows of
 * cells in the middle of a person's first look at the page. So the row is
 * drawn from the first paint with its labels and a stand-in number, hidden,
 * and it becomes visible when the counts land. A read that fails leaves it
 * hidden: an empty band says nothing false, and closing it up would move
 * everything below it.
 */
import { useTranslation } from 'react-i18next';

import type { AdminStats } from '#app/lib/admin/admin-wire';

export interface StatsRowProps {
  /** The counts, or `null` while they are being read and after a read that failed. `null` keeps the box and draws nothing in it. */
  stats: AdminStats | null;
}

/** One cell: what it counts, and the count. */
interface StatsCell {
  label: string;
  value: number;
}

/** What each cell holds while there is no answer. Hidden, so it is never read; it is here to give the cell its height. */
const STAND_IN_VALUE = 0;

export function StatsRow({ stats }: StatsRowProps) {
  const { t } = useTranslation();
  const cells: StatsCell[] = [
    { label: t('admin.stats.people'), value: stats?.accounts ?? STAND_IN_VALUE },
    { label: t('admin.stats.admins'), value: stats?.admins ?? STAND_IN_VALUE },
    { label: t('admin.stats.pending'), value: stats?.pendingInvites ?? STAND_IN_VALUE },
    { label: t('admin.stats.photosToday'), value: stats?.aiRequestsToday ?? STAND_IN_VALUE },
  ];
  return (
    // `invisible` rather than `hidden`: it keeps the box, and it also takes the
    // stand-in numbers out of the accessibility tree.
    <dl className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${stats === null ? 'invisible' : ''}`}>
      {cells.map((cell) => (
        <div key={cell.label} className="border p-3">
          <dt className="text-xs text-muted-foreground">{cell.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}
