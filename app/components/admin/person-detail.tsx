/**
 * One person, opened: when they last did something, and what they have read
 * per day since.
 *
 * ── Presentational, like the list ────────────────────────────────────────
 *
 * It takes a person, an activity request that is either running, failed or
 * answered, and two callbacks. The route owns the client and the fetch, which
 * is what lets this file be rendered in a test with no session and no network,
 * including in the state that matters most: somebody who has never signed in.
 *
 * ── It shows nothing that is not already stored ──────────────────────────
 *
 * Four facts, and all four are columns the service already had: a last-seen
 * instant, a join date, today's counter against the allowance, and one integer
 * per day. There is no diary content here, and there is none to be had: the
 * blobs are encrypted on the device and the operator of the instance cannot
 * read them. The screen says so rather than leaving an operator to assume the
 * absence is a missing feature.
 *
 * ── A quiet day is drawn; an absent day is not ───────────────────────────
 *
 * One square per entry the service sent, and the service sends every day of
 * the window (`activity-strip.ts` has the reasoning). So an empty square means
 * "this day happened and nothing was read", and the only days with no square
 * are the ones before the window, which the sentence under the strip names
 * outright. Nothing here is allowed to make those two look the same.
 */
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { LastSeenValue } from '#app/components/admin/last-seen';
import { Badge } from '#app/components/ui/badge';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { activityLevel, activityTotal, type ActivityLevel } from '#app/lib/admin/activity-strip';
import type { AdminAccountActivity, AdminAccountView, AdminActivityDay } from '#app/lib/admin/admin-wire';

/** Where the activity request is. One `kind`, so a spinner and a strip can never be on screen together. */
export type PersonActivityState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; activity: AdminAccountActivity };

export interface PersonDetailProps {
  person: AdminAccountView;
  activity: PersonActivityState;
  /** Back to the list. The list is the only place anything is changed. */
  onBack: () => void;
  /** Asks for the strip again after a failure. The person is already in hand, so only the strip is re-read. */
  onRetryActivity: () => void;
}

export function PersonDetail({ person, activity, onBack, onRetryActivity }: PersonDetailProps) {
  const { t } = useTranslation();
  const isSuspended = person.suspendedAt !== null;

  return (
    <div className="space-y-6">
      <Button type="button" variant="ghost" size="sm" className="h-11" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('admin.person.back')}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="truncate">{person.displayName ?? t('admin.noName')}</CardTitle>
          <CardDescription className="truncate">{person.email}</CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant={person.role === 'admin' ? 'default' : 'secondary'}>
              {person.role === 'admin' ? t('admin.role.admin') : t('admin.role.standard')}
            </Badge>
            <Badge variant={isSuspended ? 'destructive' : 'outline'}>
              {isSuspended ? t('admin.standing.suspended') : t('admin.standing.active')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t('admin.columns.lastSeen')}</dt>
              <dd>
                <LastSeenValue lastSeenAt={person.lastSeenAt} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('admin.columns.joined')}</dt>
              <dd>{new Date(person.createdAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('admin.columns.usedToday')}</dt>
              <dd>
                {person.dailyAiLimit === 0 ?
                  t('admin.usageNone')
                : t('admin.usage', { used: person.aiUsedToday, limit: person.dailyAiLimit })}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.person.activityTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ActivitySection state={activity} onRetry={onRetryActivity} />
          <p className="text-xs text-muted-foreground">{t('admin.person.noDiary')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/** The three things the strip can be. Guard clauses first, the strip last. */
function ActivitySection({ state, onRetry }: { state: PersonActivityState; onRetry: () => void }) {
  const { t } = useTranslation();

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('admin.person.activityLoading')}
      </p>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('admin.person.activityFailed')}</p>
        <Button type="button" variant="outline" size="sm" className="h-11" onClick={onRetry}>
          {t('admin.person.activityRetry')}
        </Button>
      </div>
    );
  }

  const { activity } = state;
  const total = activityTotal(activity.days);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('admin.person.activityWindow', {
          days: activity.window.days,
          from: activity.window.fromDay,
          to: activity.window.toDay,
        })}
      </p>
      <ActivityStrip days={activity.days} />
      <p className="text-sm">
        {total === 0 ? t('admin.person.activityQuiet') : t('admin.person.activityTotal', { photos: total })}
      </p>
      <p className="text-xs text-muted-foreground">{t('admin.person.activityLegend')}</p>
    </div>
  );
}

/**
 * One square per day, in the order the service sent them.
 *
 * A LIST, not a canvas. Each square carries its day and its count as text, so
 * the strip is readable by somebody who cannot see the shading, and the whole
 * thing is ninety `<li>`s rather than a charting dependency.
 */
function ActivityStrip({ days }: { days: readonly AdminActivityDay[] }) {
  const { t } = useTranslation();

  return (
    <ul className="flex flex-wrap gap-1">
      {days.map((entry) => (
        <li
          key={entry.day}
          className={`h-4 w-4 rounded-sm ${LEVEL_CLASS[activityLevel(entry.count)]}`}
          title={t('admin.person.day', { day: entry.day, photos: entry.count })}
        >
          <span className="sr-only">{t('admin.person.day', { day: entry.day, photos: entry.count })}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * How each level is painted.
 *
 * LEVEL 0 IS AN OUTLINE, not nothing. An empty square is what tells an operator
 * that the day is inside the window and was quiet, and a level that painted
 * nothing at all would put a hole in the strip in exactly the place the feature
 * exists to describe.
 */
const LEVEL_CLASS = {
  0: 'border border-border bg-muted',
  1: 'bg-primary/25',
  2: 'bg-primary/50',
  3: 'bg-primary/75',
  4: 'bg-primary',
} satisfies Record<ActivityLevel, string>;
