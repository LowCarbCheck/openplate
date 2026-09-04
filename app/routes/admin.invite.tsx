/**
 * `/admin/invite` — one address, and the three things that ride with it.
 *
 * ── Why this is a page and not a dialog on the console ───────────────────
 *
 * Its RESULT is the reason. On an instance with mail the answer is one
 * sentence, but on one without, the answer is a link that must be read,
 * copied, and understood as a credential before it is sent anywhere. That does
 * not belong in a box somebody dismisses with the escape key.
 *
 * ── The defaults are the whole design ────────────────────────────────────
 *
 * Type an address, press the button. The name is optional, the role is
 * standard, the allowance and the expiry are prefilled with values that suit
 * the ordinary case. An administrator inviting their fifth colleague should
 * not have to make four decisions again.
 *
 * ── Client-only, like every account screen ───────────────────────────────
 *
 * The loader answers "does this instance have a server" and nothing else. The
 * invitation is created by the browser against that server, so this app's own
 * server never holds an administrator's token and never sees an invitation
 * link.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getFormProps, getInputProps, getSelectProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { Loader2 } from 'lucide-react';

import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { InviteResult } from '#app/components/admin/invite-result';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import {
  DEFAULT_INVITE_ALLOWANCE,
  DEFAULT_INVITE_EXPIRY_DAYS,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_INVITE_EXPIRY_DAYS,
  makeInviteSchema,
  type InviteFormValues,
} from '#app/lib/admin/invite-schema';
import { canonicalizeEmail } from '#app/lib/sync/email';
import type { Delivery } from '#app/lib/admin/admin-wire';
import { isSyncRequestError } from '#app/lib/sync/engine/client/sync-error';

/** What the page is doing. `sent` carries the answer the result card needs and nothing else. */
type InviteState =
  { kind: 'form' } | { kind: 'working' } | { kind: 'forbidden' } | { kind: 'sent'; email: string; delivery: Delivery };

export default function AdminInvite() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<InviteState>({ kind: 'form' });
  const [failure, setFailure] = useState<string | null>(null);

  const [form, fields] = useForm({
    id: 'admin-invite',
    defaultValue: {
      email: '',
      displayName: '',
      role: 'member',
      dailyAiLimit: String(DEFAULT_INVITE_ALLOWANCE),
      expiresInDays: String(DEFAULT_INVITE_EXPIRY_DAYS),
    },
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeInviteSchema(t) });
    },
    shouldRevalidate: 'onInput',
    onSubmit(event, { submission }) {
      event.preventDefault();
      if (submission?.status !== 'success') return;
      void send(submission.value);
    },
  });

  async function send(values: InviteFormValues): Promise<void> {
    const client = currentAdminClient();
    if (client === null) {
      setState({ kind: 'forbidden' });
      return;
    }
    setState({ kind: 'working' });
    setFailure(null);
    // CANONICALISED HERE, so the address in the result card is the one the
    // service stored. Showing what was typed would tell an administrator they
    // invited `Anna@Example.ORG` when the account is `anna@example.org`.
    const email = canonicalizeEmail(values.email);
    const displayName = values.displayName.trim();
    try {
      const outcome = await client.createInvite({
        email,
        displayName: displayName === '' ? null : displayName,
        role: values.role,
        dailyAiLimit: values.dailyAiLimit,
        expiresInDays: values.expiresInDays,
      });
      if (outcome.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      setState({ kind: 'sent', email, delivery: { emailed: outcome.value.emailed, link: outcome.value.link } });
    } catch (error) {
      // A `409` is the one failure with a useful sentence: this address already
      // has an account, so the person does not need an invitation, they need
      // to sign in. Everything else is the same "it did not go through".
      const alreadyHere = isSyncRequestError(error) && error.kind === 'conflict';
      setFailure(alreadyHere ? t('admin.invite.exists', { email }) : t('admin.invite.failed'));
      setState({ kind: 'form' });
    }
  }

  if (state.kind === 'forbidden') return <NotAnAdministratorCard />;

  if (state.kind === 'sent') {
    return (
      <InviteResult
        email={state.email}
        delivery={state.delivery}
        onInviteAnother={() => {
          setState({ kind: 'form' });
          setFailure(null);
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.invite.title')}</CardTitle>
        <CardDescription>{t('admin.invite.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form {...getFormProps(form)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={fields.email.id}>{t('admin.invite.emailLabel')}</Label>
            <Input {...getInputProps(fields.email, { type: 'email' })} autoComplete="off" className="h-11" />
            {fields.email.errors !== undefined && (
              <p className="text-sm text-red-600 dark:text-red-400">{fields.email.errors}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={fields.displayName.id}>{t('admin.invite.nameLabel')}</Label>
            <Input
              {...getInputProps(fields.displayName, { type: 'text' })}
              autoComplete="off"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">{t('admin.invite.nameHint')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={fields.role.id}>{t('admin.role.label')}</Label>
              <select
                {...getSelectProps(fields.role)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="member">{t('admin.role.standard')}</option>
                <option value="admin">{t('admin.role.admin')}</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.dailyAiLimit.id}>{t('admin.invite.allowanceLabel')}</Label>
              <Input {...getInputProps(fields.dailyAiLimit, { type: 'number' })} min={0} step={1} className="h-11" />
              <p className="text-xs text-muted-foreground">{t('admin.invite.allowanceHint')}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={fields.expiresInDays.id}>{t('admin.invite.expiryLabel')}</Label>
            <Input
              {...getInputProps(fields.expiresInDays, { type: 'number' })}
              min={1}
              max={MAX_INVITE_EXPIRY_DAYS}
              step={1}
              className="h-11 sm:max-w-[10rem]"
            />
            <p className="text-xs text-muted-foreground">{t('admin.invite.expiryHint')}</p>
            {fields.expiresInDays.errors !== undefined && (
              <p className="text-sm text-red-600 dark:text-red-400">{fields.expiresInDays.errors}</p>
            )}
          </div>

          {failure !== null && <p className="text-sm text-red-600 dark:text-red-400">{failure}</p>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="h-11" disabled={state.kind === 'working'}>
              {state.kind === 'working' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {state.kind === 'working' ? t('admin.invite.sending') : t('admin.invite.submit')}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => void navigate('/admin')}>
              {t('admin.invite.back')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
