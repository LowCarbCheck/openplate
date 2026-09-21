import type { Route } from './+types/legacy-scan';
import { redirect } from 'react-router';

/**
 * Permanent redirect for the pre-rename `/scan` path → `/add/photo`
 * (ADR-0019), preserving the query string. This one carries real weight:
 * `?shared=1` is the PWA share target's landing address, and an installed app
 * keeps running its OLD service worker until it next updates, so `/scan?shared=1`
 * keeps arriving indefinitely regardless of what this build ships.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  throw redirect(`/add/photo${url.search}`);
}
