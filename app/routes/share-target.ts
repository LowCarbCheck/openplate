import { redirect } from 'react-router';

/**
 * Server-side fallback for the PWA share target (`share_target` in the
 * manifest). When the service worker is active it intercepts the shared-photo
 * POST, stashes the file, and redirects to `/scan?shared=1` — this route never
 * runs in that case. It exists to cover the SW-not-yet-active window (fresh
 * install, first load) by bouncing the share into the scan flow; the photo
 * itself is only recoverable via the service-worker path.
 */
export function action(): Response {
  return redirect('/scan');
}

export function loader(): Response {
  return redirect('/scan');
}
