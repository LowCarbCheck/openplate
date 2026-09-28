import { redirect } from 'react-router';

/**
 * Permanent redirect for the pre-rename `/log/plate` path → `/add/photo`,
 * targeted directly rather than through the `/scan` redirect (ADR-0019), to
 * avoid a double hop.
 */
export async function loader() {
  throw redirect('/add/photo');
}
