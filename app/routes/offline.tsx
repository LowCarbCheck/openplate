import { Link } from '#app/components/link';
import { WifiOff } from 'lucide-react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '#app/components/ui/button';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import '#app/i18n/i18n';

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.offline') }];

/**
 * Minimal, self-contained offline fallback. The service worker precaches this
 * page and serves it for document navigations that fail while offline, so it
 * must render without a loader or any authenticated chrome. Semantic tokens
 * carry both light and dark themes (DESIGN.md §2, §9).
 *
 * The copy here has to be true: the diary, add, goals, and trends routes are
 * `clientLoader`-only against on-device storage (M117/03), so they keep
 * working fully offline — this page only shows up for the handful of things
 * that genuinely need the network (a first visit to a page this device
 * hasn't cached yet, or photo scanning, which calls out to an AI provider).
 * "openplate needs a connection to load new data" was wrong: it implied the
 * whole app was offline-broken, when in fact everything already logged, and
 * every page already visited, keeps working with no connection at all.
 *
 * Translations are bundled inline (see `app/i18n/i18n.ts`), so this page
 * renders in the visitor's language even while genuinely offline — there is
 * no network fetch of the catalog to fail. `meta()` runs outside the React
 * tree, so its title goes through the pure `meta-title` seam rather than the
 * i18next singleton (see that module's header); `metaLanguage` degrades to
 * the default language when the root match is absent, which it always is
 * here since this route is served by the service worker without a loader.
 *
 * ── How this page knows the instance's mode (M196 class) ─────────────────
 *
 * The body used to say the diary lives on this device and stop there, which is
 * a device-only claim and false wherever `serverHoldsTheDiary` is true. The
 * policy still reaches this page even offline, because it is not this route's
 * data: `useInstancePolicy()` reads the ROOT loader's public config, and the
 * service worker precaches `/offline` as a whole server-rendered document at
 * install time, while the device is online. That document carries the root's
 * loader data with it, so a hydrated render offline reads the same
 * configuration a live render would. `meta()` is the thing that cannot see it,
 * since it runs outside the React tree, and the title is mode-neutral anyway.
 *
 * If the config is ever genuinely absent (an error boundary, a document that
 * predates the current deploy), `getInstancePolicy` answers with the OPEN
 * policy and the device-only body renders. That is the same direction every
 * other reader of the config takes, and it is the honest one here: a
 * self-hoster is the default, and a managed instance is unreachable offline in
 * the first place, so the stale case is a person who could not have signed in.
 */
export default function Offline() {
  const { t } = useTranslation();
  const { serverHoldsTheDiary } = useInstancePolicy();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">{t('offline.heading')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t(serverHoldsTheDiary ? 'offline.bodyManaged' : 'offline.body')}
      </p>
      <Button asChild className="h-11">
        <Link to="/diary">{t('offline.cta')}</Link>
      </Button>
    </main>
  );
}
