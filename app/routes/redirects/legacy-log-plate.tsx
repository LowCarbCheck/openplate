import { redirect } from 'react-router';

/** Permanent redirect for the pre-rename `/log/plate` path → `/scan`. */
export async function loader() {
  throw redirect('/scan');
}
