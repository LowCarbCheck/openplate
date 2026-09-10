/**
 * `/settings/goals`: a REDIRECT to `/settings/nutrition`, and nothing else.
 *
 * The page split in two in M215 spec 03. It asked for a body fact (how tall are
 * you) and an eating target (how many carbs a day) under one title, and those
 * are different questions: the body facts went to `/settings/profile` and the
 * eating style and the four targets went to `/settings/nutrition`. The targets
 * are what "Goals" meant to anyone who typed this address, so this is where it
 * lands.
 *
 * The old address stays alive because it is linked from places nobody controls:
 * a browser bookmark, a settings screenshot, and the release notes of every
 * version before this one. A 404 here would read as "the feature was removed",
 * which is the opposite of what happened. Same reason `/settings/sync` still
 * resolves, and the same shape.
 *
 * A SERVER redirect rather than a client one, so a cold navigation never
 * renders a frame of the old route, and so a crawler following an old link gets
 * a 302 rather than an empty page. There is no client state to preserve: every
 * value both pages show is read from the device on arrival.
 */
import { redirect } from 'react-router';

export function loader() {
  return redirect('/settings/nutrition');
}
