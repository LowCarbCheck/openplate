/**
 * What an account page shows, in place of its form, on a page the browser
 * will not let an account ceremony run on (2026-09-27 install rehearsal).
 *
 * TWO SENTENCES AND A LINK. What is wrong, in the reader's terms (accounts
 * need HTTPS here), what to do about it (open the https address, or
 * `localhost` on the computer that runs it), and where the person who runs
 * the server reads how. No form: a form here invites an attempt that cannot
 * work and ends in the browser's own TypeError.
 *
 * The link opens the project site in a new tab rather than leaving the app,
 * because the person who reads it is often not the person who can act on it,
 * and they may want to come back and pass the address on.
 */
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SELF_HOSTING_HTTPS_DOCS_URL } from '#app/lib/brand';

export function AccountsNeedHttps() {
  const { t } = useTranslation();
  return (
    <div data-slot="accounts-need-https" className="space-y-3 text-sm">
      <p className="font-medium">{t('secureContext.title')}</p>
      <p className="text-muted-foreground">{t('secureContext.body')}</p>
      <a
        href={SELF_HOSTING_HTTPS_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
      >
        {t('secureContext.guide')}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </div>
  );
}
