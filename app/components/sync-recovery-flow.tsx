import { useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { canSubmitRecovery, INITIAL_RECOVERY_FLOW_STATE, recoveryFlowReducer } from '#app/lib/sync/recovery-flow';
import { makeSyncRecoverySchema, type SyncRecoveryValues } from '#app/lib/sync/recovery-schema';
import { classifyRecoveryFailure } from '#app/lib/sync/sign-in-error';
import { recoverSyncAccount } from '#app/lib/sync/sync-actions';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { FieldError } from '#app/components/field-error';
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
 * component, so the gate cannot be loosened by a styling change. What the
 * three FIELDS must contain is a Zod schema instead
 * (`app/lib/sync/recovery-schema.ts`), driven through Conform so each broken
 * rule renders under the field that broke it rather than as one sentence above
 * the button (owner request, 2026-09-02).
 *
 * The service's own refusal stays on its own screen: it is a `401` that
 * deliberately will not say WHICH of the two secrets was wrong, so it belongs
 * to the form rather than to a field.
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
  // The values are needed again after a failed attempt (the form remounts on
  // "try again"), so they are mirrored here rather than left inside a form
  // that no longer exists. Nothing is written to storage: two of the three are
  // secrets.
  const [draft, setDraft] = useState<SyncRecoveryValues>({
    handle: initialHandle,
    recoveryCode: '',
    passphrase: '',
  });

  async function handleSubmit(values: SyncRecoveryValues): Promise<void> {
    if (!canSubmitRecovery(state)) return;
    setDraft(values);
    dispatch({ type: 'submitted' });
    try {
      await recoverSyncAccount({
        serverUrl,
        handle: values.handle.trim(),
        recoveryCode: values.recoveryCode,
        newPassphrase: values.passphrase,
      });
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

  return <RecoveryForm draft={draft} onSubmit={(values) => void handleSubmit(values)} onCancel={onCancel} />;
}

function RecoveryForm({
  draft,
  onSubmit,
  onCancel,
}: {
  draft: SyncRecoveryValues;
  onSubmit: (values: SyncRecoveryValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [form, fields] = useForm({
    id: 'sync-recover',
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeSyncRecoverySchema(t) });
    },
    // Nothing red before the person asks for it, but a corrected field clears
    // its own error as it is typed. See `.claude/conform-to-react.md`.
    shouldRevalidate: 'onInput',
    defaultValue: draft,
    onSubmit(event, { submission }) {
      // Client-side ceremony, no action to post to: the default navigation
      // would abandon it.
      event.preventDefault();
      if (submission?.status !== 'success') return;
      onSubmit(submission.value);
    },
  });

  return (
    <form {...getFormProps(form)} className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface p-4 text-sm text-accent-amber">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{t('sync.recover.intro')}</p>
      </div>

      {/* The same sentence the create screen shows, and the only other place
          the password is explained. */}
      <div className="text-sm text-muted-foreground">
        <p>{t('sync.passwordNote')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fields.handle.id}>{t('sync.handleLabel')}</Label>
        <Input
          {...getInputProps(fields.handle, { type: 'text' })}
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="none"
          className="h-11 font-mono"
        />
        <FieldError id={fields.handle.errorId} errors={fields.handle.errors} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fields.recoveryCode.id}>{t('sync.recover.codeLabel')}</Label>
        <Input
          {...getInputProps(fields.recoveryCode, { type: 'text' })}
          autoComplete="off"
          spellCheck={false}
          className="h-11 font-mono"
        />
        <p className="text-xs text-muted-foreground">{t('sync.recover.codeHint')}</p>
        <FieldError id={fields.recoveryCode.errorId} errors={fields.recoveryCode.errors} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={fields.passphrase.id}>{t('sync.recover.newPassphraseLabel')}</Label>
        <Input
          {...getInputProps(fields.passphrase, { type: 'password' })}
          autoComplete="new-password"
          className="h-11"
        />
        <FieldError id={fields.passphrase.errorId} errors={fields.passphrase.errors} />
      </div>

      <FieldError id={form.errorId} errors={form.errors} />

      <div className="flex flex-col gap-2">
        <Button type="submit" className="h-11 w-full">
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
