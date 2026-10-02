/**
 * The two reads behind "is the What's new card shown here", in one hook so the
 * card, the About row and the Preferences switch cannot disagree.
 *
 * Both reads are external stores, so both go through `useSyncExternalStore`:
 * the server renders `unset` and no account, which resolves to hidden, and the
 * browser corrects it right after hydration without a mismatch.
 */
import { useSyncExternalStore } from 'react';

import { useSyncSession } from '#app/components/sync-status';
import {
  readWhatsNewPreference,
  resolveWhatsNewVisible,
  subscribeWhatsNewPreference,
  type WhatsNewPreference,
} from '#app/lib/whats-new-visibility';

/** What the server renders, and what the first hydration pass renders: nothing chosen. */
function readServerPreference(): WhatsNewPreference {
  return 'unset';
}

/**
 * Whether the card and the About row show on this device, right now.
 *
 * Follows a change of the stored choice and a role that arrives late: after a
 * reload the session opens with the role unread, so an administrator with
 * nothing stored reads `false` first and `true` once the account has been read.
 *
 * @returns `true` when the card and the row should render.
 */
export function useWhatsNewVisible(): boolean {
  const stored = useSyncExternalStore(subscribeWhatsNewPreference, readWhatsNewPreference, readServerPreference);
  const session = useSyncSession();
  return resolveWhatsNewVisible(stored, session.account?.role ?? null);
}
