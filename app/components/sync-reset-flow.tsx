import { useReducer, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, KeyRound, Loader2 } from 'lucide-react';
import {
  canSubmitReset,
  INITIAL_RESET_FLOW_STATE,
  resetFlowReducer,
  resetPreservesData,
} from '#app/lib/sync/reset-flow';
import { validateSyncPassphrase } from '#app/lib/sync/setup-flow';
import { completeSyncReset } from '#app/lib/sync/sync-actions';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';

/**
 * The passphrase-reset fork.
 *
 * ── Why this screen is shaped the way it is ───────────────────────────────
 *
 * Resetting a passphrase restores LOGIN. It does not restore DATA — the server
 * never held a key. Without a recovery code, everything already synced becomes
 * PERMANENTLY undecryptable, by everyone, including us. Nothing about the flow
 * looks destructive from the outside: you forgot a passphrase, you clicked a
 * link in an email, you typed a new one, and you land in a working, empty app.
 *
 * So the question is asked FIRST and cannot be skipped: "do you have your
 * recovery code?" There is no continue button on this screen, only the two
 * answers. Choosing "no" then requires ticking an explicit acknowledgment
 * before anything can be submitted — the same belt-and-braces the setup flow's
 * "I've saved it" checkbox uses, and for the same reason: a user who just
 * wants their app back does not read paragraphs.
 *
 * The state machine and the "may this be submitted" predicate both live in
 * `app/lib/sync/reset-flow.ts`, unit-tested independently of this component
 * (`tests/unit/sync-reset-flow.test.ts`), so the gate cannot be loosened by a
 * styling change.
 */
export function SyncResetFlow({ serverUrl, token }: { serverUrl: string; token: string }) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(resetFlowReducer, INITIAL_RESET_FLOW_STATE);
  const [passphrase, setPassphrase] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [freshRecoveryCode, setFreshRecoveryCode] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmitReset(state)) return;

    const lengthError = validateSyncPassphrase(passphrase, t);
    if (lengthError !== null) {
      dispatch({ type: 'rejected', message: lengthError });
      return;
    }

    const withRecoveryCode = resetPreservesData(state);
    dispatch({ type: 'submitted' });
    try {
      const result = await completeSyncReset({
        serverUrl,
        token,
        newPassphrase: passphrase,
        // The fork, carried through to the one parameter that decides it.
        recoveryCode: withRecoveryCode ? recoveryCode : null,
      });
      setFreshRecoveryCode(result.recoveryCode);
      dispatch({ type: 'succeeded', dataPreserved: result.dataPreserved });
    } catch (error) {
      dispatch({
        type: 'failed',
        message: describeErrorForUser(error, t('sync.reset.failed')),
        hadRecoveryCode: withRecoveryCode,
      });
    }
  }

  if (state.kind === 'asking') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface p-4 text-sm text-accent-amber">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{t('sync.reset.forkWarning')}</p>
        </div>
        <h2 className="text-base font-semibold">{t('sync.reset.forkQuestion')}</h2>
        <div className="flex flex-col gap-2">
          <Button type="button" className="h-11 w-full" onClick={() => dispatch({ type: 'answeredHasRecoveryCode' })}>
            <KeyRound className="h-4 w-4" /> {t('sync.reset.forkYes')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => dispatch({ type: 'answeredNoRecoveryCode' })}
          >
            {t('sync.reset.forkNo')}
          </Button>
        </div>
      </div>
    );
  }

  if (state.kind === 'submitting') {
    return (
      <output className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('sync.reset.working')}
      </output>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => dispatch({ type: 'backToFork' })}
        >
          {t('sync.reset.startOver')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'complete') {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm text-primary">
          <Check className="h-4 w-4" aria-hidden="true" />
          {state.dataPreserved ? t('sync.reset.doneWithData') : t('sync.reset.doneWithoutData')}
        </p>
        {freshRecoveryCode !== null && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('sync.reset.newRecoveryCode')}</p>
            <p className="rounded-lg border bg-muted/30 p-4 font-mono text-sm tracking-wide">{freshRecoveryCode}</p>
          </div>
        )}
      </div>
    );
  }

  const isDestructive = state.kind === 'without-recovery-code';

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      {isDestructive ?
        <div className="space-y-3 rounded-lg border border-accent-amber-border bg-accent-amber-surface p-4 text-sm text-accent-amber">
          <p className="font-medium">{t('sync.reset.noCode.heading')}</p>
          <p>{t('sync.reset.noCode.body')}</p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={state.acknowledgedDataLoss}
              onChange={(event) => dispatch({ type: 'dataLossAcknowledged', acknowledged: event.target.checked })}
              className="mt-1 accent-primary"
            />
            {/* The one sentence the user must consciously accept. */}
            <span>{t('sync.reset.noCode.acknowledgeDataPermanentlyGone')}</span>
          </label>
        </div>
      : <div className="space-y-2">
          <Label htmlFor="sync-recovery-code">{t('sync.reset.recoveryCodeLabel')}</Label>
          <Input
            id="sync-recovery-code"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="h-11 font-mono"
          />
          <p className="text-xs text-muted-foreground">{t('sync.reset.recoveryCodeHint')}</p>
        </div>
      }

      <div className="space-y-2">
        <Label htmlFor="sync-new-passphrase">{t('sync.reset.newPassphraseLabel')}</Label>
        <Input
          id="sync-new-passphrase"
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="h-11"
        />
      </div>

      {state.error !== null && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          variant={isDestructive ? 'destructive' : 'default'}
          className="h-11 w-full"
          disabled={!canSubmitReset(state)}
        >
          {isDestructive ? t('sync.reset.submitWithoutData') : t('sync.reset.submitWithData')}
        </Button>
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => dispatch({ type: 'backToFork' })}>
          {t('sync.reset.back')}
        </Button>
      </div>
    </form>
  );
}
