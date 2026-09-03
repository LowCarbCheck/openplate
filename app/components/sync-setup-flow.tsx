import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, Loader2, RefreshCw } from 'lucide-react';
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
import { normalizeHandle, suggestHandle } from '#app/lib/sync/handle';
import { passphraseStrengthKey, ratePassphrase } from '#app/lib/sync/passphrase-strength';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { FieldError } from '#app/components/field-error';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';

/**
 * The sync-setup CEREMONY: invite, handle and passphrase entry -> the ACCOUNT
 * CARD, with an unmissable loss warning -> a confirm-saved gate before setup
 * can complete.
 *
 * THE HANDLE IS TYPED, with a suggestion one click away. The field starts
 * empty and "suggest a name" fills it with `suggestHandle`'s readable
 * `<adjective>-<animal>-<number>` in the UI language (`quick-otter-42`,
 * `flink-otter-42`) — never the Crockford string `generateHandle` mints, which
 * reads as a password and makes people think it cannot be changed. This is
 * also where the `@` rule becomes visible: the same check the service enforces
 * runs locally (`handle.ts`), so a person who types their email address is
 * told immediately rather than after a round trip.
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
 * key records, reached from the sign-in form where the handle and passphrase
 * have already been typed. The wizard then opens straight into provisioning
 * and runs the identical card ceremony — the code it produces is exactly as
 * unrecoverable as a first-time one, so it gets exactly the same gate.
 */
export function SyncSetupFlow({
  provision,
  onCeremonyActiveChange,
  resume,
  invite,
}: {
  provision: (input: { handle: string; passphrase: string; invite: string }) => Promise<SyncSetupOutcome>;
  /**
   * Reports whether this wizard is holding something the user MUST still see,
   * so the surrounding screen can refuse to swap it out.
   *
   * Provisioning opens the sync session as a side effect, which used to make
   * the settings route replace this component with the connected panel while
   * it was one dispatch away from displaying the account card — a card shown
   * exactly once, and the only way back into the account there is. See
   * `isSyncSetupCeremonyActive` and `resolveSyncScreen` for the rule.
   */
  onCeremonyActiveChange?: (isActive: boolean) => void;
  /** Skips the details form and provisions immediately with an already-known handle and passphrase. */
  resume?: { handle: string; passphrase: string };
  /** Omitted when this instance neither wants nor was given an invite — then no invite field is rendered at all. */
  invite?: SyncSetupInvite;
}) {
  const { t, i18n } = useTranslation();
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
  // The invite arrived ready to use, so it starts read-only. Held HERE rather
  // than in the details form, which unmounts during provisioning: a person who
  // pressed "Change" must not find the box locked again on the way back.
  const [isInviteUnlocked, setIsInviteUnlocked] = useState(false);

  // Reported from an effect, never during render — the parent turns this into
  // state, and a render-phase parent update is a React error. Releasing on
  // unmount matters as much as reporting: a wizard that vanished with the flag
  // still set would strand the user on a setup screen forever.
  const isCeremonyActive = isSyncSetupCeremonyActive(state);
  useEffect(() => {
    onCeremonyActiveChange?.(isCeremonyActive);
    return () => onCeremonyActiveChange?.(false);
  }, [isCeremonyActive, onCeremonyActiveChange]);

  /** The provisioning round trip, shared by the form submit and the `resume` entry point. */
  const runProvision = useCallback(
    async (chosen: { handle: string; passphrase: string; invite: string }): Promise<void> => {
      try {
        const outcome = await provision(chosen);
        dispatch({ type: 'setupSucceeded', handle: outcome.handle, recoveryCode: outcome.recoveryCode });
      } catch (error) {
        // The underlying words wherever there are any — "that handle is
        // taken" is worth reading, and a generic failure message would send
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
    void runProvision({ handle: resume.handle, passphrase: resume.passphrase, invite: '' });
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
    // The CANONICAL form goes to the service — NFKC, trimmed, lowercased, the
    // same normalisation the server applies. Sending the raw field would show
    // the user one handle on the account card and register another.
    void runProvision({
      handle: normalizeHandle(submission.value.handle),
      passphrase: submission.value.passphrase,
      invite: submission.value.invite.trim(),
    });
  }

  if (state.kind === 'enter-details') {
    return (
      <DetailsStep
        invite={invite}
        isInviteUnlocked={isInviteUnlocked || isInviteRejected(state.serverError)}
        onUnlockInvite={() => setIsInviteUnlocked(true)}
        lastResult={detailsResult}
        onSuggestHandle={() => suggestHandle(i18n.language)}
        onSubmit={handleDetailsSubmit}
      />
    );
  }
  if (state.kind === 'generating') {
    return <GeneratingStep />;
  }
  if (state.kind === 'show-account-card') {
    return (
      <AccountCardStep
        handle={state.handle}
        recoveryCode={state.recoveryCode}
        hasConfirmedSaved={state.hasConfirmedSaved}
        onConfirmToggle={(checked) => dispatch({ type: 'confirmSavedToggled', checked })}
        onFinish={() => dispatch({ type: 'finishRequested' })}
      />
    );
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
  /** It came from a link, so it needs no action: shown read-only, with a check and a "Change" action. */
  isFromLink: boolean;
  /** This instance refuses signups without one, so an empty box is worth saying so before the round trip. */
  isRequired: boolean;
};

/** The shape `parseWithZod` hands back for this form, and the shape `lastResult` is built from. */
type SyncSignupSubmission = Submission<SyncSignupValues, string[], SyncSignupValues>;

/** A service refusal the person answers by editing the invite, so the box has to be editable again. */
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
  isInviteUnlocked,
  onUnlockInvite,
  lastResult,
  onSuggestHandle,
  onSubmit,
}: {
  invite?: SyncSetupInvite;
  isInviteUnlocked: boolean;
  onUnlockInvite: () => void;
  lastResult: ReturnType<SyncSignupSubmission['reply']> | undefined;
  onSuggestHandle: () => string;
  onSubmit: (submission: SyncSignupSubmission) => void;
}) {
  const { t } = useTranslation();
  // A local mirror ONLY because something else reads the live value: the
  // strength hint paints from it. Conform still owns the field itself (see the
  // input), and this is fed by an `onChange` layered on the spread.
  const [passphrase, setPassphrase] = useState('');

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
    defaultValue: { invite: invite?.initialValue ?? '', handle: '', passphrase: '', confirmPassphrase: '' },
    onSubmit(event, { submission }) {
      // Nothing is posted anywhere: this form's "action" is a browser-side
      // ceremony, and the default navigation would abandon it.
      event.preventDefault();
      if (submission === undefined) return;
      onSubmit(submission);
    },
  });

  // A HINT, never a gate (`passphrase-strength.ts`): the 12-character floor is
  // the only hard rule, and a meter that refuses pushes people towards
  // whatever pattern satisfies it rather than towards length.
  const strength = ratePassphrase(passphrase);
  const strengthId = `${fields.passphrase.id}-strength`;
  const isInviteReadOnly = invite?.isFromLink === true && !isInviteUnlocked;

  return (
    <form {...getFormProps(form)} className="space-y-4">
      {invite !== undefined && (
        <div className="space-y-2">
          <Label htmlFor={fields.invite.id}>{t('sync.create.inviteLabel')}</Label>
          <div className="flex items-center gap-2">
            <Input
              {...getInputProps(fields.invite, { type: 'text' })}
              autoComplete="off"
              spellCheck={false}
              readOnly={isInviteReadOnly}
              className={isInviteReadOnly ? 'h-11 bg-muted text-muted-foreground' : 'h-11'}
            />
            {isInviteReadOnly && (
              <>
                <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="sr-only">{t('sync.create.inviteFromLink')}</span>
                <Button type="button" variant="ghost" className="h-11 shrink-0" onClick={onUnlockInvite}>
                  {t('sync.create.inviteChange')}
                </Button>
              </>
            )}
          </div>
          {/* The "this instance is invite-only" hint is for someone who has to
              find a code. Once one is sitting in the box, ready to use, it is
              an instruction to do something already done. */}
          {!isInviteReadOnly && <p className="text-xs text-muted-foreground">{t('sync.create.inviteHint')}</p>}
          <FieldError id={fields.invite.errorId} errors={fields.invite.errors} />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={fields.handle.id}>{t('sync.handleLabel')}</Label>
        <div className="flex gap-2">
          {/*
            Conform owns this field end to end — `getInputProps` supplies the
            id, the name, the seeded `defaultValue` and the
            `aria-invalid`/`aria-describedby` pair from the SAME metadata
            `FieldError` reads. Presentation-only props go AFTER the spread so
            they aren't clobbered by it. NOT `required`: the field starts empty
            (owner decision, 2026-09-02) and the browser's native popup would
            intercept the submit with untranslated copy before the schema ever
            ran.
          */}
          <Input
            {...getInputProps(fields.handle, { type: 'text' })}
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="none"
            className="h-11 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            // `form.update` rather than a local value: the input is
            // uncontrolled, so rewriting Conform's initialValue is what puts
            // the suggestion in the box AND in the next submission.
            onClick={() => form.update({ name: fields.handle.name, value: onSuggestHandle() })}
            aria-label={t('sync.setup.handleShuffle')}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('sync.handleHint')}</p>
        <FieldError id={fields.handle.errorId} errors={fields.handle.errors} />
      </div>

      <p className="text-sm text-muted-foreground">{t('sync.setup.passphraseIntro')}</p>
      {/* The one place, with the forgot screen, that says what the password
          also does. One string, two call sites: see `sync.passwordNote`. */}
      <p className="text-sm text-muted-foreground">{t('sync.passwordNote')}</p>

      <div className="space-y-2">
        <Label htmlFor={fields.passphrase.id}>{t('sync.setup.passphraseLabel')}</Label>
        <Input
          {...getInputProps(fields.passphrase, { type: 'password', ariaDescribedBy: strengthId })}
          autoComplete="new-password"
          onChange={(event) => setPassphrase(event.target.value)}
          className="h-11"
        />
        <p
          id={strengthId}
          aria-live="polite"
          className={
            passphrase === '' ? 'sr-only'
            : strength === 'strong' ?
              'text-xs text-primary'
            : strength === 'fair' ?
              'text-xs text-accent-amber'
            : 'text-xs text-muted-foreground'
          }
        >
          {passphrase === '' ? '' : t(passphraseStrengthKey(strength))}
        </p>
        <FieldError id={fields.passphrase.errorId} errors={fields.passphrase.errors} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fields.confirmPassphrase.id}>{t('sync.setup.confirmLabel')}</Label>
        <Input
          {...getInputProps(fields.confirmPassphrase, { type: 'password' })}
          autoComplete="new-password"
          className="h-11"
        />
        <FieldError id={fields.confirmPassphrase.errorId} errors={fields.confirmPassphrase.errors} />
      </div>

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

/**
 * THE ACCOUNT CARD: handle and recovery code, together, once, behind one save
 * confirmation.
 *
 * ── Why one card and not two screens ─────────────────────────────────────
 *
 * The failure this guards against is a user who saves the recovery code and
 * never registers that the handle is equally required to get back in. Two
 * screens, or two separate copy-to-clipboard moments, are how that happens:
 * the second value reads as an afterthought. So there is one copy action that
 * takes both, one checkbox, and one sentence saying what losing them costs.
 *
 * EXPORTED so any flow that has to show these values reuses this exact
 * ceremony instead of growing a second, inevitably weaker one.
 */
export function AccountCardStep({
  handle,
  recoveryCode,
  hasConfirmedSaved,
  onConfirmToggle,
  onFinish,
  finishLabel,
}: {
  handle: string;
  recoveryCode: string;
  hasConfirmedSaved: boolean;
  onConfirmToggle: (checked: boolean) => void;
  onFinish: () => void;
  /** Defaults to the first-time-setup wording; another flow passes its own. */
  finishLabel?: string;
}) {
  const { t } = useTranslation();
  const [copyLabel, setCopyLabel] = useState(() => t('sync.setup.copy'));

  async function handleCopy(): Promise<void> {
    try {
      // BOTH values in one clipboard write, labelled. A copy button that took
      // only the code would be the two-moments failure this card exists to
      // prevent, wearing a different hat.
      await navigator.clipboard.writeText(
        `${t('sync.handleLabel')}: ${handle}\n${t('sync.setup.accountCard.codeLabel')}: ${recoveryCode}`,
      );
      setCopyLabel(t('sync.setup.copied'));
      setTimeout(() => setCopyLabel(t('sync.setup.copy')), 2000);
    } catch {
      setCopyLabel(t('sync.setup.copyFailed'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface p-4 text-sm text-accent-amber">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <strong>{t('sync.setup.recoveryWarningLead')}</strong> {t('sync.setup.recoveryWarningBody')}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
        <p className="text-sm font-medium">{t('sync.setup.accountCard.title')}</p>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('sync.handleLabel')}</p>
          <p className="font-mono text-sm tracking-wide">{handle}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('sync.setup.accountCard.codeLabel')}</p>
          <p className="font-mono text-sm tracking-wide">{recoveryCode}</p>
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopy()} className="gap-1">
            <Copy className="h-3.5 w-3.5" /> {copyLabel}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{t('sync.setup.accountCard.bothRequired')}</p>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm">
        <input
          type="checkbox"
          checked={hasConfirmedSaved}
          onChange={(event) => onConfirmToggle(event.target.checked)}
          className="mt-1 accent-primary"
        />
        <span>{t('sync.setup.accountCard.confirmSaved')}</span>
      </label>

      <Button type="button" disabled={!hasConfirmedSaved} onClick={onFinish} className="h-11 w-full">
        <Check className="h-4 w-4" /> {finishLabel ?? t('sync.setup.finish')}
      </Button>
    </div>
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
