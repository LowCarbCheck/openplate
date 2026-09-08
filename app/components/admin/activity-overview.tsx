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
 *
 * ── EVERY VALUE IN A ROW IS NAMED ────────────────────────────────────────
 *
 * The date under each name is the last sign in, and it used to say so nowhere:
 * a bare "9/6/2026" under a person is as likely to be read as a joining date.
 * Wide enough, a header row names the columns; below that the row reflows and
 * each value carries its own label instead. Same rule, same shape, as the
 * people list.
 */
import type { ReactNode } from 'react';
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

/**
 * The widths the header and the rows share, as in `people-table.tsx`.
 *
 * The person column GROWS in both, which is what keeps the two fixed columns
 * after it against the right edge of the header and of every row alike. The
 * strip in between takes whatever its window needs, and a wide window simply
 * moves where the squares start, not where the numbers are.
 */
const COLUMN_CLASS = {
  person: 'min-w-0 flex-1 basis-56',
  strip: 'flex shrink-0 items-center gap-2',
  photosRead: 'flex shrink-0 items-center gap-2 sm:block sm:w-24 sm:text-right',
  lastSeen: 'flex shrink-0 items-center gap-2 sm:block sm:w-28 sm:text-right',
};

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
      : <div className="rounded-lg border">
          <ActivityHeader windowDays={state.kind === 'ready' ? state.window.days : null} />
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.account.id}>
                <Link
                  to={`/admin/people/${row.account.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
                >
                  <div className={COLUMN_CLASS.person}>
                    <p className="flex items-center gap-2 truncate font-medium">
                      <span className="truncate">{row.account.displayName ?? t('admin.noName')}</span>
                      {row.account.suspendedAt !== null && (
                        <Badge variant="destructive" className="shrink-0">
                          {t('admin.standing.suspended')}
                        </Badge>
                      )}
                    </p>
                  </div>

                  {row.days !== null && (
                    <div className={COLUMN_CLASS.strip}>
                      <InlineLabel>{t('admin.columns.recentDays', { days: row.days.length })}</InlineLabel>
                      <ActivityStrip days={row.days} size="row" />
                    </div>
                  )}

                  {row.days !== null && (
                    <div className={`${COLUMN_CLASS.photosRead} text-sm tabular-nums`}>
                      <InlineLabel>{t('admin.columns.photosRead')}</InlineLabel>
                      <span>{activityTotal(row.days)}</span>
                    </div>
                  )}

                  <div className={`${COLUMN_CLASS.lastSeen} text-sm tabular-nums`}>
                    <InlineLabel>{t('admin.columns.lastSeen')}</InlineLabel>
                    <span className="text-muted-foreground">
                      <LastSeenValue lastSeenAt={row.account.lastSeenAt} />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      }
    </div>
  );
}

/**
 * The names of the columns, for the widths that can carry them.
 *
 * `windowDays` is `null` while the strips are loading or after they failed, and
 * then the two columns that only exist with strips are not named. A heading
 * over an absence is a promise the page is not keeping.
 */
function ActivityHeader({ windowDays }: { windowDays: number | null }) {
  const { t } = useTranslation();

  return (
    <div className="hidden items-center gap-x-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground sm:flex">
      <span className={COLUMN_CLASS.person}>{t('admin.columns.person')}</span>
      {windowDays !== null && (
        <span className={COLUMN_CLASS.strip}>{t('admin.columns.recentDays', { days: windowDays })}</span>
      )}
      {windowDays !== null && <span className={COLUMN_CLASS.photosRead}>{t('admin.columns.photosRead')}</span>}
      <span className={COLUMN_CLASS.lastSeen}>{t('admin.columns.lastSeen')}</span>
    </div>
  );
}

/** The name a value carries below the width the header needs. Same rule as the people list. */
function InlineLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground sm:hidden">{children}</span>;
}
