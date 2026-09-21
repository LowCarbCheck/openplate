/**
 * `/kuendigung/bestaetigt` — the confirmation § 312k BGB requires.
 *
 * ── RENDERS ONLY WHAT THE SPEC NAMES, AND NOTHING ELSE ────────────────────
 *
 * Receipt id, kind, the typed address, the received instant (full date, time
 * and timezone, from the SERVER's own `receivedAt`, never `new Date()` on
 * this device), a print button, and one line that the same receipt went out
 * by mail. No retention offer, no pause, no discount, no survey, no support
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
import type { MetaFunction } from 'react-router';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { H1, P } from '#app/components/typography';
import PublicWrapper from '#app/components/public-wrapper';
import { Button } from '#app/components/ui/button';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import '#app/i18n/i18n';

export const meta: MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.kuendigungBestaetigt') },
];

/** What `/kuendigung` hands over in router state, parsed rather than trusted — it is untyped at the router boundary. */
const confirmationStateSchema = z.object({
  receiptId: z.string().min(1),
  receivedAt: z.string().min(1),
  email: z.string().min(1),
});

export default function KuendigungBestaetigt() {
  const { t, i18n } = useTranslation('legal');
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
      <article className="font-prose prose prose-zinc dark:prose-invert max-w-none">
        <H1 variant="default" className="mb-8">
          {t('declarations.confirmed.cancelTitle')}
        </H1>
        <P>{t('declarations.confirmed.receiptIdLabel', { receiptId: parsed.data.receiptId })}</P>
        <P>{t('declarations.confirmed.kindCancel')}</P>
        <P>{t('declarations.confirmed.addressLabel', { email: parsed.data.email })}</P>
        <P>{t('declarations.confirmed.receivedAtLabel', { instant: receivedAtLabel })}</P>
        <P>{t('declarations.confirmed.mailNotice')}</P>
        <Button type="button" onClick={() => window.print()} className="not-prose">
          {t('declarations.confirmed.print')}
        </Button>
      </article>
    </PublicWrapper>
  );
}
