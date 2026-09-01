import { Link } from '#app/components/link';
import { WifiOff } from 'lucide-react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '#app/components/ui/button';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
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
 */
export default function Offline() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">{t('offline.heading')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('offline.body')}</p>
      <Button asChild className="h-11">
        <Link to="/diary">{t('offline.cta')}</Link>
      </Button>
    </main>
  );
}
