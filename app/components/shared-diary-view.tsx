/**
 * A patient's diary, read-only, decrypted ON THE CLINICIAN'S DEVICE.
 *
 * `app/routes/settings.data.tsx` states the house rule — the diary lives on
 * the device — and this is the first screen that renders SOMEBODY ELSE's
 * diary. The rule does not bend for that: the share wrap is opened with the
 * clinician's private key and the blob with the DEK it yields, both in this
 * browser. No server holds either, and no loader fetches a patient blob.
 *
 * The component is deliberately presentational and takes a decrypted
 * {@link SharedDiary}. That keeps every decision about what a grantee may see
 * in `sharing.ts` — which only ever hands over the SHAREABLE region, never the
 * owner-private compartment — and lets this screen be rendered in a test.
 */
import { useTranslation } from 'react-i18next';

import { computeDailyTotals } from '#app/lib/local-store';
import type { LocalFoodLog } from '#app/lib/local-store';
import type { SharedDiary } from '#app/lib/sync/sharing';

/** How many recent days the read view lists. A clinician wants the recent picture, not an archive. */
const DAYS_SHOWN = 14;

/** One day of the patient's diary, as this view renders it. */
interface SharedDiaryDay {
  dayKey: string;
  netCarbs: number;
  entries: LocalFoodLog[];
}

/** Buckets the shared logs by day, most recent first. Pure — the same aggregate the owner's own diary uses. */
export function summariseSharedDiary(logs: readonly LocalFoodLog[], limit = DAYS_SHOWN): SharedDiaryDay[] {
  const dayKeys = [...new Set(logs.map((log) => log.dayKey))].toSorted().toReversed().slice(0, limit);
  return dayKeys.map((dayKey) => ({
    dayKey,
    netCarbs: computeDailyTotals(logs, dayKey).summary?.netCarbs ?? 0,
    entries: logs.filter((log) => log.dayKey === dayKey),
  }));
}

export function SharedDiaryView({ diary }: { diary: SharedDiary }) {
  const { t } = useTranslation();
  const days = summariseSharedDiary(diary.snapshot.foodLogs);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">
          {t('sharing.clinician.patientTitle', { accountId: diary.grantorAccountId })}
        </h2>
        <p className="text-xs text-muted-foreground">{t('sharing.clinician.readOnly')}</p>
        <p className="text-xs text-muted-foreground">
          {t('sharing.clinician.lastUpdated', { at: new Date(diary.createdAt).toLocaleString() })}
        </p>
      </header>

      {days.length === 0 && <p className="text-sm text-muted-foreground">{t('sharing.clinician.noEntries')}</p>}

      <ul className="space-y-3">
        {days.map((day) => (
          <li key={day.dayKey} className="rounded-xl border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">{day.dayKey}</p>
              <p className="text-sm text-muted-foreground">
                {t('sharing.clinician.dayNetCarbs', { grams: Math.round(day.netCarbs) })}
              </p>
            </div>
            <ul className="mt-2 space-y-1">
              {day.entries.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">{entry.name}</span>
                  <span>{t('sharing.clinician.entryGrams', { grams: Math.round(entry.quantityGrams) })}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
