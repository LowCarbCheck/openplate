/**
 * Account creation: the invite, if this instance wants one, wrapped around the
 * ceremony that mints the handle and shows the account card.
 *
 * EXTRACTED from `routes/settings.sync.tsx` (M183 spec 03) so the signed-out
 * settings screen and any other door into account creation render the SAME
 * form. Two copies of a credential form is how one of them quietly rots.
 *
 * ── Why the handle is NOT collected here ─────────────────────────────────
 *
 * It used to be an email field on this panel, with the passphrase warnings on
 * the next screen. The handle is not that: it is generated, not typed, and it
 * is one half of the account card the ceremony ends on. Keeping it beside the
 * passphrase — in `SyncSetupFlow` — is what lets the card show the two values
 * the ceremony actually produced, rather than one collected here and one
 * produced there.
 *
 * The invite stays, because it is a capability from outside the ceremony and
 * the field is also the paste target for a code that arrived as text rather
 * than as a link. It is a FIELD OF THE CEREMONY'S FORM rather than a box above
 * it (owner request, 2026-09-02): that is what puts an invalid code under the
 * invite box instead of over the submit button, and it disappears with the rest
 * of the form once provisioning starts — an invite box beside an account card
 * is asking a question that has already been answered.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SyncSetupFlow } from '#app/components/sync-setup-flow';
import { Button } from '#app/components/ui/button';
import { consumePendingInvite } from '#app/lib/sync/invite-link';
import type { SignupMode } from '#app/lib/sync/engine/protocol';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { SyncFieldError, type SyncRefusal } from '#app/lib/sync/form-field-error';
import { classifySignupFailure } from '#app/lib/sync/signup-error';
import { createSyncAccount, readSignupMode } from '#app/lib/sync/sync-actions';

export function CreateAccountPanel({
  serverUrl,
  initialInvite,
  onCancel,
  onCeremonyActiveChange,
  onCeremonyComplete,
}: {
  serverUrl: string;
  /** The token from an `#invite=…` link, already taken out of the URL by the caller, or `''`. */
  initialInvite: string;
  onCancel: () => void;
  onCeremonyActiveChange: (isActive: boolean) => void;
  /** Fired once, when the account card has been shown and acknowledged. */
  onCeremonyComplete?: () => void;
}) {
  const { t } = useTranslation();
  const [isCeremonyActive, setIsCeremonyActive] = useState(false);

  /**
   * A `useCallback`, and that is load-bearing rather than tidiness.
   *
   * An inline arrow here is a NEW function on every render of this panel, and
   * this panel re-renders on every one of its own `setIsCeremonyActive` calls.
   * `SyncSetupFlow` reports the flag from an effect that lists the callback in
   * its dependencies, so a fresh identity re-runs that effect — and its
   * CLEANUP reports `false` first. That is the loop that, on 2026-09-04, told
   * `/settings/sync` the ceremony had ended while it was still provisioning.
   */
  const handleCeremonyActiveChange = useCallback(
    (isActive: boolean): void => {
      setIsCeremonyActive(isActive);
      onCeremonyActiveChange(isActive);
    },
    [onCeremonyActiveChange],
  );

  // `null` while unknown — an older service, or one that could not be reached.
  // The form stays usable either way; this only decides whether the invite
  // field is offered and which refusal message a 403 gets.
  const [signupMode, setSignupMode] = useState<SignupMode | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ask = async (): Promise<void> => {
      const mode = await readSignupMode(serverUrl);
      if (!cancelled) setSignupMode(mode);
    };
    // `readSignupMode` fails open and never rejects, so there is nothing here
    // for a catch to do — the unknown mode IS the failure result.
    void ask();
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  // Offered when the instance says it wants one, and also whenever a link
  // supplied one — so a person following an invite to a service that could not
  // be reached still sees their code rather than losing it silently.
  const wantsInvite = signupMode === 'invite' || initialInvite !== '';

  return (
    <div className="space-y-4">
      <SyncSetupFlow
        invite={
          wantsInvite ?
            { initialValue: initialInvite, isFromLink: initialInvite !== '', isRequired: signupMode === 'invite' }
          : undefined
        }
        onCeremonyActiveChange={handleCeremonyActiveChange}
        onCeremonyComplete={onCeremonyComplete}
        provision={async ({ handle: accountHandle, passphrase, invite }) => {
          // The person has acted on the prefilled code, so the pending slot
          // has done its job and is emptied HERE rather than on mount: until
          // this moment a reload still has to be able to bring the token back,
          // and after it a later visit must not resurrect a spent one.
          consumePendingInvite();
          try {
            return await createSyncAccount({
              serverUrl,
              handle: accountHandle,
              passphrase,
              inviteToken: invite === '' ? undefined : invite,
            });
          } catch (error) {
            // Translated here rather than left to `describeErrorForUser`,
            // which would surface the SERVICE's own English sentence. §4 of
            // the protocol says a client branches on the status, not the
            // prose — displaying that prose is the same mistake in the other
            // direction. The FIELD travels with the message, so a taken name
            // and a spent invite land under the box the person has to change.
            const refusal = describeSignupError(error, signupMode, t);
            if (refusal.field !== null) throw new SyncFieldError(refusal.field, refusal.message, { cause: error });
            throw new Error(refusal.message, { cause: error });
          }
        }}
      />
      {!isCeremonyActive && (
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
          {t('sync.cancel')}
        </Button>
      )}
    </div>
  );
}

/**
 * Turns a failure to CREATE an account into copy the user can act on, plus the
 * FIELD it belongs under when there is one.
 *
 * The `403` needs `signupMode` to be readable at all: the service answers the
 * same status whether it is closed or merely wants an invite, and it
 * deliberately will not distinguish a missing invite from an expired or
 * already-spent one. When the mode is unknown the generic refusal is the
 * honest answer — better than sending somebody to look for an invitation that
 * was never required.
 */
function describeSignupError(cause: unknown, signupMode: SignupMode | null, t: (key: string) => string): SyncRefusal {
  const failure = classifySignupFailure(cause, signupMode);
  if (failure === 'invite-required') return { field: 'invite', message: t('sync.create.inviteRequired') };
  if (failure === 'handle-taken') return { field: 'handle', message: t('sync.create.handleTaken') };
  // "This server is not accepting new accounts" is about the server, and
  // nothing typed into any field answers it — so it belongs to the form, on
  // the screen that offers a retry rather than under a box.
  if (failure === 'signups-closed') return { field: null, message: t('sync.create.closed') };
  return { field: null, message: describeErrorForUser(cause, t('sync.setup.setupFailed')) };
}
