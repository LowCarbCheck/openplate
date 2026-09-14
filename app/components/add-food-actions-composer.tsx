/**
 * The add-entry composer strip: **one control, three ways in.**
 *
 * ── What it replaces, and why ────────────────────────────────────────────
 *
 * `AddFoodActions` is three separate buttons with gaps between them, which the
 * eye reads as three competing offers. This strip collapses them into ONE
 * field-shaped object: the wide half is a writing surface that says what to do
 * and opens the composer, and the microphone and the camera are trim inside
 * the same frame, to the right of a hairline, the way a message composer
 * carries its dictation and attachment keys. Rank comes from area, not from
 * colour, so nothing is demoted to a consolation tile.
 *
 * It shipped to `/dashboard` after a playground review, and `/diary` followed:
 * all four of its add-entry surfaces, the three empty states and the one under
 * a day that has entries, render this strip. `AddFoodActions` survives only in
 * `/dev/playground`, as the before picture.
 *
 * ── The behaviour is the row's behaviour, unchanged ──────────────────────
 *
 * The photo affordance is a `button`, not a `Link`, because a navigation
 * cannot open a camera: a browser only honours a programmatic `input.click()`
 * inside the gesture that asked for it, so the tap has to do the work itself.
 * That gesture lives in `useCameraCapture`, shared with the tab bar's raised
 * launcher and with `AddFoodActions`. One decision, every surface.
 *
 * Type goes to `describeTo` and speak to the same destination with `speak=1`,
 * which focuses the composer's field and shows the dictation hint. Neither
 * goes to `/add`: that is the database search, which answers "which food is
 * this" for one item, and handing it to somebody who wants to write a whole
 * meal was the defect the three-button row already fixed once.
 *
 * Both destinations carry the viewed day when the caller passes one, so a
 * back-dated log, typed OR photographed, lands on the day in front of the
 * person.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Keyboard, Mic } from 'lucide-react';

import { Link } from '#app/components/link';
import { useCameraCapture } from '#app/components/add/use-camera-capture';
import { buildAddHref } from '#app/lib/add-food-hrefs';
import { cn } from '#app/lib/utils';

export function AddFoodActionsComposer({
  describeTo,
  scanTo = '/scan',
  className,
}: {
  /** The composer, carrying the viewed day. Typing goes here; dictating goes here with the field focused. */
  describeTo: string;
  scanTo?: string;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const { capture, triggerRef, inputRef, inputProps } = useCameraCapture({ scanTo });

  return (
    <div className={cn('w-full', className)}>
      <div className="flex w-full items-center gap-1 rounded-2xl border border-primary/25 bg-card/80 p-1.5 shadow-sm transition-shadow focus-within:border-primary/60 focus-within:shadow-md">
        <Link
          to={describeTo}
          className="flex min-h-11 flex-1 items-center gap-2.5 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
        >
          <Keyboard className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{t('launcher.sheetTitle')}</span>
        </Link>
        <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
        <Link
          to={buildAddHref(describeTo, { speak: true })}
          aria-label={t('launcher.speak')}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-primary transition-colors hover:bg-primary/10 active:bg-primary/15 motion-safe:active:scale-95"
        >
          <Mic className="size-5" aria-hidden="true" />
        </Link>
        <button
          ref={triggerRef}
          type="button"
          onClick={capture}
          aria-label={t('launcher.photo')}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30 transition-transform hover:bg-primary/90 motion-safe:active:scale-95"
        >
          <Camera className="size-5" aria-hidden="true" />
        </button>
      </div>
      {/* The hidden capture input, outside every conditional above: the element
          whose `click()` is on the gesture stack must not be able to unmount
          while the camera is opening. */}
      <input ref={inputRef} {...inputProps} />
    </div>
  );
}
