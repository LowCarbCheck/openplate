import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronUp } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#app/components/ui/sheet';
import { cn } from '#app/lib/utils';
import { useCameraCapture, type CameraCapture } from '#app/components/add/use-camera-capture';
import { AddFoodActionsComposer } from '#app/components/add-food-actions-composer';
import { buildAddHref } from '#app/lib/add-food-hrefs';
import { hasMovedBeyondPressTolerance, LONG_PRESS_MS, type PointerPosition } from '#app/lib/long-press';
import { parseDateParam } from '#app/lib/user-days';
import type { NavigationItem } from './app-sidebar';

/**
 * The tab bar's flagship action: **the intent is the tap.**
 *
 * The raised circle used to be a `NavLink` to `/scan`, where the user then
 * chose a scan and then pressed a picker — three taps and two screens before
 * the camera opened. It is a button now, and it opens the camera itself.
 *
 * The gesture itself lives in `useCameraCapture`, which every add-food surface
 * shares; read that module for the browser rule it exists to obey. What stays
 * here is the shape around it: the long press, the sheet, and the geometry.
 *
 * The chevron beside it is the discoverable route to everything else. The
 * long press is a shortcut on top of it, never the only way in.
 *
 * IT CARRIES THE VIEWED DAY. This bar sits under every screen, including
 * `/diary?date=<an earlier day>`. It used to send all three of its doors to
 * today: a photo, a typed meal or a dictated one, logged to the wrong day with
 * nothing on screen saying so. The day is read out of the current URL and
 * threaded through `buildAddHref`, so the launcher logs to the day the person
 * is looking at.
 *
 * THE SHEET RENDERS THE COMPOSER STRIP (M232/03), not a row list of its own.
 * It used to hand-roll three rows with the same three destinations the strip
 * already offers on `/dashboard` and `/diary`, which is two implementations of
 * one door. The strip is given THIS component's capture, so the page still has
 * exactly one hook instance and exactly one hidden input, and that input still
 * sits outside the sheet where closing the sheet cannot unmount it.
 */
export function AddLauncher({ tab }: { tab: NavigationItem }) {
  const { t } = useTranslation();
  const location = useLocation();
  // `null` on today's view and on any screen that carries no day, which is
  // exactly what a bare destination means.
  const viewedDate = parseDateParam(new URLSearchParams(location.search).get('date'));
  const describeTo = buildAddHref('/describe', { date: viewedDate });
  const scanTo = buildAddHref('/scan', { date: viewedDate });
  const launcherCapture = useCameraCapture({ scanTo });
  const { capture, triggerRef, inputRef, inputProps } = launcherCapture;
  const pressStartRef = useRef<PointerPosition | null>(null);
  /**
   * The sheet's own photo key.
   *
   * A SECOND REF, deliberately, not the hook's. Both keys are on the page at
   * once while the sheet is open, and one ref cannot hold two elements: the
   * sheet's key would take it on open and null it on close, leaving the raised
   * circle with nothing to return focus to after a dismissed camera. The hook
   * closes over its own ref, so the focus still comes back to the circle.
   */
  const sheetPhotoRef = useRef<HTMLButtonElement>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when a long press already opened the sheet, so the click that follows it does not also open the camera. */
  const longPressFiredRef = useRef(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const isActive = location.pathname === tab.to || location.pathname.startsWith(tab.to + '/');

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
    pressStartRef.current = null;
  };

  useEffect(() => clearPressTimer, []);

  // The strip's type and speak keys are ordinary links, so nothing closes the
  // sheet behind them the way the old rows' `SheetClose` did. A navigation
  // closes it, whichever door inside it started the navigation.
  useEffect(() => {
    setIsSheetOpen(false);
  }, [location.key]);

  const handleLauncherClick = () => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    capture();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    longPressFiredRef.current = false;
    pressStartRef.current = { x: event.clientX, y: event.clientY };
    pressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      clearPressTimer();
      setIsSheetOpen(true);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pressStartRef.current;
    if (start === null) return;
    if (hasMovedBeyondPressTolerance({ start, current: { x: event.clientX, y: event.clientY } })) clearPressTimer();
  };

  /**
   * The sheet's photo key: the SAME gesture, and then the sheet gets out of
   * the way. `capture()` first and nothing awaited before it, so the camera
   * still opens inside the tap; the close that follows cannot reach the input,
   * which lives outside the sheet.
   */
  const capturePhotoFromSheet = () => {
    capture();
    setIsSheetOpen(false);
  };

  /** This component's capture, wearing the sheet's own trigger and close. The strip renders no input for it. */
  const sheetCapture: CameraCapture = {
    ...launcherCapture,
    capture: capturePhotoFromSheet,
    triggerRef: sheetPhotoRef,
  };

  return (
    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
      <div className="relative flex flex-1 flex-col items-center justify-end">
        {/* The single hidden capture input every photo path goes through, the
            raised circle's own tap and the strip's camera key in the sheet. It
            sits outside the sheet on purpose, so closing the sheet cannot
            unmount the element whose `click()` is still on the gesture stack. */}
        <input ref={inputRef} {...inputProps} />

        <button
          ref={triggerRef}
          type="button"
          aria-current={isActive ? 'page' : undefined}
          onClick={handleLauncherClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={clearPressTimer}
          onPointerCancel={clearPressTimer}
          onPointerLeave={clearPressTimer}
          onContextMenu={(event) => event.preventDefault()}
          // `manipulation` drops the double-tap zoom delay, and the callout
          // suppression stops iOS opening its own "save image" menu on the
          // press this component reads as a long press.
          style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
          className={cn(
            'flex flex-1 flex-col items-center justify-end gap-1 pb-1.5 text-[11px] transition-colors',
            isActive ? 'font-semibold text-primary' : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          <span
            className={cn(
              '-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background',
              'motion-safe:transition-all motion-safe:duration-200',
              isActive ? 'shadow-lg shadow-primary/40 motion-safe:scale-105' : 'shadow-md shadow-primary/20',
            )}
          >
            <tab.icon className="h-6 w-6" aria-hidden="true" />
          </span>
          <span>{t(tab.labelKey)}</span>
        </button>

        {/* The discoverable way to everything else. Visible, 32px of hit area,
            and labelled — the long press above is a shortcut for people who
            already expect one, never the only door. */}
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={t('launcher.moreOptions')}
            aria-haspopup="dialog"
            aria-expanded={isSheetOpen}
            className="absolute right-0 bottom-6 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </SheetTrigger>
      </div>

      <SheetContent
        side="bottom"
        // Reduced motion keeps the sheet, drops the slide — the position is
        // the information, the travel is decoration.
        className="motion-reduce:transition-none motion-reduce:animate-none rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader>
          <SheetTitle>{t('launcher.sheetTitle')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          {/* THE SAME STRIP `/dashboard` AND `/diary` DRAW, given this
              component's camera. Its three keys are the three doors the sheet
              used to hand-roll: type, dictate, photograph. All three carry the
              viewed day, and none of them points at `/add`, the database
              search, which answers "which food is this" for one item rather
              than taking a written meal.

              `label` is "Type" here, not the strip's own invitation: the
              heading above already says "Add food", and the same words twice,
              stacked, read as a mistake. */}
          <AddFoodActionsComposer describeTo={describeTo} capture={sheetCapture} label={t('launcher.type')} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
