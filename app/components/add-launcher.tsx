import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronUp, Keyboard, Mic, ScanBarcode, Camera } from 'lucide-react';
import { Link } from '#app/components/link';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#app/components/ui/sheet';
import { cn } from '#app/lib/utils';
import { getLocalAiSettings } from '#app/lib/local-store';
import { offerPickedFile } from '#app/lib/scan-handoff';
import { hasMovedBeyondPressTolerance, LONG_PRESS_MS, type PointerPosition } from '#app/lib/long-press';
import type { VisionMode } from '#app/services/vision';
import type { NavigationItem } from './app-sidebar';

/**
 * Whether the device already has an AI provider connected.
 *
 * `unknown` is its own member and is NOT treated as "connected": the read is
 * an IndexedDB round trip that only starts after hydration, and opening the
 * camera on a device that cannot analyse the photo would ask for a permission
 * the feature can never use. Until the answer is in, the launcher behaves
 * exactly as it does for an unconnected device — it goes to `/scan`, which is
 * where the connect card lives.
 */
type AiConnection = 'unknown' | 'connected' | 'absent';

/** One sheet row: full width, 44px of hit area, no decoration competing with the label. */
const LAUNCHER_ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-base font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden';

/**
 * The tab bar's flagship action: **the intent is the tap.**
 *
 * The raised circle used to be a `NavLink` to `/scan`, where the user then
 * chose a scan and then pressed a picker — three taps and two screens before
 * the camera opened. It is a button now, and it opens the camera itself.
 *
 * Everything about the shape of this component follows from one browser rule:
 * a programmatic `input.click()` is only honoured while the user gesture that
 * caused it is still on the stack. So the tap handler calls `click()`
 * synchronously — no `await`, no navigation first, no settings read on the
 * way. The connection state is therefore read ONCE on mount and kept in
 * state, and the photo is handed to `/scan` afterwards through a one-shot
 * module slot (`scan-handoff.ts`) rather than fetched by the route.
 *
 * The chevron beside it is the discoverable route to everything else. The
 * long press is a shortcut on top of it, never the only way in.
 */
export function AddLauncher({ tab }: { tab: NavigationItem }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The scan the pending capture was started for — a ref, so the tap handler needs no re-render. */
  const modeRef = useRef<VisionMode>('plate');
  const pressStartRef = useRef<PointerPosition | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when a long press already opened the sheet, so the click that follows it does not also open the camera. */
  const longPressFiredRef = useRef(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [aiConnection, setAiConnection] = useState<AiConnection>('unknown');

  const isActive = location.pathname === tab.to || location.pathname.startsWith(tab.to + '/');

  // Read the device's AI connection once, after hydration. The result gates
  // whether a tap may open the camera at all (see `AiConnection`).
  useEffect(() => {
    let isMounted = true;
    void (async () => {
      const settings = await getLocalAiSettings();
      if (isMounted) setAiConnection(settings === null ? 'absent' : 'connected');
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // A dismissed camera fires `cancel`, not `change`. Nothing visible should
  // happen — the user changed their mind — but the focus that went to the
  // file dialog has to come back to the control that opened it.
  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    const handleCancel = () => buttonRef.current?.focus();
    input.addEventListener('cancel', handleCancel);
    return () => input.removeEventListener('cancel', handleCancel);
  }, []);

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
    pressStartRef.current = null;
  };

  useEffect(() => clearPressTimer, []);

  /**
   * THE GESTURE. `click()` is called with nothing awaited before it — see the
   * component comment, and `tests/unit/add-launcher-gesture.test.ts`, which
   * pins exactly that.
   */
  const captureWith = (mode: VisionMode) => {
    if (aiConnection !== 'connected') {
      // No provider (or not known yet): never a camera permission prompt for a
      // feature that cannot work. `/scan` shows the connect card.
      void navigate('/scan', { viewTransition: true });
      return;
    }
    modeRef.current = mode;
    inputRef.current?.click();
  };

  const handleCapturedFile = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    // Reset the trigger so re-taking the same photo fires `change` again.
    event.target.value = '';
    if (picked === null) return;
    offerPickedFile(picked, modeRef.current);
    void navigate('/scan', { viewTransition: true });
  };

  const handleLauncherClick = () => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    captureWith('plate');
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

  const openSheetItem = (mode: VisionMode) => {
    captureWith(mode);
    setIsSheetOpen(false);
  };

  return (
    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
      <div className="relative flex flex-1 flex-col items-center justify-end">
        {/* The single hidden capture input every photo path goes through — the
            launcher's own tap and both photo rows in the sheet. It sits
            outside the sheet on purpose, so closing the sheet cannot unmount
            the element whose `click()` is still on the gesture stack. */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleCapturedFile}
        />

        <button
          ref={buttonRef}
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
        <div className="flex flex-col gap-1 px-4 pb-4">
          <button type="button" onClick={() => openSheetItem('plate')} className={LAUNCHER_ITEM_CLASS}>
            <Camera className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t('launcher.platePhoto')}
          </button>
          <button type="button" onClick={() => openSheetItem('label')} className={LAUNCHER_ITEM_CLASS}>
            <ScanBarcode className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t('launcher.labelPhoto')}
          </button>
          {/* Navigations stay links: `SheetClose` closes the sheet, the link
              does the travelling. `?speak=1` is what arms `/add`'s microphone. */}
          <SheetClose asChild>
            <Link to="/add?speak=1" className={LAUNCHER_ITEM_CLASS}>
              <Mic className="h-5 w-5 shrink-0" aria-hidden="true" />
              {t('launcher.speak')}
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link to="/add" className={LAUNCHER_ITEM_CLASS}>
              <Keyboard className="h-5 w-5 shrink-0" aria-hidden="true" />
              {t('launcher.type')}
            </Link>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
