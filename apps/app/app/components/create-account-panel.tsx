/**
 * Account creation: the invite, wrapped around the ceremony that sets a
 * password.
 *
 * EXTRACTED from `routes/settings.sync.tsx` (M183 spec 03) so the signed-out
 * settings screen and any other door into account creation render the SAME
 * form. Two copies of a credential form is how one of them quietly rots.
 *
 * ── The invite is now REQUIRED, always (M192) ────────────────────────────
 *
 * There is no open signup and no closed mode to ask about, so this panel no
 * longer reads a signup mode from `/health` and no longer decides whether to
 * offer an invite field: every account comes from one. The field is still a
 * FIELD OF THE CEREMONY'S FORM rather than a box above it (owner request,
 * 2026-09-02), which is what puts an invalid code under the invite box instead
 * of over the submit button.
 *
 * Nothing here collects an ADDRESS. The invite is written to one, and the
 * service reads it off the token — a form that asked would let somebody create
 * an account at an address their admin did not invite.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SyncSetupFlow, type SyncProvisionInput } from '#app/components/sync-setup-flow';
import { readFreshServerInstance } from '#app/hooks/use-server-instance';
import type { InstanceHealthConsent } from '#app/lib/sync/engine/protocol';
import { Button } from '#app/components/ui/button';
import { trackAccountCreated } from '#app/lib/matomo-events';
import { consumePendingInvite } from '#app/lib/sync/invite-link';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { SyncFieldError, type SyncRefusal } from '#app/lib/sync/form-field-error';
import { classifySignupFailure } from '#app/lib/sync/signup-error';
import { createSyncAccount } from '#app/lib/sync/sync-actions';

export function CreateAccountPanel({
  serverUrl,
  initialInvite,
  healthConsent: initialHealthConsent,
  onCancel,
  onAlreadyRegistered,
  onCeremonyActiveChange,
  onCeremonyComplete,
}: {
  serverUrl: string;
  /** The token from an `#invite=…` link, already taken out of the URL by the caller, or `''`. */
  initialInvite: string;
  /**
   * The consent the instance asks of a new account, as the caller read it off
   * the handshake, or `null` when it asks for none or could not be read
   * (`PROTOCOL.md` §5.6, §5.8). The panel keeps its own copy from here on: a
   * `400 health-consent-required` means the instance changed its wording, or
   * started asking, while the page was open, and the panel reads the
   * handshake again and draws the box for what it says now.
   */
  healthConsent: InstanceHealthConsent | null;
  /** Omitted where there is nowhere to cancel BACK to, e.g. `/join`, which is a page rather than a mode. */
  onCancel?: () => void;
  /**
   * The invited address already has an account (`409`).
   *
   * A CALLBACK rather than a field error, because the answer is not on this
   * form: nothing typed here fixes it, and the person's next step is signing
   * in. `/join` swaps the whole card for one that offers that door.
   */
  onAlreadyRegistered?: () => void;
  onCeremonyActiveChange?: (isActive: boolean) => void;
  /** Fired once, when the account card has been shown and acknowledged. */
  onCeremonyComplete?: () => void;
}) {
  const { t } = useTranslation();
  const [isCeremonyActive, setIsCeremonyActive] = useState(false);
  const [healthConsent, setHealthConsent] = useState<InstanceHealthConsent | null>(initialHealthConsent);

  /**
   * The consent the instance asks for NOW, after it refused the one sent.
   *
   * A fresh read, never the tab's cache: the refusal is the proof that the
   * cached answer is out of date. An unreadable handshake keeps the version
   * already held, so the box stays on screen for another try; `null` means
   * there is no version to draw a box for at all.
   */
  const rereadHealthConsent = async (): Promise<InstanceHealthConsent | null> => {
    const instance = await readFreshServerInstance(serverUrl);
    const next = instance === null ? healthConsent : (instance.healthConsent ?? null);
    setHealthConsent(next);
    return next;
  };

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
      onCeremonyActiveChange?.(isActive);
    },
    [onCeremonyActiveChange],
  );

  return (
    <div className="space-y-4">
      <SyncSetupFlow
        invite={{ initialValue: initialInvite, isFromLink: initialInvite !== '', isRequired: true }}
        healthConsent={healthConsent ?? undefined}
        onCeremonyActiveChange={handleCeremonyActiveChange}
        onCeremonyComplete={onCeremonyComplete}
        provision={async ({ passphrase, invite, displayName, healthConsent: agreed }: SyncProvisionInput) => {
          // The person has acted on the prefilled code, so the pending slot
          // has done its job and is emptied HERE rather than on mount: until
          // this moment a reload still has to be able to bring the token back,
          // and after it a later visit must not resurrect a spent one.
          consumePendingInvite();
          try {
            const account = await createSyncAccount({
              serverUrl,
              inviteToken: invite,
              passphrase,
              displayName: displayName === '' ? null : displayName,
              healthConsent: agreed,
            });
            trackAccountCreated();
            return account;
          } catch (error) {
            // THE CONSENT WAS REFUSED: missing, or given to a wording the
            // instance no longer asks for. Nothing was created and the invite
            // is still good (`PROTOCOL.md` §5.8), so the box comes back,
            // unticked, for the wording the handshake names now. With no
            // wording to draw, it is the retry screen instead.
            if (classifySignupFailure(error) === 'health-consent-required') {
              const current = await rereadHealthConsent();
              if (current === null) throw new Error(t('sync.setup.setupFailed'), { cause: error });
              throw new SyncFieldError('healthConsent', t('healthConsent.requiredToCreate'), { cause: error });
            }
            // Translated here rather than left to `describeErrorForUser`,
            // which would surface the SERVICE's own English sentence. §4 of
            // the protocol says a client branches on the status, not the
            // prose — displaying that prose is the same mistake in the other
            // direction. The FIELD travels with the message, so a taken name
            // and a spent invite land under the box the person has to change.
            // AN ACCOUNT ALREADY EXISTS at the invited address. It leaves this
            // form entirely rather than landing under a field: an admin
            // re-sending an invitation to somebody who already used the first
            // one is ordinary, and the answer is the sign-in page.
            if (classifySignupFailure(error) === 'account-exists' && onAlreadyRegistered !== undefined) {
              onAlreadyRegistered();
              // Thrown anyway, so the ceremony ends in `error` rather than
              // pretending to have created an account. The card above it has
              // already been swapped out by the callback.
              throw new Error(t('sync.create.accountExists'), { cause: error });
            }
            const refusal = describeSignupError(error, t);
            if (refusal.field !== null) throw new SyncFieldError(refusal.field, refusal.message, { cause: error });
            throw new Error(refusal.message, { cause: error });
          }
        }}
      />
      {!isCeremonyActive && onCancel !== undefined && (
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
 * EVERY `403` IS ONE SENTENCE. The service will not distinguish a missing
 * invite from an expired, revoked or already-spent one — telling them apart
 * would let a caller probe which tokens exist — and the person's next step is
 * the same for all four: ask whoever invited them for a new link.
 */
function describeSignupError(cause: unknown, t: (key: string) => string): SyncRefusal {
  const failure = classifySignupFailure(cause);
  if (failure === 'invite-required') return { field: 'invite', message: t('sync.create.inviteRequired') };
  // Under the INVITE box too, because that is the field whose value carries
  // the address: "this address already has an account" is answered by signing
  // in, or by a different invite, never by editing the password.
  if (failure === 'account-exists') return { field: 'invite', message: t('sync.create.accountExists') };
  // About the account rather than about anything typed, so it belongs to the
  // form and its retry screen rather than under a box.
  if (failure === 'suspended') return { field: null, message: t('sync.suspended') };
  return { field: null, message: describeErrorForUser(cause, t('sync.setup.setupFailed')) };
}
