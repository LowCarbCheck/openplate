import { ProgressBar } from './progress-bar';
import * as React from 'react';
import { Link } from '#app/components/link';
import { Trans, useTranslation } from 'react-i18next';
import { Github } from 'lucide-react';
import { APP_NAME, REPO_LICENSE_URL, REPO_URL } from '#app/lib/brand';
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
          {/* The source link, icon-only and muted (M146 spec 01). Additive to
              the button beside it, never competitive with it: teal carries
              CTAs (DESIGN.md §1) and reading the code is not one, so this is
              `text-muted-foreground` with a hover, never `--primary` and never
              a filled button. Icon-only because the header is one 16px row —
              the label lives in `aria-label` and in the footer. */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener"
            aria-label={t('chrome.sourceLabel')}
            title={t('chrome.source')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Github className="h-5 w-5" aria-hidden="true" />
          </a>
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
          <nav className="flex flex-wrap items-center justify-center gap-4">
            {/* Provenance, where a reader looks for it: the repository as a
                real labelled link, and the licence next to it. Both are plain
                external anchors (not the in-app `Link`) and both stay muted
                like the rest of this row. */}
            <a href={REPO_URL} target="_blank" rel="noopener" className="transition-colors hover:text-foreground">
              {t('chrome.source')}
            </a>
            <a
              href={REPO_LICENSE_URL}
              target="_blank"
              rel="noopener"
              className="transition-colors hover:text-foreground"
            >
              {t('chrome.licence')}
            </a>
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
