import type { Route } from './+types/legacy-log';
import { redirect } from 'react-router';

/**
 * Permanent redirect for the pre-rename `/log` path → `/diary`, preserving any
 * `?date=` (or other) query string so old bookmarks and links keep working.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  throw redirect(`/diary${url.search}`);
}
