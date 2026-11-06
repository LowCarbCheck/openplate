/**
 * The reminder-email choice, as the client reads it off the wire.
 *
 * `AccountView.activityMail` is read by a cast, so nothing upstream has checked
 * what the key holds. ONLY `true` MEANS ON: a core older than the field sends no
 * key, and a nonsense value is not a yes either. Reading anything else as on
 * would show a switch the person never turned on.
 */
export function decodeActivityMail(wire: boolean | null | undefined): boolean {
  return wire === true;
}

/**
 * Whether the reminder-email control is drawn in settings.
 *
 * THE ACCOUNT'S OWN ANSWER KEEPS IT ON SCREEN. An instance that switched the
 * feature off after somebody opted in must still let that person turn the
 * reminders off, so a control that vanished with the instance flag would leave
 * a person unable to withdraw. A signed-out device has no account to change.
 *
 * @param input.hasAccount - a session with an account is open.
 * @param input.instanceOffers - `InstanceDescriptor.activityMail`, `false` while unread.
 * @param input.accountOptedIn - `SyncSessionSnapshot.account.activityMail`.
 */
export function isActivityMailControlShown({
  hasAccount,
  instanceOffers,
  accountOptedIn,
}: {
  hasAccount: boolean;
  instanceOffers: boolean;
  accountOptedIn: boolean;
}): boolean {
  if (!hasAccount) return false;
  return instanceOffers || accountOptedIn;
}
