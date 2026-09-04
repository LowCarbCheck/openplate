/**
 * What `/welcome` should offer first (M183 spec 02).
 *
 * The welcome screen asks one question — is this a new person or a returning
 * one? — and it can only guess. Nothing on a blank device proves an account
 * exists, so the guess never SKIPS the screen and never decides for anybody:
 * it only decides which of the two buttons is the primary one, and whether a
 * remembered name can be shown.
 *
 * ONE trace is on the device: **a remembered address** (`readAccountHint`,
 * backed by `openplate.sync.email-hint`). This device has signed into an
 * account before. It is an address, never a credential, which is why it can be
 * printed on a button.
 *
 * There WAS a second, weaker one: a gateway membership
 * (`connectedVia: 'invite'`). It proved that somebody had redeemed an invite
 * on this device, which was not the same as an account existing, so it
 * reordered the buttons and never prefilled a name. M192 deleted the gateway
 * and with it that trace.
 *
 * ── A managed instance has one door (M187 spec 03) ───────────────────────
 *
 * On a managed instance (`PublicConfig.managed`) the question above has no
 * second answer. There is no anonymous diary to start: the AI comes from the
 * account and the diary only survives the device inside that account. So the
 * guess stops mattering — the primary action is always signing in, and the
 * other action becomes "I have an invite link". The device trace still decides
 * whether an ADDRESS can be printed on the button, because that part is about
 * this device and not about the instance.
 *
 * Pure, and separate from the route, for the same reason `resolveOnboardingGate`
 * is: the input combinations are worth testing exhaustively and none of them
 * should need IndexedDB or a router to reach.
 */
/** Which button the welcome screen leads with. */
export type WelcomePrimaryAction =
  /** This device carries a trace of an account, or this instance has no other door: lead with the way back in. */
  | 'sign-in'
  /** Nothing on this device, on an instance where a diary can be started without anybody's permission. */
  | 'start';

/** The quieter button under the primary one. Never the same action twice. */
export type WelcomeSecondaryAction =
  /** Open the first-run questionnaire. Offered on OPEN instances only. */
  | 'start'
  /** The account door, when signing in is not already the primary action. */
  | 'sign-in'
  /** Paste a link somebody sent. The second and last door on a managed instance. */
  | 'invite-link';

/** What the decision is made from: two device traces, and one fact about the instance. */
export interface WelcomeHintInput {
  /** The address this device last signed in with, or `null`. */
  accountHint: string | null;
  /**
   * Whether this instance hands out accounts by invite (`PublicConfig.managed`).
   *
   * `false` is the self-host default and yields exactly the screen this module
   * produced before the flag existed.
   */
  managed: boolean;
}

/** What the screen renders. */
export interface WelcomeHint {
  /** Which action gets the primary button. */
  primary: WelcomePrimaryAction;
  /** Which action gets the quieter button under it. */
  secondary: WelcomeSecondaryAction;
  /**
   * The remembered address, for the button label and for the prefill on the
   * next screen — or `null` on a device that has never signed in.
   */
  accountName: string | null;
  /**
   * Whether this DEVICE carries a trace of an account.
   *
   * Separate from `primary` because on a managed instance signing in leads
   * whether or not there is a trace, and the line that says "this device was
   * signed in before" must not be printed to somebody it was never true of.
   */
  isReturning: boolean;
}

/**
 * Decides which door `/welcome` leads with.
 *
 * @param input - the two device traces; see the module header for their weight.
 * @returns the primary action plus the name to show, if any.
 */
export function resolveWelcomeHint({ accountHint, managed }: WelcomeHintInput): WelcomeHint {
  // A stored empty string is the same as no name. `readAccountHint` already
  // maps `''` to null, but this function takes its input from a caller rather
  // than from that function, so it does not rely on it.
  const trimmed = accountHint?.trim() ?? '';
  const accountName = trimmed === '' ? null : trimmed;
  const isReturning = accountName !== null;

  // The managed branch does not consult the trace for the ORDER at all: there
  // is no second door for it to point at. It still decides the name.
  if (managed) return { primary: 'sign-in', secondary: 'invite-link', accountName, isReturning };

  if (isReturning) return { primary: 'sign-in', secondary: 'start', accountName, isReturning };
  return { primary: 'start', secondary: 'sign-in', accountName, isReturning };
}
