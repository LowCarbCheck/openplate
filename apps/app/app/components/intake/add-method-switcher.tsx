/**
 * Search, Describe, Photo: the one door between the three add screens
 * (M255/01).
 *
 * ADR-0019 put the three intake screens side by side under `/add` and left
 * the switch between them as its own piece of work. Until this existed each
 * screen carried a sentence pointing at one other screen ("Scan your plate
 * instead", "Search the food database instead", "Add food without a photo"),
 * three doors that each reached one of two places, and none of them kept what
 * the person had started. This row replaces all three, and `add-drafts.ts`
 * is what makes leaving safe: every screen keeps its draft there.
 *
 * DRAWN BY THE LAYOUT, not by the screens. `app/routes/add.tsx` renders it
 * once above `<Outlet />`, so it stays mounted across a switch and sits in the
 * same box on all three screens; a copy per screen would remount on every
 * switch and could drift a pixel from its siblings.
 *
 * WHAT A LINK CARRIES: the day (`?date=`) and the meal slot (`?meal=`) the
 * person is logging to, and for Search the words still in its box. Nothing
 * else. `?speak=1` is a request to arm the composer once, and `?q=` on the
 * current screen is that screen's own business.
 *
 * INERT WHILE AN ANALYSIS RUNS. A photo or a sentence being read by the AI is
 * a paid request in flight, and leaving the screen would throw its answer
 * away. The photo screen reports that through `useReportAddMethodBusy`; the
 * links then keep their box and their address and refuse the tap
 * (`aria-disabled`), rather than disappearing and moving the screen.
 *
 * NO TEAL. `/add` spends five teal marks today (`tests/design-contract.ts`),
 * and a selected segment does not need the brand colour to be read as
 * selected: it is inverted, from the same foreground and background tokens
 * the rest of the page is written in, and it carries `aria-current`.
 */
import { createContext, useContext, useEffect, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { NavLink } from '#app/components/link';
import { ADD_METHODS, readAddDraft, type AddMethod } from '#app/lib/add-drafts';
import { ADD_DESCRIBE_PATH, ADD_PHOTO_PATH, ADD_SEARCH_PATH, buildIntakeHref } from '#app/lib/intake-hrefs';
import { MEAL_TYPES } from '#app/lib/meal-choice';
import { parseDateParam } from '#app/lib/user-days';
import { cn } from '#app/lib/utils';

/** Where each method lives (ADR-0019). */
const METHOD_PATHS = {
  search: ADD_SEARCH_PATH,
  describe: ADD_DESCRIBE_PATH,
  photo: ADD_PHOTO_PATH,
} satisfies Record<AddMethod, string>;

/** Each method's catalog key. */
const METHOD_LABEL_KEYS = {
  search: 'add.methods.search',
  describe: 'add.methods.describe',
  photo: 'add.methods.photo',
} satisfies Record<AddMethod, string>;

/** A `?meal=` worth forwarding: one of the four slots, never whatever the address happened to say. */
const mealSlotParam = z.enum(MEAL_TYPES);

/**
 * The address of one method, carrying the day and the meal slot.
 *
 * @param options.method - the method the link opens.
 * @param options.date - the viewed day from the current address, or `null` for today.
 * @param options.slot - the meal slot from the current address, when it is a real one.
 * @param options.searchText - the words the search draft holds, for the Search link only.
 * @returns the href.
 */
export function addMethodHref({
  method,
  date,
  slot,
  searchText,
}: {
  method: AddMethod;
  date: string | null;
  slot: string | undefined;
  searchText: string;
}): string {
  const query = method === 'search' ? searchText.trim() : '';
  const path = query === '' ? METHOD_PATHS[method] : `${METHOD_PATHS[method]}?${new URLSearchParams({ q: query })}`;
  return buildIntakeHref(path, { date, slot });
}

/** Tells the layout whether an analysis is in flight. The default does nothing, for a screen rendered outside `/add`. */
const AddMethodBusyContext = createContext<(isBusy: boolean) => void>(() => undefined);

/** Provided by `app/routes/add.tsx`, which owns the busy flag the switcher reads. */
export const AddMethodBusyProvider = AddMethodBusyContext.Provider;

/**
 * Reports to the switcher whether this screen has an analysis in flight.
 *
 * The flag is cleared when the screen unmounts, so a screen that is left by
 * another way out (the bottom bar, the back gesture) never leaves the
 * switcher inert behind it.
 *
 * @param isBusy - true while a paid request is running.
 */
export function useReportAddMethodBusy(isBusy: boolean): void {
  const setBusy = useContext(AddMethodBusyContext);
  useEffect(() => {
    setBusy(isBusy);
  }, [isBusy, setBusy]);
  useEffect(() => () => setBusy(false), [setBusy]);
}

/** Stops a tap on an inert link before the router sees it. */
function refuseNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}

/**
 * The switcher row.
 *
 * @param isBusy - true while the photo screen has an analysis in flight.
 */
export function AddMethodSwitcher({ isBusy }: { isBusy: boolean }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const date = parseDateParam(searchParams.get('date'));
  const slot = mealSlotParam.safeParse(searchParams.get('meal')).data;
  // Read at render, and this component renders on every navigation between
  // the three screens (it reads the address), which is exactly when a draft
  // written on the screen just left needs to be in the Search link.
  const searchText = readAddDraft('search')?.q ?? '';

  return (
    <nav
      aria-label={t('add.methods.label')}
      data-slot="add-method-switcher"
      className="mx-auto grid w-full max-w-2xl grid-cols-3 gap-1 border bg-card p-1"
    >
      {ADD_METHODS.map((method) => (
        <NavLink
          key={method}
          to={addMethodHref({ method, date, slot, searchText })}
          data-method={method}
          aria-disabled={isBusy ? true : undefined}
          onClick={isBusy ? refuseNavigation : undefined}
          // The address alone decides which one is lit. `NavLink` compares
          // the path and ignores the query, so `/add/search?q=egg` is still
          // Search, and it writes `aria-current="page"` itself.
          className={({ isActive }) =>
            cn(
              // One box for every state: the same padding, the same weight,
              // the same height, so selecting, busying or relabelling a
              // segment never moves anything.
              'flex min-h-11 min-w-0 items-center justify-center px-1 py-1.5 text-center text-sm font-medium leading-tight transition-colors',
              'hyphens-auto break-words focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
              'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
              isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {t(METHOD_LABEL_KEYS[method])}
        </NavLink>
      ))}
    </nav>
  );
}
