/**
 * The device-local choice between the two ways to read a macro share: by
 * calories (the default, the standard) or by grams.
 *
 * Every macro share visual in the app (the diary's "What you ate", the
 * Insights "An average day" and "Where your calories come from") shows the
 * calorie share until the person taps "g" on the small control beside it. The
 * choice is kept here, in the browser, and is deliberately NOT synced, exported
 * or erased with a diary: like the kg/lb unit
 * (`#app/lib/weight-unit-preference`) it is a rendering preference, not health
 * data.
 *
 * `useMacroShareBasis` is a `useSyncExternalStore` over this module, so two
 * visuals on one page switch together, and a second tab follows through the
 * `storage` event.
 */
import { useSyncExternalStore } from 'react';

/** Which quantity a macro share is a share of. */
export type MacroShareBasis = 'kcal' | 'grams';

/** The two bases, in the order the control draws them. */
export const MACRO_SHARE_BASES = ['kcal', 'grams'] as const satisfies readonly MacroShareBasis[];

/** What a person who never touched the control sees. */
export const DEFAULT_MACRO_SHARE_BASIS: MacroShareBasis = 'kcal';

/** Browser-local (not synced) preference for every macro share visual. */
export const MACRO_SHARE_BASIS_STORAGE_KEY = 'openplate:macro-share-basis';

/**
 * Reads the stored basis, defaulting to calories when unset, unreadable or
 * holding anything but `'grams'` (server render, private browsing, a value an
 * older or newer build wrote).
 *
 * @returns the stored basis, or `'kcal'`.
 */
export function readStoredMacroShareBasis(): MacroShareBasis {
  if (globalThis.window === undefined) return DEFAULT_MACRO_SHARE_BASIS;
  try {
    const stored = window.localStorage.getItem(MACRO_SHARE_BASIS_STORAGE_KEY);
    return stored === 'grams' ? 'grams' : DEFAULT_MACRO_SHARE_BASIS;
  } catch {
    return DEFAULT_MACRO_SHARE_BASIS;
  }
}

/**
 * Persists the basis. A no-op outside the browser, and a write failure
 * (private mode, full quota) is swallowed: losing a display preference must
 * never take a page down.
 *
 * @param basis - the basis to remember.
 */
export function writeStoredMacroShareBasis(basis: MacroShareBasis): void {
  if (globalThis.window === undefined) return;
  try {
    window.localStorage.setItem(MACRO_SHARE_BASIS_STORAGE_KEY, basis);
  } catch {
    // Ignored by design, see this function's doc.
  }
}

/** Every mounted `useMacroShareBasis`, told when this tab changes the choice. */
const listeners = new Set<() => void>();

/**
 * The choice made in this tab, held in memory too, so a browser that refuses
 * the storage write (private mode) still switches the visuals for the rest of
 * the visit. A `storage` event from another tab clears it: storage wins again.
 */
let chosenInThisTab: MacroShareBasis | null = null;

function getSnapshot(): MacroShareBasis {
  return chosenInThisTab ?? readStoredMacroShareBasis();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MACRO_SHARE_BASIS_STORAGE_KEY && event.key !== null) return;
    chosenInThisTab = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The server renders the default, so a hydrating client never disagrees with the markup it was sent. */
function getServerSnapshot(): MacroShareBasis {
  return DEFAULT_MACRO_SHARE_BASIS;
}

/**
 * The basis every macro share visual should draw, and the setter the control
 * calls. The setter writes storage first and then tells every visual in this
 * tab, so they all repaint in the same commit.
 *
 * @returns a `[basis, setBasis]` pair.
 */
export function useMacroShareBasis(): readonly [MacroShareBasis, (basis: MacroShareBasis) => void] {
  const basis = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [basis, setMacroShareBasis] as const;
}

function setMacroShareBasis(basis: MacroShareBasis): void {
  chosenInThisTab = basis;
  writeStoredMacroShareBasis(basis);
  for (const notify of listeners) notify();
}
