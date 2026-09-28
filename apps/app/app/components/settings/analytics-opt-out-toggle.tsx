/**
 * The switch that stops this instance counting your visits (2026-09-28, the pre-launch privacy audit).
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────
 *
 * Visit counting runs on legitimate interest, with no cookie and no consent banner, and that basis
 * gives a person the right to object. There was no way to. This is it, on Preferences because
 * that page is reachable signed out, and anchored at `#visit-counting` so the privacy notice can
 * link straight to it.
 *
 * ── ONLY WHERE THERE IS SOMETHING TO SWITCH OFF ──────────────────────────
 *
 * An instance with no Matomo configured counts nothing, and a switch there would suggest it does.
 *
 * ── THE BROWSER'S OWN "NO" ───────────────────────────────────────────────
 *
 * Under Do Not Track or Global Privacy Control nothing is counted whatever the switch says, so the
 * switch shows off and cannot be turned on, and a line says why. That line is rendered on the
 * server too, hidden, so its box is there from the first paint and showing it moves nothing: the
 * server cannot know the browser's signal, and a line that appeared after mount would push
 * everything below it down.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';

import { SETTINGS_INSET_CLASS } from '#app/components/settings/settings-section';
import { Label } from '#app/components/ui/label';
import { Switch } from '#app/components/ui/switch';
import { usePublicConfig } from '#app/hooks/use-public-config';
import { browserAsksNotToTrack, hasOptedOutOfAnalytics, setAnalyticsOptOut } from '#app/lib/analytics-opt-out';
import { cn } from '#app/lib/utils';

/** The section's anchor, for a link from the privacy notice. */
export const VISIT_COUNTING_ANCHOR = 'visit-counting';

/**
 * The switch, with its label, one line of explanation and one reserved line for the browser's signal.
 *
 * @returns the settings row, or `null` on an instance that counts nothing.
 */
export function AnalyticsOptOutToggle(): ReactElement | null {
  const { t } = useTranslation();
  const analytics = usePublicConfig()?.analytics ?? null;
  const [isCounting, setIsCounting] = useState(true);
  const [isBrowserSignal, setIsBrowserSignal] = useState(false);

  useEffect(() => {
    const signal = browserAsksNotToTrack();
    setIsBrowserSignal(signal);
    setIsCounting(!signal && !hasOptedOutOfAnalytics());
  }, []);

  if (analytics === null) return null;

  function handleToggle(next: boolean): void {
    setIsCounting(next);
    setAnalyticsOptOut(!next);
  }

  return (
    <div
      id={VISIT_COUNTING_ANCHOR}
      data-slot="settings-inset"
      className={cn(SETTINGS_INSET_CLASS, 'scroll-mt-20 space-y-3 px-4 py-4')}
    >
      {/* The ROW is the target, not the 32px track. */}
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor="analytics-counting" className="flex items-center gap-2 text-sm font-medium">
          <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('preferences.analytics.label')}
        </Label>
        <Switch
          id="analytics-counting"
          checked={isCounting}
          disabled={isBrowserSignal}
          onCheckedChange={handleToggle}
        />
      </div>
      <p className="text-sm text-muted-foreground">{t('preferences.analytics.description')}</p>
      <p className={cn('text-sm text-muted-foreground', !isBrowserSignal && 'invisible')} aria-hidden={!isBrowserSignal}>
        {t('preferences.analytics.browserSignal')}
      </p>
    </div>
  );
}
