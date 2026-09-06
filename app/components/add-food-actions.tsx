/**
 * The one hierarchy for starting a log: **photograph first, then type or
 * speak.**
 *
 * The primary opens the camera. It is a `Button`, not a `Link`, because a
 * navigation cannot open a camera: a browser only honours a programmatic
 * `input.click()` inside the gesture that asked for it, so the tap has to do
 * the work itself. The gesture lives in `useCameraCapture`, which the tab
 * bar's raised launcher shares. One decision, four surfaces, no drift.
 *
 * The two quiet buttons beside it are the other ways in, visible rather than
 * hidden behind the photo path. "Speak" renders only where a recogniser
 * exists (Firefox has none), so nobody sees a dead control.
 *
 * BOTH destinations are passed in, and both carry the viewed day. `/diary`
 * sends `/add?date=...` and `/scan?date=...` when the user is not looking at
 * today, so a back-dated log, typed OR photographed, lands on the day in front
 * of them. `/dashboard` is always today and takes the defaults. The speak
 * destination is `addTo` with `speak=1`, which arms the microphone on the add
 * screen without ever starting it.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Keyboard, Mic } from 'lucide-react';
import { Link } from '#app/components/link';
import { Button } from '#app/components/ui/button';
import { useCameraCapture } from '#app/components/add/use-camera-capture';
import { useSpeechInputAvailable } from '#app/components/add/speech-input-button';
import { cn } from '#app/lib/utils';

/** `addTo` with `speak=1` added, whether or not it already carries a query. */
export function speakHref(addTo: string): string {
  const [path = addTo, query = ''] = addTo.split('?');
  const params = new URLSearchParams(query);
  params.set('speak', '1');
  return `${path}?${params.toString()}`;
}

export function AddFoodActions({
  addTo,
  scanTo = '/scan',
  className,
}: {
  addTo: string;
  scanTo?: string;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const { captureWith, triggerRef, inputRef, inputProps } = useCameraCapture({ scanTo });
  const canSpeak = useSpeechInputAvailable() === true;

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <Button ref={triggerRef} type="button" className="h-11 w-full" onClick={() => captureWith('plate')}>
        <Camera className="h-4 w-4" aria-hidden="true" /> {t('diary.actions.photograph')}
      </Button>
      <div className="flex gap-2">
        <Button asChild variant="outline" className="h-11 flex-1">
          <Link to={addTo}>
            <Keyboard className="h-4 w-4" aria-hidden="true" /> {t('launcher.type')}
          </Link>
        </Button>
        {canSpeak && (
          <Button asChild variant="outline" className="h-11 flex-1">
            <Link to={speakHref(addTo)}>
              <Mic className="h-4 w-4" aria-hidden="true" /> {t('launcher.speak')}
            </Link>
          </Button>
        )}
      </div>
      {/* The hidden capture input, outside every conditional above: the
          element whose `click()` is on the gesture stack must not be able to
          unmount while the camera is opening. */}
      <input ref={inputRef} {...inputProps} />
    </div>
  );
}
