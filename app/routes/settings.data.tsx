/**
 * settings.data.tsx — "Data & backup" (`/settings/data`).
 *
 * Everything the user can do with their own copy of their diary: download it
 * (CSV or the lossless JSON backup), restore one onto this device, and manage
 * the device-local plate-photo cache. Lifted out of the old `/profile` page
 * unchanged in behaviour — the anchors it was deep-linked by (`#your-data`
 * from the backup nudge banner, `#import-backup` from the diary's empty
 * state) travelled with it and must keep working.
 *
 * NO SERVER LOADER, by design: the diary lives on the device (AGENTS.md,
 * local-first), so the export is built in the browser from the primary store
 * and never round-trips through the server.
 */
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Route } from './+types/settings.data';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';

import { buildLogsCsv, type ExportLogInput } from '#app/lib/export-format';
import {
  exportBackup,
  getLocalProfileGoals,
  listLocalFoodLogs,
  localFoodLogToSnapshot,
  markExported,
  resolveLocalTimezone,
  restoreBackup,
  serializeBackup,
} from '#app/lib/local-store';
import { todayInTimezone } from '#app/lib/user-days';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { PhotoCacheCard } from '#app/components/photo-cache-card';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.data') }];

export const handle = {
  title: 'Data & backup',
  titleKey: 'settings.data.title',
  backTo: '/settings',
};

////////////////////////////////////////////////////////////////////////////////
// Client-side downloads (M117/03: "your data" now lives on this device)
////////////////////////////////////////////////////////////////////////////////

/** Triggers a browser download of `body` as a file named `filename`. Browser-only. */
function downloadBlob({ filename, contentType, body }: { filename: string; contentType: string; body: string }): void {
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Maps a local food log to the pure CSV builder's row shape (id/foodId travel through opaquely, never rendered). */
function toExportLogInput(log: Awaited<ReturnType<typeof listLocalFoodLogs>>[number]): ExportLogInput {
  return {
    id: log.id,
    loggedAt: new Date(log.loggedAt),
    name: log.name,
    quantityGrams: log.quantityGrams,
    carbs: log.macros.carbs,
    fiber: log.macros.fiber,
    sugars: log.macros.sugars,
    polyols: log.macros.polyols,
    protein: log.macros.protein,
    fat: log.macros.fat,
    kcal: log.macros.kcal,
    mealType: log.mealType,
    source: log.source,
    aiEstimated: log.aiEstimated,
    curatedSource: log.curatedSource,
    foodId: log.foodId,
    logBatchId: log.logBatchId,
    // Reuse THE shared projection rather than re-deriving the per-100g → per-
    // serving scaling here: this is the same figure the diary and trends read,
    // so the CSV can't disagree with the app about a curated entry's carbs.
    netCarbs: localFoodLogToSnapshot(log).netCarbs,
    // Threaded through so `computeExportNetCarbs`'s compute-from-parts
    // fallback (used when `netCarbs` above is absent, e.g. a hand-typed
    // EU-panel entry) picks the right formula instead of double-subtracting
    // fibre — see spec 13 (M123).
    carbBasis: log.carbBasis,
  };
}

/** Builds and downloads the diary CSV from the on-device primary store. */
async function downloadDiaryCsv(): Promise<void> {
  const logs = await listLocalFoodLogs();
  const csv = buildLogsCsv(logs.map(toExportLogInput));
  const profile = await getLocalProfileGoals();
  const date = todayInTimezone(resolveLocalTimezone(profile));
  downloadBlob({ filename: `openplate-diary-${date}.csv`, contentType: 'text/csv;charset=utf-8', body: csv });
}

/**
 * Builds and downloads the full schema-versioned local backup (the same
 * lossless envelope `app/lib/local-store/backup.ts` round-trips through
 * import — M117/01's local-first backup story) and stamps the last-export
 * instant so the backup-nudge (spec 08) sees a fresh date.
 */
async function downloadEverythingJson(): Promise<void> {
  const envelope = await exportBackup();
  await markExported();
  const json = serializeBackup(envelope);
  const date = envelope.exportedAt.slice(0, 10);
  downloadBlob({
    filename: `openplate-backup-${date}.json`,
    contentType: 'application/json;charset=utf-8',
    body: json,
  });
}

/**
 * Restores a previously exported openplate backup onto this device
 * (M117/08 item 2 — the diary's empty state links here). Upsert semantics
 * (`restoreBackup`, spec 01): existing rows with matching ids are
 * overwritten, everything else is added, so this is safe to run into either
 * a fresh device or one that already has some data.
 */
function ImportBackupSection() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file if a retry is needed
    if (!file) return;

    setIsImporting(true);
    try {
      const json = await file.text();
      await restoreBackup(json);
      toast.success(t('settings.data.importSuccess'));
    } catch {
      toast.error(t('settings.data.importError'));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div id="import-backup" className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">{t('settings.data.importHeading')}</p>
      <p className="text-xs text-muted-foreground">{t('settings.data.importDescription')}</p>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void handleFileChange(event)}
      />
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full justify-center sm:h-10 sm:w-auto"
        disabled={isImporting}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload />
        {isImporting ? t('settings.data.importing') : t('settings.data.importButton')}
      </Button>
    </div>
  );
}

function DownloadButtons() {
  const { t } = useTranslation();
  const [isDownloading, setIsDownloading] = useState<'csv' | 'json' | null>(null);

  const handleDownload = (kind: 'csv' | 'json', run: () => Promise<void>) => {
    setIsDownloading(kind);
    void run().finally(() => setIsDownloading(null));
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full justify-center sm:h-10 sm:w-auto"
        disabled={isDownloading !== null}
        onClick={() => handleDownload('csv', downloadDiaryCsv)}
      >
        <Download />
        {isDownloading === 'csv' ? t('settings.data.preparing') : t('settings.data.downloadCsv')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full justify-center sm:h-10 sm:w-auto"
        disabled={isDownloading !== null}
        onClick={() => handleDownload('json', downloadEverythingJson)}
      >
        <Download />
        {isDownloading === 'json' ? t('settings.data.preparing') : t('settings.data.downloadJson')}
      </Button>
    </div>
  );
}

export default function SettingsData() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card id="your-data">
        <CardHeader>
          <CardTitle>{t('settings.data.exportTitle')}</CardTitle>
          <CardDescription>{t('settings.data.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DownloadButtons />
          <p className="text-xs text-muted-foreground">{t('settings.data.photosNote')}</p>
          <ImportBackupSection />
        </CardContent>
      </Card>

      <PhotoCacheCard />
    </div>
  );
}
