/**
 * The intake composer strip: **one control, three ways in.**
 *
 * ── What it is, and what it is NOT ───────────────────────────────────────
 *
 * This strip takes an INTAKE: a person says what they have, by writing it, by
 * dictating it, or by photographing it. What is then done with that intake is
 * not this component's business. It knows hrefs and never a purpose.
 *
 * Two consumers render it today, and they differ only in the links they pass:
 *
 * - the diary, where `describeTo` is `/add/describe` and a photo goes to
 *   `/add/photo`, so words and pictures become food logged on the day on
 *   screen;
 * - the pantry (M233/02), where `describeTo` is `/add/describe?to=/pantry`
 *   and a photo goes to `/pantry`, so the same words and pictures become the
 *   list of what is in the fridge.
 *
 * That is why it lives under `components/intake/` and is not called an
 * add-food composer: a third consumer is a third pair of hrefs at a call site,
 * not a branch in here. The allowlist behind `?to=` is `app/lib/intake-consumers.ts`.
 *
 * ── What it replaces, and why ────────────────────────────────────────────
 *
 * `AddFoodActions` was three separate buttons with gaps between them, which the
 * eye reads as three competing offers. This strip collapses them into ONE
 * field-shaped object: the wide half is a writing surface that says what to do
 * and opens the composer, and the microphone is trim inside the same frame, to
 * the right of a hairline, the way a message composer carries its dictation
 * key. The camera sat beside it as a third key until M260; it leads the strip
 * now, as a large button of its own (see THE PHOTO DOOR below).
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
 * That gesture lives in `useCameraCapture`, shared with the tab bar's add
 * launcher. One decision, every surface.
 *
 * Type goes to `describeTo` and speak to the same destination with `speak=1`,
 * which focuses the composer's field and shows the dictation hint. Neither
 * goes to `/add/search`: that is the database search, which answers "which
 * food is this" for one item, and handing it to somebody who wants to write a
 * whole meal was the defect the three-button row already fixed once.
 *
 * Both destinations carry the viewed day when the caller passes one, so a
 * back-dated log, typed OR photographed, lands on the day in front of the
 * person.
 *
 * ── WHERE THE STRIP HAS NO CAMERA (M259) ─────────────────────────────────
 *
 * The launcher's sheet renders this strip too, under the sheet's own photo
 * door, and there the strip draws type and speak only: `variant="wordsOnly"`.
 *
 * Until M259 the sheet's strip carried the camera, as an outlined key at its
 * far end (M232/04 had stepped it back from the filled key so it would not
 * compete with the raised plus below the panel), driven by a capture the
 * launcher handed down. After a day with that on a phone the operator wrote:
 * "the photo option needs to be much more prominent and the first thing you
 * want to click on. it's currently almost hidden." So the sheet leads with a
 * large filled photo door of its own (`add-launcher.tsx`), and a second
 * camera in the strip under it would say the same thing twice, smaller. The
 * words-only strip calls no capture hook and renders no input, so the sheet
 * still has no capture input inside it: the bar's one input sits outside the
 * sheet, where a close cannot unmount it (`use-camera-capture.ts`).
 *
 * ── THE PHOTO DOOR, EVERYWHERE ELSE (M260) ──────────────────────────────
 *
 * On `/dashboard`, `/diary` and `/pantry` the strip leads with the sheet's own
 * large photo button, `PhotoDoor`, above the type and speak row, and the row
 * has no camera key. One camera per strip.
 *
 * Until M260 these pages ended the row in a filled 44 px camera key. Filled
 * was the original, deliberate call and it still holds: a photo costs a camera
 * permission prompt, so it is worth naming first, and on these pages the strip
 * is the only prominent camera. The desktop sidebar carries `/add/photo` as a
 * flat link, and the tab bar's plus is phone only, so on desktop and tablet
 * the strip's camera is the one worth seeing. What changed is the size: 0.48.0
 * put the large button in the sheet because the operator had called the key
 * "almost hidden" there, counsel noted the strip still drew that same key, and
 * the operator answered "yes same large button". So the button carries the
 * job at every width now, and both doors render the one component.
 *
 * The strip owns that camera itself: it calls the capture hook, puts the
 * hook's `triggerRef` on the button (focus comes back there after a dismissed
 * camera), and renders the input, in the one branch that draws the button.
 * The button's name is "Plate photo" by default, and the pantry passes
 * `photoLabel`, because it photographs a shelf, not a plate.
 *
 * The variant is an explicit prop rather than something inferred, so the
 * strip a call site gets can be audited at that call site.
 */
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Mic } from 'lucide-react';

import { Link } from '#app/components/link';
import { PhotoDoor } from '#app/components/intake/photo-door';
import { useCameraCapture } from '#app/components/intake/use-camera-capture';
import { ADD_PHOTO_PATH, buildIntakeHref } from '#app/lib/intake-hrefs';
import { cn } from '#app/lib/utils';

/**
 * What the strip draws. `'standalone'` leads with the large photo button and
 * owns the camera behind it, then type and speak; `'wordsOnly'` draws type and
 * speak, for the launcher's sheet, whose own photo door leads it. See the
 * module header.
 */
export type IntakeComposerVariant = 'standalone' | 'wordsOnly';

interface IntakeComposerBaseProps {
  /** The composer, carrying the viewed day. Typing goes here; dictating goes here with the field focused. */
  describeTo: string;
  className?: string;
  /**
   * The wide half's prompt. Left out it invites ("Add food"), which is right
   * on a page where nothing else says so. The launcher's sheet passes "Type",
   * because its own heading already carries the invitation.
   */
  label?: string;
}

/**
 * `variant` and `scanTo` in one union: a words-only strip has no camera, so a
 * photo target given to it would be dropped in silence. Passing both is a
 * compile error at the call site instead.
 */
export type IntakeComposerProps = IntakeComposerBaseProps &
  (
    | {
        /** Type and speak only; see the module header. */
        variant: 'wordsOnly';
        scanTo?: never;
        photoLabel?: never;
      }
    | {
        variant?: 'standalone';
        /** Where a photo is taken to. Left out, `/add/photo`. */
        scanTo?: string;
        /** The photo button's name. Left out, "Plate photo"; the pantry photographs a shelf. */
        photoLabel?: string;
      }
  );

export function IntakeComposer(props: IntakeComposerProps): ReactElement {
  const { describeTo, className, label } = props;
  // The shared half of the props, named once so both branches carry the same
  // set and adding a base prop cannot reach one branch and miss the other.
  const base = { describeTo, className, label };
  if (props.variant === 'wordsOnly') {
    return <ComposerStrip {...base} />;
  }
  return <ComposerWithOwnCamera {...base} scanTo={props.scanTo} photoLabel={props.photoLabel} />;
}

/**
 * The strip on a page with no camera of its own: it opens one with the large
 * photo button, and it renders the input for it.
 */
function ComposerWithOwnCamera({
  scanTo = ADD_PHOTO_PATH,
  photoLabel,
  ...rest
}: IntakeComposerBaseProps & { scanTo?: string; photoLabel?: string }): ReactElement {
  const { t } = useTranslation();
  const { capture, triggerRef, inputRef, inputProps } = useCameraCapture({ scanTo });

  return (
    <ComposerStrip
      {...rest}
      // `capture` straight onto the tap, nothing awaited before it, for the
      // gesture rule in the module header. The hook's ref rides here, where
      // focus comes back after a dismissed camera.
      photoDoor={
        <PhotoDoor
          ref={triggerRef}
          onClick={capture}
          dataSlot="intake-composer-photo"
          label={photoLabel ?? t('launcher.platePhoto')}
        />
      }
    >
      {/* The hidden capture input, outside every conditional above: the element
          whose `click()` is on the gesture stack must not be able to unmount
          while the camera is opening. */}
      <input ref={inputRef} {...inputProps} />
    </ComposerStrip>
  );
}

/**
 * The strip itself. It draws type and speak, under the photo button when it is
 * handed one; it owns no camera of its own.
 */
function ComposerStrip({
  describeTo,
  className,
  label,
  photoDoor,
  children,
}: IntakeComposerBaseProps & {
  /** The large photo button, drawn above the row. Left out, the strip draws no camera. */
  photoDoor?: ReactNode;
  /** The capture input, rendered only by the caller that owns the camera. */
  children?: ReactNode;
}): ReactElement {
  const { t } = useTranslation();

  return (
    // A COLUMN: the photo button on top, the type and speak row under it. The
    // button is in the first paint, so nothing moves when the page settles.
    // The capture input is `sr-only`, out of the flow, so the gap is between
    // the two visible children only.
    <div data-slot="intake-composer" className={cn('flex w-full flex-col gap-2', className)}>
      {photoDoor}
      {/* THE ROW IS A CONTROL, NOT A CARD. The box and its keys draw no
          radius, square corners app-wide (DESIGN.md section 5); it was 16px
          around 12px keys until M243 spec 03, which read as a card with
          smaller cards in it. Nothing about the geometry moved: the mic key
          is the same 44 px square. Do not name that class in a comment,
          `intake-composer.test.ts` counts the literal and a mention makes it
          two. */}
      <div className="flex w-full items-center gap-1 border border-primary/25 bg-card/80 p-1.5 shadow-sm transition-shadow focus-within:border-primary/60 focus-within:shadow-md">
        {/* `min-w-0` is load-bearing (M243 spec 05b). The label's own box is an
            ellipsis box, but this link is the flex item, and a flex item's
            automatic minimum is its CONTENT's minimum, so the German "Essen
            eintragen" held the link at 170 px and pushed the row's last key
            (the camera key, until M260) 9 px past the hero card on a 320 px
            phone. Shrinking the link is what lets the ellipsis do its job. */}
        <Link
          to={describeTo}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-3 text-sm text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
        >
          {/* The two quiet keys take the label's own ink, not the brand colour
              (M243 spec 05b, the teal budget). The strip already spends the
              accent once, on the filled photo button above, and three teal
              marks in one strip left nothing to say which of them is the
              offer. The hover still lights up, so the affordance is intact. */}
          <Keyboard className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{label ?? t('launcher.sheetTitle')}</span>
        </Link>
        <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
        <Link
          to={buildIntakeHref(describeTo, { speak: true })}
          aria-label={t('launcher.speak')}
          className="flex size-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground active:bg-primary/15 motion-safe:active:scale-95"
        >
          <Mic className="size-5" aria-hidden="true" />
        </Link>
      </div>
      {children}
    </div>
  );
}
