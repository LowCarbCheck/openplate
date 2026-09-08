/**
 * One person, opened: what is known about them, and everything an
 * administrator may do to them.
 *
 * ── Presentational, like the list ────────────────────────────────────────
 *
 * It takes a person, an activity request that is either running, failed or
 * answered, and one callback per action. The route owns the client, the fetch
 * and the re-read after every change, which is what lets this file be rendered
 * in a test with no session and no network, including in the state that
 * matters most: somebody who has never signed in.
 *
 * ── This is where every action lives now ─────────────────────────────────
 *
 * They used to be five buttons on every row of the list. A list is for finding
 * somebody; a page about one person is where changing them belongs, and it is
 * also the only place there is room to say what a change does before it is
 * made.
 *
 * ── Your own page still refuses two of them ──────────────────────────────
 *
 * The service refuses an administrator's changes to their own account, and the
 * reason is worth keeping visible: an instance whose last administrator
 * suspended or deleted themselves has nobody left who can undo it. Rather than
 * offer the buttons and explain the refusal, they are simply absent. Looking is
 * not changing, so an administrator may read their own page in full.
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { ActivityStrip } from '#app/components/admin/activity-strip';
import { LastSeenValue } from '#app/components/admin/last-seen';
import { ConfirmButton, DeletePersonButton, PersonEditor, type PersonEdit } from '#app/components/admin/person-actions';
import { Link } from '#app/components/link';
import { Badge } from '#app/components/ui/badge';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { activityTotal } from '#app/lib/admin/activity-strip';
import type { AdminAccountActivity, AdminAccountView } from '#app/lib/admin/admin-wire';

/** Where the activity request is. One `kind`, so a spinner and a strip can never be on screen together. */
export type PersonActivityState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; activity: AdminAccountActivity };

/** What this page can ask the route to do. Each resolves when the change has been stored and the account re-read. */
export interface PersonDetailActions {
  onSave: (input: PersonEdit) => Promise<void>;
  onSetSuspended: (input: { suspended: boolean }) => Promise<void>;
  onSendResetMail: () => Promise<void>;
  onDelete: () => Promise<void>;
}

export interface PersonDetailProps extends PersonDetailActions {
  person: AdminAccountView;
  activity: PersonActivityState;
  /** True on the signed-in administrator's own page. Suspension and deletion are absent there. */
  isSelf: boolean;
  /** Asks for the strip again after a failure. The person is already in hand, so only the strip is re-read. */
  onRetryActivity: () => void;
}

export function PersonDetail({ person, activity, isSelf, onRetryActivity, ...actions }: PersonDetailProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSuspended = person.suspendedAt !== null;

  /**
   * One action, with its own failure beside it.
   *
   * The message is deliberately ours rather than the server's: `PROTOCOL.md`
   * §4 forbids branching on its prose, and showing it would put an English
   * sentence from another codebase into a German page.
   */
  async function run(action: () => Promise<void>): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      setIsEditing(false);
    } catch {
      setError(t('admin.edit.failed'));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Button asChild type="button" variant="ghost" size="sm" className="h-11">
        <Link to="/admin">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('admin.person.back')}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="truncate">{person.displayName ?? t('admin.noName')}</CardTitle>
          <CardDescription className="truncate">{person.email}</CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {isSelf && <Badge variant="outline">{t('admin.you')}</Badge>}
            <Badge variant={person.role === 'admin' ? 'default' : 'secondary'}>
              {person.role === 'admin' ? t('admin.role.admin') : t('admin.role.standard')}
            </Badge>
            <Badge variant={isSuspended ? 'destructive' : 'outline'}>
              {isSuspended ? t('admin.standing.suspended') : t('admin.standing.active')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
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

          {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {isEditing ?
            <PersonEditor
              person={person}
              isBusy={isBusy}
              onCancel={() => setIsEditing(false)}
              onSave={(next) => void run(() => actions.onSave(next))}
            />
          : <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                {t('admin.edit.open')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => void run(() => actions.onSendResetMail())}
              >
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('admin.resetMail.cta')}
              </Button>
              {!isSelf && (
                <>
                  {isSuspended ?
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => void run(() => actions.onSetSuspended({ suspended: false }))}
                    >
                      {t('admin.reactivate.cta')}
                    </Button>
                  : <ConfirmButton
                      label={t('admin.suspend.cta')}
                      title={t('admin.suspend.confirmTitle', { email: person.email })}
                      body={t('admin.suspend.confirmBody')}
                      confirmLabel={t('admin.suspend.confirmCta')}
                      isBusy={isBusy}
                      onConfirm={() => void run(() => actions.onSetSuspended({ suspended: true }))}
                    />
                  }
                  <DeletePersonButton
                    email={person.email}
                    isBusy={isBusy}
                    onConfirm={() => void run(() => actions.onDelete())}
                  />
                </>
              )}
            </div>
          }

          {isSelf && <p className="text-xs text-muted-foreground">{t('admin.person.selfNote')}</p>}
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
