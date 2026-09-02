import { useReducer, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { canSubmitRecovery, INITIAL_RECOVERY_FLOW_STATE, recoveryFlowReducer } from '#app/lib/sync/recovery-flow';
import { validateSyncPassphrase } from '#app/lib/sync/setup-flow';
import { classifyRecoveryFailure } from '#app/lib/sync/sign-in-error';
import { recoverSyncAccount } from '#app/lib/sync/sync-actions';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';

/**
 * "I have forgotten my passphrase" — handle plus recovery code, ending in a
 * new passphrase.
 *
 * ── Why this screen has no fork ──────────────────────────────────────────
 *
 * Its predecessor asked "do you have your recovery code?" and let the answer
 * be no, because a mailed reset restored LOGIN while leaving every synced byte
 * undecryptable. That endpoint is gone (M181): the code is now the second
 * AUTHENTICATOR, so without it there is nothing to submit and no branch to
 * gate. What replaces the fork is a plain statement, above the form, that
 * losing both secrets ends the account — said before the user starts hunting
 * for a door that does not exist.
 *
 * The state machine and its "may this be submitted" predicate live in
 * `app/lib/sync/recovery-flow.ts`, unit-tested independently of this
 * component, so the gate cannot be loosened by a styling change.
 */
export function SyncRecoveryFlow({
  serverUrl,
  initialHandle,
  onCancel,
}: {
  serverUrl: string;
  /** The device's account hint, so a returning user does not retype a handle this device already knows. */
  initialHandle: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(recoveryFlowReducer, INITIAL_RECOVERY_FLOW_STATE);
  const [handle, setHandle] = useState(initialHandle);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [passphrase, setPassphrase] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmitRecovery(state)) return;

    const lengthError = validateSyncPassphrase(passphrase, t);
    if (lengthError !== null) {
      dispatch({ type: 'rejected', message: lengthError });
      return;
    }

    dispatch({ type: 'submitted' });
    try {
      await recoverSyncAccount({ serverUrl, handle: handle.trim(), recoveryCode, newPassphrase: passphrase });
      dispatch({ type: 'succeeded' });
    } catch (error) {
      dispatch({ type: 'failed', message: describeRecoveryError(error, t) });
    }
  }

  if (state.kind === 'submitting') {
    return (
      <output className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('sync.recover.working')}
      </output>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => dispatch({ type: 'retried' })}>
          {t('sync.recover.tryAgain')}
        </Button>
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
          {t('sync.cancel')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'complete') {
    return (
      <p className="flex items-center gap-2 text-sm text-primary">
        <Check className="h-4 w-4" aria-hidden="true" />
        {t('sync.recover.done')}
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface p-4 text-sm text-accent-amber">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{t('sync.recover.intro')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sync-recover-handle">{t('sync.handleLabel')}</Label>
        <Input
          id="sync-recover-handle"
          type="text"
          required
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="none"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          className="h-11 font-mono"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sync-recover-code">{t('sync.recover.codeLabel')}</Label>
        <Input
          id="sync-recover-code"
          required
          autoComplete="off"
          spellCheck={false}
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
          className="h-11 font-mono"
        />
        <p className="text-xs text-muted-foreground">{t('sync.recover.codeHint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sync-recover-passphrase">{t('sync.recover.newPassphraseLabel')}</Label>
        <Input
          id="sync-recover-passphrase"
          type="password"
          required
          autoComplete="new-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="h-11"
        />
      </div>

      {state.error !== null && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <div className="flex flex-col gap-2">
        <Button type="submit" className="h-11 w-full" disabled={!canSubmitRecovery(state)}>
          {t('sync.recover.submit')}
        </Button>
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
          {t('sync.cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Turns a recovery failure into copy the user can act on.
 *
 * The `401` is the one that matters: the service answers it identically for an
 * unknown handle, an account that never set a code, a wrong code, and a lost
 * rotation race — deliberately, so the form cannot be used to find out which.
 * Showing the service's own English sentence would be the same mistake in the
 * other direction (`PROTOCOL.md` §4: branch on the status, never the prose).
 */
function describeRecoveryError(cause: unknown, t: (key: string) => string): string {
  if (classifyRecoveryFailure(cause) === 'rejected') return t('sync.recover.rejected');
  return describeErrorForUser(cause, t('sync.recover.failed'));
}
