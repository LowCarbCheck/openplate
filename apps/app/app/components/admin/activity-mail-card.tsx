/**
 * The reminder emails, as an administrator edits them (2026-11).
 *
 * Two kinds, each with a switch, a day count and a button that sends one to
 * the administrator's own address, under one line of numbers: how many people
 * asked for reminders, and per kind how many went out and how many came back.
 *
 * ── PRESENTATIONAL, like every other `/admin` screen ─────────────────────
 *
 * It takes what the core said and callbacks, and holds only the drafts being
 * typed. The route owns the admin client, the calls and the outcomes
 * (`routes/admin.settings.tsx`).
 *
 * ── NOTHING MOVES WHEN A STATUS ARRIVES ──────────────────────────────────
 *
 * Every line that can appear (the two stats, a day-count error, the test
 * status, the save result) is always rendered in a box of its own height and
 * only has its text filled in, so the button under it never moves (DESIGN.md
 * section 7).
 *
 * ── A BAD DAY COUNT IS REFUSED HERE ──────────────────────────────────────
 *
 * The bounds are the wire's. A count outside them shows its sentence under the
 * box as it is typed, and Save sends nothing until both are right.
 */
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import type { InstanceSettingsState } from '#app/components/admin/instance-settings-card';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { Switch } from '#app/components/ui/switch';
import {
  ACTIVITY_MAIL_DAY_BOUNDS,
  ACTIVITY_MAIL_KINDS,
  type ActivityMailKind,
  type AdminActivityMailSettings,
  type AdminActivityMailStats,
} from '#app/lib/admin/admin-wire';
import {
  parseActivityMailDays,
  readActivityMailDrafts,
  type ActivityMailKindDraft,
} from '#app/lib/admin/settings-schema';

/** What the test button of one kind last did. */
export type ActivityMailTestStatus = 'idle' | 'sending' | 'sent' | 'throttled' | 'failed';

export interface ActivityMailCardProps {
  /** What the core holds now. The drafts start from it. */
  settings: AdminActivityMailSettings;
  /** The numbers, or `null` while unread and for a core that has none. */
  stats: AdminActivityMailStats | null;
  state: InstanceSettingsState;
  /** A sentence about a save that did not go through, or `null`. */
  failure: string | null;
  testStatus: Record<ActivityMailKind, ActivityMailTestStatus>;
  onSave: (settings: AdminActivityMailSettings) => void;
  onTest: (kind: ActivityMailKind) => void;
}

/** The copy keys of one kind. One entry per kind, so a new one cannot be drawn unlabelled. */
const KIND_KEYS = {
  firstScan: { title: 'admin.activityMail.firstScan.title', hint: 'admin.activityMail.firstScan.hint' },
  quiet: { title: 'admin.activityMail.quiet.title', hint: 'admin.activityMail.quiet.hint' },
} as const satisfies Record<ActivityMailKind, { title: string; hint: string }>;

/** The copy key of each test status. `idle` says nothing, and its box is still there. */
const TEST_STATUS_KEYS = {
  idle: null,
  sending: 'admin.activityMail.test.sending',
  sent: 'admin.activityMail.test.sent',
  throttled: 'admin.activityMail.test.throttled',
  failed: 'admin.activityMail.test.failed',
} as const satisfies Record<ActivityMailTestStatus, string | null>;

export function ActivityMailCard({
  settings,
  stats,
  state,
  failure,
  testStatus,
  onSave,
  onTest,
}: ActivityMailCardProps): ReactElement {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<ActivityMailKind, ActivityMailKindDraft>>({
    firstScan: { enabled: settings.firstScan.enabled, days: String(settings.firstScan.days) },
    quiet: { enabled: settings.quiet.enabled, days: String(settings.quiet.days) },
  });

  function change(kind: ActivityMailKind, next: Partial<ActivityMailKindDraft>): void {
    setDrafts((current) => ({ ...current, [kind]: { ...current[kind], ...next } }));
  }

  function save(): void {
    const parsed = readActivityMailDrafts(drafts);
    if (parsed === null) return;
    onSave(parsed);
  }

  return (
    <Card data-slot="admin-activity-mail">
      <CardHeader>
        <CardTitle>{t('admin.activityMail.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* The numbers sit above both kinds. Their boxes are there before the read lands. */}
        <p data-slot="activity-mail-opted-in" className="min-h-5 text-sm">
          {stats === null ? '' : t('admin.activityMail.stats.optedIn', { optedIn: stats.optedIn })}
        </p>

        {ACTIVITY_MAIL_KINDS.map((kind) => {
          const draft = drafts[kind];
          const bounds = ACTIVITY_MAIL_DAY_BOUNDS[kind];
          const isDaysValid = parseActivityMailDays({ kind, raw: draft.days }) !== null;
          const statusKey = TEST_STATUS_KEYS[testStatus[kind]];
          const switchId = `activity-mail-${kind}-enabled`;
          const daysId = `activity-mail-${kind}-days`;
          const errorId = `${daysId}-error`;
          return (
            <fieldset key={kind} data-slot="activity-mail-kind" data-kind={kind} className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor={switchId} className="font-medium">
                  {t(KIND_KEYS[kind].title)}
                </Label>
                <Switch
                  id={switchId}
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => change(kind, { enabled })}
                />
              </div>
              <p className="text-sm text-muted-foreground">{t(KIND_KEYS[kind].hint)}</p>
              <p data-slot="activity-mail-kind-stats" className="min-h-5 text-sm">
                {stats === null ? '' : t('admin.activityMail.stats.kind', stats[kind])}
              </p>

              <div className="space-y-1.5">
                <Label htmlFor={daysId}>{t('admin.activityMail.daysLabel')}</Label>
                <Input
                  id={daysId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="h-11 w-28"
                  value={draft.days}
                  aria-invalid={!isDaysValid}
                  aria-describedby={errorId}
                  onChange={(event) => change(kind, { days: event.target.value })}
                />
                <p
                  id={errorId}
                  data-slot="activity-mail-days-error"
                  className={
                    isDaysValid ? 'invisible min-h-5 text-sm' : 'min-h-5 text-sm text-red-600 dark:text-red-400'
                  }
                >
                  {t('admin.activityMail.daysRange', { min: bounds.min, max: bounds.max })}
                </p>
              </div>

              <div className="space-y-1.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={testStatus[kind] === 'sending'}
                  onClick={() => onTest(kind)}
                >
                  {t('admin.activityMail.test.button')}
                </Button>
                <output data-slot="activity-mail-test-status" className="block min-h-5 text-sm text-muted-foreground">
                  {statusKey === null ? '' : t(statusKey)}
                </output>
              </div>
            </fieldset>
          );
        })}

        <div className="space-y-2">
          <output data-slot="activity-mail-save-status" className="block min-h-5 text-sm">
            {state === 'saved' && <span className="font-medium">{t('admin.activityMail.saved')}</span>}
            {failure !== null && <span className="text-red-600 dark:text-red-400">{failure}</span>}
          </output>
          <Button type="button" className="h-11" disabled={state === 'working'} onClick={save}>
            {state === 'working' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {state === 'working' ? t('admin.activityMail.saving') : t('admin.activityMail.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
