/**
 * The switch that turns the streak and the awards off (M235/06).
 *
 * ── WHY IT IS HERE AND NOT ON THE AWARDS SCREEN ──────────────────────────
 *
 * The awards screen is reached from the streak card on `/trends`, and the
 * switch hides that card. A switch living on the screen it makes unreachable
 * is a door that locks from the inside, so it sits on Preferences, which is
 * already the page for "how the app looks" and is reachable either way.
 *
 * ── WHY THE VALUE IS ON THE PROFILE AND NOT IN localStorage ──────────────
 *
 * Unlike the theme and the language above it on that page, this is not a
 * property of the device. A person who says they do not want a streak has said
 * it about the app, so it rides the merged, synced profile row and reaches
 * their other device (`LocalProfileGoals.gamificationHidden`).
 *
 * The read happens after mount and the switch renders `checked={false}` until
 * it resolves. That is the same shape every device-reading settings row here
 * uses, and the wrong-for-a-moment direction is deliberately the visible one:
 * a person who has hidden these surfaces sees the switch settle, while a
 * person who has not sees nothing change.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';

import { SETTINGS_INSET_CLASS } from '#app/components/settings/settings-section';
import { Label } from '#app/components/ui/label';
import { Switch } from '#app/components/ui/switch';
import { isGamificationHidden } from '#app/lib/gamification/surfaces';
import { getLocalProfileGoals, patchLocalProfileGoals } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';
import { cn } from '#app/lib/utils';

/**
 * The switch, with its own label and one line of explanation.
 *
 * @returns the settings row.
 */
export function AwardsVisibilityToggle(): ReactElement {
  const { t } = useTranslation();
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    async function readProfile(): Promise<void> {
      try {
        const profile = await getLocalProfileGoals();
        if (isCancelled) return;
        setIsHidden(isGamificationHidden(profile));
      } catch (error) {
        // The switch stays where it is and the page keeps working: a failed
        // read must not cost somebody their Preferences page.
        reportError(error, { boundary: 'awards-visibility-read' });
      }
    }
    void readProfile();
    return () => {
      isCancelled = true;
    };
  }, []);

  function handleToggle(next: boolean): void {
    // Optimistic, then written: the switch is a display preference, so the
    // control must not lag a store write, and a failed write is reported
    // rather than thrown at somebody who flicked a switch.
    setIsHidden(next);
    async function write(): Promise<void> {
      try {
        await patchLocalProfileGoals({ gamificationHidden: next });
      } catch (error) {
        reportError(error, { boundary: 'awards-visibility-write' });
      }
    }
    void write();
  }

  // NO HEADING above it, so this is the bare inset container rather than a
  // `SettingsSection`: the switch's own `Label` names the setting, and a
  // heading would be the same words twice (DESIGN.md §10.7).
  return (
    <div className={cn(SETTINGS_INSET_CLASS, 'space-y-3 px-4 py-4')}>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="awards-hidden" className="flex items-center gap-2 text-sm font-medium">
          <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('awards.hide')}
        </Label>
        <Switch id="awards-hidden" checked={isHidden} onCheckedChange={handleToggle} />
      </div>
      <p className="text-sm text-muted-foreground">{t('awards.hideDescription')}</p>
    </div>
  );
}
