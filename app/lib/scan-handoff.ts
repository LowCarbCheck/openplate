/**
 * The one-shot slot that carries a photo from the tab bar's launcher to
 * `/scan`.
 *
 * The launcher opens the camera INSIDE the tap that started it (see
 * `add-launcher.tsx`): a phone only honours a programmatic `input.click()`
 * while the user gesture is still on the stack, so there is no room to
 * navigate first and pick the photo on the other side. The photo therefore
 * exists before the route that consumes it does, and something has to hold it
 * across the navigation.
 *
 * A module variable, not `sessionStorage`: a `File` is not serialisable, and
 * `structuredClone` into IndexedDB would mean an async write inside the same
 * gesture. A client navigation never reloads the document, so the module
 * instance the launcher wrote to is the same one `/scan` reads from.
 *
 * EXACTLY ONCE is the contract. `takePickedFile` clears the slot as it reads,
 * so a remount, a `StrictMode` double-effect, or a later visit to `/scan` can
 * never re-analyse (and re-charge for) a photo that was already handed over.
 */
import type { VisionMode } from '#app/services/vision';

/** A photo captured outside `/scan`, with the scan it was captured for. */
export interface ScanHandoff {
  file: File;
  mode: VisionMode;
}

let pending: ScanHandoff | null = null;

/**
 * Parks a freshly captured photo for `/scan` to pick up.
 *
 * A second offer before the first is taken REPLACES it — the newer capture is
 * the one the user just made, and holding a queue would mean a stale photo
 * surfacing on some later visit.
 */
export function offerPickedFile(file: File, mode: VisionMode): void {
  pending = { file, mode };
}

/** Takes the parked photo and empties the slot, or `null` when nothing is parked. */
export function takePickedFile(): ScanHandoff | null {
  const held = pending;
  pending = null;
  return held;
}
