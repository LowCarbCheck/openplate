import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import { Link } from '#app/components/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#app/components/ui/sheet';
import { cn } from '#app/lib/utils';
import { useCameraCapture } from '#app/components/intake/use-camera-capture';
import { IntakeComposer } from '#app/components/intake/intake-composer';
import { PhotoDoor } from '#app/components/intake/photo-door';
import { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH, ADD_SEARCH_PATH, buildIntakeHref } from '#app/lib/intake-hrefs';
import { parseDateParam } from '#app/lib/user-days';

/** The intake hub every add screen nests under (ADR-0019). The plus is lit on all of them. */
const ADD_HUB_PATH = '/add';

/**
 * The tab bar's raised plus, and the add sheet it opens (M258).
 *
 * A TAP OPENS THE SHEET. Until 0.46.0 this circle was a camera: a tap opened
 * the camera inside its own gesture, and the sheet sat behind a long press,
 * which is a gesture nobody finds. The operator's three-slot bar makes the
 * circle a plus and the sheet its tap, so the add sheet is where every way to
 * log a food starts on a phone. The camera is the sheet's first door, still
 * opened inside the tap on that door.
 *
 * A LONG PRESS DOES NOTHING EXTRA NOW. It was the only way into the sheet, and
 * the tap is that way now, so the press timer, the drift tolerance and
 * `app/lib/long-press.ts` went with it. A held press is an ordinary tap when
 * it lifts. The iOS callout suppression stays, so a held press still does not
 * open the system's "save image" menu over the circle.
 *
 * THE CAMERA IS STILL THIS COMPONENT'S. The gesture lives in
 * `useCameraCapture`, which every add-food surface shares; read that module
 * for the browser rule it exists to obey. This component calls it once, so the
 * page has exactly one capture hook and one hidden input for the bar, and that
 * input sits OUTSIDE the sheet: closing the sheet must not unmount the element
 * whose `click()` is still on the gesture stack.
 *
 * IT CARRIES THE VIEWED DAY. This bar sits under every screen, including
 * `/diary?date=<an earlier day>`. It used to send all three of its doors to
 * today: a photo, a typed meal or a dictated one, logged to the wrong day with
 * nothing on screen saying so. The day is read out of the current URL and
 * threaded through `buildIntakeHref`, so the sheet logs to the day the person
 * is looking at.
 *
 * THE SHEET OPENS WITH THE CAMERA (M259). After a day with 0.47.0 the
 * operator wrote: "clicking on add I think is better but the photo option
 * needs to be much more prominent and the first thing you want to click on.
 * it's currently almost hidden." It was a 44 px outlined key at the right end
 * of the composer strip, on the sheet's third row. It is now the first door, a
 * full-width button filled in the brand, taller than anything else in the
 * sheet, with a camera glyph and its name in words. There is ONE camera in the
 * sheet: the strip under it no longer draws its key.
 *
 * THEN THE FOOD SEARCH, a row drawn like the search field it leads to, going
 * to `/add/search`, the database search. It was the bar's Add tab until M258
 * took that tab away; without it a search was three taps (plus, type, the
 * switcher).
 *
 * THEN THE STRIP (M232/03), the same one `/dashboard` and `/diary` draw, in
 * its words-only form: type and speak.
 */
export function AddLauncher() {
  const { t } = useTranslation();
  const location = useLocation();
  // `null` on today's view and on any screen that carries no day, which is
  // exactly what a bare destination means.
  const viewedDate = parseDateParam(new URLSearchParams(location.search).get('date'));
  const describeTo = buildIntakeHref(ADD_DESCRIBE_PATH, { date: viewedDate });
  const searchTo = buildIntakeHref(ADD_SEARCH_PATH, { date: viewedDate });
  const scanTo = buildIntakeHref(ADD_PHOTO_PATH, { date: viewedDate });
  const { capture, triggerRef, inputRef, inputProps } = useCameraCapture({ scanTo });
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const isOnAddHub = location.pathname === ADD_HUB_PATH || location.pathname.startsWith(`${ADD_HUB_PATH}/`);

  // The search door and the strip's type and speak keys are ordinary links, so
  // nothing closes the sheet behind them. A navigation closes it, whichever
  // door inside it started the navigation.
  useEffect(() => {
    setIsSheetOpen(false);
  }, [location.key]);

  /**
   * The sheet's photo door: the camera, and then the sheet gets out of the way.
   * `capture()` first and nothing awaited before it, so the camera still opens
   * inside the tap; the close that follows cannot reach the input, which lives
   * outside the sheet.
   */
  const capturePhotoFromSheet = () => {
    capture();
    setIsSheetOpen(false);
  };

  return (
    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
      <div className="relative flex min-w-0 flex-1 flex-col items-center justify-end">
        {/* The single hidden capture input the bar's photo path goes through,
            the sheet's photo door. It sits outside the sheet on purpose, so
            closing the sheet cannot unmount the element whose `click()` is
            still on the gesture stack. */}
        <input ref={inputRef} {...inputProps} />

        {/* RADIX'S OWN TRIGGER, so the plus announces the sheet
            (`aria-haspopup`, `aria-expanded`) and takes the focus back when
            it closes. Its name is its visible label, "Add". The hook's ref
            rides on it too: `Slot` composes the two. */}
        <SheetTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            data-slot="bottom-nav-add"
            data-active={isOnAddHub ? 'true' : undefined}
            onContextMenu={(event) => event.preventDefault()}
            // `manipulation` drops the double-tap zoom delay, and the callout
            // suppression stops iOS opening its own "save image" menu on a
            // held press.
            style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
            className={cn(
              'flex flex-1 flex-col items-center justify-end gap-1 pb-1.5 text-[11px] transition-colors',
              isOnAddHub ? 'font-semibold text-primary' : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {/* THE GEOMETRY STAYS, THE GLOW GOES (M243/03). The circle used to sit
                in a teal halo, a large one when active and a medium one at rest,
                both drawn in the brand colour at a fifth and at two fifths alpha,
                which was the one piece of chrome in the app that painted light in
                the brand colour. Do not name those classes here: the milestone
                verifies their absence with a grep over this file. Nothing
                else in this app, and nothing in lowcarbcheck, rests heavier than
                `shadow-sm`. The active state keeps its lift through the scale, not
                through a bigger halo. The size, the offset and the ring are
                untouched on purpose, and M258 changed only the glyph inside:
                three clearances are measured off this box (`bottom-nav.tsx`'s
                `h-14`, `app-wrapper`'s `6rem` of bottom page padding and
                `/add/photo`'s sticky action bar), and `lcc-lineage-shell.spec.ts`
                freezes all four of its rect values. */}
            <span
              className={cn(
                '-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-4 ring-background',
                'motion-safe:transition-all motion-safe:duration-200',
                isOnAddHub && 'motion-safe:scale-105',
              )}
            >
              <Plus className="h-6 w-6" aria-hidden="true" />
            </span>
            <span>{t('nav.add')}</span>
          </button>
        </SheetTrigger>
      </div>

      <SheetContent
        side="bottom"
        // Reduced motion keeps the sheet, drops the slide: the position is
        // the information, the travel is decoration.
        className="motion-reduce:transition-none motion-reduce:animate-none pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader>
          <SheetTitle>{t('launcher.sheetTitle')}</SheetTitle>
        </SheetHeader>
        <div className="grid gap-3 px-4 pb-4">
          {/* THE PHOTO, FIRST (M259), and the one camera in this sheet. A
              button, not a link: a navigation cannot open a camera, so the tap
              does the work itself (`capturePhotoFromSheet`). Full width, filled
              in the brand like the raised plus below the panel, square cornered
              like every control in the app, and 64 px tall, 20 more than any
              other door here, so rank comes from size as well as from colour.
              The glyph and the name in words, because a camera glyph alone was
              what the operator could not find. It is also the first control in
              the sheet, so it takes the focus when the sheet opens.

              `PhotoDoor` since M260: the composer strip on `/diary`,
              `/dashboard` and `/pantry` leads with the same element, so the
              two doors cannot drift. No ref here: the hook's ref stays on the
              plus, which outlives the sheet.

              AT THE TOP ON PURPOSE, the opposite of the More sheet, which puts
              its most used tile nearest the thumb. Here the size and the fill
              carry the door, so do not move it down to match. */}
          <PhotoDoor onClick={capturePhotoFromSheet} dataSlot="add-sheet-photo" label={t('launcher.platePhoto')} />
          {/* THE FOOD SEARCH. A link drawn as the search field it opens
              (`/add/search`'s own `#food-search`: the input's border, height
              and muted placeholder ink, a search glyph on the left), so it
              reads as "type a food name here" and not as one more button.
              Square corners like every field in the app, 44 px tall. It
              carries the viewed day through `buildIntakeHref`, as the other
              doors do. */}
          <Link
            to={searchTo}
            data-slot="add-sheet-search"
            className="flex h-11 w-full min-w-0 items-center gap-2.5 border border-input bg-transparent px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-muted dark:bg-input/30"
          >
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('launcher.searchFoods')}</span>
          </Link>
          {/* THE SAME STRIP `/dashboard` AND `/diary` DRAW, words only: type
              and dictate, both carrying the viewed day. None of them points at
              `/add/search`: the search door above does, and the strip's "Type"
              opens the composer, which takes a written meal rather than one
              food's name.

              `label` is "Type" here, not the strip's own invitation: the
              heading above already says "Add food", and the same words twice,
              stacked, read as a mistake.

              `variant="wordsOnly"` ONLY here (M259): the photo door above is
              this sheet's camera, so the strip draws no camera key and opens no
              camera of its own. Until M259 it drew an outlined key, driven by
              this component's capture; that key was the camera the operator
              called "almost hidden". `/dashboard`, `/diary` and `/pantry` pass
              no variant, and since M260 their strip leads with the same large
              `PhotoDoor` this sheet does. */}
          <IntakeComposer describeTo={describeTo} label={t('launcher.type')} variant="wordsOnly" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
