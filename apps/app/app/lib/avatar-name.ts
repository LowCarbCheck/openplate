/**
 * avatar-name.ts, what the header's avatar button says about who is here.
 *
 * The owner, signed in on app.openplate.de, read "Dieses Gerät" on the button
 * and asked why it did not say the name they gave when they signed up
 * (2026-09-30). So the button, and the menu's top label with it, now show the
 * account's display name, and "This device" is what they show when there is
 * no name to show: no session, or an account with an empty name.
 *
 * AN ADDRESS IS CUT TO ITS FIRST PART. Somebody who typed their email into
 * the name field gets "altan", not "altan@example.com". A full address is long
 * in a fixed box, and the account strip at the foot of the same menu already
 * prints it in full.
 *
 * NOTHING WHILE THE SESSION REOPENS. After a reload the header is drawn
 * before `SyncController` has reopened the cached session, and in that window
 * `account` is `null` for a person who IS signed in (`isResuming`, see
 * `SyncSessionSnapshot`). Saying "This device" there and the name a moment
 * later tells a signed-in person they are signed out, once per reload, which
 * is the exact thing that snapshot field exists to prevent. So the button says
 * nothing until the resume has settled, in a box already the size the words
 * will have.
 *
 * Pure, so both rules have a unit test (`tests/unit/avatar-name.test.ts`) and
 * the component only picks the words.
 */

/** What makes a display name read as an email address. */
const EMAIL_AT = '@';

/**
 * The name to show on the avatar button and at the top of its menu.
 *
 * @param displayName - `session.account.displayName`, or `null` without a session.
 * @returns the name, trimmed, and cut before the first `@` when it holds one;
 *   `null` when nothing is left, which the caller draws as "This device".
 */
export function resolveAvatarName(displayName: string | null): string | null {
  if (displayName === null) return null;
  const trimmed = displayName.trim();
  const atIndex = trimmed.indexOf(EMAIL_AT);
  const name = atIndex === -1 ? trimmed : trimmed.slice(0, atIndex).trimEnd();
  return name === '' ? null : name;
}

/** What the avatar button says. */
export type AvatarLabel =
  /** The account's name, as {@link resolveAvatarName} gives it. */
  | { kind: 'name'; name: string }
  /** No session, or an account with no name to show: "This device". */
  | { kind: 'device' }
  /** A session may still be reopening: nothing yet, in the box the words will fill. */
  | { kind: 'pending' };

/** Everything {@link resolveAvatarLabel} reads, all of it from the session snapshot and the instance. */
export interface AvatarLabelInput {
  /** `session.account.displayName`, or `null` without a session. */
  displayName: string | null;
  /** `SyncSessionSnapshot.isResuming`. */
  isResuming: boolean;
  /** Whether this instance has a sync server. Without one there is no session to reopen. */
  hasSyncServer: boolean;
}

/**
 * What the button says for one snapshot, in a fixed order: a known name
 * first, then the reopening window, then the device.
 *
 * @param input - the account's name and the session's state.
 * @returns the label to draw.
 */
export function resolveAvatarLabel({ displayName, isResuming, hasSyncServer }: AvatarLabelInput): AvatarLabel {
  const name = resolveAvatarName(displayName);
  if (name !== null) return { kind: 'name', name };
  // No sync server, no resume: `SyncController` settles the flag at once
  // there, and waiting for it would blank "This device" for a frame.
  if (hasSyncServer && isResuming) return { kind: 'pending' };
  return { kind: 'device' };
}
