/**
 * What `/welcome` should offer first (M183 spec 02).
 *
 * The welcome screen asks one question — is this a new person or a returning
 * one? — and it can only guess. Nothing on a blank device proves an account
 * exists, so the guess never SKIPS the screen and never decides for anybody:
 * it only decides which of the two buttons is the primary one, and whether a
 * remembered name can be shown.
 *
 * Two traces can be on the device, and they are not equally strong.
 *
 * 1. **A remembered sign-in name** (`readAccountHint`, backed by
 *    `openplate.sync.account-hint`). This device has signed into an account
 *    before. It is a name, never a credential, which is why it can be printed
 *    on a button.
 * 2. **A gateway membership** (`getLocalAiSettings()`'s `connectedVia ===
 *    'invite'`). Somebody handed this device an invite link and it was
 *    redeemed. That proves an invite, NOT an account — the two halves of a
 *    join link are minted independently and either can be sent alone — so it
 *    reorders the buttons and nothing more. In particular it never invents a
 *    name to prefill.
 *
 * ── A managed instance has one door (M187 spec 03) ───────────────────────
 *
 * On an instance that declares a gateway (`PublicConfig.managed`) the question
 * above has no second answer. There is no anonymous diary to start: the AI
 * comes from the gateway's invite and the diary only survives the device
 * inside the account that same link creates. So the guess stops mattering —
 * the primary action is always signing in, and the other action becomes "I
 * have an invite link". The device traces still decide whether a NAME can be
 * printed on the button, because that part is about this device and not about
 * the instance.
 *
 * Pure, and separate from the route, for the same reason `resolveOnboardingGate`
 * is: the input combinations are worth testing exhaustively and none of them
 * should need IndexedDB or a router to reach.
 */
import type { AiConnectionMethod } from '#app/lib/local-store/ai-settings';

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
  /** The handle this device last signed in with, or `null`. */
  accountHint: string | null;
  /** How this device's AI provider was connected, or `null` when there is none. */
  connectedVia: AiConnectionMethod | null;
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
   * The remembered sign-in name, for the button label and for the prefill on
   * the next screen — or `null`, which is what a gateway-only hint yields.
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
export function resolveWelcomeHint({ accountHint, connectedVia, managed }: WelcomeHintInput): WelcomeHint {
  // A stored empty string is the same as no name. `readAccountHint` already
  // maps `''` to null, but this function takes its input from a caller rather
  // than from that function, so it does not rely on it.
  const trimmed = accountHint?.trim() ?? '';
  const accountName = trimmed === '' ? null : trimmed;
  const hasGatewayMembership = connectedVia === 'invite';
  const isReturning = accountName !== null || hasGatewayMembership;

  // The managed branch does not consult the traces for the ORDER at all: there
  // is no second door for them to point at. They still decide the name.
  if (managed) return { primary: 'sign-in', secondary: 'invite-link', accountName, isReturning };

  if (isReturning) return { primary: 'sign-in', secondary: 'start', accountName, isReturning };
  return { primary: 'start', secondary: 'sign-in', accountName, isReturning };
}
