import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { shouldShowBackupNudge } from '#app/lib/backup-nudge';
import { cn } from '#app/lib/utils';

/**
 * Dismissible, non-blocking reminder that the device has un-exported data
 * (M117/08 — spec 01's `daysSinceExport` mechanics, this file's copy and
 * placement). Same amber, non-alarming tone as `OfflineBanner` — being behind
 * on backups is a nudge, never an error. Dismissing hides it for the rest of
 * this session (component state, no persistence); it reappears on the next
 * load if the underlying condition is still true, which is the correct
 * "nudge" behavior rather than a bug — a real backup export clears the
 * condition at the source (`markExported`).
 *
 * A `null` `daysSinceExport` (never exported) is NOT an early-out here: that's
 * the population most at risk, so `shouldShowBackupNudge` owns the whole
 * decision — measuring a never-exported device's `daysSinceFirstData` against
 * the same threshold, and gating on `hasData` so a brand-new empty device
 * stays quiet.
 */
export function BackupNudgeBanner({
  daysSinceExport,
  daysSinceFirstData,
  hasData,
  className,
}: {
  daysSinceExport: number | null;
  /** Whole days since this device first held data — see `shouldShowBackupNudge`. */
  daysSinceFirstData: number | null;
  hasData: boolean;
  className?: string;
}) {
  const [isDismissed, setIsDismissed] = useState(false);
  const { t } = useTranslation();
  if (isDismissed) return null;
  if (!shouldShowBackupNudge({ daysSinceExport, daysSinceFirstData, hasData })) return null;
  // The copy moved out of `formatBackupNudgeMessage` and into the catalog
  // (M129/05): the singular/plural split it hand-rolled is `count`'s job in
  // i18next, and German needs its own plural rules for the same sentence.
  // `#app/lib/backup-nudge` keeps the decision (`shouldShowBackupNudge`),
  // which is the part worth unit-testing.
  const message =
    daysSinceExport === null ?
      t('banners.backupNeverExported')
    : t('banners.backupLastExport', { count: daysSinceExport });

  return (
    <output
      className={cn(
        'flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface px-3 py-2 text-sm text-accent-amber',
        className,
      )}
    >
      <Download className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">
        {message}{' '}
        <Link to="/settings/data#your-data" className="underline underline-offset-2 hover:no-underline">
          {t('banners.backupExportNow')}
        </Link>
      </span>
      <button
        type="button"
        aria-label={t('banners.backupDismiss')}
        onClick={() => setIsDismissed(true)}
        className="shrink-0 rounded p-0.5 text-accent-amber/70 hover:text-accent-amber"
      >
        <X className="h-4 w-4" />
      </button>
    </output>
  );
}
