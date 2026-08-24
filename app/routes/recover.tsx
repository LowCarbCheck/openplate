/**
 * `/recover` — the blocking screen a device lands on when its local diary is
 * gone (M123 spec 01).
 *
 * WHY THIS EXISTS. openplate keeps everything on the device. The load/autosave
 * race documented in `app/lib/local-store/persist.ts` can empty the primary
 * store's TABLES partition while the VALUES partition survives, and until this
 * route existed the `_personal` gate read the result — no profile, no logs —
 * as a brand-new install and opened the first-run wizard. Someone who had
 * logged for weeks was shown a welcome screen. That is the single worst thing
 * this app can do with a data-loss event: present it as a fresh start.
 *
 * So the gate (`app/lib/onboarding-gate.ts`) now consults the `firstDataAt`
 * marker in the surviving partition and sends that device HERE instead. This
 * page says only what is actually known — this device has held data, the local
 * copy is not readable — offers the one real remedy (restore a backup file),
 * and does not promise recovery openplate cannot deliver. There is no server
 * copy to fetch, and saying so plainly is part of the job.
 *
 * CLIENT-ONLY and TOP-LEVEL, deliberately. It exports no loader, action or
 * `clientLoader`: the backup file is read in the browser and restored straight
 * into IndexedDB, and its contents (a whole diary) must never reach this
 * server. It is registered outside `_personal` because that layout's gate is
 * exactly what redirects here — nesting it there would loop.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Upload } from 'lucide-react';

import type { Route } from './+types/recover';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { dateLabelLocale } from '#app/i18n/date-locale';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { getFirstDataAt, restoreBackup } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.recover') }];

/** Where a successful restore lands. A full page load, not a client nav — see `handleFileChange`. */
const AFTER_RESTORE_PATH = '/diary';

/** What the restore control is doing. `failed` keeps the button usable for a second attempt. */
type RestoreStatus = 'idle' | 'restoring' | 'failed';

/**
 * The one fact this page can state about the missing data: when this device
 * first held any. Read on mount rather than in a loader — the marker lives in
 * IndexedDB, which exists only in the browser, and a missing or malformed
 * marker simply renders nothing extra.
 */
function useFirstDataLabel(): string | null {
  const { i18n } = useTranslation();
  const [firstDataAt, setFirstDataAt] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function readMarker(): Promise<void> {
      const value = await getFirstDataAt();
      if (isMounted) setFirstDataAt(value);
    }
    void readMarker();
    return () => {
      isMounted = false;
    };
  }, []);

  if (firstDataAt === null) return null;
  return new Intl.DateTimeFormat(dateLabelLocale(i18n.language), { dateStyle: 'long' }).format(new Date(firstDataAt));
}

/**
 * Restores an exported openplate backup onto this device.
 *
 * `restoreBackup` upserts, so this is safe to run into whatever is left of the
 * store. On success the page does a FULL navigation rather than a client-side
 * one: the store and its persister were just rewritten wholesale, and a fresh
 * document is the one way to be sure every route re-reads them from scratch.
 */
function RestoreFromBackup() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<RestoreStatus>('idle');

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file be picked again after a failure
    if (!file) return;

    setStatus('restoring');
    try {
      await restoreBackup(await file.text());
    } catch (error) {
      reportError(error, { boundary: 'recover-restore' });
      setStatus('failed');
      return;
    }
    window.location.assign(AFTER_RESTORE_PATH);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('recover.restoreBody')}</p>
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
        className="h-11 w-full justify-center sm:w-auto"
        disabled={status === 'restoring'}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload />
        {status === 'restoring' ? t('recover.restoring') : t('recover.restoreButton')}
      </Button>
      {status === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          {t('recover.restoreError')}
        </p>
      )}
    </div>
  );
}

/**
 * The recovery screen itself: what is known, what can be done about it, and —
 * last, and understated — the way out for someone who has no backup at all.
 * That escape exists so nobody is permanently stuck on this page; it is a
 * choice the user makes, never something the gate decides for them.
 */
export default function Recover() {
  const { t } = useTranslation();
  const firstDataLabel = useFirstDataLabel();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <AlertTriangle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <CardTitle>{t('recover.title')}</CardTitle>
          <CardDescription>{t('recover.lead')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {firstDataLabel !== null && (
            <p className="text-sm text-muted-foreground">{t('recover.firstDataAt', { date: firstDataLabel })}</p>
          )}
          <div className="space-y-2 border-t pt-4">
            <h2 className="text-sm font-medium">{t('recover.restoreHeading')}</h2>
            <RestoreFromBackup />
          </div>
          <div className="space-y-2 border-t pt-4">
            <h2 className="text-sm font-medium">{t('recover.noBackupHeading')}</h2>
            <p className="text-sm text-muted-foreground">{t('recover.noBackupBody')}</p>
            <Button asChild variant="outline" className="h-11 w-full justify-center sm:w-auto">
              <Link to="/onboarding">{t('recover.startFresh')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
