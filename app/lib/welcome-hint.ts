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
 * Pure, and separate from the route, for the same reason `resolveOnboardingGate`
 * is: the four input combinations are worth testing exhaustively and none of
 * them should need IndexedDB or a router to reach.
 */
import type { AiConnectionMethod } from '#app/lib/local-store/ai-settings';

/** Which button the welcome screen leads with. */
export type WelcomePrimaryAction =
  /** This device carries a trace of an account: lead with the door back in. */
  | 'sign-in'
  /** Nothing on this device: lead with the first-run flow. */
  | 'start';

/** The two device traces the decision is made from. Both are read on the client. */
export interface WelcomeHintInput {
  /** The handle this device last signed in with, or `null`. */
  accountHint: string | null;
  /** How this device's AI provider was connected, or `null` when there is none. */
  connectedVia: AiConnectionMethod | null;
}

/** What the screen renders. */
export interface WelcomeHint {
  /** Which action gets the primary button; the other one becomes the secondary. */
  primary: WelcomePrimaryAction;
  /**
   * The remembered sign-in name, for the button label and for the prefill on
   * the next screen — or `null`, which is what a gateway-only hint yields.
   */
  accountName: string | null;
}

/**
 * Decides which door `/welcome` leads with.
 *
 * @param input - the two device traces; see the module header for their weight.
 * @returns the primary action plus the name to show, if any.
 */
export function resolveWelcomeHint({ accountHint, connectedVia }: WelcomeHintInput): WelcomeHint {
  // A stored empty string is the same as no name. `readAccountHint` already
  // maps `''` to null, but this function takes its input from a caller rather
  // than from that function, so it does not rely on it.
  const trimmed = accountHint?.trim() ?? '';
  const accountName = trimmed === '' ? null : trimmed;
  const hasGatewayMembership = connectedVia === 'invite';
  return {
    primary: accountName !== null || hasGatewayMembership ? 'sign-in' : 'start',
    accountName,
  };
}
