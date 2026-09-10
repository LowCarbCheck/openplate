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
 * NO PUBLISHED STATUS IS EVER LOST (owner, 2026-09-10). It used to be: this
 * module only holds the message, and something has to be rendering it for it to
 * be read, which was `components/app-wrapper.tsx`'s header and nowhere else. A
 * publish from the public chrome or from a bare top-level route went into
 * nothing, with no failure anywhere. The fix is a HOST COUNT, kept here: every
 * `HeaderStatus` registers itself while it is mounted, and
 * `components/status-fallback-host.tsx`, mounted once at the root, watches that
 * count and draws its own bar when it is zero. Read
 * `components/status-fallback-host.tsx` for the three tiers.
 *
 * The count lives beside the message rather than in the fallback component
 * because the two are read together: a fallback that counted its own siblings
 * would have to know about every shell, and this way a new shell only has to
 * mount `HeaderStatus`.
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

/**
 * Test seam: drops the message, the id counter AND the host count, so one
 * test's ids and one test's mounted hosts can't leak into the next one's.
 */
export function resetStatusChannel(): void {
  cancelTimer();
  current = null;
  nextId = 1;
  hostCount = 0;
  emitHosts();
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

let hostCount = 0;
const hostListeners = new Set<() => void>();

function emitHosts(): void {
  for (const listener of hostListeners) listener();
}

/**
 * Declares that a host for this channel is on screen, and returns the call that
 * takes the declaration back. `HeaderStatus` calls this in a mount effect and
 * returns the result as the cleanup, so the count is exactly the number of
 * mounted hosts.
 *
 * @returns the unregister call. Calling it twice is harmless; the second call does nothing.
 */
export function registerStatusHost(): () => void {
  hostCount += 1;
  emitHosts();
  let isReleased = false;
  return () => {
    if (isReleased) return;
    isReleased = true;
    hostCount -= 1;
    emitHosts();
  };
}

/** How many hosts are mounted, read without subscribing. The test seam, and the client snapshot. */
export function readStatusHostCount(): number {
  return hostCount;
}

function subscribeHosts(onStoreChange: () => void): () => void {
  hostListeners.add(onStoreChange);
  return () => {
    hostListeners.delete(onStoreChange);
  };
}

/**
 * Subscribes a component to the host count. Re-renders whenever a host mounts
 * or unmounts.
 *
 * BOTH snapshots read the same module slot, exactly as `useStatus` does. On a
 * real server that slot is always zero and cannot be anything else: the only
 * caller of `registerStatusHost` is a mount effect, and effects never run
 * during a server render. So a server render always reports "no host", the
 * honest answer for HTML that has not hydrated, and the first client render
 * agrees with it. Reading the slot rather than returning a hard-coded zero is
 * also what lets a static-render test drive the count, which is the only way to
 * test the fallback without a DOM.
 */
export function useStatusHostCount(): number {
  return useSyncExternalStore(subscribeHosts, readStatusHostCount, readStatusHostCount);
}
