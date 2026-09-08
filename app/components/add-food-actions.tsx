/**
 * The three ways to start a log, side by side and the same size: **photograph,
 * type, speak.**
 *
 * THEY ARE EQUALS NOW. Photograph used to be a full-width primary with the
 * other two shrunk underneath it, which said that typing was the consolation
 * prize. All three reach the same AI review screen and produce the same
 * entries, so all three get the same height, the same tap target and a label
 * under an icon. Photograph keeps the filled fill because it is the one that
 * costs a camera permission and is worth naming first; the other two are
 * outlined in the same primary colour, so the row reads as one family rather
 * than one action plus two links.
 *
 * The photo action is a `Button`, not a `Link`, because a navigation cannot
 * open a camera: a browser only honours a programmatic `input.click()` inside
 * the gesture that asked for it, so the tap has to do the work itself. The
 * gesture lives in `useCameraCapture`, which the tab bar's raised launcher
 * shares. One decision, four surfaces, no drift.
 *
 * "Speak" renders only where a recogniser exists (Firefox has none), so nobody
 * sees a dead control. Without it the row is two columns rather than three
 * with a hole in it.
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

/**
 * The shared geometry of one action. Tall enough (h-14) that the icon and its
 * label both fit without crowding, and wide enough that a thumb hits the
 * button rather than the gap beside it.
 */
const ACTION_CLASS = 'h-14 flex-1 flex-col gap-1 px-2 text-xs font-medium';

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
      <div className="flex gap-2">
        <Button ref={triggerRef} type="button" className={ACTION_CLASS} onClick={() => captureWith('plate')}>
          <Camera className="h-5 w-5" aria-hidden="true" />
          {t('launcher.photo')}
        </Button>
        {/* Outlined in the primary colour rather than a neutral grey: these are
            the same action at the same rank, and a grey pair beside a filled
            button would read as "or, if you must". */}
        <Button asChild variant="outline" className={cn(ACTION_CLASS, 'border-primary/50 text-primary')}>
          <Link to={addTo}>
            <Keyboard className="h-5 w-5" aria-hidden="true" />
            {t('launcher.type')}
          </Link>
        </Button>
        {canSpeak && (
          <Button asChild variant="outline" className={cn(ACTION_CLASS, 'border-primary/50 text-primary')}>
            <Link to={speakHref(addTo)}>
              <Mic className="h-5 w-5" aria-hidden="true" />
              {t('launcher.speak')}
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
