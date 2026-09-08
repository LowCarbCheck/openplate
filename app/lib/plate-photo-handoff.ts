/**
 * The one-shot slot that carries the confirmed plate's photograph from the
 * review screen into `/scan`'s confirm action.
 *
 * WHY A SLOT AT ALL. The picture is an in-memory `File` held by the review
 * component; the confirm posts a form, and a `File` that never went through an
 * `<input type="file">` cannot ride one. The action needs it because the photo
 * belongs to the same write as the diary rows: one confirm caches one photo,
 * under the batch id those rows carry.
 *
 * WHY NOT NAVIGATION STATE. It used to be saved from a `useNavigation()`
 * effect that armed on a `submitting` render and fired on the `loading` render
 * that followed. That render never happens. The confirm action is local
 * IndexedDB work that resolves inside one React batch, so the component never
 * observes a `submitting` state, and no plate photo was ever cached (found in
 * a browser walk on 2026-09-08). Saving on the same signal that writes the
 * rows removes the dependency on a render sequence entirely.
 *
 * KEYED BY THE BATCH ID, so a take can only ever return the picture that
 * belongs to the confirm asking for it. A stale offer from an earlier draft is
 * refused rather than saved under a batch it does not show.
 *
 * EXACTLY ONCE is the contract, as in `scan-handoff.ts`: `takePlatePhoto`
 * clears the slot as it reads. A confirm that fails validation never reaches
 * the write and so never takes; the next offer replaces what it left behind.
 *
 * A module variable rather than storage: a `File` is not serialisable, the
 * offer and the take happen inside one client navigation, and a photograph is
 * exactly the thing this app does not put anywhere it was not asked to.
 */

/** A photograph parked for a confirm, with the owner its cached row is keyed to. */
export interface OfferedPlatePhoto {
  /**
   * The owner id the review screen was handed (`clientLoader`'s `userId`).
   * It travels with the file so the action never has to name an owner of its
   * own; the photo cache keys every row by owner, and the reader
   * (`usePlatePhoto`) uses the same value.
   */
  userId: number;
  /** The already-downscaled JPEG, exactly as it was sent to the provider. */
  file: File;
}

/** Everything a confirm needs to cache one plate's photograph. */
export interface PlatePhotoOffer extends OfferedPlatePhoto {
  /** The client-minted batch id the confirm form posts, and the diary rows carry. */
  logBatchId: string;
}

let pending: PlatePhotoOffer | null = null;

/**
 * Parks the confirmed plate's photograph for the confirm action to take.
 *
 * A second offer REPLACES the first: the review screen mints one batch id per
 * draft, so the newest offer is the draft the person is looking at.
 */
export function offerPlatePhoto(offer: PlatePhotoOffer): void {
  pending = { logBatchId: offer.logBatchId, userId: offer.userId, file: offer.file };
}

/**
 * Takes the photograph parked for this batch and empties the slot.
 *
 * `null` when nothing is parked, when the parked photograph belongs to another
 * batch, or when it was already taken. A typed or spoken intake has no
 * photograph at all, so its confirm simply finds the slot empty and saves
 * nothing.
 */
export function takePlatePhoto(logBatchId: string): OfferedPlatePhoto | null {
  if (pending === null || pending.logBatchId !== logBatchId) return null;
  const held = pending;
  pending = null;
  return { userId: held.userId, file: held.file };
}

/**
 * Empties the slot if it still holds this batch's photograph.
 *
 * Batch-checked on purpose: the review screen drops on unmount and on a change
 * of file or batch id, and an unguarded drop would let that cleanup throw away
 * a newer offer that had already replaced it.
 */
export function dropPlatePhoto(logBatchId: string): void {
  if (pending !== null && pending.logBatchId === logBatchId) pending = null;
}
