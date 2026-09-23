/**
 * The switch that stops this device proposing foods to LowCarbCheck (M251/04).
 *
 * ── WHEN IT RENDERS ──────────────────────────────────────────────────────
 *
 * Only on an instance whose operator turned backfill on
 * (`PublicConfig.foodDbBackfill`). Elsewhere nothing is ever sent, and a
 * switch for it would be a control that does nothing.
 *
 * ── WHY THE VALUE IS ON THE DEVICE ───────────────────────────────────────
 *
 * It lives in `localStorage` beside the weight unit, read by the confirm step
 * of the same device (`#app/lib/food-proposals-client`). The proposals carry
 * no identifier, so there is nothing about the person to follow them to a
 * second device; turning it off there is one more tap.
 *
 * ── NO LAYOUT SHIFT ──────────────────────────────────────────────────────
 *
 * The row renders at its final size from the first paint, on by default, and
 * the stored value is read after mount. A person who turned it off sees the
 * switch move; nothing around it does.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';

import { SettingsSection } from '#app/components/settings/settings-section';
import { Label } from '#app/components/ui/label';
import { Switch } from '#app/components/ui/switch';
import { isFoodDbContributionOn, setFoodDbContribution } from '#app/lib/food-proposals-client';

/**
 * The settings section with the switch, or nothing on an instance without backfill.
 *
 * @param props.isInstanceOn - `PublicConfig.foodDbBackfill`.
 * @returns the section, or `null`.
 */
export function FoodDbContributionToggle({ isInstanceOn }: { isInstanceOn: boolean }): ReactElement | null {
  const { t } = useTranslation();
  const [isOn, setIsOn] = useState(true);

  useEffect(() => {
    setIsOn(isFoodDbContributionOn());
  }, []);

  if (!isInstanceOn) return null;

  function handleToggle(next: boolean): void {
    setIsOn(next);
    setFoodDbContribution(next);
  }

  return (
    <SettingsSection label={t('settingsAi.foodDb.title')} contentClassName="space-y-3">
      {/* The ROW is the target, not the 32 px track. */}
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor="food-db-contribute" className="flex items-center gap-2 text-sm font-medium">
          <Database className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('settingsAi.foodDb.label')}
        </Label>
        <Switch id="food-db-contribute" checked={isOn} onCheckedChange={handleToggle} />
      </div>
      <p className="text-sm text-muted-foreground">{t('settingsAi.foodDb.description')}</p>
    </SettingsSection>
  );
}
