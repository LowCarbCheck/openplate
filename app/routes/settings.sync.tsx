/**
 * `/settings/sync` — a REDIRECT to `/settings/account`, and nothing else.
 *
 * The page moved and was renamed in M192. The old address stays alive because
 * it is linked from three places nobody controls: a browser bookmark, a
 * settings row somebody screenshotted, and the release notes of every version
 * before this one. A 404 there would read as "the feature was removed", which
 * is the opposite of what happened.
 *
 * A SERVER redirect rather than a client one, so a cold navigation never
 * renders a frame of the old route, and so a crawler following an old link
 * gets a 302 rather than an empty page. There is no client state to preserve:
 * the account lives in the sync session, which survives a navigation.
 */
import { redirect } from 'react-router';

export function loader() {
  return redirect('/settings/account');
}
