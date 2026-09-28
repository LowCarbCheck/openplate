/**
 * An alternate STRUCTURE for the add-entry row, for review only.
 *
 * The old row was `#app/components/add-food-actions`, now deleted (M232/02):
 * three separate buttons with gaps between them, which the eye reads as three
 * competing offers. The concept here collapses that into ONE object, and it
 * keeps photograph, type and speak at equal rank, because demoting typing was
 * a defect the old row already fixed once and is not worth re-introducing.
 *
 * Concept A, the composer strip, WAS REVIEWED AND SHIPPED: it lives at
 * `#app/components/intake/intake-composer` and `/dashboard` renders it. The
 * playground imports it from there rather than keeping a second copy.
 *
 * The variant keeps the shipped behaviour: the camera gesture is a button so
 * `input.click()` stays inside the tap, type and speak are Links into the
 * composer. A chosen variant can replace the shipped body without re-wiring.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Keyboard, Mic } from 'lucide-react';

import { Link } from '#app/components/link';
import { useCameraCapture } from '#app/components/intake/use-camera-capture';
import { ADD_PHOTO_PATH, buildIntakeHref } from '#app/lib/intake-hrefs';
import { cn } from '#app/lib/utils';

type VariantProps = {
  describeTo: string;
  scanTo?: string;
  className?: string;
};

/** One segment of concept B. Equal width, equal height, no gap; the divider between them is the parent's business. */
const SEGMENT_CLASS =
  'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 active:bg-primary/15';

/**
 * Concept B, the segmented control.
 *
 * The three modes share ONE raised surface, split by hairlines, with no gaps
 * and one outer radius, so the row reads as a single control with three ways in
 * rather than as three things to choose between. Equal geometry keeps them
 * equal; the camera is recognisable because its icon sits on a filled teal
 * chip, not because it is bigger or louder than the others.
 */
export function AddFoodActionsSegmented({ describeTo, scanTo = ADD_PHOTO_PATH, className }: VariantProps): ReactElement {
  const { t } = useTranslation();
  const { capture, triggerRef, inputRef, inputProps } = useCameraCapture({ scanTo });

  return (
    <div className={cn('w-full', className)}>
      <div className="flex w-full divide-x divide-border overflow-hidden border border-primary/25 bg-card shadow-md shadow-black/20">
        <button ref={triggerRef} type="button" onClick={capture} className={SEGMENT_CLASS}>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Camera className="size-4" aria-hidden="true" />
          </span>
          {t('launcher.photo')}
        </button>
        <Link to={describeTo} className={SEGMENT_CLASS}>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Keyboard className="size-4" aria-hidden="true" />
          </span>
          {t('launcher.type')}
        </Link>
        <Link to={buildIntakeHref(describeTo, { speak: true })} className={SEGMENT_CLASS}>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mic className="size-4" aria-hidden="true" />
          </span>
          {t('launcher.speak')}
        </Link>
      </div>
      <input ref={inputRef} {...inputProps} />
    </div>
  );
}
