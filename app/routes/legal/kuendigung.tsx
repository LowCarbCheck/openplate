/**
 * `/kuendigung` — the § 312k BGB cancellation button (M214/09).
 *
 * ── WHY THIS PAGE EXISTS ───────────────────────────────────────────────────
 *
 * § 312k BGB requires a cancellation button labelled exactly `Verträge hier
 * kündigen`, carrying nothing else, and a confirmation button labelled
 * exactly `jetzt kündigen`. Absatz 6 makes the omission the expensive
 * outcome: where the button is missing, a consumer may cancel at any time
 * without notice, which voids the notice-period term for every customer this
 * deployment ever signs. The title is the `title` of the mounted
 * `kuendigung.md` (M246, `docs/content.md`), and the submit label is
 * `declarations.cancel.submit` in each locale's `common.json`. Neither
 * is wordsmith's to rephrase.
 *
 * ── THE PROSE IS MOUNTED, THE MECHANISM IS HERE ──
 *
 * The lead paragraph and the `unavailable` text come from
 * `<CONTENT_DIR>/<lang>/kuendigung.md`, read in the loader. The form, its
 * labels, its validation and the POST stay in this file. With no content
 * folder the route answers 404, like every content page.
 *
 * ── PUBLIC, UNAUTHENTICATED, ALWAYS REGISTERED ────────────────────────────
 *
 * No login, like `/withdrawal` beside it. Not gated on `plans`: a deployment
 * that never linked here still owes the button, because the statute's
 * default is worse than the page.
 *
 * ── CLIENT-ONLY, LIKE EVERY UNAUTHENTICATED FORM IN THIS APP ──────────────
 *
 * The loader reads the page's prose and nothing else. There is no action:
 * the declaration goes straight from this browser to
 * `openplate-core`'s own origin (`SYNC_SERVER_URL`), never through this
 * server, the same shape `/forgot` and `/join-study` already use.
 * `CredentialSubmitButton` is reused here for the reason its own doc states
 * generically, not for its name: this form has no `method`/`action` either,
 * so a pre-hydration native submit would be a GET carrying a name and an
 * email address into the address bar, history and the next `Referer`. That is
 * a smaller secret than a passphrase, but it is still this reader's own data,
 * and the guard costs nothing extra to reuse.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { z } from 'zod';

import type { Route } from './+types/kuendigung';
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
import { createComponentLogger } from '#app/lib/logger';
import { checkoutLocaleFor } from '#app/lib/plans/plans-door';
import { canonicalizeEmail } from '#app/lib/sync/email';
import '#app/i18n/i18n';

/** SERVER: the page's prose, from the mounted content folder. */
export async function loader({ request }: Route.LoaderArgs) {
  return { page: await loadContentPageOrThrow({ request, slug: 'kuendigung' }) };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: contentPageTitle(loaderData?.page.title ?? null) }];

const log = createComponentLogger('kuendigung');

/** Where a browser posts a declaration — `openplate-core`'s own origin, never this server. */
const DECLARATIONS_API_PATH = '/v1/legal/declarations';

const TERMINATION_TYPES = ['ordentlich', 'ausserordentlich'] as const;
type TerminationType = (typeof TERMINATION_TYPES)[number];

const TIMING_OPTIONS = ['earliest', 'onDate'] as const;
type Timing = (typeof TIMING_OPTIONS)[number];

/** Duplicated per module by this repo's own convention — see `app/lib/sync/setup-flow.ts`. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * The form schema. `email` uses Zod v4's own `z.email()` (see
 * `app/routes/index.tsx`), and `reason` is required only when the reader
 * picked the extraordinary termination type — the one field § 312k's model
 * text does not ask for on the ordinary path.
 */
function makeCancelDeclarationSchema(t: Translate) {
  return z
    .object({
      terminationType: z.enum(TERMINATION_TYPES),
      reason: z.string().default(''),
      name: z.string().default(''),
      email: z.email(t('declarations.errors.emailInvalid')),
      contractReference: z.string().default(''),
      timing: z.enum(TIMING_OPTIONS),
      requestedDate: z.string().default(''),
    })
    .superRefine((value, ctx) => {
      if (value.name.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['name'], message: t('declarations.errors.nameRequired') });
      }
      if (value.terminationType === 'ausserordentlich' && value.reason.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['reason'], message: t('declarations.errors.reasonRequired') });
      }
    });
}

type CancelDeclarationValues = z.infer<ReturnType<typeof makeCancelDeclarationSchema>>;

/** The server's 202 body — `PROTOCOL.md`-style: parsed, never trusted. */
const acceptedResponseSchema = z.object({
  receiptId: z.string().min(1),
  receivedAt: z.string().min(1),
  kind: z.literal('kuendigung'),
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
async function submitCancelDeclaration(input: {
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

export default function Kuendigung({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;
  const unavailable = sectionBlocks(page, 'unavailable');
  const { t, i18n } = useTranslation();
  const navigate = useAppNavigate();
  const serverUrl = useSyncServerUrl();
  const [terminationType, setTerminationType] = useState<TerminationType>('ordentlich');
  const [timing, setTiming] = useState<Timing>('earliest');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<DeclarationFailure | null>(null);

  const [form, fields] = useForm({
    id: 'kuendigung-form',
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeCancelDeclarationSchema(t) });
    },
    shouldRevalidate: 'onInput',
    defaultValue: {
      terminationType: 'ordentlich',
      timing: 'earliest',
      name: '',
      email: '',
      contractReference: '',
      reason: '',
      requestedDate: '',
    },
    onSubmit(event, { submission }) {
      // Client-side only: the request goes to openplate-core's own origin,
      // and the default navigation would abandon it.
      event.preventDefault();
      if (submission?.status !== 'success' || serverUrl === null) return;
      void submitForm(submission.value);
    },
  });

  async function submitForm(value: CancelDeclarationValues): Promise<void> {
    if (serverUrl === null) return;
    setIsSubmitting(true);
    setFailure(null);
    const email = canonicalizeEmail(value.email);
    const outcome = await submitCancelDeclaration({
      serverUrl,
      request: {
        kind: 'kuendigung',
        name: value.name.trim(),
        email,
        contractReference: value.contractReference.trim() === '' ? null : value.contractReference.trim(),
        terminationType: value.terminationType,
        reason: value.terminationType === 'ausserordentlich' ? value.reason.trim() : null,
        requestedDate: value.requestedDate.trim() === '' ? null : value.requestedDate.trim(),
        timing: value.timing,
        language: checkoutLocaleFor(i18n.language),
      },
    });
    setIsSubmitting(false);
    if (outcome.status === 'accepted') {
      void navigate('/kuendigung/bestaetigt', {
        state: { receiptId: outcome.receiptId, receivedAt: outcome.receivedAt, email },
      });
      return;
    }
    setFailure(outcome.status);
  }

  return (
    <PublicWrapper>
      <ContentArticle title={page.title} updated={page.updated} language={page.language} blocks={page.body}>
        {serverUrl === null ?
          <ContentBlocks blocks={unavailable} />
        : <form {...getFormProps(form)} className="not-prose mt-8 space-y-6">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('declarations.cancel.terminationTypeLabel')}</legend>
              {TERMINATION_TYPES.map((option) => (
                <label key={option} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={fields.terminationType.name}
                    value={option}
                    checked={terminationType === option}
                    onChange={() => setTerminationType(option)}
                    className="size-4 accent-primary"
                  />
                  {t(
                    `declarations.cancel.terminationType${option === 'ordentlich' ? 'Ordentlich' : 'Ausserordentlich'}`,
                  )}
                </label>
              ))}
              <ReservedFieldError id={fields.terminationType.errorId} errors={fields.terminationType.errors} />
            </fieldset>

            {/* An expansion the person asked for (DESIGN.md section 7): picking
                the extraordinary type reveals its reason field, below the tap. */}
            {terminationType === 'ausserordentlich' && (
              <div className="space-y-2">
                <Label htmlFor={fields.reason.id}>{t('declarations.cancel.reasonLabel')}</Label>
                <textarea
                  id={fields.reason.id}
                  name={fields.reason.name}
                  rows={3}
                  className="w-full resize-none border border-input bg-card px-3 py-2 text-base outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                />
                <ReservedFieldError id={fields.reason.errorId} errors={fields.reason.errors} />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor={fields.name.id}>{t('declarations.cancel.nameLabel')}</Label>
              <Input {...getInputProps(fields.name, { type: 'text' })} autoComplete="name" />
              <ReservedFieldError id={fields.name.errorId} errors={fields.name.errors} />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.email.id}>{t('declarations.cancel.emailLabel')}</Label>
              <Input
                {...getInputProps(fields.email, { type: 'email' })}
                autoComplete="email"
                spellCheck={false}
                autoCapitalize="none"
              />
              <ReservedFieldError id={fields.email.errorId} errors={fields.email.errors} />
            </div>

            <div className="space-y-2">
              <Label htmlFor={fields.contractReference.id}>{t('declarations.cancel.contractReferenceLabel')}</Label>
              <Input {...getInputProps(fields.contractReference, { type: 'text' })} />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('declarations.cancel.timingLabel')}</legend>
              {TIMING_OPTIONS.map((option) => (
                <label key={option} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={fields.timing.name}
                    value={option}
                    checked={timing === option}
                    onChange={() => setTiming(option)}
                    className="size-4 accent-primary"
                  />
                  {t(`declarations.cancel.timing${option === 'earliest' ? 'Earliest' : 'OnDate'}`)}
                </label>
              ))}
              <ReservedFieldError id={fields.timing.errorId} errors={fields.timing.errors} />
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor={fields.requestedDate.id}>{t('declarations.cancel.requestedDateLabel')}</Label>
              <Input {...getInputProps(fields.requestedDate, { type: 'date' })} />
            </div>

            <CredentialSubmitButton disabled={isSubmitting} className="h-11 w-full sm:w-auto">
              {t('declarations.cancel.submit')}
            </CredentialSubmitButton>

            <DeclarationSubmitError failure={failure} unavailable={unavailable} />
          </form>
        }
      </ContentArticle>
    </PublicWrapper>
  );
}
