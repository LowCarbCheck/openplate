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
  { title: metaTitle(metaLanguage(matches), 'meta.widerrufenBestaetigt') },
];

/** What `/widerrufen` hands over in router state, parsed rather than trusted — it is untyped at the router boundary. */
const confirmationStateSchema = z.object({
  receiptId: z.string().min(1),
  receivedAt: z.string().min(1),
  email: z.string().min(1),
});

export default function WiderrufenBestaetigt() {
  const { t, i18n } = useTranslation('legal');
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
      <article className="font-prose prose prose-zinc dark:prose-invert max-w-none">
        <H1 variant="default" className="mb-8">
          {t('declarations.confirmed.withdrawTitle')}
        </H1>
        <P>{t('declarations.confirmed.receiptIdLabel', { receiptId: parsed.data.receiptId })}</P>
        <P>{t('declarations.confirmed.kindWithdraw')}</P>
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
