import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import type { Submission } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import {
  initialSyncSetupState,
  isSyncSetupCeremonyActive,
  syncSetupReducer,
  type SyncSetupOutcome,
  type SyncSetupServerError,
} from '#app/lib/sync/setup-flow';
import { makeSyncSignupSchema, type SyncInviteRule, type SyncSignupValues } from '#app/lib/sync/signup-schema';
import { readSyncErrorField } from '#app/lib/sync/form-field-error';
import { PasswordFields } from '#app/components/password-fields';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { FieldError } from '#app/components/field-error';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';

/**
 * The sync-setup CEREMONY: invite and password entry -> the account exists.
 *
 * ── WHAT M192 REMOVED FROM THIS FILE ─────────────────────────────────────
 *
 * A handle field with a suggestion button, and the ACCOUNT CARD that followed
 * provisioning: the handle and the recovery code shown together, once, behind
 * an un-skippable "I have saved this" tick.
 *
 * Neither has anything left to do. The address comes from the invite, so there
 * is no name to choose; and the recovery code is escrowed with the service and
 * never shown, so there is nothing for a person to save. What is left is a
 * password and a confirmation.
 *
 * That is a deliberate loss of a safeguard, and the trade is stated in the
 * milestone's decisions: the operator of a managed instance now holds what it
 * takes to open a diary, and what that buys is a person who forgets their
 * password getting their diary back instead of a working login to something
 * unreadable.
 *
 * ── One Conform form, one error per field ────────────────────────────────
 *
 * Validation is a single Zod schema (`signup-schema.ts`) driven through
 * Conform, exactly like `settings.goals.tsx` and `fasting.tsx`. What it
 * replaced was a chain of `if`s whose first failure became one red sentence
 * above the submit button — one problem at a time, attached to no field
 * (owner request, 2026-09-02). `shouldRevalidate: 'onInput'` is not optional
 * here: without it a reported error survives the person fixing it.
 *
 * THE INVITE LIVES IN THIS FORM, not above it. It is the first field of the
 * same submission, so an invalid code lands under the invite box rather than
 * over the button, and a code that arrived through a link is shown read-only
 * with a check — it needs no action, and "Change" is there for the person who
 * has a different one to paste.
 *
 * `provision` is injected, and this component knows nothing about what it
 * does. That is the whole point of the split: the ceremony is a fixed piece of
 * UX (M117/08, D5) that has to look and behave the same whether it runs during
 * first-time account creation, on a device joining an existing account, or in
 * a test. WHICH server the keys go to, how the request is authenticated, and
 * what an account even is are the caller's business
 * (`app/lib/sync/sync-actions.ts`).
 *
 * `provision` must REJECT on failure. Anything it throws becomes the reducer's
 * failure branch — nothing is swallowed, because a setup that silently half-
 * completed is the one state a user cannot recover from without support. A
 * refusal the person can still fix (`SyncFieldError`: a taken name, a spent
 * invite) comes back to THIS form under its field; everything else gets the
 * retry screen.
 *
 * `resume` is the setup-COMPLETION entry point: an account that exists with no
 * key records, reached from the sign-in form where the address and the
 * password have already been typed. The wizard then opens straight into
 * provisioning.
 */
export function SyncSetupFlow({
  provision,
  onCeremonyActiveChange,
  onCeremonyComplete,
  resume,
  invite,
}: {
  provision: (input: { passphrase: string; invite: string; displayName: string }) => Promise<SyncSetupOutcome>;
  /**
   * Reports whether this wizard is mid-flight, so the surrounding screen can
   * refuse to swap it out.
   *
   * Provisioning opens the sync session as a side effect, which makes the
   * settings route want to replace this component with the connected panel
   * while it is still running. See `isSyncSetupCeremonyActive` and
   * `resolveSyncScreen` for the rule.
   */
  onCeremonyActiveChange?: (isActive: boolean) => void;
  /**
   * The ceremony is OVER: the account exists and the session is open.
   *
   * A separate event from `onCeremonyActiveChange` because the `false` edge of
   * that flag is NOT the end of the ceremony, and reading it as one shipped a
   * production bug on 2026-09-04: the effect below re-fires whenever its own
   * identity changes, so the caller saw `false` while provisioning was still
   * running and navigated away mid-flight. This fires once, from the reducer's
   * `complete` state.
   */
  onCeremonyComplete?: () => void;
  /** Skips the details form and provisions immediately with an already-known password. */
  resume?: { passphrase: string };
  /** Omitted when this instance neither wants nor was given an invite — then no invite field is rendered at all. */
  invite?: SyncSetupInvite;
}) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(syncSetupReducer, { resume: resume !== undefined }, initialSyncSetupState);
  /**
   * The last submission Conform accepted, kept so the form can be re-seeded
   * with what the person typed when it comes BACK — after a service refusal,
   * or after "try again" on the failure screen. The details form unmounts
   * while provisioning runs, so nothing inside it survives on its own, and
   * `reply()` carries both the payload and any field error in the one shape
   * Conform's `lastResult` expects.
   */
  const lastSubmissionRef = useRef<SyncSignupSubmission | null>(null);

  // Reported from an effect, never during render — the parent turns this into
  // state, and a render-phase parent update is a React error. Releasing on
  // unmount matters as much as reporting: a wizard that vanished with the flag
  // still set would strand the user on a setup screen forever.
  const isCeremonyActive = isSyncSetupCeremonyActive(state);
  useEffect(() => {
    onCeremonyActiveChange?.(isCeremonyActive);
    return () => onCeremonyActiveChange?.(false);
  }, [isCeremonyActive, onCeremonyActiveChange]);

  // The one report of a FINISHED ceremony. Guarded by a ref rather than by the
  // effect's dependencies: an unstable callback identity re-runs the effect,
  // and firing a second handoff would send the caller somewhere twice.
  const hasReportedCompleteRef = useRef(false);
  const isComplete = state.kind === 'complete';
  useEffect(() => {
    if (!isComplete || hasReportedCompleteRef.current) return;
    hasReportedCompleteRef.current = true;
    onCeremonyComplete?.();
  }, [isComplete, onCeremonyComplete]);

  /** The provisioning round trip, shared by the form submit and the `resume` entry point. */
  const runProvision = useCallback(
    async (chosen: { passphrase: string; invite: string; displayName: string }): Promise<void> => {
      try {
        await provision(chosen);
        dispatch({ type: 'setupSucceeded' });
      } catch (error) {
        // The underlying words wherever there are any — "that invitation is no
        // longer valid" is worth reading, and a generic failure would send
        // the user round the same loop. `describeErrorForUser` rather than an
        // `instanceof Error` check: WebCrypto rejects with a DOMException, and
        // this step is where one is most likely to surface. `field` is what
        // decides between "back to the form, under the invite box" and the
        // retry screen.
        dispatch({
          type: 'setupFailed',
          message: describeErrorForUser(error, t('sync.setup.setupFailed')),
          field: readSyncErrorField(error),
        });
      }
    },
    [provision, t],
  );

  // The resume path provisions on mount. The ref makes that happen ONCE even
  // under React's development double-invoke of effects: a second run would push
  // key records that the first run already wrote, and the CAS would answer
  // `409` — turning a successful repair into "this account already has sync
  // keys" and losing the recovery code that had just been written.
  const hasResumedRef = useRef(false);
  useEffect(() => {
    if (resume === undefined || hasResumedRef.current) return;
    hasResumedRef.current = true;
    void runProvision({ passphrase: resume.passphrase, invite: '', displayName: '' });
  }, [resume, runProvision]);

  /**
   * What the details form is re-seeded with. `undefined` before the first
   * submission — there is nothing to restore and nothing to complain about.
   *
   * Memoised on the reducer state so the object identity only changes when the
   * screen does: Conform re-applies `lastResult` whenever it is a new object,
   * and a fresh one every render would fight the person's typing.
   */
  const detailsResult = useMemo(() => {
    if (state.kind !== 'enter-details') return undefined;
    const submission = lastSubmissionRef.current;
    if (submission === null) return undefined;
    if (state.serverError === null) return submission.reply();
    return submission.reply({ fieldErrors: { [state.serverError.field]: [state.serverError.message] } });
  }, [state]);

  function handleDetailsSubmit(submission: SyncSignupSubmission): void {
    if (submission.status !== 'success') return;
    lastSubmissionRef.current = submission;
    dispatch({ type: 'detailsSubmitted' });
    void runProvision({
      passphrase: submission.value.passphrase,
      invite: submission.value.invite.trim(),
      displayName: submission.value.displayName.trim(),
    });
  }

  if (state.kind === 'enter-details') {
    return (
      <DetailsStep
        invite={invite}
        isInviteRevealed={isInviteRejected(state.serverError)}
        lastResult={detailsResult}
        onSubmit={handleDetailsSubmit}
      />
    );
  }
  if (state.kind === 'generating') {
    return <GeneratingStep />;
  }
  if (state.kind === 'error') {
    return <ErrorStep message={state.message} onRetry={() => dispatch({ type: 'retried' })} />;
  }
  return <CompleteStep />;
}

/** How the details form should treat the invite, when there is one at all. */
export type SyncSetupInvite = {
  /** The token an `#invite=…` link supplied, already taken out of the URL, or `''`. */
  initialValue: string;
  /**
   * It came from a link, so the form does not mention it at all: the token
   * rides along in a hidden field and the person sees the address it was
   * written to instead.
   *
   * IT USED TO BE A READ-ONLY BOX with a check mark, a "Change" button and a
   * sentence saying the code was ready to use. Walking 0.10.0 on 2026-09-04:
   * that is four pieces of furniture around a value nobody typed, nobody can
   * verify and nobody should change, on the one screen where a person is
   * supposed to think about a password. The only reason to edit it is a
   * refusal, and a refusal reveals the box.
   */
  isFromLink: boolean;
  /** This instance refuses signups without one, so an empty box is worth saying so before the round trip. */
  isRequired: boolean;
};

/** The shape `parseWithZod` hands back for this form, and the shape `lastResult` is built from. */
type SyncSignupSubmission = Submission<SyncSignupValues, string[], SyncSignupValues>;

/** A service refusal the person answers by editing the invite, so the box has to appear. */
function isInviteRejected(serverError: SyncSetupServerError | null): boolean {
  return serverError !== null && serverError.field === 'invite';
}

/** What the schema is told to demand of the invite, derived from the one prop that describes it. */
function inviteRule(invite: SyncSetupInvite | undefined): SyncInviteRule {
  if (invite === undefined) return 'none';
  return invite.isRequired ? 'required' : 'optional';
}

function DetailsStep({
  invite,
  isInviteRevealed,
  lastResult,
  onSubmit,
}: {
  invite?: SyncSetupInvite;
  /** The service refused the token: the box appears so it can be corrected or replaced. */
  isInviteRevealed: boolean;
  lastResult: ReturnType<SyncSignupSubmission['reply']> | undefined;
  onSubmit: (submission: SyncSignupSubmission) => void;
}) {
  const { t } = useTranslation();

  const [form, fields] = useForm({
    id: 'sync-signup',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeSyncSignupSchema(t, { invite: inviteRule(invite) }) });
    },
    // `shouldValidate` stays at Conform's `onSubmit` default — nothing is red
    // before the person asks for it — but REVALIDATION is `onInput`, so a
    // corrected field clears its own error as it is typed. Left at the default,
    // a reported error would sit there, `aria-invalid` and all, until the next
    // submit.
    shouldRevalidate: 'onInput',
    defaultValue: { invite: invite?.initialValue ?? '', displayName: '', passphrase: '', confirmPassphrase: '' },
    onSubmit(event, { submission }) {
      // Nothing is posted anywhere: this form's "action" is a browser-side
      // ceremony, and the default navigation would abandon it.
      event.preventDefault();
      if (submission === undefined) return;
      onSubmit(submission);
    },
  });

  // HIDDEN when it came from a link and the service has not refused it. See
  // `SyncSetupInvite.isFromLink` for why this is not a read-only box.
  const isInviteHidden = invite?.isFromLink === true && !isInviteRevealed;

  return (
    <form {...getFormProps(form)} className="space-y-4">
      {invite !== undefined && isInviteHidden && <input {...getInputProps(fields.invite, { type: 'hidden' })} />}
      {invite !== undefined && !isInviteHidden && (
        <div className="space-y-2">
          <Label htmlFor={fields.invite.id}>{t('sync.create.inviteLabel')}</Label>
          <Input
            {...getInputProps(fields.invite, { type: 'text' })}
            autoComplete="off"
            spellCheck={false}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">{t('sync.create.inviteHint')}</p>
          <FieldError id={fields.invite.errorId} errors={fields.invite.errors} />
        </div>
      )}

      {/* OPTIONAL, and the last field rather than the first: the address came
          from the invite and is not asked for, so this box is the only one on
          the form that is not required, and putting it above the password
          would read as a name somebody has to choose. */}
      <div className="space-y-2">
        <Label htmlFor={fields.displayName.id}>{t('sync.displayNameLabel')}</Label>
        <Input {...getInputProps(fields.displayName, { type: 'text' })} autoComplete="name" className="h-11" />
        <FieldError id={fields.displayName.errorId} errors={fields.displayName.errors} />
      </div>

      <p className="text-sm text-muted-foreground">{t('sync.setup.passphraseIntro')}</p>

      {/* THE SHARED PAIR (M192): the same two fields, the same strength hint
          and the same mismatch placement the reset screen and the change-
          password card use. Three hand-drawn copies had already drifted. */}
      <PasswordFields
        passphrase={fields.passphrase}
        confirmPassphrase={fields.confirmPassphrase}
        passwordLabel={t('sync.setup.passphraseLabel')}
      />

      {/* Only what belongs to no field lands here: a service refusal with a
          named field went back to that field on the way in. */}
      <FieldError id={form.errorId} errors={form.errors} />

      <Button type="submit" className="h-11 w-full">
        {t('sync.setup.continue')}
      </Button>
    </form>
  );
}

function GeneratingStep() {
  const { t } = useTranslation();

  return (
    <output className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {t('sync.setup.generating')}
    </output>
  );
}

function ErrorStep({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
      <Button type="button" variant="outline" onClick={onRetry} className="h-11 w-full">
        {t('sync.setup.retry')}
      </Button>
    </div>
  );
}

function CompleteStep() {
  const { t } = useTranslation();

  return (
    <p className="flex items-center gap-2 text-sm text-primary">
      <Check className="h-4 w-4" /> {t('sync.setup.complete')}
    </p>
  );
}
