/**
 * THE ONE NOTIFICATION CHANNEL.
 *
 * Everything the app used to say in a floating toast is said here instead, and
 * the app header's title slot is where it is said (`components/header-status.tsx`).
 * The owner's decision on 2026-09-10 was that there are no toasts any more: a
 * toast covered the controls under it, needed its own z-index argument against
 * the header and the bottom nav, and was a second, floating place for the app
 * to speak. The header already speaks, it is sticky, and while a status is up
 * it is the one thing on screen saying anything.
 *
 * Shape of the thing: a module-scoped "latest wins" slot plus a
 * `useSyncExternalStore` subscription. There is no queue and no stacking. A
 * second publish replaces the first, exactly as a second sentence replaces the
 * first in a conversation.
 *
 * A PUBLISHED STATUS WITH NO HOST ON SCREEN IS SILENTLY LOST. This module only
 * holds the message; something has to be rendering `HeaderStatus` for it to be
 * read. Today that is `components/app-wrapper.tsx`'s header, which every route
 * under `routes/_personal.tsx` wears, and every call site in the app is on one
 * of those routes. A new caller on the PUBLIC chrome (`components/public-shell.tsx`,
 * which has no title slot at all) would publish into nothing, and nobody would
 * see a failure, so a new surface needs a host mounted before it gets a voice.
 *
 * SERVER RENDERING. `getServerSnapshot` reads the same module slot, which is
 * process-wide rather than per-request. That is safe only because nothing
 * publishes during a server render: every caller is an event handler, an
 * effect, or a `clientAction`, all of which run in the browser. Do not publish
 * from a `loader` or from a component body.
 */
import { useSyncExternalStore } from 'react';

/** How loud the message is, and which colour and icon carry it. */
export type StatusTone = 'info' | 'success' | 'warning' | 'error';

/** The single trailing control a status may offer. The diary's "Undo" is the reason this exists. */
export interface StatusAction {
  label: string;
  onClick: () => void;
}

/** What a host renders. `id` is monotone per publish, so a republish is always a new key. */
export interface StatusMessage {
  id: number;
  text: string;
  /** The optional second, smaller line. `null` when the message is one line. */
  description: string | null;
  tone: StatusTone;
  action: StatusAction | null;
}

/** What a caller passes. Only `text` is required; every other field has a default worth having. */
export interface PublishStatusInput {
  text: string;
  description?: string;
  tone?: StatusTone;
  action?: StatusAction;
  /** Milliseconds until it clears itself, or `null` to persist until dismissed. Defaults per tone. */
  ttlMs?: number | null;
}

/**
 * How long each tone stays up when the caller does not say.
 *
 * A warning gets half again as long as a confirmation because it usually asks
 * the reader to do something later; an error gets `null`, meaning it stays
 * until the reader dismisses it, because an error that scrolled past on its own
 * is an error nobody handled.
 */
export const STATUS_TTL_MS = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: null,
} satisfies Record<StatusTone, number | null>;

let current: StatusMessage | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function cancelTimer(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

/**
 * Publishes a status. Latest wins: whatever was showing is replaced outright.
 *
 * @param input - the message, its tone, and how long it should stay.
 */
export function publishStatus({ text, description, tone = 'info', action, ttlMs }: PublishStatusInput): void {
  cancelTimer();
  current = {
    id: nextId++,
    text,
    description: description ?? null,
    tone,
    action: action ?? null,
  };
  emit();
  const ttl = ttlMs === undefined ? STATUS_TTL_MS[tone] : ttlMs;
  if (ttl === null) return;
  timer = setTimeout(() => {
    current = null;
    timer = null;
    emit();
  }, ttl);
}

/** Clears whatever is showing. The dismiss control calls this; so does a caller that has changed its mind. */
export function clearStatus(): void {
  cancelTimer();
  current = null;
  emit();
}

/** The current message, read without subscribing. The test seam, and what both snapshots return. */
export function readStatus(): StatusMessage | null {
  return current;
}

/** Test seam: drops the message AND the id counter, so one test's ids can't leak into the next one's. */
export function resetStatusChannel(): void {
  cancelTimer();
  current = null;
  nextId = 1;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** Subscribes a component to the channel. Re-renders on every publish and every clear. */
export function useStatus(): StatusMessage | null {
  return useSyncExternalStore(subscribe, readStatus, readStatus);
}
