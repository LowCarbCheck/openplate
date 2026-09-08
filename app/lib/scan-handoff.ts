/**
 * The one-shot slot that carries an intake from wherever it was started to
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
 * TYPED AND SPOKEN INTAKE RIDES THE SAME SLOT. `/add` hands over a sentence
 * instead of a picture, and `/scan` runs the text task with it. The words do
 * not need a slot for the gesture reason above, they need it for the SAME
 * reason: the review screen, the confirm action and every stored row are the
 * photo path's, and reaching them means arriving on `/scan` with the intake
 * already in hand rather than re-typing it into a query string a browser
 * history would then keep.
 *
 * EXACTLY ONCE is the contract. `takeIntakeHandoff` clears the slot as it
 * reads, so a remount, a `StrictMode` double-effect, or a later visit to
 * `/scan` can never re-analyse (and re-charge for) an intake that was already
 * handed over.
 */
import type { TypedIntakeSource } from '#app/lib/intake-source';

/**
 * A photo captured outside `/scan`.
 *
 * No mode rides with it any more: there is one photo task, and what the
 * picture shows is the model's problem rather than something the person had to
 * declare before the shutter (amends ADR-0005, 2026-09-08).
 */
export interface PhotoHandoff {
  kind: 'photo';
  file: File;
}

/** Words captured outside `/scan`, with how the person produced them. */
export interface TextHandoff {
  kind: 'text';
  /** Exactly what was typed or dictated. Trimmed by the offering surface, never rewritten here. */
  text: string;
  source: TypedIntakeSource;
}

export type ScanHandoff = PhotoHandoff | TextHandoff;

let pending: ScanHandoff | null = null;

/**
 * Parks a freshly captured photo for `/scan` to pick up.
 *
 * A second offer before the first is taken REPLACES it — the newer capture is
 * the one the user just made, and holding a queue would mean a stale intake
 * surfacing on some later visit. The same rule holds across kinds: a photo
 * offered after a sentence replaces the sentence.
 */
export function offerPickedFile(file: File): void {
  pending = { kind: 'photo', file };
}

/** Parks what a person typed or spoke, for `/scan` to run the text task with. */
export function offerTypedText(text: string, source: TypedIntakeSource): void {
  pending = { kind: 'text', text, source };
}

/** Takes the parked intake and empties the slot, or `null` when nothing is parked. */
export function takeIntakeHandoff(): ScanHandoff | null {
  const held = pending;
  pending = null;
  return held;
}
