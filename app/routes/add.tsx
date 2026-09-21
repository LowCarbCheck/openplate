/**
 * `/add`, the hub the three intake siblings nest under (ADR-0019).
 *
 * This layout renders nothing of its own, on purpose: there is no hub SCREEN,
 * a method switcher that asks "how do you want to log?" before routing onward
 * is filed as a separate follow-up, not built here. The launcher's raised
 * button and its long-press sheet (Photo, Type, Speak) already are that hub,
 * one gesture away from `/add/search`, `/add/describe` and `/add/photo`. Bare
 * `/add` itself has no screen either; `add._index.tsx` redirects it to
 * `/add/search`.
 */
import { Outlet } from 'react-router';

export default function AddLayout() {
  return <Outlet />;
}
