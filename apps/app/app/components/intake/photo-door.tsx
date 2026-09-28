/**
 * The large photo button: the camera, named in words, filled in the brand (M259, M260).
 *
 * ONE COMPONENT, TWO DOORS. The add sheet leads with it (`add-launcher.tsx`),
 * and so does every composer strip that owns its own camera: `/diary`,
 * `/dashboard` and `/pantry` (`intake-composer.tsx`). The operator asked for
 * the "same large button" on the strip after 0.48.0 put it in the sheet, so
 * the two draw this one element and cannot drift apart.
 *
 * WHY IT LOOKS LIKE THIS. The operator called the 44 px icon-only camera key
 * "almost hidden". So the door is full width, 64 px tall (taller than anything
 * beside it), filled like the raised plus, square cornered like every control
 * in the app, with the camera glyph AND its name in words.
 *
 * A BUTTON, NEVER A LINK. A navigation cannot open a camera: a browser only
 * honours a programmatic `input.click()` inside the gesture that asked for it.
 * The caller's `onClick` must call the capture hook's `capture()` first, with
 * nothing awaited before it, and the hidden input stays where the caller
 * renders it (`use-camera-capture.ts`). This component owns no camera.
 */
import type { ReactElement, Ref } from 'react';
import { Camera } from 'lucide-react';

interface PhotoDoorProps {
  /** The visible name: "Plate photo" where a meal is logged, "Photo" on the pantry. */
  label: string;
  /** Opens the camera. It must reach `capture()` synchronously, inside the tap. */
  onClick: () => void;
  /** The `data-slot` a check finds this door by, one per surface. */
  dataSlot: string;
  /**
   * The capture hook's `triggerRef`, where focus returns after a dismissed
   * camera. Left out where the hook's ref belongs to another element: the
   * sheet's door leaves it on the raised plus, which outlives the sheet.
   */
  ref?: Ref<HTMLButtonElement>;
}

export function PhotoDoor({ label, onClick, dataSlot, ref }: PhotoDoorProps): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      data-slot={dataSlot}
      className="flex min-h-16 w-full min-w-0 items-center justify-center gap-3 bg-primary text-primary-foreground px-4 text-base font-semibold shadow-sm transition-colors hover:bg-primary/90 active:bg-primary/85 motion-safe:active:scale-[0.99]"
    >
      <Camera className="size-6 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}
