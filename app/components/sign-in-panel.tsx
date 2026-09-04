/**
 * Sign in — and, when the account turns out to have no key records, finish the
 * setup that never completed.
 *
 * EXTRACTED from `routes/settings.sync.tsx` (M183 spec 03). `/sign-in` and the
 * signed-out `/settings/sync` screen render THIS component, in one copy: a
 * second credential form is how one of the two quietly rots.
 *
 * ── Why the repair lives HERE and not behind "create an account" ──────────
 *
 * An account whose device died between the signup and the key-record writes
 * exists with no key hierarchy. Sending that user back to "create an account"
 * answers `409` (the account exists) and always will — the only door left open
 * is a sign-in, which is exactly where the missing key records become visible.
 * Without the repair, neither door works and the account is permanently
 * unusable.
 *
 * The repair reuses `SyncSetupFlow` rather than printing a code inline, so the
 * un-skippable "I've saved this recovery code" gate applies identically. And
 * because provisioning opens the session mid-ceremony, `onCeremonyActiveChange`
 * has to be threaded up to the caller for the same reason it is on the create
 * path — otherwise `resolveSyncScreen` swaps in the connected panel and
 * unmounts the code.
 */
import { useState } from 'react';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import type { Submission } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { FieldError } from '#app/components/field-error';
import { SyncSetupFlow } from '#app/components/sync-setup-flow';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { classifySignInFailure } from '#app/lib/sync/sign-in-error';
import { makeSyncSignInSchema, type SyncSignInValues } from '#app/lib/sync/sign-in-schema';
import type { SyncSetupOutcome } from '#app/lib/sync/setup-flow';
import { signInToSync, syncNow } from '#app/lib/sync/sync-actions';

/** The shape `parseWithZod` hands back for the sign-in form, and what a service refusal is replied onto. */
type SyncSignInSubmission = Submission<SyncSignInValues, string[], SyncSignInValues>;

export function SignInPanel({
  serverUrl,
  initialHandle,
  onCancel,
  onForgot,
  onForgetName,
  onSignedIn,
  onCeremonyActiveChange,
  onCeremonyComplete,
}: {
  serverUrl: string;
  initialHandle: string;
  /** Omitted where there is nowhere to cancel BACK to, e.g. on `/sign-in`, which is a page rather than a mode. */
  onCancel?: () => void;
  onForgot: () => void;
  /** "Not you?" — offered only beside a prefilled name, and only where the caller can act on it. */
  onForgetName?: () => void;
  /**
   * Handed the finished sign-in INSTEAD of the default first pull.
   *
   * `/sign-in` takes this over because it has to survive a failed pull with a
   * retry that never re-asks for the password, and this form is unmounted by
   * then. Without it the default below is right: pull once, and report the
   * failure on the form the person is still looking at.
   */
  onSignedIn?: () => void;
  /**
   * Reports the repair wizard holding something the person must still see, so
   * a surrounding screen can refuse to swap it out. Optional: `/sign-in` is a
   * page of its own with nothing to swap in, and passes nothing.
   */
  onCeremonyActiveChange?: (isActive: boolean) => void;
  /**
   * The repair ceremony FINISHED: its account card was shown and
   * acknowledged.
   *
   * Separate from the flag above, and for the reason recorded in
   * `sync-setup-flow.tsx`: the flag's `false` is re-fired by an effect cleanup
   * and is not an end-of-ceremony signal. A caller that treats it as one acts
   * while the recovery code is still on its way to the screen.
   */
  onCeremonyComplete?: () => void;
}) {
  const { t } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);
  // The service's refusal, fed back into the form as Conform's `lastResult`.
  // It is a FORM-level error on purpose: one status answers both a wrong name
  // and a wrong passphrase, so naming a field would be a guess — and an
  // account-enumeration oracle if the guess were right.
  const [lastResult, setLastResult] = useState<ReturnType<SyncSignInSubmission['reply']> | undefined>(undefined);
  const [repair, setRepair] = useState<{
    handle: string;
    passphrase: string;
    completeSetup: (input: { passphrase: string }) => Promise<SyncSetupOutcome>;
  } | null>(null);

  const [form, fields] = useForm({
    id: 'sync-signin',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeSyncSignInSchema(t) });
    },
    // Nothing red before the person asks for it, but a corrected field clears
    // its own error as it is typed. See `.claude/conform-to-react.md`.
    shouldRevalidate: 'onInput',
    defaultValue: { handle: initialHandle, passphrase: '' },
    onSubmit(event, { submission }) {
      // No action to post to: signing in is Argon2id and a fetch to the sync
      // service, both in this browser, and the default navigation would
      // abandon them.
      event.preventDefault();
      if (submission?.status !== 'success') return;
      void handleSubmit(submission);
    },
  });

  async function handleSubmit(submission: SyncSignInSubmission): Promise<void> {
    if (submission.status !== 'success') return;
    const { handle: accountHandle, passphrase } = submission.value;
    setIsBusy(true);
    setLastResult(undefined);
    try {
      const result = await signInToSync({ serverUrl, handle: accountHandle.trim(), passphrase });
      if (result.status === 'setup-incomplete') {
        setRepair({ handle: accountHandle.trim(), passphrase, completeSetup: result.completeSetup });
        return;
      }
      if (onSignedIn !== undefined) {
        onSignedIn();
        return;
      }
      await syncNow();
    } catch (caught) {
      setLastResult(submission.reply({ formErrors: [describeSignInError(caught, t)] }));
    } finally {
      setIsBusy(false);
    }
  }

  if (repair !== null) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('sync.signIn.finishSetup')}</p>
        <SyncSetupFlow
          resume={{ handle: repair.handle, passphrase: repair.passphrase }}
          onCeremonyActiveChange={onCeremonyActiveChange}
          onCeremonyComplete={onCeremonyComplete}
          provision={async (input) => {
            const outcome = await repair.completeSetup({ passphrase: input.passphrase });
            // Fired, never awaited — same reason as the create path: a network
            // round trip between "the key records exist" and "the code is on
            // screen" turns a transient failure into a lost recovery code.
            void syncNow().catch(() => undefined);
            return outcome;
          }}
        />
      </div>
    );
  }

  return (
    <form {...getFormProps(form)} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('sync.signIn.intro')}</p>
      <div className="space-y-2">
        <Label htmlFor={fields.handle.id}>{t('sync.handleLabel')}</Label>
        {/* Conform owns the field: id, name, seeded value and the
            `aria-invalid`/`aria-describedby` pair all come from the same
            metadata `FieldError` reads. No `required` — the browser's native
            popup would intercept the submit with untranslated copy. */}
        <Input
          {...getInputProps(fields.handle, { type: 'text' })}
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="none"
          className="h-11 font-mono"
        />
        <FieldError id={fields.handle.errorId} errors={fields.handle.errors} />
        {/* Beside the prefilled name, because that is the thing it disowns.
            The device remembers a name so a returning person does not have to
            type it; the shared or handed-on device needs one line to say the
            name is not theirs. */}
        {onForgetName !== undefined && initialHandle !== '' && (
          <button
            type="button"
            onClick={onForgetName}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('sync.signIn.notYou')}
          </button>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={fields.passphrase.id}>{t('sync.passphraseLabel')}</Label>
        <Input
          {...getInputProps(fields.passphrase, { type: 'password' })}
          autoComplete="current-password"
          className="h-11"
        />
        <FieldError id={fields.passphrase.errorId} errors={fields.passphrase.errors} />
      </div>
      <FieldError id={form.errorId} errors={form.errors} />
      <div className="flex flex-col gap-2">
        <Button type="submit" className="h-11 w-full" disabled={isBusy}>
          {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isBusy ? t('sync.signIn.working') : t('sync.signIn.submit')}
        </Button>
        <button
          type="button"
          onClick={onForgot}
          className="min-h-11 text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('sync.signIn.forgot')}
        </button>
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
            {t('sync.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Turns a sign-in failure into copy the user can act on.
 *
 * ONE message for a wrong handle and a wrong passphrase, because the service
 * answers one status for both — telling them apart would make this form an
 * account-enumeration oracle. Everything else keeps its own words: a DEK that
 * will not unwrap is not a wrong passphrase, and saying so sends people to try
 * harder at something that cannot work.
 */
function describeSignInError(cause: unknown, t: (key: string) => string): string {
  if (classifySignInFailure(cause) === 'rejected') return t('sync.signIn.failed');
  return describeErrorForUser(cause, t('sync.signIn.failed'));
}
