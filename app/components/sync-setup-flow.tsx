import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, Loader2, Mail } from 'lucide-react';
import {
  initialSyncSetupState,
  isSyncSetupCeremonyActive,
  syncSetupReducer,
  validateSyncPassphrase,
  type SyncSetupOutcome,
} from '#app/lib/sync/setup-flow';
import { passphraseStrengthKey, ratePassphrase } from '#app/lib/sync/passphrase-strength';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';

/**
 * The sync-setup CEREMONY: passphrase entry -> an UNMISSABLE recovery-code
 * loss warning -> a confirm-saved gate before setup can complete.
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
 * `error` branch — nothing is swallowed, because a setup that silently half-
 * completed is the one state a user cannot recover from without support. It
 * may however RESOLVE with `awaiting-email-verification`, which is a designed
 * outcome rather than a failure and gets its own calm screen (see
 * `SyncSetupOutcome`).
 *
 * `resume` is the setup-COMPLETION entry point: an account that exists with no
 * key records, reached from the sign-in form where the passphrase has already
 * been typed. The wizard then opens straight into provisioning and runs the
 * identical recovery-code ceremony — the code it produces is exactly as
 * unrecoverable as a first-time one, so it gets exactly the same gate.
 */
export function SyncSetupFlow({
  provision,
  onCeremonyActiveChange,
  resume,
}: {
  provision: (input: { passphrase: string }) => Promise<SyncSetupOutcome>;
  /**
   * Reports whether this wizard is holding something the user MUST still see,
   * so the surrounding screen can refuse to swap it out.
   *
   * Provisioning opens the sync session as a side effect, which used to make
   * the settings route replace this component with the connected panel while
   * it was one dispatch away from displaying the recovery code — a code shown
   * exactly once, and the only data-preserving recovery path there is. See
   * `isSyncSetupCeremonyActive` and `resolveSyncScreen` for the rule.
   */
  onCeremonyActiveChange?: (isActive: boolean) => void;
  /** Skips passphrase entry and provisions immediately with an already-collected passphrase. */
  resume?: { passphrase: string };
}) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(syncSetupReducer, { resume: resume !== undefined }, initialSyncSetupState);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

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
    async (chosenPassphrase: string): Promise<void> => {
      try {
        const outcome = await provision({ passphrase: chosenPassphrase });
        if (outcome.status === 'awaiting-email-verification') {
          dispatch({ type: 'verificationRequired', email: outcome.email });
          return;
        }
        dispatch({ type: 'setupSucceeded', recoveryCode: outcome.recoveryCode });
      } catch (error) {
        // The underlying words wherever there are any — "an account already
        // exists for this address" is worth reading, and a generic failure
        // message would send the user round the same loop. `describeErrorForUser`
        // rather than an `instanceof Error` check: WebCrypto rejects with a
        // DOMException, and this step is where one is most likely to surface.
        dispatch({ type: 'setupFailed', message: describeErrorForUser(error, t('sync.setup.setupFailed')) });
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
    void runProvision(resume.passphrase);
  }, [resume, runProvision]);

  async function handlePassphraseSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // The reducer stores already-translated text: messages are produced here,
    // where a `t` exists, rather than as keys resolved at render time.
    const lengthError = validateSyncPassphrase(passphrase, t);
    if (lengthError) {
      dispatch({ type: 'passphraseRejected', message: lengthError });
      return;
    }
    if (passphrase !== confirmPassphrase) {
      dispatch({ type: 'passphraseRejected', message: t('sync.setup.passphraseMismatch') });
      return;
    }

    dispatch({ type: 'passphraseSubmitted' });
    await runProvision(passphrase);
  }

  if (state.kind === 'enter-passphrase') {
    return (
      <PassphraseStep
        passphrase={passphrase}
        confirmPassphrase={confirmPassphrase}
        error={state.error}
        onPassphraseChange={setPassphrase}
        onConfirmPassphraseChange={setConfirmPassphrase}
        onSubmit={handlePassphraseSubmit}
      />
    );
  }
  if (state.kind === 'generating') {
    return <GeneratingStep />;
  }
  if (state.kind === 'show-recovery-code') {
    return (
      <RecoveryCodeStep
        recoveryCode={state.recoveryCode}
        hasConfirmedSaved={state.hasConfirmedSaved}
        onConfirmToggle={(checked) => dispatch({ type: 'confirmSavedToggled', checked })}
        onFinish={() => dispatch({ type: 'finishRequested' })}
      />
    );
  }
  if (state.kind === 'awaiting-email-verification') {
    return <AwaitingVerificationStep email={state.email} />;
  }
  if (state.kind === 'error') {
    return <ErrorStep message={state.message} onRetry={() => dispatch({ type: 'retried' })} />;
  }
  return <CompleteStep />;
}

function PassphraseStep({
  passphrase,
  confirmPassphrase,
  error,
  onPassphraseChange,
  onConfirmPassphraseChange,
  onSubmit,
}: {
  passphrase: string;
  confirmPassphrase: string;
  error: string | null;
  onPassphraseChange: (value: string) => void;
  onConfirmPassphraseChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  // A HINT, never a gate (`passphrase-strength.ts`): the 12-character floor is
  // the only hard rule, and a meter that refuses pushes people towards
  // whatever pattern satisfies it rather than towards length.
  const strength = ratePassphrase(passphrase);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('sync.setup.passphraseIntro')}</p>
      <div className="space-y-2">
        <Label htmlFor="sync-passphrase">{t('sync.setup.passphraseLabel')}</Label>
        <Input
          id="sync-passphrase"
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(event) => onPassphraseChange(event.target.value)}
          className="h-11"
          aria-describedby="sync-passphrase-strength"
        />
        <p
          id="sync-passphrase-strength"
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
      </div>
      <div className="space-y-2">
        <Label htmlFor="sync-passphrase-confirm">{t('sync.setup.confirmLabel')}</Label>
        <Input
          id="sync-passphrase-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassphrase}
          onChange={(event) => onConfirmPassphraseChange(event.target.value)}
          className="h-11"
        />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
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
 * The account exists; this instance wants the address confirmed before it
 * hands out a session.
 *
 * Deliberately NOT an error screen. Nothing went wrong, nothing was lost, and
 * the user's next move is in their inbox — so this reads as an instruction,
 * not a fault. It also says plainly that the recovery code comes later, because
 * the first-time-setup copy has already promised one and its absence here would
 * otherwise look like the step that failed.
 */
function AwaitingVerificationStep({ email }: { email: string }) {
  const { t } = useTranslation();

  return (
    <output className="block space-y-3">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-4 text-sm">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">{t('sync.setup.awaitingVerification.title')}</p>
          <p className="text-muted-foreground">{t('sync.setup.awaitingVerification.body', { email })}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('sync.setup.awaitingVerification.note')}</p>
    </output>
  );
}

/**
 * The recovery-code display and its "I've saved this" gate.
 *
 * EXPORTED so the "replace my recovery code" flow reuses this exact ceremony
 * instead of growing a second, inevitably weaker one. A code shown once with
 * an unmissable warning in one place and casually in another is the same bug
 * twice.
 */
export function RecoveryCodeStep({
  recoveryCode,
  hasConfirmedSaved,
  onConfirmToggle,
  onFinish,
  finishLabel,
}: {
  recoveryCode: string;
  hasConfirmedSaved: boolean;
  onConfirmToggle: (checked: boolean) => void;
  onFinish: () => void;
  /** Defaults to the first-time-setup wording; the rotation flow passes its own. */
  finishLabel?: string;
}) {
  const { t } = useTranslation();
  const [copyLabel, setCopyLabel] = useState(() => t('sync.setup.copy'));

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(recoveryCode);
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

      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-4 font-mono text-sm tracking-wide">
        <span>{recoveryCode}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopy()} className="shrink-0 gap-1">
          <Copy className="h-3.5 w-3.5" /> {copyLabel}
        </Button>
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm">
        <input
          type="checkbox"
          checked={hasConfirmedSaved}
          onChange={(event) => onConfirmToggle(event.target.checked)}
          className="mt-1 accent-primary"
        />
        <span>{t('sync.setup.confirmSaved')}</span>
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
