/**
 * The four counts, across the top of the console.
 *
 * ── Above the tabs, because it is about the instance ─────────────────────
 *
 * It sits in the layout rather than on the people tab, so it describes the
 * whole instance rather than whichever list is open. It is read-only, and it
 * is the fastest answer to "is this instance healthy".
 */
import { useTranslation } from 'react-i18next';

import type { AdminStats } from '#app/lib/admin/admin-wire';

export interface StatsRowProps {
  stats: AdminStats;
}

/** One cell: what it counts, and the count. */
interface StatsCell {
  label: string;
  value: number;
}

export function StatsRow({ stats }: StatsRowProps) {
  const { t } = useTranslation();
  const cells: StatsCell[] = [
    { label: t('admin.stats.people'), value: stats.accounts },
    { label: t('admin.stats.admins'), value: stats.admins },
    { label: t('admin.stats.pending'), value: stats.pendingInvites },
    { label: t('admin.stats.photosToday'), value: stats.aiRequestsToday },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">{cell.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}
