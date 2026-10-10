/**
 * The four counts, across the top of the console.
 *
 * ── Above the tabs, because it is about the instance ─────────────────────
 *
 * It sits in the layout rather than on the people tab, so it describes the
 * whole instance rather than whichever list is open. It changes nothing, and
 * it is the fastest answer to "is this instance healthy".
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
 *
 * ── Three of the counts are doors (2026-10-11) ───────────────────────────
 *
 * People opens the whole list, Administrators opens the list narrowed to
 * administrators, and Open invitations opens the invitations tab on its
 * pending chip. Each is a real link, so middle click and a copied address work,
 * and the whole cell is the target: the link sits on the number and stretches
 * over the cell. Photos read today has no list behind it that answers "who",
 * so it stays a plain cell rather than linking somewhere that does not.
 *
 * A "new this week" count would be the obvious fifth cell, but the service's
 * counts carry no such field and the accounts list is not read in this layout.
 * The people tab has that answer one chip away.
 */
import { useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';
import type { AdminStats } from '#app/lib/admin/admin-wire';
import { EMPTY_PEOPLE_FILTER, writePeopleFilter } from '#app/lib/admin/people-filter';

export interface StatsRowProps {
  /** The counts, or `null` while they are being read and after a read that failed. `null` keeps the box and draws nothing in it. */
  stats: AdminStats | null;
}

/** One cell: what it counts, the count, and where a click goes (`null` for a cell that is not a door). */
interface StatsCell {
  label: string;
  value: number;
  to: string | null;
}

/** Where the administrators count leads: the people list, narrowed to them. */
const ADMINISTRATORS_PATH = `/admin?${writePeopleFilter({ ...EMPTY_PEOPLE_FILTER, view: 'administrators' })}`;

/** What each cell holds while there is no answer. Hidden, so it is never read; it is here to give the cell its height. */
const STAND_IN_VALUE = 0;

export function StatsRow({ stats }: StatsRowProps) {
  const { t } = useTranslation();
  const cells: StatsCell[] = [
    { label: t('admin.stats.people'), value: stats?.accounts ?? STAND_IN_VALUE, to: '/admin' },
    { label: t('admin.stats.admins'), value: stats?.admins ?? STAND_IN_VALUE, to: ADMINISTRATORS_PATH },
    { label: t('admin.stats.pending'), value: stats?.pendingInvites ?? STAND_IN_VALUE, to: '/admin/invitations' },
    { label: t('admin.stats.photosToday'), value: stats?.aiRequestsToday ?? STAND_IN_VALUE, to: null },
  ];
  return (
    // `invisible` rather than `hidden`: it keeps the box, and it also takes the
    // stand-in numbers out of the accessibility tree.
    <dl className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${stats === null ? 'invisible' : ''}`}>
      {cells.map((cell) => (
        <div
          key={cell.label}
          className={`relative border p-3 ${
            cell.to === null ?
              ''
            : 'transition-colors hover:border-primary/60 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring'
          }`}
        >
          <dt className="text-xs text-muted-foreground">{cell.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {cell.to === null ?
              cell.value
            : <Link
                to={cell.to}
                aria-label={`${cell.label}: ${cell.value}`}
                className="outline-none after:absolute after:inset-0"
              >
                {cell.value}
              </Link>
            }
          </dd>
        </div>
      ))}
    </dl>
  );
}
