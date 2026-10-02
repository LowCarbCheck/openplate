/**
 * sync-error-copy.ts: which sentence a sync error reason is told with.
 *
 * The status surfaces used to build the key with a template string
 * (`sync.status.error.${reason}`), which cannot fail to compile when a reason
 * is added and has no sentence: the person would see the raw key. This is an
 * exhaustive `Record` instead, so a new `SyncErrorReason` is a type error here
 * until it is given its copy. There is deliberately no `default`.
 *
 * `suspended` reuses the sentence the sign-in and account screens already say
 * (`sync.suspended`), because one phrasing per idea is a rule of this app
 * (DESIGN.md section 10.7), and a suspended account is told the same thing
 * wherever it meets the refusal.
 */
import type { SyncErrorReason } from './sync-session';

/** Every translation key a sync error reason can be told with. */
export type SyncErrorCopyKey =
  | 'sync.status.error.reauth-required'
  | 'sync.status.error.reauthRequiredManaged'
  | 'sync.status.error.offline'
  | 'sync.status.error.incompatible'
  | 'sync.status.error.failed'
  | 'sync.suspended';

const COPY_KEYS = {
  'reauth-required': 'sync.status.error.reauth-required',
  suspended: 'sync.suspended',
  offline: 'sync.status.error.offline',
  incompatible: 'sync.status.error.incompatible',
  failed: 'sync.status.error.failed',
} as const satisfies Record<SyncErrorReason, SyncErrorCopyKey>;

/**
 * The key for a reason.
 *
 * @param options.reason - why sync stopped.
 * @param options.hasHiddenTheDiary - whether ending this session also hid the
 *   diary on this device. Only `reauth-required` changes with it: a session
 *   that ended and took the diary out of view says so, because "sign in to keep
 *   syncing" does not describe a screen with nothing on it. The caller asks the
 *   instance policy (`signOutClosesTheDiary`), never the mode name.
 */
export function syncErrorCopyKey({
  reason,
  hasHiddenTheDiary,
}: {
  reason: SyncErrorReason;
  hasHiddenTheDiary: boolean;
}): SyncErrorCopyKey {
  if (reason === 'reauth-required' && hasHiddenTheDiary) return 'sync.status.error.reauthRequiredManaged';
  return COPY_KEYS[reason];
}
