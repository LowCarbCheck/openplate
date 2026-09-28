import * as React from 'react';
import { Link as RouterLink, NavLink as RouterNavLink, useHref, type LinkProps, type NavLinkProps } from 'react-router';
import { useAppNavigate } from '#app/hooks/use-app-navigate';

/**
 * The app's `Link` / `NavLink`.
 *
 * Thin re-exports of react-router's own components with `viewTransition`
 * defaulted to `true`, so every internal navigation runs inside
 * `document.startViewTransition()` and the page cross-fades instead of
 * snapping. The fade itself is 200ms of pure opacity on the `root` snapshot
 * (`::view-transition-old(root)` / `-new(root)` in `app/app.css`) — deliberately
 * shorter and quieter than a marketing-site transition, because this is a
 * tool people open several times a day.
 *
 * Three things this intentionally does NOT do:
 *
 * - **No shared-element morphs.** Nothing in the app has a stable visual
 *   counterpart across two routes yet, and a half-applied morph is worse than
 *   none. When one arrives it gets its own `view-transition-name` plus a
 *   `::view-transition-group()` rule, applied per-navigation via
 *   `useViewTransitionState` so two on-screen copies of a name can't collide.
 * - **No feature detection.** Browsers without the View Transitions API make
 *   react-router's `viewTransition` a no-op; there is nothing to polyfill and
 *   nothing to branch on.
 * - **No motion toggle.** The app has no in-app motion setting, so the OS-level
 *   `prefers-reduced-motion: reduce` media query is the only switch — the
 *   `app.css` block kills every `::view-transition-*` animation under it.
 *
 * Opt an individual link out with `viewTransition={false}`. External
 * destinations keep using a plain `<a>`; this module is for in-app routes only.
 *
 * ## Why the click is intercepted
 *
 * In the installed app the system Back gesture is the only way out of a
 * screen, so it has to mean UP rather than EARLIER. That is a claim about the
 * shape of the history stack, and the stack is shaped by `useAppNavigate`,
 * which pushes only when a link goes one level deeper and otherwise replaces
 * or pops (`app/hooks/use-app-navigate.ts` documents the rules and four
 * worked walks). Since every route in the app imports `Link` from here, this
 * is the one place that has to change for the whole app to obey it.
 *
 * The interception is DELIBERATELY NARROW. It runs only for a plain primary
 * click with no modifier key and no `target`, which is the only click that a
 * router would have handled anyway. Everything else falls through to the
 * browser, and that is not politeness, it is correctness:
 *
 * - the rendered `href` is untouched, so server markup, "copy link address",
 *   a screen reader's link list and a search engine all see a real address;
 * - a middle click, or ctrl/cmd/shift/alt click, opens a new tab or window,
 *   where this document's history stack is not involved at all;
 * - `target="_blank"` and `download` links are left to the browser.
 */
/**
 * Is this the one click the router owns? Everything else is the browser's.
 *
 * `button === 0` is the primary button; a middle click is `1`. Any modifier
 * key means the person asked for a new tab, a new window or a download.
 */
function isPlainLeftClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** The props both wrappers read to decide whether a click is theirs. */
interface AppNavigationClickInput {
  to: LinkProps['to'];
  target: string | undefined;
  download: unknown;
  onClick: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
}

/**
 * The click handler `Link` and `NavLink` share, so the tab bar (which renders
 * `NavLink`) and every other destination (which render `Link`) shape the stack
 * by the same rules.
 */
function useAppNavigationClick({ to, target, download, onClick }: AppNavigationClickInput) {
  // react-router's own resolver, so a relative `to` and a `Partial<Path>` both
  // become the same href the anchor renders, and `go` never has to parse one.
  const href = useHref(to);
  const go = useAppNavigate();

  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (download !== undefined) return;
    if (target !== undefined && target !== '_self') return;
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    go(href);
  };
}

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { viewTransition = true, to, target, download, onClick, ...props },
  ref,
) {
  const handleClick = useAppNavigationClick({ to, target, download, onClick });

  return (
    <RouterLink
      ref={ref}
      to={to}
      target={target}
      download={download}
      viewTransition={viewTransition}
      onClick={handleClick}
      {...props}
    />
  );
});

export const NavLink = React.forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { viewTransition = true, to, target, download, onClick, ...props },
  ref,
) {
  const handleClick = useAppNavigationClick({ to, target, download, onClick });

  return (
    <RouterNavLink
      ref={ref}
      to={to}
      target={target}
      download={download}
      viewTransition={viewTransition}
      onClick={handleClick}
      {...props}
    />
  );
});
