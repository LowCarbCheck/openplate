/**
 * The camera capture gesture, in one place.
 *
 * Every surface that offers "photograph your food" goes through this hook: the
 * tab bar's add sheet, and the in-page add-food actions on `/diary` and
 * `/dashboard`. It was extracted from `add-launcher.tsx` so those surfaces
 * cannot drift apart on the one rule that makes the feature work at all.
 *
 * THE RULE. A browser only honours a programmatic `input.click()` while the
 * user gesture that caused it is still on the stack. An `await` anywhere
 * before it, a settings read, a navigation, a downscale, ends the gesture, and
 * the camera silently never opens. So `capture` is not `async` and awaits
 * nothing: the connection state is read ONCE on mount and kept in state, and
 * the photo is handed to the scan screen afterwards through a one-shot module
 * slot (`intake-handoff.ts`) rather than fetched by the route.
 *
 * `scanTo` is the scan screen this hook navigates to, and it carries the day
 * the user is looking at. A photo taken on a back-dated diary page must log to
 * THAT day, not to today. It is read at render, so the gesture still awaits
 * nothing.
 *
 * `unknown` IS NOT `absent`. After a reload the connection reads `unknown`
 * until the session has resumed, and a tap in that window must still open the
 * camera (`camera-capture-decision.ts` holds the rules). The PICKED photo then
 * waits, in state and not in the gesture, for the connection to resolve:
 * connected hands it over as usual, absent (or `CONNECTION_WAIT_MS` without an
 * answer) goes to `scanTo` WITHOUT parking it, so nothing is sent and no photo
 * is left in the one-shot slot for a later visit to send.
 *
 * The caller renders the input itself, with `inputRef` and `inputProps`. Put
 * it OUTSIDE any sheet, dialog or conditional: closing a sheet must not
 * unmount the element whose `click()` is still on the gesture stack.
 */
import { useEffect, useRef, useState, type ChangeEvent, type ComponentProps, type RefObject } from 'react';
import { offerPickedFile } from '#app/lib/intake-handoff';
import { CONNECTION_WAIT_MS, decidePick, decideTap } from '#app/lib/camera-capture-decision';
import { useAiConnection } from '#app/components/add/use-ai-connection';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { ADD_PHOTO_PATH } from '#app/lib/intake-hrefs';

export type CameraCapture = {
  /** Open the camera, synchronously, inside the tap that asked for it. */
  capture: () => void;
  /** The control that opens the camera. A dismissed camera returns focus here. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** The hidden capture input every photo path goes through. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Spread onto that input. Render it outside any sheet or conditional. */
  inputProps: ComponentProps<'input'>;
};

/** A photo picked while the connection was still unknown. */
interface WaitingPick {
  file: File;
  hasTimedOut: boolean;
}

export function useCameraCapture({ scanTo = ADD_PHOTO_PATH }: { scanTo?: string } = {}): CameraCapture {
  const navigate = useAppNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Shared with `/add/search`'s "Log with AI" action, so the two surfaces can
  // never disagree about whether this device can analyse anything
  // (`useAiConnection`).
  const aiConnection = useAiConnection();
  const [waitingPick, setWaitingPick] = useState<WaitingPick | null>(null);
  const waitingFile = waitingPick?.file ?? null;

  const goToScan = () => {
    void navigate(scanTo, { viewTransition: true });
  };

  // The bound on the wait. Keyed on the file alone, so a re-render or the
  // connection changing between two unknown answers never restarts it.
  useEffect(() => {
    if (waitingFile === null) return;
    const timer = setTimeout(() => {
      setWaitingPick((current) => (current === null ? null : { ...current, hasTimedOut: true }));
    }, CONNECTION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waitingFile]);

  // The wait's end: act on the answer once there is one. Leaving the screen
  // unmounts this hook and drops the wait with it.
  useEffect(() => {
    if (waitingPick === null) return;
    const decision = decidePick({ connection: aiConnection, hasTimedOut: waitingPick.hasTimedOut });
    if (decision === 'wait') return;
    setWaitingPick(null);
    if (decision === 'hand-over') offerPickedFile(waitingPick.file);
    void navigate(scanTo, { viewTransition: true });
  }, [waitingPick, aiConnection, navigate, scanTo]);

  // A dismissed camera fires `cancel`, not `change`. Nothing visible should
  // happen, the user changed their mind, but the focus that went to the file
  // dialog has to come back to the control that opened it.
  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    const handleCancel = () => triggerRef.current?.focus();
    input.addEventListener('cancel', handleCancel);
    return () => input.removeEventListener('cancel', handleCancel);
  }, []);

  /**
   * THE GESTURE. `click()` is called with nothing awaited before it. See the
   * module comment, and `tests/unit/add-launcher-gesture.test.ts`, which pins
   * exactly that.
   */
  const capture = () => {
    if (decideTap(aiConnection) === 'go-to-scan') {
      // No provider, definitely: never a camera permission prompt for a
      // feature that cannot work. The scan screen shows the connect card.
      goToScan();
      return;
    }
    inputRef.current?.click();
  };

  const handleCapturedFile = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    // Reset the trigger so re-taking the same photo fires `change` again.
    event.target.value = '';
    if (picked === null) return;
    const decision = decidePick({ connection: aiConnection, hasTimedOut: false });
    if (decision === 'wait') {
      setWaitingPick({ file: picked, hasTimedOut: false });
      return;
    }
    if (decision === 'hand-over') offerPickedFile(picked);
    goToScan();
  };

  return {
    capture,
    triggerRef,
    inputRef,
    inputProps: {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      className: 'sr-only',
      tabIndex: -1,
      'aria-hidden': true,
      onChange: handleCapturedFile,
    },
  };
}
