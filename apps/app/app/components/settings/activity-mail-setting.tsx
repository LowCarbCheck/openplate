/**
 * The reminder-email switch (2026-11): one labelled switch and the sentence
 * that says what it sends.
 *
 * PRESENTATIONAL. The page owns the session, the instance flag and the PATCH,
 * which is what lets this render in the unit tier with no session and no
 * network. WHEN it is drawn at all is {@link isActivityMailControlShown}'s
 * answer: where the instance sends reminders, or where the account already
 * asked for them, so a person can always turn them off.
 *
 * The switch reads what the service holds (`checked`), never what the tap
 * asked for, and is disabled while the write is in flight.
 */
import { useTranslation } from 'react-i18next';

import { SettingsSection } from '#app/components/settings/settings-section';
import { Label } from '#app/components/ui/label';
import { Switch } from '#app/components/ui/switch';

export interface ActivityMailSettingProps {
  /** What the service holds for this account. */
  isOn: boolean;
  isSaving: boolean;
  onChange: (next: boolean) => void;
}

export function ActivityMailSetting({ isOn, isSaving, onChange }: ActivityMailSettingProps) {
  const { t } = useTranslation();
  return (
    <div data-slot="activity-mail-setting">
      <SettingsSection
        label={t('activityMail.settings.title')}
        description={t('activityMail.settings.description')}
        contentClassName="space-y-6"
      >
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="activity-mail-switch">{t('activityMail.settings.title')}</Label>
          <Switch id="activity-mail-switch" checked={isOn} disabled={isSaving} onCheckedChange={onChange} />
        </div>
      </SettingsSection>
    </div>
  );
}
