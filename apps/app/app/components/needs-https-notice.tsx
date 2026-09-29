/**
 * What a control shows, in its place, on a page the browser will not give
 * `crypto.subtle` (a plain-http page that is not on this computer).
 *
 * TWO SENTENCES AND A LINK, shared by every such place so they read alike:
 * what cannot happen here, what to do instead, and the HTTPS section of the
 * self-hosting guide for whoever runs the server. The account pages
 * (`AccountsNeedHttps`) and the OpenRouter connect (`OAuthConnectButton`) draw
 * it; `useCanRunAccounts` is the one question they ask first.
 *
 * The link opens the project site in a new tab rather than leaving the app,
 * because the person who reads it is often not the person who can act on it.
 */
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useProjectSiteUrl } from '#app/hooks/use-project-site-url';
import { SELF_HOSTING_HTTPS_DOCS_PATH } from '#app/lib/brand';
import { cn } from '#app/lib/utils';

export function NeedsHttpsNotice({
  slot,
  title,
  body,
  className,
}: {
  /** The `data-slot`, which a browser check finds the notice by. */
  slot: string;
  /** Already translated: what cannot happen on this page. */
  title: string;
  /** Already translated: why, and what to do instead. */
  body: string;
  className?: string;
}) {
  const { t } = useTranslation();
  // The guide in the reader's language: the site translates it, and it used to be the English copy for everybody.
  const guideUrl = useProjectSiteUrl(SELF_HOSTING_HTTPS_DOCS_PATH);
  return (
    <div data-slot={slot} className={cn('space-y-3 text-sm', className)}>
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">{body}</p>
      <a
        href={guideUrl}
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
