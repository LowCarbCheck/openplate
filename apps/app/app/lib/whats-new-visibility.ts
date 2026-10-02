/**
 * Whether the "What's new" card and its row in About are shown on this device.
 *
 * THE DEFAULT DEPENDS ON WHO IS ASKING. A regular person gets no card unless
 * they switch it on in Preferences, because a note about the release is the
 * operator's news and not theirs. An administrator gets it without asking,
 * because they run the instance and want to know what just landed.
 *
 * THREE STORED STATES, NOT TWO. `unset` is a real answer, and it is the only
 * one that lets the role decide. Writing the switch stores an explicit `on` or
 * `off`, which then wins over the role in both directions: an administrator can
 * turn it off, a member can turn it on.
 *
 * WHY `localStorage`, AND WHY NOT THE PROFILE ROW. The same call
 * `#app/lib/analytics-opt-out` makes: it is a preference about this device's
 * screen, not data about the person, and it must be readable signed out. The
 * acknowledgement it sits next to (`#app/lib/whats-new`) is device-scoped too.
 *
 * THE ROLE IS NEVER GUESSED. `null` means "not read yet" or "nobody is signed
 * in", and both read as not visible. `sync-session.ts` explains the 0.10.1 walk
 * defect that came from turning "not known yet" into a role.
 *
 * This module imports no JSON and no React, so the browser tier can import
 * {@link WHATS_NEW_VISIBLE_KEY} from it rather than transcribe it, the reason
 * `#app/lib/whats-new` gives for the same thing.
 */

/** Where the choice lives. Versioned, so a future retune can start clean. */
export const WHATS_NEW_VISIBLE_KEY = 'openplate:whats-new-visible:v1';

/** Dispatched on `window` when the choice changes during a visit, since `storage` fires only in OTHER tabs. */
export const WHATS_NEW_VISIBLE_EVENT = 'openplate:whats-new-visible';

/** What is stored: nothing, an explicit yes, or an explicit no. */
export type WhatsNewPreference = 'unset' | 'on' | 'off';

/** The account roles the session knows, or `null` for unread and for signed out. */
export type WhatsNewRole = 'admin' | 'member' | null | undefined;

/**
 * Reads a raw stored value as a preference. Anything that is not exactly `on`
 * or `off` is `unset`, so a junk value can never hide the card from, or show it
 * to, anybody by accident.
 *
 * @param raw - what `localStorage.getItem` returned.
 * @returns the preference.
 */
export function parseWhatsNewPreference(raw: string | null): WhatsNewPreference {
  if (raw === 'on' || raw === 'off') return raw;
  return 'unset';
}

/**
 * The preference stored on this device. Outside a browser, and with storage
 * blocked, it is `unset`: nothing was ever chosen here.
 *
 * Safe as a `useSyncExternalStore` snapshot: it returns one of three strings,
 * so two reads of the same storage compare equal.
 *
 * @returns the stored preference.
 */
export function readWhatsNewPreference(): WhatsNewPreference {
  try {
    return parseWhatsNewPreference(globalThis.localStorage?.getItem(WHATS_NEW_VISIBLE_KEY) ?? null);
  } catch {
    return 'unset';
  }
}

/**
 * Whether the card and the row are shown.
 *
 * A stored choice wins. With none, only an administrator sees them. A member,
 * an unread role and a signed-out device do not.
 *
 * @param stored - the stored preference.
 * @param role - the signed-in account's role, `null` when unread or signed out.
 * @returns `true` when the surfaces should render.
 */
export function resolveWhatsNewVisible(stored: WhatsNewPreference, role: WhatsNewRole): boolean {
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return role === 'admin';
}

/**
 * Saves the person's choice and tells everything on this page about it.
 *
 * @param isVisible - `true` to show the card and the row, `false` to hide them.
 */
export function setWhatsNewVisible(isVisible: boolean): void {
  try {
    globalThis.localStorage?.setItem(WHATS_NEW_VISIBLE_KEY, isVisible ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice cannot outlive this visit, but the event below still applies it now.
  }
  globalThis.dispatchEvent?.(new CustomEvent(WHATS_NEW_VISIBLE_EVENT, { detail: { isVisible } }));
}

/**
 * The `subscribe` half of `useSyncExternalStore` for the stored choice: this
 * tab's own change event, and the `storage` event another tab's write raises.
 *
 * @param onChange - called when the stored choice may have changed.
 * @returns the unsubscribe function.
 */
export function subscribeWhatsNewPreference(onChange: () => void): () => void {
  globalThis.addEventListener?.(WHATS_NEW_VISIBLE_EVENT, onChange);
  globalThis.addEventListener?.('storage', onChange);
  return () => {
    globalThis.removeEventListener?.(WHATS_NEW_VISIBLE_EVENT, onChange);
    globalThis.removeEventListener?.('storage', onChange);
  };
}
