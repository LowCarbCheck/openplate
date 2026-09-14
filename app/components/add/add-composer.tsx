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
 * a day that has entries, render this strip. `AddFoodActions`, the three-button
 * row this strip replaced, is deleted (M232/02); it no longer survives as a
 * before picture anywhere, including `/dev/playground`.
 *
 * ── The behaviour is the row's behaviour, unchanged ──────────────────────
 *
 * The photo affordance is a `button`, not a `Link`, because a navigation
 * cannot open a camera: a browser only honours a programmatic `input.click()`
 * inside the gesture that asked for it, so the tap has to do the work itself.
 * That gesture lives in `useCameraCapture`, shared with the tab bar's raised
 * launcher. One decision, every surface.
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
 *
 * ── WHOSE CAMERA IS IT (M232/03) ─────────────────────────────────────────
 *
 * The launcher's sheet renders this strip too, and that page ALREADY has a
 * capture: the raised circle in the tab bar owns one, hoisted outside the
 * sheet on purpose, because closing a sheet must not unmount the element whose
 * `click()` is still on the gesture stack (`use-camera-capture.ts`). So the
 * strip takes an optional `capture`: given one it uses it and renders no input
 * at all, and given none it calls the hook itself, exactly as `/dashboard` and
 * `/diary` have always used it.
 *
 * THE CHOICE IS THE CALL SITE'S AND IT NEVER MOVES. A given call either passes
 * a capture or it does not, for the whole life of that mount, so the two cases
 * are two components underneath one signature. Nothing here can turn an input
 * off while the camera is opening, because nothing here ever turns one off.
 *
 * ── HOW HEAVY THE CAMERA KEY IS (M232/04) ────────────────────────────────
 *
 * The key is filled by default and outlined inside the launcher's sheet, and
 * that is the ONLY difference between the two variants.
 *
 * Filled everywhere was the original, deliberate call: a photo costs a camera
 * permission prompt, so it is worth naming first, and on `/dashboard` and
 * `/diary` this strip is the only prominent camera on the page. The tab bar's
 * raised circle is `md:hidden`, and the desktop sidebar carries `/scan` as a
 * flat link, so demoting the key everywhere would leave desktop and tablet
 * with no camera worth seeing.
 *
 * Inside the sheet the page already has that raised circle, a few pixels
 * outside the panel, filled and owning the camera-first language by itself.
 * A second filled camera there competes with it and says nothing new, so the
 * embedded variant draws an outline instead.
 *
 * The variant is an explicit prop rather than something read off `capture`,
 * so the treatment a call site gets can be audited at that call site.
 */
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Keyboard, Mic } from 'lucide-react';

import { Link } from '#app/components/link';
import { useCameraCapture, type CameraCapture } from '#app/components/add/use-camera-capture';
import { buildAddHref } from '#app/lib/add-food-hrefs';
import { cn } from '#app/lib/utils';

/** Where this strip is drawn, which decides the camera key's weight and nothing else. */
export type AddComposerVariant = 'standalone' | 'embedded';

/**
 * The camera key's weight, per context. See the module header for why the
 * sheet is the one place that steps back.
 */
const CAMERA_KEY_CLASS = {
  standalone: 'bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/90',
  embedded: 'border border-primary/40 text-primary hover:bg-primary/10 active:bg-primary/15',
} satisfies Record<AddComposerVariant, string>;

interface AddComposerBaseProps {
  /** The composer, carrying the viewed day. Typing goes here; dictating goes here with the field focused. */
  describeTo: string;
  className?: string;
  /**
   * The wide half's prompt. Left out it invites ("Add food"), which is right
   * on a page where nothing else says so. The launcher's sheet passes "Type",
   * because its own heading already carries the invitation.
   */
  label?: string;
  /**
   * How heavy the camera key is drawn. `'standalone'` fills it, which is what
   * `/dashboard` and `/diary` want; `'embedded'` outlines it, for the
   * launcher's sheet, where the raised circle beside it is already filled.
   */
  variant?: AddComposerVariant;
}

/**
 * `capture` and `scanTo` are mutually exclusive, not two independent optional
 * fields: a caller with its own capture has no use for a photo target, since
 * that capture already has its own, and a caller with neither gets the
 * default `/scan`. Modelling them as one flat object let a caller pass both
 * and lose `scanTo` in silence, so the choice is a discriminated union
 * instead, and passing both is a compile error at the call site.
 */
export type AddComposerProps = AddComposerBaseProps &
  (
    | {
        /**
         * A capture the CALLER owns, for a page that already has one. Given, this
         * strip renders no input of its own; see the module header.
         */
        capture: CameraCapture;
        scanTo?: never;
      }
    | {
        capture?: never;
        /** Where a photo is taken to. Only meaningful when this composer owns its own capture. */
        scanTo?: string;
      }
  );

export function AddComposer(props: AddComposerProps): ReactElement {
  const { describeTo, className, label, variant } = props;
  // The shared half of the props, named once so both branches carry the same
  // set and adding a base prop cannot reach one branch and miss the other.
  const base = { describeTo, className, label, variant };
  if (props.capture !== undefined) {
    return <ComposerStrip {...base} camera={props.capture} />;
  }
  return <ComposerWithOwnCamera {...base} scanTo={props.scanTo} />;
}

/** The strip on a page with no camera of its own: it opens one, and it renders the input for it. */
function ComposerWithOwnCamera({
  scanTo = '/scan',
  ...rest
}: AddComposerBaseProps & { scanTo?: string }): ReactElement {
  const camera = useCameraCapture({ scanTo });
  const { inputRef, inputProps } = camera;

  return (
    <ComposerStrip {...rest} camera={camera}>
      {/* The hidden capture input, outside every conditional above: the element
          whose `click()` is on the gesture stack must not be able to unmount
          while the camera is opening. */}
      <input ref={inputRef} {...inputProps} />
    </ComposerStrip>
  );
}

/** The strip itself. It draws the three keys and owns no camera, whoever's camera it is driving. */
function ComposerStrip({
  describeTo,
  className,
  label,
  variant = 'standalone',
  camera,
  children,
}: AddComposerBaseProps & {
  camera: CameraCapture;
  /** The capture input, rendered only by the caller that owns the camera. */
  children?: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const { capture, triggerRef } = camera;

  return (
    <div className={cn('w-full', className)}>
      <div className="flex w-full items-center gap-1 rounded-2xl border border-primary/25 bg-card/80 p-1.5 shadow-sm transition-shadow focus-within:border-primary/60 focus-within:shadow-md">
        <Link
          to={describeTo}
          className="flex min-h-11 flex-1 items-center gap-2.5 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
        >
          <Keyboard className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{label ?? t('launcher.sheetTitle')}</span>
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
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors motion-safe:active:scale-95',
            CAMERA_KEY_CLASS[variant],
          )}
        >
          <Camera className="size-5" aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}
