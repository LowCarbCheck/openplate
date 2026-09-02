import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import {
  initialSyncSetupState,
  isSyncSetupCeremonyActive,
  syncSetupReducer,
  validateSyncPassphrase,
  type SyncSetupOutcome,
  type Translate,
} from '#app/lib/sync/setup-flow';
import { findHandleProblem, generateHandle, normalizeHandle } from '#app/lib/sync/handle';
import { passphraseStrengthKey, ratePassphrase } from '#app/lib/sync/passphrase-strength';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';

/**
 * The sync-setup CEREMONY: handle and passphrase entry -> the ACCOUNT CARD,
 * with an unmissable loss warning -> a confirm-saved gate before setup can
 * complete.
 *
 * THE HANDLE IS MINTED HERE, not typed. `generateHandle` produces a short
 * Crockford-base32 name on first render and the field stays editable, which is
 * also where the `@` rule becomes visible: the same check the service enforces
 * runs locally (`handle.ts`), so a person who types their email address is
 * told immediately rather than after a round trip.
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
 * completed is the one state a user cannot recover from without support.
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
}: {
  provision: (input: { handle: string; passphrase: string }) => Promise<SyncSetupOutcome>;
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
}) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(syncSetupReducer, { resume: resume !== undefined }, initialSyncSetupState);
  // Minted once, on first render, and then owned by the field. A `useState`
  // initialiser rather than an effect: the value must exist for the first
  // paint, and re-minting it on a re-render would move the handle under a user
  // who is halfway through editing it.
  const [handle, setHandle] = useState(generateHandle);
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
    async (chosen: { handle: string; passphrase: string }): Promise<void> => {
      try {
        const outcome = await provision(chosen);
        dispatch({ type: 'setupSucceeded', handle: outcome.handle, recoveryCode: outcome.recoveryCode });
      } catch (error) {
        // The underlying words wherever there are any — "that handle is
        // taken" is worth reading, and a generic failure message would send
        // the user round the same loop. `describeErrorForUser` rather than an
        // `instanceof Error` check: WebCrypto rejects with a DOMException, and
        // this step is where one is most likely to surface.
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
    void runProvision({ handle: resume.handle, passphrase: resume.passphrase });
  }, [resume, runProvision]);

  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // The reducer stores already-translated text: messages are produced here,
    // where a `t` exists, rather than as keys resolved at render time.
    const handleError = describeHandleProblem(handle, t);
    if (handleError !== null) {
      dispatch({ type: 'detailsRejected', message: handleError });
      return;
    }
    const lengthError = validateSyncPassphrase(passphrase, t);
    if (lengthError) {
      dispatch({ type: 'detailsRejected', message: lengthError });
      return;
    }
    if (passphrase !== confirmPassphrase) {
      dispatch({ type: 'detailsRejected', message: t('sync.setup.passphraseMismatch') });
      return;
    }

    dispatch({ type: 'detailsSubmitted' });
    // The CANONICAL form goes to the service — NFKC, trimmed, lowercased, the
    // same normalisation the server applies. Sending the raw field would show
    // the user one handle on the account card and register another.
    await runProvision({ handle: normalizeHandle(handle), passphrase });
  }

  if (state.kind === 'enter-details') {
    return (
      <DetailsStep
        handle={handle}
        passphrase={passphrase}
        confirmPassphrase={confirmPassphrase}
        error={state.error}
        onHandleChange={setHandle}
        onRegenerateHandle={() => setHandle(generateHandle())}
        onPassphraseChange={setPassphrase}
        onConfirmPassphraseChange={setConfirmPassphrase}
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

/**
 * Turns a refused handle into the sentence that names the rule.
 *
 * Three cases, three sentences: "a handle is not an email address" is the one
 * that has to be unmistakable, because typing an address into this box is the
 * single most likely mistake a person arriving from any other service makes.
 */
export function describeHandleProblem(candidate: string, t: Translate): string | null {
  const problem = findHandleProblem(candidate);
  if (problem === null) return null;
  if (problem === 'email-shaped') return t('sync.setup.handleNotAnEmail');
  if (problem === 'too-long') return t('sync.setup.handleTooLong');
  return t('sync.setup.handleRequired');
}

function DetailsStep({
  handle,
  passphrase,
  confirmPassphrase,
  error,
  onHandleChange,
  onRegenerateHandle,
  onPassphraseChange,
  onConfirmPassphraseChange,
  onSubmit,
}: {
  handle: string;
  passphrase: string;
  confirmPassphrase: string;
  error: string | null;
  onHandleChange: (value: string) => void;
  onRegenerateHandle: () => void;
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
      <div className="space-y-2">
        <Label htmlFor="sync-handle">{t('sync.handleLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id="sync-handle"
            type="text"
            required
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="none"
            value={handle}
            onChange={(event) => onHandleChange(event.target.value)}
            className="h-11 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={onRegenerateHandle}
            aria-label={t('sync.setup.handleShuffle')}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('sync.handleHint')}</p>
      </div>
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
