/**
 * What the sign-out dialog says about the outbox before anybody agrees to an
 * erase (M201 spec 02).
 *
 * The outbox (`local-store/store.ts`, `OUTBOX_TABLE`) holds writes this device
 * has made and not yet handed on. They are the entries an erase actually
 * destroys, as opposed to the ones a sign-in downloads back, so the number is
 * the single fact that makes the choice informed rather than brave.
 *
 * Pure and separate from the dialog for one reason: EMPTY IS A SENTENCE, NOT A
 * ZERO. "0 entries will be lost" is the same class of copy as an empty state
 * that renders a bare `0`, and it reads as a warning when it is in fact the
 * all-clear. So the three states are named here and the component renders one
 * string per state, rather than interpolating a count that is sometimes not a
 * count.
 */

/** The three things the dialog can honestly say about the outbox. */
export type EraseOutboxNotice =
  /** The count is still being read from the device. */
  | { kind: 'counting' }
  /** Nothing is waiting, and the dialog says so in words. */
  | { kind: 'empty' }
  /** This many entries have not left the device, and an erase loses them. */
  | { kind: 'waiting'; count: number };

/**
 * @param count - rows in `OUTBOX_TABLE`, or `null` while the read is in flight.
 */
export function resolveEraseOutboxNotice(count: number | null): EraseOutboxNotice {
  if (count === null) return { kind: 'counting' };
  if (count <= 0) return { kind: 'empty' };
  return { kind: 'waiting', count };
}
