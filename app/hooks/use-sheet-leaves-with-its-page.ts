import { useEffect, type Dispatch, type MouseEvent, type SetStateAction } from 'react';

/** What a bottom sheet hands the hook: its open state and the setter that owns it. */
export interface SheetOpenState {
  isOpen: boolean;
  /** React's own state setter, which is stable, so the listener is not re-added on every render. */
  setIsOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * Closes a bottom sheet when the page it was opened on goes, and at no other moment.
 *
 * THE SHEET CLOSES WHEN ONE OF ITS OWN LINKS IS USED, not when a location
 * commits. The add sheet and the More sheet both used to close on a change of
 * `location.key`, and that change reaches React when it renders the new
 * location, which on a slow phone is well after the navigation started: the
 * person taps a link, the old screen is still up with the bar under it, they
 * open a sheet, and then the new location lands and shuts the sheet they have
 * just opened (2026-09-27, `add-sheet-outlives-a-pending-navigation.spec.ts`
 * and `more-sheet-outlives-a-pending-navigation.spec.ts`). So the close follows
 * the tap instead: the returned handler goes on the sheet's content, and a
 * click that reached any link inside it closes the sheet.
 *
 * BACK AND FORWARD STILL CLOSE IT: the page the sheet was opened on is gone.
 * A history move fires `popstate` at once, before any render, so this
 * listener has no window for the race above.
 *
 * WHAT NO LONGER CLOSES IT is a navigation that nothing in the sheet started.
 * While a sheet is open it is modal, so the only such navigation is one the
 * app starts by itself, and one that started before the tap is exactly the
 * race this hook exists to lose.
 *
 * @param state - the sheet's open state and its setter.
 * @returns the click handler for the sheet's content.
 */
export function useSheetLeavesWithItsPage({
  isOpen,
  setIsOpen,
}: SheetOpenState): (event: MouseEvent<HTMLElement>) => void {
  useEffect(() => {
    if (!isOpen) return;
    const close = (): void => setIsOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, [isOpen, setIsOpen]);

  return (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('a[href]') === null) return;
    setIsOpen(false);
  };
}
