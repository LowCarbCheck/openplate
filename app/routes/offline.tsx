import { Link } from '#app/components/link';
import { WifiOff } from 'lucide-react';
import { Button } from '#app/components/ui/button';
import { APP_NAME } from '#app/lib/brand';

export function meta(): Array<{ title: string }> {
  return [{ title: `You're offline · ${APP_NAME}` }];
}

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
 */
export default function Offline() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">No connection right now</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your diary, and everything you've already logged, lives on this device — they still work with no connection.
        This one page just isn't loadable yet: either it's new to this device, or it needs to reach the internet (like
        scanning a photo). Try again once you're back online.
      </p>
      <Button asChild className="h-11">
        <Link to="/diary">Go to your diary</Link>
      </Button>
    </main>
  );
}
