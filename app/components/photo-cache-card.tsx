import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#app/components/ui/alert-dialog';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Label } from '#app/components/ui/label';
import { Switch } from '#app/components/ui/switch';
import {
  clearAllPhotos,
  getPhotoUsage,
  isPhotoCaptureEnabled,
  setPhotoCaptureEnabled,
  type PhotoUsage,
} from '#app/lib/local-store/photos';
import { formatPhotoSize, PHOTO_RETENTION_DAYS } from '#app/lib/local-store/photo-policy';
import { ANONYMOUS_USER_ID } from '#app/lib/local-store/store';

/**
 * "Photos on this device" settings card. Plate photos are a best-effort, device-
 * local cache (never uploaded, never synced); this surfaces their count + rough
 * size, a Clear-all confirm, and an on/off switch (default ON) whose OFF also
 * clears. All state lives in IndexedDB, so it loads in an effect — SSR renders a
 * stable default (enabled, empty) that the client then fills in.
 *
 * Every photo row is keyed to an owner id (`photo-policy.ts`'s `buildPhotoKey`)
 * because the cache's IndexedDB database used to be shared by several signed-in
 * accounts on one device. With accounts gone (M128 spec 03) there is exactly one
 * owner left — the `ANONYMOUS_USER_ID` sentinel — and `photo-rekey.ts` moves any
 * surviving account-keyed row onto it at boot, so this card sees the whole
 * device's cache. The on/off switch was always device-global (see `photos.ts`'s
 * module doc comment).
 */
export function PhotoCacheCard() {
  const { t } = useTranslation();
  const ownerId = ANONYMOUS_USER_ID;
  const [usage, setUsage] = useState<PhotoUsage>({ count: 0, totalBytes: 0 });
  const [enabled, setEnabled] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);

  const refreshUsage = (): void => {
    void getPhotoUsage(ownerId).then(setUsage);
  };

  useEffect(() => {
    let active = true;
    const loadCaptureEnabled = async (): Promise<void> => {
      const value = await isPhotoCaptureEnabled();
      if (active) setEnabled(value);
    };
    const loadUsage = async (): Promise<void> => {
      const value = await getPhotoUsage(ownerId);
      if (active) setUsage(value);
    };
    void loadCaptureEnabled();
    void loadUsage();
    return () => {
      active = false;
    };
  }, [ownerId]);

  // Turning the switch off also clears this device's cached photos (handled
  // inside setPhotoCaptureEnabled).
  const handleToggle = (next: boolean): void => {
    setEnabled(next);
    void setPhotoCaptureEnabled(next, ownerId).then(refreshUsage);
  };

  const handleClear = (): void => {
    setClearOpen(false);
    void clearAllPhotos(ownerId).then(refreshUsage);
  };

  // Singular/plural is i18next's `count` job, not a ternary here — German and
  // English happen to share the one/other rule, but the next locale may not.
  const usageLine =
    usage.count === 0 ?
      t('settings.photos.usageEmpty')
    : t('settings.photos.usage', { count: usage.count, size: formatPhotoSize(usage.totalBytes) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" /> {t('settings.photos.title')}
        </CardTitle>
        <CardDescription>{t('settings.photos.description', { days: PHOTO_RETENTION_DAYS })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="save-plate-photos" className="text-sm font-normal">
            {t('settings.photos.switchLabel')}
          </Label>
          <Switch id="save-plate-photos" checked={enabled} onCheckedChange={handleToggle} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{usageLine}</p>
          <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={usage.count === 0}>
                <Trash2 className="h-4 w-4" /> {t('settings.photos.clearAll')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('settings.photos.clearConfirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('settings.photos.clearConfirmDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('settings.photos.cancel')}</AlertDialogCancel>
                <Button variant="destructive" onClick={handleClear}>
                  {t('settings.photos.clearAll')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
