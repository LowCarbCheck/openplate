/**
 * WHERE EVERY PERSONAL ROUTE SITS IN THE TREE.
 *
 * The installed app (manifest `display: standalone`, `start_url: /diary`) has
 * a system Back control that the person did not choose: the Android gesture,
 * the Android hardware key and the iOS edge swipe. In a browser tab those mean
 * "the page I was on before", and that is right, because a tab has an address
 * bar and a tab strip to say where you are. In an installed app the same
 * gesture is the one and only way out of a screen, and "the page before" is
 * wrong: tapping Diary, Add, Diary, Add four times should not cost four Backs
 * to leave.
 *
 * So Back has to mean UP, not EARLIER. That is a claim about the shape of the
 * history stack, not about intercepting `popstate`: we only ever PUSH when the
 * person goes one level DEEPER, and otherwise replace or pop. This table is
 * what "deeper" means.
 *
 * The parents were seeded from two places and nowhere else:
 *
 * - `app/routes.ts`, for which routes exist under the `_personal` layout.
 * - each route's `handle.backTo`, which is the Back LINK the app chrome
 *   already draws (`_personal.tsx` reads it). A screen that already claims a
 *   parent in its chrome has that same parent here, or the drawn arrow and the
 *   system gesture would disagree on one screen.
 *
 * Every parent in the table is a STATIC path, so `parentOf` never has to
 * substitute a parameter back into an ancestor.
 */

/** A route pattern as `app/routes.ts` spells it, parameters included. */
export type RoutePattern = string;

/** One row of the table: a pattern, and the static path one level above it. */
export interface RouteTreeEntry {
  pattern: RoutePattern;
  /** `null` for a root: a destination the nav catalog reaches in one tap. */
  parent: string | null;
}

/**
 * THE TABLE. Order is the reading order of `app/routes.ts`, not a precedence:
 * `parentOf` matches on segment count plus literal segments, so two rows can
 * never both match one pathname.
 */
export const ROUTE_TREE: readonly RouteTreeEntry[] = [
  // ---------------------------------------------------------------------------
  // Roots. Everything the sidebar, the drawer and the bottom tab bar reach in
  // one tap (`personalNavigationItems` in `app/components/app-sidebar.tsx`,
  // plus `adminNavigationItem`), and nothing else. Tapping between two roots
  // must never grow the stack, or the tab bar becomes a Back treadmill.
  // ---------------------------------------------------------------------------
  { pattern: '/dashboard', parent: null },
  { pattern: '/diary', parent: null },
  { pattern: '/scan', parent: null },
  { pattern: '/add', parent: null },
  { pattern: '/trends', parent: null },
  { pattern: '/nutrients', parent: null },
  { pattern: '/fasting', parent: null },
  { pattern: '/settings', parent: null },
  // `/settings/nutrition` is BOTH a root and a child, and the two answers are
  // not in conflict: the catalog carries it as the "Goals" row, so it is one
  // tap from anywhere, while `/settings` also lists it as a row. It is entered
  // as a CHILD below, because the deeper-only push rule is about what Back
  // should undo, and Back from the targets page belongs on the settings hub.
  // A root here would make it un-poppable from the hub.

  // ---------------------------------------------------------------------------
  // Under the diary.
  // ---------------------------------------------------------------------------
  // One logged entry. `diary.entry.$id.tsx`'s own `handle.backTo` is `/diary`,
  // and its loader narrows that to the entry's own DAY (`?date=`), which is
  // the same pathname; the ledger's pop matches on pathname, so both agree.
  { pattern: '/diary/entry/:id', parent: '/diary' },
  // The meal composer. Its `handle.backTo` says `/diary`, not `/add`, so it is
  // a child of the DIARY: the sentence you type there lands in the day you
  // came from. The design note's "under /add unless its handle says otherwise"
  // resolves here to the handle.
  { pattern: '/describe', parent: '/diary' },

  // ---------------------------------------------------------------------------
  // Under settings. Each of these carries `handle.backTo: '/settings'`.
  // ---------------------------------------------------------------------------
  { pattern: '/settings/ai', parent: '/settings' },
  { pattern: '/settings/preferences', parent: '/settings' },
  { pattern: '/settings/profile', parent: '/settings' },
  { pattern: '/settings/nutrition', parent: '/settings' },
  // A redirect route, not a screen (it forwards to `/settings/nutrition`). It
  // is in the table because `app/routes.ts` lists it and the parity test reads
  // that file as text; a person never rests on this pathname.
  { pattern: '/settings/goals', parent: '/settings' },
  { pattern: '/settings/life-phase', parent: '/settings' },
  { pattern: '/settings/data', parent: '/settings' },
  { pattern: '/settings/account', parent: '/settings' },
  { pattern: '/settings/plan', parent: '/settings' },
  // Also a redirect route, kept for old bookmarks. Same note as `/settings/goals`.
  { pattern: '/settings/sync', parent: '/settings' },
  { pattern: '/settings/sharing', parent: '/settings' },
  { pattern: '/settings/research', parent: '/settings' },
  { pattern: '/settings/about', parent: '/settings' },
  // "Your foods" and "Saved meals" are NOT under `/add`, even though `/add` is
  // where you use them: both declare `handle.backTo: '/settings'`, because
  // they are managed from the settings hub. Same rule as `/describe`, the
  // handle wins, so the drawn arrow and the gesture agree.
  { pattern: '/foods', parent: '/settings' },
  { pattern: '/meals', parent: '/settings' },
  // Somebody else's diary, the grantee's side. `shared._index.tsx` declares
  // `handle.backTo: '/settings'` (it is reached from the sharing row), and the
  // detail declares `/shared`.
  { pattern: '/shared', parent: '/settings' },
  { pattern: '/shared/:grantorAccountId', parent: '/shared' },

  // ---------------------------------------------------------------------------
  // The administration console. `admin.tsx` declares `handle.backTo:
  // '/settings'`, so the console hangs off the hub even though the admin row
  // in the sidebar footer also reaches it in one tap. The tab routes and the
  // detail routes are one level under their own layout.
  // ---------------------------------------------------------------------------
  { pattern: '/admin', parent: '/settings' },
  { pattern: '/admin/invitations', parent: '/admin' },
  { pattern: '/admin/activity', parent: '/admin' },
  { pattern: '/admin/people/:id', parent: '/admin' },
  { pattern: '/admin/invite', parent: '/admin' },
  { pattern: '/admin/feedback', parent: '/admin' },
  { pattern: '/admin/feedback/:id', parent: '/admin/feedback' },
];

/** Strip a trailing slash so `/settings/` and `/settings` are one pathname. */
function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function segmentsOf(pathname: string): string[] {
  return normalizePathname(pathname).split('/').filter((segment) => segment.length > 0);
}

/** Does a concrete pathname match one pattern? `:name` matches any one segment. */
function matchesPattern(pathname: string, pattern: RoutePattern): boolean {
  const pathSegments = segmentsOf(pathname);
  const patternSegments = segmentsOf(pattern);
  if (pathSegments.length !== patternSegments.length) return false;
  return patternSegments.every((patternSegment, index) => {
    if (patternSegment.startsWith(':')) return pathSegments[index] !== undefined;
    return patternSegment === pathSegments[index];
  });
}

/** The table row a concrete pathname belongs to, or `null` when it is off the tree. */
export function entryFor(pathname: string): RouteTreeEntry | null {
  return ROUTE_TREE.find((entry) => matchesPattern(pathname, entry.pattern)) ?? null;
}

/**
 * The static path one level above `pathname`.
 *
 * @param pathname - a concrete location pathname, no search and no hash.
 * @returns the parent path, or `null` for a root AND for any pathname that is
 *   not a personal route at all (a public page, or a URL this app never
 *   serves). Both answers are "there is nothing above this", which is what
 *   every caller wants: `isDeeper` says no, and the navigation replaces.
 */
export function parentOf(pathname: string): string | null {
  return entryFor(pathname)?.parent ?? null;
}

/**
 * How many levels down the tree `pathname` sits. A root is `0`.
 *
 * A pathname off the tree is also `0`: it has no parent, so it has no depth,
 * and there is no sensible larger number to give it.
 */
export function depthOf(pathname: string): number {
  let depth = 0;
  let current = parentOf(pathname);
  // Bounded by the table: the deepest chain today is three long
  // (`/admin/feedback/:id` → `/admin/feedback` → `/admin` → `/settings`), and
  // the bound is the table's own length so a cycle introduced by an edit stops
  // instead of hanging the browser.
  while (current !== null && depth < ROUTE_TREE.length) {
    depth += 1;
    current = parentOf(current);
  }
  return depth;
}

/**
 * Is `to` exactly one level below `from`?
 *
 * This is the ONLY question that earns a history PUSH. Not "is it deeper by
 * any amount" and not "is it a descendant": a jump from `/diary` straight to
 * `/admin/feedback/7` (a deep link, a notification) skipped the levels
 * between, so pushing there would give Back a step that leads nowhere the
 * person has been.
 *
 * @param from - the pathname the person is on now.
 * @param to - the pathname being navigated to.
 */
export function isDeeper(from: string, to: string): boolean {
  const parent = parentOf(to);
  if (parent === null) return false;
  return parent === normalizePathname(from);
}
