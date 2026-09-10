/**
 * The camera capture gesture, in one place.
 *
 * Every surface that offers "photograph your food" goes through this hook: the
 * tab bar's raised launcher, and the in-page add-food actions on `/diary` and
 * `/dashboard`. It was extracted from `add-launcher.tsx` so those surfaces
 * cannot drift apart on the one rule that makes the feature work at all.
 *
 * THE RULE. A browser only honours a programmatic `input.click()` while the
 * user gesture that caused it is still on the stack. An `await` anywhere
 * before it, a settings read, a navigation, a downscale, ends the gesture, and
 * the camera silently never opens. So `capture` is not `async` and awaits
 * nothing: the connection state is read ONCE on mount and kept in state, and
 * the photo is handed to the scan screen afterwards through a one-shot module
 * slot (`scan-handoff.ts`) rather than fetched by the route.
 *
 * `scanTo` is the scan screen this hook navigates to, and it carries the day
 * the user is looking at. A photo taken on a back-dated diary page must log to
 * THAT day, not to today. It is read at render, so the gesture still awaits
 * nothing.
 *
 * The caller renders the input itself, with `inputRef` and `inputProps`. Put
 * it OUTSIDE any sheet, dialog or conditional: closing a sheet must not
 * unmount the element whose `click()` is still on the gesture stack.
 */
import { useEffect, useRef, type ChangeEvent, type ComponentProps, type RefObject } from 'react';
import { offerPickedFile } from '#app/lib/scan-handoff';
import { useAiConnection } from '#app/components/add/use-ai-connection';
import { useAppNavigate } from '#app/hooks/use-app-navigate';

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

export function useCameraCapture({ scanTo = '/scan' }: { scanTo?: string } = {}): CameraCapture {
  const navigate = useAppNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Shared with `/add`'s "Log with AI" action, so the two surfaces can never
  // disagree about whether this device can analyse anything (`useAiConnection`).
  const aiConnection = useAiConnection();

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
    if (aiConnection !== 'connected') {
      // No provider (or not known yet): never a camera permission prompt for a
      // feature that cannot work. The scan screen shows the connect card.
      void navigate(scanTo, { viewTransition: true });
      return;
    }
    inputRef.current?.click();
  };

  const handleCapturedFile = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    // Reset the trigger so re-taking the same photo fires `change` again.
    event.target.value = '';
    if (picked === null) return;
    offerPickedFile(picked);
    void navigate(scanTo, { viewTransition: true });
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
