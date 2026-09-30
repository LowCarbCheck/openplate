/**
 * The one page a moved instance serves at every address.
 *
 * ── Server rendered, and no app script on it ─────────────────────────────
 *
 * Rendered to a string by `server.ts` with `renderToStaticMarkup`, outside React Router, and sent
 * as a whole document. It loads none of the app's scripts, and it must not: the app registers
 * `/sw.js` as it starts, and in moved mode that is the kill switch, which reloads every tab it
 * finds. An app script here would register it, be reloaded by it, and loop (see
 * `moved-request.ts`). The only script is the inline theme line below, the same decision
 * `app/root.tsx` makes before the first paint, so the page opens in the reader's light or dark
 * choice and never flips.
 *
 * ── Drawn in the app's own tokens ────────────────────────────────────────
 *
 * The app's stylesheets (`moved-page-links.ts`), its semantic colour tokens, its `Button`, and the
 * body font role. No colour of its own. Tailwind finds the classes below because it scans all of
 * `app/`, so the built stylesheet carries them. Nothing on it arrives late: the icon has its size
 * in its attributes, the font swap is metric-matched in `app/app.css`, and there is no text that
 * appears after the first paint. The button's label may wrap at 360 px, so it is allowed to.
 */
import { renderToStaticMarkup } from 'react-dom/server';

import { Button } from '#app/components/ui/button';
import type { LanguageCode } from '#app/i18n/language-prefs';
import type { MovedCopy } from './moved-copy';
import type { MovedPageLink } from './moved-page-links';

/** What the page needs to draw itself. */
export interface MovedPageProps {
  readonly language: LanguageCode;
  readonly copy: MovedCopy;
  /** Where the button goes: the sign-in page at the new address. */
  readonly signInUrl: string;
  readonly links: readonly MovedPageLink[];
}

/**
 * The theme decision `app/root.tsx` runs before the first paint: the stored choice, then the
 * system's. Its twin there also installs the helpers the settings screen calls; this page has no
 * settings, so it only sets the class.
 */
const THEME_SCRIPT =
  "(function(){var theme=localStorage.getItem('theme');" +
  "var isDark=theme==='dark'||(!theme||theme==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches;" +
  "document.documentElement.classList.toggle('dark',isDark);})();";

/** The app's icon, the same file and cache key `app/root.tsx` links as its icon. */
const ICON_SRC = '/icons/icon-192.png?v=2';

/** The icon's drawn size in CSS pixels, written into the tag so its box exists before it loads. */
const ICON_SIZE_PX = 48;

/** The moved page, as a whole document. */
export function MovedPage({ language, copy, signInUrl, links }: MovedPageProps) {
  return (
    <html lang={language} dir="ltr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{copy.title}</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {links.map((link) => (
          <link
            key={`${link.rel} ${link.href}`}
            rel={link.rel}
            href={link.href}
            as={link.as}
            type={link.type}
            sizes={link.sizes}
            crossOrigin={link.crossOrigin}
          />
        ))}
      </head>
      <body className="font-body">
        <main
          data-slot="moved-page"
          className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10 break-words"
        >
          <img src={ICON_SRC} alt="" width={ICON_SIZE_PX} height={ICON_SIZE_PX} className="size-12" />
          <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-base leading-relaxed">{copy.body}</p>
          <Button asChild size="lg" className="h-auto min-h-12 w-full whitespace-normal py-3 text-center md:h-auto">
            <a href={signInUrl}>{copy.signIn}</a>
          </Button>
          <div className="flex flex-col gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
            <p>{copy.homeScreen}</p>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              <li>{copy.iphone}</li>
              <li>{copy.android}</li>
            </ul>
          </div>
        </main>
      </body>
    </html>
  );
}

/**
 * The moved page as the bytes of a response body.
 *
 * @param props - what the page draws.
 * @returns `<!DOCTYPE html>` and the document.
 */
export function renderMovedPage(props: MovedPageProps): string {
  return `<!DOCTYPE html>${renderToStaticMarkup(<MovedPage {...props} />)}`;
}
