/**
 * Whether the sign-out dialog is open, and whether its work is running, held
 * outside React so the dialog can outlive the session it signs out of.
 *
 * ── The defect this exists for ───────────────────────────────────────────
 *
 * The dialog used to render inside two places that both depend on the session:
 * `/settings/account` draws its card only while there is an account, and the
 * header menu swaps its sign-out row for the sign-in row the moment there is
 * none. The first step of `runSignOut` closes the session, so the dialog
 * UNMOUNTED at the start of its own work. When the erase then threw, because a
 * second tab held the database, `setError` wrote to a component that no longer
 * existed and the hard navigation never ran. The person saw a signed-out app,
 * the diary still on the device, and no message at all.
 *
 * ── What the store is for ────────────────────────────────────────────────
 *
 * Two facts that more than one place needs, and that no one component can own:
 *
 * - `isOpen`: any door (the header row, the settings button) opens the one
 *   dialog by calling `openSignOutDialog()`. The dialog itself is mounted ONCE,
 *   in `root.tsx`, above every route, so it is there whatever the session does.
 *   A door is a plain button with no trigger plumbing and no state of its own.
 * - `phase`: `running` from the first step of the sign-out until it ends, and
 *   `failed` when the erase threw. `useRevalidateWhenTheSessionEnds` asks
 *   `isSignOutRunning()`, because the session ending is then the sign-out's own
 *   doing and a revalidation would race the lock and flash `/welcome` before the
 *   hard navigation.
 *
 * ── A running sign-out cannot be closed ──────────────────────────────────
 *
 * `closeSignOutDialog()` does nothing while `running`. Escape ends in it, and
 * so does the Cancel button (which is disabled while running anyway). A click
 * on the overlay does NOT close a Radix AlertDialog, running or not: an alert
 * dialog wants an answer, so only Escape and Cancel leave it. Closing a dialog
 * whose work is in flight would bring back exactly the silent failure above:
 * the error would have nowhere to be shown. Once the phase is `failed` (or
 * `idle`) it closes as usual.
 *
 * ── Where the keyboard goes back to ──────────────────────────────────────
 *
 * The dialog has no Radix Trigger, because no door owns it, and Radix returns
 * focus to the trigger when a dialog closes: with none, it returned it to
 * nothing and a keyboard user was back at the top of the document.
 * `openSignOutDialog()` therefore records the element that had focus when a
 * door opened the dialog, and `returnFocusAfterSignOutDialog()` gives focus
 * back to it. A header menu row is gone with its menu by then, so the answer
 * for that door is the avatar button that opened the menu.
 *
 * ── Why not React state in the root ──────────────────────────────────────
 *
 * The doors live deep in two different trees. A context would put a provider
 * and a re-rendering consumer in the root for two booleans, and the sync
 * session store next door already shows the shape that avoids it: a module
 * variable, a listener set, and `useSyncExternalStore`.
 *
 * ── Server rendering ─────────────────────────────────────────────────────
 *
 * The host renders during SSR. The server snapshot is a constant (closed, idle)
 * and nothing here touches `window`, so the server and the first client render
 * agree and there is no hydration mismatch.
 */
import { useSyncExternalStore } from 'react';

/** What the sign-out's work is doing. `idle` is the resting state, before and after a dialog. */
export type SignOutPhase = 'idle' | 'running' | 'failed';

/** Everything a component needs to draw the sign-out dialog. */
export interface SignOutProgress {
  /** Whether the dialog is on screen. */
  isOpen: boolean;
  /** Whether the sign-out is running, has failed, or has not started. */
  phase: SignOutPhase;
}

/** What server-rendered markup sees, and where the store starts: closed and idle. */
const CLOSED: SignOutProgress = { isOpen: false, phase: 'idle' };

let snapshot: SignOutProgress = CLOSED;
const listeners = new Set<() => void>();

function publish(next: SignOutProgress): void {
  if (next.isOpen === snapshot.isOpen && next.phase === snapshot.phase) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function getSnapshot(): SignOutProgress {
  return snapshot;
}

function getServerSnapshot(): SignOutProgress {
  return CLOSED;
}

/**
 * The element that had focus when a door opened the dialog. A module variable
 * like the snapshot, and never touched at import: the server has no `document`.
 */
let focusedBeforeOpening: HTMLElement | null = null;

/** The avatar button of the header menu, the fallback home of focus (`avatar-menu.tsx` names it). */
const AVATAR_TRIGGER_SELECTOR = '[data-slot="avatar-menu-trigger"]';

/** Remembers what had focus, unless the dialog is already open (a second call must not record the dialog's own button). */
function recordFocusedElement(): void {
  if (snapshot.isOpen) return;
  if (globalThis.document === undefined) return;
  const active = document.activeElement;
  focusedBeforeOpening = active instanceof HTMLElement && active !== document.body ? active : null;
}

/** Opens the dialog. Every door calls this and nothing else. */
export function openSignOutDialog(): void {
  recordFocusedElement();
  publish({ ...snapshot, isOpen: true });
}

/**
 * Gives focus back after the dialog has closed: to the element that had it
 * when the dialog opened, if that is still on the page, and to the avatar
 * button otherwise (a menu row does not outlive its menu). Called from the
 * dialog's `onCloseAutoFocus`, in place of the trigger it does not have.
 */
export function returnFocusAfterSignOutDialog(): void {
  const recorded = focusedBeforeOpening;
  focusedBeforeOpening = null;
  if (globalThis.document === undefined) return;
  const target = recorded?.isConnected ? recorded : document.querySelector<HTMLElement>(AVATAR_TRIGGER_SELECTOR);
  target?.focus();
}

/**
 * Closes the dialog, unless the sign-out is running.
 *
 * A no-op while `running`: see the header. The dialog's own `onOpenChange`
 * guards the same case, and this is the second lock, so no caller can close a
 * dialog whose work is in flight.
 */
export function closeSignOutDialog(): void {
  if (snapshot.phase === 'running') return;
  publish({ ...snapshot, isOpen: false });
}

/** Records what the sign-out's work is doing. */
export function setSignOutPhase(phase: SignOutPhase): void {
  publish({ ...snapshot, phase });
}

/** Whether a sign-out is running right now, for code that is not a component. */
export function isSignOutRunning(): boolean {
  return snapshot.phase === 'running';
}

/** The dialog's state right now, for code that is not a component (an event handler, a test). */
export function getSignOutProgress(): SignOutProgress {
  return snapshot;
}

/** The dialog's state, re-rendering the caller when it changes. */
export function useSignOutProgress(): SignOutProgress {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
