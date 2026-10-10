/**
 * The people list's filter, kept in the address.
 *
 * ── Why the address ──────────────────────────────────────────────────────
 *
 * `/admin?view=new&sort=oldest&label=Family&q=anna`. A reload lands on the same
 * list, the back button from a person's page returns to the list as it was, and
 * an operator can send a colleague the address of "everybody who never signed
 * in". The pure halves (what a value means, what a default is) are in
 * `people-filter.ts`; this hook only connects them to React Router.
 *
 * ── REPLACE, never push ──────────────────────────────────────────────────
 *
 * A keystroke or a chip is a correction to the list on screen, not a step
 * deeper. A history entry per keystroke would make Back walk through the
 * letters of a search, so every write replaces the current entry.
 *
 * ── The search box is not driven by the address ──────────────────────────
 *
 * The text in the box is local state, and the address follows it a moment
 * later. A box driven by the address would take its value back from a
 * navigation that lands a few microtasks late, and fast typing would drop
 * letters and throw the caret to the end. The address is written once typing
 * pauses (and at once for any other change), which also keeps well clear of
 * the limit Safari puts on history writes.
 *
 * A change that arrives from OUTSIDE (the back button, a pasted address) is
 * told apart from our own by remembering the last query we wrote: only a
 * different one is copied into the box.
 *
 * ── Why no loader runs ───────────────────────────────────────────────────
 *
 * Changing the search of the current page revalidates its loaders by default.
 * `admin.tsx` exports a `shouldRevalidate` that declines for a same-path
 * navigation, so nothing is fetched per keystroke and no navigation state
 * lights the progress bar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  isSameLabelFilter,
  readPeopleFilter,
  urlQueryOf,
  writePeopleFilter,
  type PeopleFilter,
} from '#app/lib/admin/people-filter';

/** How long typing must pause before the address follows. */
export const QUERY_WRITE_DELAY_MS = 250;

/**
 * @param knownLabels - the labels present on the instance; a label in the
 *   address that is not among them reads as "any label".
 * @returns the filter in force, and the function that changes it.
 */
export function usePeopleFilter(knownLabels: readonly string[]): [PeopleFilter, (next: PeopleFilter) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromAddress = readPeopleFilter({ params: searchParams, knownLabels });

  const [typed, setTyped] = useState(fromAddress.query);
  const filter: PeopleFilter = { ...fromAddress, query: typed };

  // The query last written to the address, and the filter last returned, so a
  // timer that fires later and an address change that lands later can both be
  // judged against what the screen holds NOW, not what it held when they began.
  const lastWrittenQuery = useRef(fromAddress.query);
  const latest = useRef(filter);
  latest.current = filter;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (fromAddress.query === lastWrittenQuery.current) return;
    lastWrittenQuery.current = fromAddress.query;
    setTyped(fromAddress.query);
  }, [fromAddress.query]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const writeAddress = useCallback(
    (next: PeopleFilter): void => {
      lastWrittenQuery.current = urlQueryOf(next.query);
      setSearchParams(writePeopleFilter(next), { replace: true, preventScrollReset: true });
    },
    [setSearchParams],
  );

  const change = useCallback(
    (next: PeopleFilter): void => {
      setTyped(next.query);
      if (timer.current !== null) clearTimeout(timer.current);
      const current = latest.current;
      const isOnlyTyping =
        next.view === current.view && next.sort === current.sort && isSameLabelFilter(next.label, current.label);
      if (!isOnlyTyping) {
        writeAddress(next);
        return;
      }
      timer.current = setTimeout(() => writeAddress(next), QUERY_WRITE_DELAY_MS);
    },
    [writeAddress],
  );

  return [filter, change];
}
