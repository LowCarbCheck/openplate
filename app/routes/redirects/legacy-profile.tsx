import type { Route } from './+types/legacy-profile';
import { redirect } from 'react-router';

/**
 * Redirect for the retired `/profile` page → `/settings`.
 *
 * The profile page was a card hub for configuration; it became the settings
 * hub, and its one non-configuration card (the streak) moved to Trends. The
 * path stays alive because it's been linkable and bookmarkable for a while —
 * including from a device's home screen — and a 404 there would look like the
 * app lost the user's data.
 *
 * The hash is deliberately NOT forwarded: a fragment never reaches the
 * server, so the old `#your-data`/`#install` deep links resolve in the
 * browser against the new page. In-app links to those anchors were repointed
 * at their new homes (`/settings/data#your-data`, `/settings#install`).
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  throw redirect(`/settings${url.search}`);
}
