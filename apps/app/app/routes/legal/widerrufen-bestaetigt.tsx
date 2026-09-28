/**
 * `/widerrufen/bestaetigt` — the immediate confirmation § 356a BGB requires
 * on a durable medium.
 *
 * ── RENDERS ONLY WHAT THE SPEC NAMES, AND NOTHING ELSE ────────────────────
 *
 * Same five things `/kuendigung/bestaetigt` renders, for the same reason —
 * see that file's header. No retention offer, no pause, no discount, no
 * survey, no support link.
 *
 * ── WHERE THE DATA COMES FROM ─────────────────────────────────────────────
 *
 * `/widerrufen` navigates here with `receiptId`/`receivedAt`/`email` in
 * router state; a direct visit or a reload carries none, and this page sends
 * the reader back to the form rather than fabricating a receipt.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { Route } from './+types/widerrufen-bestaetigt';
import { ContentArticle, ContentBlocks } from '#app/components/content-article';
import { P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import { Button } from '#app/components/ui/button';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { loadContentPageOrThrow } from '#app/lib/content/content-route.server';
import { contentPageTitle } from '#app/lib/content/content-page-title';
import { sectionBlocks } from '#app/lib/content/markdown';
import '#app/i18n/i18n';

/** SERVER: the receipt's title and its mail notice, from the mounted content folder. */
export async function loader({ request }: Route.LoaderArgs) {
  return { page: await loadContentPageOrThrow({ request, slug: 'widerrufen-bestaetigt' }) };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: contentPageTitle(loaderData?.page.title ?? null) }];

/** What `/widerrufen` hands over in router state, parsed rather than trusted — it is untyped at the router boundary. */
const confirmationStateSchema = z.object({
  receiptId: z.string().min(1),
  receivedAt: z.string().min(1),
  email: z.string().min(1),
});

export default function WiderrufenBestaetigt({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useAppNavigate();
  const parsed = confirmationStateSchema.safeParse(location.state);

  useEffect(() => {
    // A reload or a direct visit carries no state: send the reader back to
    // the form rather than rendering a receipt this page cannot prove.
    if (!parsed.success) void navigate('/widerrufen', { replace: true });
  }, [parsed.success, navigate]);

  if (!parsed.success) return null;

  const receivedAtLabel = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'long',
    timeStyle: 'long',
  }).format(new Date(parsed.data.receivedAt));

  return (
    <PublicWrapper>
      <ContentArticle
        title={page.title}
        updated={page.updated}
        language={page.language}
        blocks={page.body}
        hasUpdatedLine={false}
      >
        <P>{t('declarations.confirmed.receiptIdLabel', { receiptId: parsed.data.receiptId })}</P>
        <P>{t('declarations.confirmed.kindWithdraw')}</P>
        <P>{t('declarations.confirmed.addressLabel', { email: parsed.data.email })}</P>
        <P>{t('declarations.confirmed.receivedAtLabel', { instant: receivedAtLabel })}</P>
        <ContentBlocks blocks={sectionBlocks(page, 'mail-notice')} />
        <Button type="button" onClick={() => window.print()} className="not-prose">
          {t('declarations.confirmed.print')}
        </Button>
      </ContentArticle>
    </PublicWrapper>
  );
}
