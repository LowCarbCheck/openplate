import type { Route } from './+types/legacy-describe';
import { redirect } from 'react-router';

/**
 * Permanent redirect for the pre-rename `/describe` path → `/add/describe`
 * (ADR-0019), preserving the query string (`?date=`, `?speak=1`, `?to=`).
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  throw redirect(`/add/describe${url.search}`);
}
