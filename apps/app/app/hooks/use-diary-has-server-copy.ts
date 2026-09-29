/**
 * Whether a server keeps a copy of THIS diary, for a screen that tells the
 * person where their answers are kept (M265 follow-up, "stays on this device").
 *
 * ── Why the policy alone is not the answer ───────────────────────────────
 *
 * `InstancePolicy.serverHoldsTheDiary` answers the instance: true on a managed
 * one, where every person has an account and the account keeps an encrypted
 * copy. It is false on an open instance even when sync is configured, because
 * sync there is an opt-in. But the person who opted in is signed in, and for
 * them "they stay on this device" is as false as it is on a managed instance.
 * So the answer is the policy OR a session on this device, which is the rule
 * the backup banner already asks ({@link hasServerCopyOfTheDiary}).
 *
 * ── Why the session is read in the loader, and never "resuming" ──────────
 *
 * The session half is `hasDeviceSyncSession()`, read by the route's
 * `clientLoader`: the open vault, or the cached record a resume would find.
 * Both routes that ask are clientLoader-only, so the answer is settled before
 * the first paint and the sentence never swaps under the reader.
 *
 * The live snapshot's `isResuming` is passed as `false` on purpose.
 * `/onboarding` sits under `_public`, where no `SyncController` mounts, so
 * nothing ever settles that flag there: passing it would make every device
 * on an open instance read the synced sentence forever. The cached record is
 * the durable half of the same question and is already in hand.
 */
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { hasServerCopyOfTheDiary } from '#app/lib/backup-nudge';

/**
 * @param input.hasDeviceSession - `hasDeviceSyncSession()` as the route's `clientLoader` read it.
 * @returns true when "stays on this device" would be false for this person.
 */
export function useDiaryHasServerCopy({ hasDeviceSession }: { hasDeviceSession: boolean }): boolean {
  const { serverHoldsTheDiary } = useInstancePolicy();
  return hasServerCopyOfTheDiary({ serverHoldsTheDiary, isSessionResuming: false, isSignedIn: hasDeviceSession });
}
