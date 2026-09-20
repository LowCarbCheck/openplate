import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
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
import { SettingsSection } from '#app/components/settings/settings-section';
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
import { trackPhotoCacheCleared } from '#app/lib/matomo-events';
import { ANONYMOUS_USER_ID } from '#app/lib/local-store/store';

/**
 * "Photos on this device" settings section. Plate photos are a best-effort, device-
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

  const handleClear = async (): Promise<void> => {
    setClearOpen(false);
    await clearAllPhotos(ownerId);
    trackPhotoCacheCleared();
    refreshUsage();
  };

  // Singular/plural is i18next's `count` job, not a ternary here — German and
  // English happen to share the one/other rule, but the next locale may not.
  const usageLine =
    usage.count === 0 ?
      t('settings.photos.usageEmpty')
    : t('settings.photos.usage', { count: usage.count, size: formatPhotoSize(usage.totalBytes) });

  return (
    <SettingsSection
      label={t('settings.photos.title')}
      description={t('settings.photos.description', { days: PHOTO_RETENTION_DAYS })}
    >
      {/* The ROW is the target, not the 32px track: a switch with a label
          beside it is a 44px row anybody can hit, and the label is what
          carries the words. */}
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor="save-plate-photos" className="block text-sm font-normal">
          {t('settings.photos.switchLabel')}
        </Label>
        <Switch id="save-plate-photos" checked={enabled} onCheckedChange={handleToggle} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{usageLine}</p>
        <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-11 sm:h-9" disabled={usage.count === 0}>
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
              <Button variant="destructive" onClick={() => void handleClear()}>
                {t('settings.photos.clearAll')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SettingsSection>
  );
}
