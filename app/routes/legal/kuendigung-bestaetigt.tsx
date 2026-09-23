/**
 * `/kuendigung/bestaetigt` — the confirmation § 312k BGB requires.
 *
 * ── RENDERS ONLY WHAT THE SPEC NAMES, AND NOTHING ELSE ────────────────────
 *
 * Receipt id, kind, the typed address, the received instant (full date, time
 * and timezone, from the SERVER's own `receivedAt`, never `new Date()` on
 * this device), a print button, and one line that the same receipt went out
 * by mail. The title and that mail line come from the mounted
 * `kuendigung-bestaetigt.md` (M246); the receipt lines are chrome and stay here. No retention offer, no pause, no discount, no survey, no support
 * link — M214/09's requirement, and the reason there is no navigation away
 * from a cancellation somebody just confirmed.
 *
 * ── WHERE THE DATA COMES FROM ─────────────────────────────────────────────
 *
 * `/kuendigung` navigates here with `receiptId`/`receivedAt`/`email` in
 * router state — this app holds no record of the declaration once it leaves
 * the browser (ADR-0006: the server holds no accounts, and this page's
 * server holds no data of any kind). A direct visit or a reload carries no
 * state, and this page refuses to fabricate one: it sends the reader back to
 * the form rather than claiming a receipt it cannot show.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { Route } from './+types/kuendigung-bestaetigt';
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
  return { page: await loadContentPageOrThrow({ request, slug: 'kuendigung-bestaetigt' }) };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: contentPageTitle(loaderData?.page.title ?? null) }];

/** What `/kuendigung` hands over in router state, parsed rather than trusted — it is untyped at the router boundary. */
const confirmationStateSchema = z.object({
  receiptId: z.string().min(1),
  receivedAt: z.string().min(1),
  email: z.string().min(1),
});

export default function KuendigungBestaetigt({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useAppNavigate();
  const parsed = confirmationStateSchema.safeParse(location.state);

  useEffect(() => {
    // A reload or a direct visit carries no state: send the reader back to
    // the form rather than rendering a receipt this page cannot prove.
    if (!parsed.success) void navigate('/kuendigung', { replace: true });
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
        <P>{t('declarations.confirmed.kindCancel')}</P>
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
