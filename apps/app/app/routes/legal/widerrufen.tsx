/**
 * `/widerrufen` — the § 356a BGB electronic withdrawal function (M214/09).
 *
 * ── WHY THIS PAGE EXISTS ───────────────────────────────────────────────────
 *
 * § 356a BGB, in force since 2026-06-19 (Directive (EU) 2023/2673), requires a
 * function labelled exactly `Vertrag widerrufen` and a confirmation button
 * labelled exactly `Widerruf bestätigen`, continuously available, prominently
 * placed, with an immediate confirmation on a durable medium. The title is the
 * `title` of the mounted `widerrufen.md` (M246, `docs/content.md`), and the
 * submit label is `declarations.withdraw.submit` in
 * each locale's `common.json`. Neither is wordsmith's to rephrase. The
 * `/withdrawal` page names this one as the online withdrawal function. On a
 * page in any language but German, one line under the title says what the
 * page does: `declarations.withdraw.subtitle`, drawn by `ContentArticle`
 * (M265 spec 06).
 *
 * ── THE PROSE IS MOUNTED, THE MECHANISM IS HERE ──
 *
 * The lead paragraph and the `unavailable` text come from
 * `<CONTENT_DIR>/<lang>/widerrufen.md`, read in the loader. The form, its
 * labels, its validation and the POST stay in this file. With no content
 * folder the route answers 404, like every content page.
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
 * Same shape as `/kuendigung` beside it: no login, no gate on `plans`, a
 * loader for the prose only and no action. The declaration goes straight from this browser to
 * `openplate-core`'s own origin (`CORE_URL`). `CredentialSubmitButton`
 * is reused for the pre-hydration-GET guard its own doc states generically,
 * not for its name — see `kuendigung.tsx`'s header for the full argument.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { z } from 'zod';

import type { Route } from './+types/widerrufen';
import { ContentArticle, ContentBlocks } from '#app/components/content-article';
import { CredentialSubmitButton } from '#app/components/credential-submit-button';
import { DeclarationSubmitError, ReservedFieldError, type DeclarationFailure } from '#app/components/declaration-form-parts';
import PublicWrapper from '#app/components/public-wrapper';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { loadContentPageOrThrow } from '#app/lib/content/content-route.server';
import { contentPageTitle } from '#app/lib/content/content-page-title';
import { sectionBlocks } from '#app/lib/content/markdown';
import { declarationLanguageFor, submitDeclaration } from '#app/lib/declaration-submit';
import { canonicalizeEmail } from '#app/lib/sync/email';
import '#app/i18n/i18n';

/** SERVER: the page's prose, from the mounted content folder. */
export async function loader({ request }: Route.LoaderArgs) {
  return { page: await loadContentPageOrThrow({ request, slug: 'widerrufen' }) };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: contentPageTitle(loaderData?.page.title ?? null) }];

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

export default function Widerrufen({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;
  const unavailable = sectionBlocks(page, 'unavailable');
  const { t, i18n } = useTranslation();
  const navigate = useAppNavigate();
  const serverUrl = useSyncServerUrl();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<DeclarationFailure | null>(null);

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
    setFailure(null);
    const email = canonicalizeEmail(value.email);
    const outcome = await submitDeclaration({
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
        // The reader's own language, one of the six (2026-09-30). See
        // `declaration-submit.ts` for a core that still takes de and en only.
        language: declarationLanguageFor(i18n.language),
      },
    });
    setIsSubmitting(false);
    if (outcome.status === 'accepted') {
      void navigate('/widerrufen/bestaetigt', {
        state: { receiptId: outcome.receiptId, receivedAt: outcome.receivedAt, email },
      });
      return;
    }
    setFailure(outcome.status);
  }

  return (
    <PublicWrapper>
      <ContentArticle
        title={page.title}
        updated={page.updated}
        language={page.language}
        blocks={page.body}
        subtitleKey="declarations.withdraw.subtitle"
      >
        {serverUrl === null ?
          <ContentBlocks blocks={unavailable} />
        : <form {...getFormProps(form)} className="not-prose mt-8 space-y-6">
            <div className="space-y-2">
              <Label htmlFor={fields.name.id}>{t('declarations.withdraw.nameLabel')}</Label>
              <Input {...getInputProps(fields.name, { type: 'text' })} autoComplete="name" />
              <ReservedFieldError id={fields.name.errorId} errors={fields.name.errors} />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.email.id}>{t('declarations.withdraw.emailLabel')}</Label>
              <Input
                {...getInputProps(fields.email, { type: 'email' })}
                autoComplete="email"
                spellCheck={false}
                autoCapitalize="none"
              />
              <ReservedFieldError id={fields.email.errorId} errors={fields.email.errors} />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.contractReference.id}>{t('declarations.withdraw.contractReferenceLabel')}</Label>
              <Input {...getInputProps(fields.contractReference, { type: 'text' })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.requestedDate.id}>{t('declarations.withdraw.requestedDateLabel')}</Label>
              <Input {...getInputProps(fields.requestedDate, { type: 'date' })} />
            </div>

            <CredentialSubmitButton disabled={isSubmitting} className="h-11 w-full sm:w-auto">
              {t('declarations.withdraw.submit')}
            </CredentialSubmitButton>

            <DeclarationSubmitError failure={failure} unavailable={unavailable} />
          </form>
        }
      </ContentArticle>
    </PublicWrapper>
  );
}
