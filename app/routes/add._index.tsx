import type { Route } from './+types/add._index';
import { redirect } from 'react-router';

/**
 * Bare `/add` has no screen of its own (ADR-0019): it redirects to
 * `/add/search`, the database search, preserving any query string so a
 * `?date=` an old link carried still lands on the right day.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  throw redirect(`/add/search${url.search}`);
}
