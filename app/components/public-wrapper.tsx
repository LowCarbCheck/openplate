import { ProgressBar } from './progress-bar';
import * as React from 'react';
import { Link } from '#app/components/link';
import { Trans, useTranslation } from 'react-i18next';
import { APP_NAME } from '#app/lib/brand';
import { Button } from './ui/button';

export default function PublicWrapper({
  children,
  showLogo = true,
}: {
  children: React.ReactNode;
  showLogo?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col pt-16">
      <ProgressBar />
      <header className="fixed top-0 left-0 right-0 h-16 px-4 z-50 flex items-center justify-between bg-background/80 backdrop-blur-sm border-b">
        <div>
          {showLogo && (
            <a href="/" className="flex items-center gap-3 font-medium hover:opacity-80 transition-opacity">
              <img src="/icons/icon-192.png?v=2" alt="" className="h-6 w-6 rounded-full" />
              <span className="font-display text-lg font-semibold text-foreground">{APP_NAME}</span>
            </a>
          )}
        </div>
        {/* Was an account menu / "Log in" button (M128 spec 03: there are no
            accounts). The one thing a visitor on a public page actually wants
            from this corner is the way INTO the tracker, so that's what it is. */}
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">{t('chrome.openTracker')}</Link>
          </Button>
        </div>
      </header>
      <div className="container mx-auto w-full max-w-3xl flex-1 px-4 py-12 md:py-16">{children}</div>
      <footer className="border-t bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex max-w-3xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
          {/* Attribution + the device-local promise as ONE sentence, one
              catalog entry: the "by X" clause and the tagline sit either side
              of the em dash in English and in German, and a translator needs
              the whole line to reorder it. `<Trans>` carries the inline link
              so the anchor can move within the sentence per language; the
              domain itself is a proper noun and stays untranslated.

              A plain do-follow anchor on purpose — this is a real credit to
              the project openplate came out of, not a paid or untrusted link,
              so there is no `rel="nofollow"` here. `noopener` still applies
              because it opens in a new tab. */}
          <span>
            <Trans
              i18nKey="chrome.footerTagline"
              values={{ appName: APP_NAME }}
              components={{
                lcc: (
                  <a
                    href="https://lowcarbcheck.org"
                    target="_blank"
                    rel="noopener"
                    className="font-medium underline underline-offset-4 transition-colors hover:text-foreground"
                  >
                    {/* `<Trans>` replaces this with the linked run from the
                        catalog entry; it is the fallback if the key is missing. */}
                    lowcarbcheck.org
                  </a>
                ),
              }}
            />
          </span>
          <nav className="flex items-center gap-4">
            {/* The theme and language controls left the header (M129/05) and
                now live in Preferences — this is how a visitor who never
                signs in still reaches them. */}
            <Link to="/settings/preferences" className="transition-colors hover:text-foreground">
              {t('chrome.preferences')}
            </Link>
            <Link to="/privacy" className="transition-colors hover:text-foreground">
              {t('chrome.privacy')}
            </Link>
            <Link to="/terms" className="transition-colors hover:text-foreground">
              {t('chrome.terms')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
