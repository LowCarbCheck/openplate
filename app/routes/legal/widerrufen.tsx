/**
 * `/widerrufen` — the § 356a BGB electronic withdrawal function (M214/09).
 *
 * ── WHY THIS PAGE EXISTS ───────────────────────────────────────────────────
 *
 * § 356a BGB, in force since 2026-06-19 (Directive (EU) 2023/2673), requires a
 * function labelled exactly `Vertrag widerrufen` and a confirmation button
 * labelled exactly `Widerruf bestätigen`, continuously available, prominently
 * placed, with an immediate confirmation on a durable medium. Both labels are
 * pinned byte for byte in `app/i18n/locales/de/legal.json` — see
 * `declarations.withdraw.title` and `declarations.withdraw.submit` — and are
 * NOT wordsmith's to rephrase, in either language bundle. `withdrawal.tsx`'s
 * Gestaltungshinweis 3 names this page as the "online withdrawal function"
 * the model text now discloses.
 *
 * ── NO REASON FIELD ────────────────────────────────────────────────────────
 *
 * Unlike `/kuendigung`, a withdrawal needs no reason under § 355 BGB: the
 * right is unconditional within the withdrawal period. This form asks only
 * for what the model Widerrufsformular itself asks for, plus the optional
 * contract reference already offered on the cancellation button.
 *
 * ── PUBLIC, UNAUTHENTICATED, ALWAYS REGISTERED, CLIENT-ONLY ───────────────
 *
 * Same shape as `/kuendigung` beside it — no login, no gate on `plans`, no
 * loader or action: the declaration goes straight from this browser to
 * `openplate-core`'s own origin (`SYNC_SERVER_URL`). `CredentialSubmitButton`
 * is reused for the pre-hydration-GET guard its own doc states generically,
 * not for its name — see `kuendigung.tsx`'s header for the full argument.
 */
import { useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { z } from 'zod';

import { CredentialSubmitButton } from '#app/components/credential-submit-button';
import { FieldError } from '#app/components/field-error';
import { H1, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { createComponentLogger } from '#app/lib/logger';
import { checkoutLocaleFor } from '#app/lib/plans/plans-door';
import { canonicalizeEmail } from '#app/lib/sync/email';
import '#app/i18n/i18n';

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.widerrufen') }];

const log = createComponentLogger('widerrufen');

/** Where a browser posts a declaration — `openplate-core`'s own origin, never this server. */
const DECLARATIONS_API_PATH = '/v1/legal/declarations';

/** Duplicated per module by this repo's own convention — see `app/lib/sync/setup-flow.ts`. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

function makeWithdrawDeclarationSchema(t: Translate) {
  return z
    .object({
      name: z.string().default(''),
      email: z.email(t('declarations.errors.emailInvalid')),
      contractReference: z.string().default(''),
      requestedDate: z.string().default(''),
    })
    .superRefine((value, ctx) => {
      if (value.name.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['name'], message: t('declarations.errors.nameRequired') });
      }
    });
}

type WithdrawDeclarationValues = z.infer<ReturnType<typeof makeWithdrawDeclarationSchema>>;

/** The server's 202 body — `PROTOCOL.md`-style: parsed, never trusted. */
const acceptedResponseSchema = z.object({
  receiptId: z.string().min(1),
  receivedAt: z.string().min(1),
  kind: z.literal('widerruf'),
});

type DeclarationOutcome =
  | { status: 'accepted'; receiptId: string; receivedAt: string }
  | { status: 'invalid' }
  | { status: 'rate-limited' }
  | { status: 'unreachable' };

/**
 * One POST, three outcomes an unreachable core can produce, and one it
 * cannot: a SHAPE MISMATCH on the 202 body is logged and folded into
 * `unreachable` rather than thrown past this page's boundary — the one thing
 * this button may never do is claim a receipt it cannot show.
 */
async function submitWithdrawDeclaration(input: {
  serverUrl: string;
  request: Record<string, string | null>;
}): Promise<DeclarationOutcome> {
  let response: Response;
  try {
    response = await fetch(`${input.serverUrl}${DECLARATIONS_API_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.request),
    });
  } catch (error) {
    log.error('the declarations endpoint could not be reached', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'unreachable' };
  }
  if (response.status === 202) {
    const parsed = acceptedResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      log.error('a 202 declaration response did not match its schema');
      return { status: 'unreachable' };
    }
    return { status: 'accepted', receiptId: parsed.data.receiptId, receivedAt: parsed.data.receivedAt };
  }
  if (response.status === 400) return { status: 'invalid' };
  if (response.status === 429) return { status: 'rate-limited' };
  return { status: 'unreachable' };
}

export default function Widerrufen() {
  const { t, i18n } = useTranslation('legal');
  const navigate = useAppNavigate();
  const serverUrl = useSyncServerUrl();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [form, fields] = useForm({
    id: 'widerrufen-form',
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeWithdrawDeclarationSchema(t) });
    },
    shouldRevalidate: 'onInput',
    defaultValue: { name: '', email: '', contractReference: '', requestedDate: '' },
    onSubmit(event, { submission }) {
      // Client-side only: the request goes to openplate-core's own origin,
      // and the default navigation would abandon it.
      event.preventDefault();
      if (submission?.status !== 'success' || serverUrl === null) return;
      void submitForm(submission.value);
    },
  });

  async function submitForm(value: WithdrawDeclarationValues): Promise<void> {
    if (serverUrl === null) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const email = canonicalizeEmail(value.email);
    const outcome = await submitWithdrawDeclaration({
      serverUrl,
      request: {
        kind: 'widerruf',
        name: value.name.trim(),
        email,
        contractReference: value.contractReference.trim() === '' ? null : value.contractReference.trim(),
        terminationType: null,
        reason: null,
        requestedDate: value.requestedDate.trim() === '' ? null : value.requestedDate.trim(),
        timing: null,
        language: checkoutLocaleFor(i18n.language),
      },
    });
    setIsSubmitting(false);
    if (outcome.status === 'accepted') {
      void navigate('/widerrufen/bestaetigt', {
        state: { receiptId: outcome.receiptId, receivedAt: outcome.receivedAt, email },
      });
      return;
    }
    if (outcome.status === 'invalid') {
      setSubmitError(t('declarations.errors.invalid'));
      return;
    }
    if (outcome.status === 'rate-limited') {
      setSubmitError(t('declarations.errors.rateLimited'));
      return;
    }
    setSubmitError(t('declarations.errors.unreachable'));
  }

  return (
    <PublicWrapper>
      <article className="font-prose prose prose-zinc dark:prose-invert max-w-none">
        <H1 variant="default" className="mb-8">
          {t('declarations.withdraw.title')}
        </H1>
        <P variant="lead" className="mb-8">
          {t('declarations.withdraw.intro')}
        </P>

        {serverUrl === null ?
          <P>{t('declarations.errors.unreachable')}</P>
        : <form {...getFormProps(form)} className="not-prose space-y-6">
            <div className="space-y-2">
              <Label htmlFor={fields.name.id}>{t('declarations.withdraw.nameLabel')}</Label>
              <Input {...getInputProps(fields.name, { type: 'text' })} autoComplete="name" />
              <FieldError id={fields.name.errorId} errors={fields.name.errors} />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.email.id}>{t('declarations.withdraw.emailLabel')}</Label>
              <Input
                {...getInputProps(fields.email, { type: 'email' })}
                autoComplete="email"
                spellCheck={false}
                autoCapitalize="none"
              />
              <FieldError id={fields.email.errorId} errors={fields.email.errors} />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.contractReference.id}>{t('declarations.withdraw.contractReferenceLabel')}</Label>
              <Input {...getInputProps(fields.contractReference, { type: 'text' })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.requestedDate.id}>{t('declarations.withdraw.requestedDateLabel')}</Label>
              <Input {...getInputProps(fields.requestedDate, { type: 'date' })} />
            </div>

            {submitError !== null && <P className="text-sm text-red-600 dark:text-red-400">{submitError}</P>}

            <CredentialSubmitButton disabled={isSubmitting} className="h-11 w-full sm:w-auto">
              {t('declarations.withdraw.submit')}
            </CredentialSubmitButton>
          </form>
        }
      </article>
    </PublicWrapper>
  );
}
