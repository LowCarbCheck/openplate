import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate, createPath, type NavigateOptions } from 'react-router';
import { z } from 'zod';
import { isDeeper } from '#app/lib/route-tree';
import {
  EMPTY_LEDGER,
  findEarlier,
  readLedger,
  recordLocation,
  writeLedger,
  type HistoryLedger,
  type LedgerStorage,
} from '#app/lib/history-ledger';

/**
 * THE ONLY SANCTIONED NAVIGATE.
 *
 * In the installed app (`display: standalone`, `start_url: /diary`) the system
 * Back gesture is the only way out of a screen, so it has to mean UP, not
 * EARLIER. We get that by SHAPING THE STACK rather than by intercepting
 * `popstate`: a navigation pushes only when it goes one level deeper, and
 * otherwise replaces the current entry or pops back to one we already have.
 *
 * The rules are in `decideNavigation` below, in order. The hook is a thin
 * wrapper: it reads the current pathname, the ledger and `history.state.idx`,
 * asks the pure function, and performs the answer.
 *
 * ------------------------------------------------------------------------
 * FOUR WALKS, AND THE STACK EACH ONE LEAVES
 * ------------------------------------------------------------------------
 *
 * 1. Diary, Settings, Settings > AI, then the Diary tab.
 *
 *      /diary                       [ /diary ]                     idx 0
 *      tap Settings   (root, not behind us)      replace
 *                                   [ /settings ]                  idx 0
 *      tap AI         (parent is /settings)      push
 *                                   [ /settings, /settings/ai ]    idx 1
 *      tap Diary tab  (root, not behind us)      replace
 *                                   [ /settings, /diary ]          idx 1
 *
 *    Back from the diary lands on Settings: one step, not four. Before this
 *    change the same walk left four entries and Back replayed all of them.
 *
 * 2. Paging the diary six days.
 *
 *      /diary?date=D0               [ /diary ]                     idx 0
 *      D1 D2 D3 D4 D5 D6  (same pathname every time)  replace x6
 *                                   [ /diary ]                     idx 0
 *
 *    The stack never grows, so Back leaves the app instead of walking the six
 *    days backwards one gesture at a time.
 *
 * 3. A deep link into one entry, then the chrome's Back link.
 *
 *      /diary/entry/abc  (cold start)  [ /diary/entry/abc ]        idx 0
 *      tap Back  -> /diary?date=D  (a root, and nothing is behind us)
 *                                      replace
 *                                   [ /diary?date=D ]              idx 0
 *
 *    Nothing was skipped, because nothing was ever there: the person arrived
 *    from outside, so there is no earlier entry to pop to and a push would
 *    have invented one.
 *
 * 4. Diary, Add, save (the action-redirect case).
 *
 *      /diary                       [ /diary ]                     idx 0
 *      tap Add        (root)                     replace
 *                                   [ /add ]                       idx 0
 *      save    -> the clientAction redirects to /diary, and the submission
 *                 carries `replace` (see the routes changed for item 5), so
 *                 React Router replaces rather than pushes
 *                                   [ /diary ]                     idx 0
 *
 *    Without that `replace` the stack would end `[ /add, /diary ]` and Back
 *    would land on the form that was just submitted.
 */

/** What a navigation should do to the history stack. */
export type NavigationKind = 'push' | 'replace' | 'pop';

/** The answer `decideNavigation` gives, and the only thing the hook acts on. */
export interface NavigationDecision {
  kind: NavigationKind;
  /** For `pop` only: how many entries back, to hand to `navigate(-steps)`. */
  steps?: number;
  /**
   * For `pop` only: the exact destination, kept so `useSettleAppNavigation`
   * can correct the landing.
   *
   * The ledger records PATHNAMES, so a pop can only ever aim at a pathname.
   * The entry it lands on may carry a different search (`/diary?date=` is the
   * obvious one), so the settle step compares the landed location against this
   * and replaces when they differ. It is set on every pop rather than only on
   * a differing search, because "differing" is not knowable from the note.
   */
  settle?: string;
}

export interface NavigationDecisionInput {
  /** The pathname the person is on now, no search and no hash. */
  from: string;
  /** The destination as an href: pathname, plus any search and hash. */
  to: string;
  /** The caller's explicit `replace`, when it passed one. */
  replace?: boolean;
  ledger: HistoryLedger;
  /** React Router's `history.state.idx` for the current entry. */
  idx: number;
}

/** The pathname half of an href, dropping any search and hash. */
function pathnameOf(href: string): string {
  const withoutHash = href.split('#')[0] ?? '';
  return withoutHash.split('?')[0] ?? '';
}

/**
 * PUSH, REPLACE OR POP, and the reason for each.
 *
 * Pure, so the four rules are unit-testable without a router, a DOM or a
 * history. The hook below is deliberately thin over it.
 *
 * The rules are tried in this order:
 *
 *   a. An explicit `replace` from the caller wins. A caller that has already
 *      thought about the stack (a wizard step replacing itself, a redirect
 *      away from a screen that should not be returned to) is not second
 *      guessed.
 *   b. Same pathname: replace. A query or hash change is the same screen
 *      showing something else, and diary day paging and the `/add` filters
 *      both live here. Six days of paging must cost zero history entries.
 *   c. One level deeper (`isDeeper`): push. This is the ONLY thing that grows
 *      the stack, which is what makes Back mean "up".
 *   d. Already behind us: pop to it. Tapping Diary from Settings when the
 *      diary is two entries back returns to it rather than stacking a third
 *      copy, so the stack stays as short as the walk really was.
 *   e. Otherwise: replace. A sideways move between two roots, or a jump that
 *      skipped levels. Pushing would give Back a step that leads somewhere
 *      the person never was.
 */
export function decideNavigation({ from, to, replace, ledger, idx }: NavigationDecisionInput): NavigationDecision {
  // (a) The caller has decided.
  if (replace !== undefined) return { kind: replace ? 'replace' : 'push' };

  const target = pathnameOf(to);

  // (b) Same screen, different query or hash.
  if (target === pathnameOf(from)) return { kind: 'replace' };

  // (c) Exactly one level down.
  if (isDeeper(from, target)) return { kind: 'push' };

  // (d) Somewhere we have already been.
  const steps = findEarlier({ ledger, idx, pathname: target });
  if (steps !== null) return { kind: 'pop', steps, settle: to };

  // (e) Sideways, or a skipped-level jump.
  return { kind: 'replace' };
}

/** `sessionStorage`, or `null` on the server and where storage is denied. */
function browserStorage(): LedgerStorage | null {
  if (globalThis.window === undefined) return null;
  try {
    return globalThis.window.sessionStorage;
  } catch {
    // Storage can throw in a locked-down or third-party context. No note means
    // no pop, which means a replace, which is always safe.
    return null;
  }
}

/**
 * React Router's index for the CURRENT history entry.
 *
 * `createBrowserHistory` writes it (`getHistoryState`, history.js:205-215) and
 * reads it back the same way (`getIndex`, history.js:276-278). Decoded rather
 * than trusted: `history.state` is whatever the last writer put there, and a
 * page restored from the back-forward cache of an older build may carry
 * something else.
 */
const historyStateSchema = z.object({ idx: z.number().int().min(0) });

function currentHistoryIndex(): number {
  if (globalThis.window === undefined) return 0;
  return historyStateSchema.safeParse(globalThis.window.history.state).data?.idx ?? 0;
}

/** Where a pop parks the destination it still owes the person. */
const SETTLE_KEY = 'openplate.history-ledger.settle.v1';

/**
 * The one function `useAppNavigate` hands back.
 *
 * `to` is an HREF STRING, not react-router's `To`. Every call site in the app
 * already passes a string, and a string is the only form this can reason
 * about without re-implementing `createPath`; a caller holding a `Partial<Path>`
 * turns it into one with react-router's own `useHref`, which is exactly what
 * `app/components/link.tsx` does.
 */
export type AppNavigate = (to: string, options?: NavigateOptions) => void;

/**
 * `go(to, options?)`: navigate, shaping the stack instead of always pushing.
 *
 * Drop-in for `useNavigate()`'s function form at every call site in the app.
 * The numeric form (`navigate(-1)`) is deliberately NOT offered: a screen that
 * wants to go back should name where back IS, and let this decide how to get
 * there.
 */
export function useAppNavigate(): AppNavigate {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.pathname;

  return useCallback(
    (to: string, options?: NavigateOptions) => {
      const storage = browserStorage();
      const idx = currentHistoryIndex();
      const ledger = storage === null ? EMPTY_LEDGER : readLedger(storage);
      const decision = decideNavigation({ from, to, replace: options?.replace, ledger, idx });

      if (decision.kind === 'pop' && decision.steps !== undefined && storage !== null) {
        if (decision.settle !== undefined) storage.setItem(SETTLE_KEY, decision.settle);
        navigate(-decision.steps);
        return;
      }

      navigate(to, { ...options, replace: decision.kind === 'replace' });
    },
    [navigate, from],
  );
}

/**
 * Mounted ONCE, in `app/routes/_personal.tsx`. Two effects, both about the
 * history stack and both keyed on the location, so they live in one hook and
 * there is only one mount point to forget:
 *
 * - It RECORDS the landed location in the ledger, at React Router's own index,
 *   truncating anything above it. That note is what makes rule (d) possible.
 * - It SETTLES a pop. `navigate(-n)` lands on a pathname, but the entry there
 *   may carry a different search than the caller asked for, so if a pop parked
 *   a destination and the landing does not match it, this replaces to the
 *   exact destination. No `popstate` listener is involved: this is an ordinary
 *   effect on the location React Router already gives us.
 *
 * The public shell is out of scope. Its pages are a landing page and legal
 * text, where "earlier" is the right meaning of Back.
 */
export function useSettleAppNavigation(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const href = createPath(location);

  useEffect(() => {
    const storage = browserStorage();
    if (storage === null) return;

    writeLedger(
      storage,
      recordLocation({ ledger: readLedger(storage), idx: currentHistoryIndex(), pathname: location.pathname }),
    );

    const pending = storage.getItem(SETTLE_KEY);
    if (pending === null) return;
    storage.setItem(SETTLE_KEY, '');
    // The pop landed where it was aimed; nothing is owed.
    if (pending === href || pending === '') return;
    // It landed on the right pathname but the wrong day (or filter). Correct
    // it in place, so the entry we just popped to becomes the one asked for
    // and the stack length is unchanged.
    if (pathnameOf(pending) !== location.pathname) return;
    navigate(pending, { replace: true });
  }, [href, location.pathname, navigate]);
}
