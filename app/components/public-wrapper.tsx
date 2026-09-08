import { ProgressBar } from './progress-bar';
import * as React from 'react';
import { Link } from '#app/components/link';
import { Trans, useTranslation } from 'react-i18next';
import { APP_NAME, REPO_LICENSE_URL, REPO_URL } from '#app/lib/brand';
import { BUILD, formatBuildLabel } from '#app/lib/build-info';
import { BuildStamp } from '#app/components/build-stamp';
import { cn } from '#app/lib/utils';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { InviteOnlyDialog } from '#app/components/invite-only-dialog';
import { Button } from './ui/button';

/**
 * The chrome every public page wears: header, content, footer.
 *
 * ── One container, three places ──────────────────────────────────────────
 *
 * The header used to be full-bleed (`px-4` straight on the `<header>`) while
 * the content sat in a centred `max-w-3xl` container. On anything wider than
 * the container that put the wordmark hard against the viewport edge and the
 * first word of the page several hundred pixels to its right — two left edges
 * on one screen. The width is now computed ONCE here and applied to all three
 * regions, so the logo, the page and the footer share a single left edge at
 * every breakpoint.
 *
 * ── `wide` ───────────────────────────────────────────────────────────────
 *
 * `max-w-3xl` is DESIGN.md §5's page container, and it is right for the app's
 * focused single-column pages and for the legal pages, which are prose. The
 * LANDING page is not prose: it is a hero screenshot, a three-column step row
 * and a two-column feature grid, all of which were being squeezed into a
 * reading measure. `wide` swaps the container to `max-w-5xl` for that one
 * route. Hero COPY still caps itself at a reading measure inside it — a wide
 * container is not permission to set a 1024px-long sentence.
 */
export default function PublicWrapper({
  children,
  showLogo = true,
  wide = false,
}: {
  children: React.ReactNode;
  showLogo?: boolean;
  /** The landing route only — see the component doc. */
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const { headerOffersSignIn } = useInstancePolicy();
  const container = cn('container mx-auto w-full px-4', wide ? 'max-w-5xl' : 'max-w-3xl');

  return (
    // `overflow-x-clip` rather than `overflow-x-hidden`: it clips a decorative
    // overhang without making this element a scroll container, so `position:
    // sticky` inside a page still works. This is the LAYOUT-level guard; the
    // section that actually overhangs (the landing hero's backdrop) clips
    // itself too, so a stray horizontal scrollbar can't come back by a route
    // forgetting one of them.
    <div className="flex min-h-screen flex-col overflow-x-clip pt-16">
      <ProgressBar />
      {/* `bg-background/98 backdrop-blur-md`, up from `/80 backdrop-blur-sm`.
          At 80% a 36px section heading scrolling under this bar stayed legible
          THROUGH it — two overlapping texts, the page's and the header's, for
          the length of the scroll. The blur is kept (it is what makes the bar
          feel like glass rather than a slab) and only the veil is thickened,
          which is the part that was doing the hiding. Pages also carry
          `scroll-mt-*` on their sections so an anchored heading lands below
          this 64px band rather than under it. */}
      <header className="fixed left-0 right-0 top-0 z-50 h-16 border-b bg-background/98 backdrop-blur-md">
        <div className={cn(container, 'flex h-full items-center justify-between')}>
          <div>
            {showLogo && (
              <a href="/" className="flex items-center gap-3 font-medium transition-opacity hover:opacity-80">
                <img src="/icons/icon-192.png?v=2" alt="" className="h-6 w-6 rounded-full" />
                <span className="font-display text-lg font-semibold text-foreground">{APP_NAME}</span>
              </a>
            )}
          </div>
          {/* Was an account menu / "Log in" button. M128 spec 03 deleted it
            because this app had no accounts at all, and the one thing a
            visitor on a public page wants from this corner is the way INTO the
            tracker, so that is what it became.

            THAT PREMISE IS NOW CONDITIONAL (M201). `INSTANCE_MODE=managed`
            gives an instance accounts, and on one of those the deletion is
            wrong: the corner offers a button that silently redirects to
            `/welcome` and the page never says the words "sign in". The
            decision above still holds wherever `headerOffersSignIn` is false,
            which is every open instance and the self-host default. The
            question is `useInstancePolicy().headerOffersSignIn`, never the
            mode name; see `app/config/instance-policy.ts`.

            What that conditional buys, in this corner (M201 spec 03): a
            sign-in link where the button used to redirect, and beside it the
            answer for a visitor holding no invite. Neither one renders on an
            open instance, where there is nothing to sign in to and the offer
            would be the mirror image of the same fault. */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* The source icon left this corner in M201/03. It was the SECOND
                copy of a link the footer already carries as a labelled word,
                and the row is one 16px band: on a managed instance the space
                is spent on the two controls a visitor actually needs, and an
                open instance keeps the one it always had. The footer's Source
                link is untouched and is now the only one on the page. */}
            {headerOffersSignIn && <InviteOnlyDialog />}
            {/* `h-10` overrides the `sm` size's 32px box: this is the header's
                only real control on a phone and it has to be tappable.

                The destination changes WITH the label, the same trade the
                landing page's mid-page call to action already made: on a
                managed instance `/dashboard` bounces to `/welcome`, so a button
                named for a destination is a redirect wearing that name. Naming
                the real door is what makes the label true. */}
            <Button asChild variant="outline" size="sm" className="h-10 px-4">
              <Link to={headerOffersSignIn ? '/sign-in' : '/dashboard'}>
                {headerOffersSignIn ? t('chrome.signIn') : t('chrome.openTracker')}
              </Link>
            </Button>
          </div>
        </div>
      </header>
      {/* The page's one landmark for its main content. Every public route gets
          it from here rather than remembering to emit its own. */}
      <main className={cn(container, 'flex-1 py-12 md:py-16')}>{children}</main>
      <footer className="border-t bg-background/80 backdrop-blur-sm">
        <div
          className={cn(
            container,
            'flex flex-col items-center justify-between gap-4 py-6 text-sm text-muted-foreground sm:flex-row sm:gap-6',
          )}
        >
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
          <span className="text-center sm:text-left">
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
          {/* Five links. `flex-wrap` used to break them 4 + 1, leaving one word
              orphaned on its own line under a full row — so on a phone they are
              an explicit TWO-COLUMN grid (a deliberate short column, not a
              stray), and from `sm` up one non-wrapping right-aligned row.
              Labels are one word each so that row fits: the long forms
              ("Source code", "MIT licence") stay on the header's `aria-label`
              and `title`, where there is room for them. */}
          <nav className="grid w-full grid-cols-2 gap-x-5 gap-y-2 sm:flex sm:w-auto sm:flex-nowrap sm:items-center sm:justify-end">
            {/* Provenance, where a reader looks for it: the repository as a
                real labelled link, and the licence next to it. Both are plain
                external anchors (not the in-app `Link`) and both stay muted
                like the rest of this row. */}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener"
              title={t('chrome.source')}
              className="transition-colors hover:text-foreground"
            >
              {t('chrome.sourceShort')}
            </a>
            <a
              href={REPO_LICENSE_URL}
              target="_blank"
              rel="noopener"
              title={t('chrome.licence')}
              className="transition-colors hover:text-foreground"
            >
              {t('chrome.licenceShort')}
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
            {/* Section 5 DDG requires the imprint to be reachable from every
                page ("leicht erkennbar, unmittelbar erreichbar"), so it belongs
                in the footer rather than only at a known URL. */}
            <Link to="/imprint" className="transition-colors hover:text-foreground">
              {t('chrome.imprint')}
            </Link>
          </nav>
        </div>
        {/* The build, on the public chrome too: a visitor reporting something
            from the landing page or the privacy text can name the build without
            opening the tracker.

            A SECOND ROW rather than a third item in the row above. That row is a
            `justify-between` pair whose two halves are tuned against each other
            (see the five-link note), and a third child would redistribute both.
            This is also the correct reading order: the version is the least
            important thing in the footer.

            No update marker here, deliberately. The public pages are read by
            people who may never open the tracker, and an update prompt on a
            marketing page is addressed to nobody. */}
        <div className={cn(container, 'flex justify-center pb-6 sm:justify-end')}>
          <BuildStamp label={formatBuildLabel(BUILD)} hasUpdate={false} />
        </div>
      </footer>
    </div>
  );
}
