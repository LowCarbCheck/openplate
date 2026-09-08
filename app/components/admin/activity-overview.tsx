/**
 * Everybody's strip on one screen: the page that answers "is this person still
 * using it".
 *
 * ── Why it is its own tab ────────────────────────────────────────────────
 *
 * An operator running a study asks that question about everybody at once, and
 * the people list answers it one row at a time over seven days. Here the
 * window is a control, so the same list can be read over a week, a month or a
 * quarter without opening anybody.
 *
 * ── Sorted by last sign in, and the reason is in the model ───────────────
 *
 * `orderByRecentActivity` in `activity-strip.ts` owns the ordering, including
 * the rule that somebody who never arrived sorts last. It is a rule about
 * people rather than about pixels, so it is testable without a render.
 *
 * ── The window is the one the SERVICE drew ───────────────────────────────
 *
 * The control asks for seven, thirty or ninety days, and the sentence above
 * the list reports what came back. A service keeping less than was asked for
 * answers with its retention window, and a page that printed the request
 * instead would label a 30 day strip as 90 days of silence.
 */
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { ActivityStrip } from '#app/components/admin/activity-strip';
import { LastSeenValue } from '#app/components/admin/last-seen';
import { Link } from '#app/components/link';
import { Badge } from '#app/components/ui/badge';
import { Button } from '#app/components/ui/button';
import { activityTotal, orderByRecentActivity, type ActivityByAccount } from '#app/lib/admin/activity-strip';
import type { AdminAccountView, AdminActivityWindow } from '#app/lib/admin/admin-wire';

/** The three windows the control offers. Days, because that is the unit the service counts in. */
export const ACTIVITY_WINDOW_DAYS: readonly number[] = [7, 30, 90];

/** Where the whole-instance activity read is. One `kind`, so a spinner and a list can never be on screen together. */
export type ActivityOverviewState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; window: AdminActivityWindow; activity: ActivityByAccount };

export interface ActivityOverviewProps {
  people: AdminAccountView[];
  state: ActivityOverviewState;
  /** The window that was ASKED for. The one that was drawn comes back with the answer. */
  requestedDays: number;
  onRequestDays: (days: number) => void;
  onRetry: () => void;
}

export function ActivityOverview({ people, state, requestedDays, onRequestDays, onRetry }: ActivityOverviewProps) {
  const { t } = useTranslation();
  const rows = orderByRecentActivity({ people, activity: state.kind === 'ready' ? state.activity : null });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('admin.activity.windowLabel')}</span>
        {ACTIVITY_WINDOW_DAYS.map((days) => (
          <Button
            key={days}
            type="button"
            size="sm"
            variant={days === requestedDays ? 'default' : 'outline'}
            aria-pressed={days === requestedDays}
            onClick={() => onRequestDays(days)}
          >
            {t('admin.activity.windowDays', { days })}
          </Button>
        ))}
      </div>

      {state.kind === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('admin.person.activityLoading')}
        </p>
      )}

      {state.kind === 'failed' && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('admin.activity.failed')}</p>
          <Button type="button" variant="outline" size="sm" className="h-11" onClick={onRetry}>
            {t('admin.person.activityRetry')}
          </Button>
        </div>
      )}

      {state.kind === 'ready' && (
        <p className="text-sm text-muted-foreground">
          {t('admin.person.activityWindow', {
            days: state.window.days,
            from: state.window.fromDay,
            to: state.window.toDay,
          })}
        </p>
      )}

      {people.length === 0 ?
        <p className="text-sm text-muted-foreground">{t('admin.people.empty')}</p>
      : <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.account.id}>
              <Link
                to={`/admin/people/${row.account.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex items-center gap-2 truncate font-medium">
                    <span className="truncate">{row.account.displayName ?? t('admin.noName')}</span>
                    {row.account.suspendedAt !== null && (
                      <Badge variant="destructive" className="shrink-0">
                        {t('admin.standing.suspended')}
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <LastSeenValue lastSeenAt={row.account.lastSeenAt} />
                  </p>
                </div>
                {row.days !== null && <ActivityStrip days={row.days} size="row" />}
                {row.days !== null && (
                  <p className="text-sm tabular-nums">
                    {t('admin.activity.total', { photos: activityTotal(row.days) })}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      }
    </div>
  );
}
