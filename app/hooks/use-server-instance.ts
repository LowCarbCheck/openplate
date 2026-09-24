/**
 * WHAT THE SYNC SERVER SAYS ABOUT ITSELF, as a hook.
 *
 * `/health` is one small, unauthenticated document that answers several
 * questions a screen has: which model this instance proxies, and how long it
 * keeps a photograph somebody reports. Both used to be two separate concerns
 * with one read between them; this is that read, in one place, so a second
 * consumer does not mean a second request.
 *
 * FETCHED ONCE PER SERVER AND CACHED AT MODULE SCOPE. Every screen that can
 * scan, and every entry that can be reported, would otherwise ask on mount. The
 * document does not change while a tab is open, this app talks to exactly one
 * server, and an operator moving it means a new document anyway. The cache dies
 * with the tab.
 *
 * A ROUTE GATE DOES NOT READ THE CACHE. A hint on a screen may be as old as
 * the tab; a gate that opens a page may not, because the same server can
 * answer differently an hour later (M245/05). A gate calls
 * {@link readFreshServerInstance}, which asks again.
 *
 * FAILS OPEN, like the read underneath it: an unreachable service, a malformed
 * body or a service older than the fields all yield `null`. Every caller must
 * treat `null` as "not known", never as a licence to substitute a default of
 * its own, see {@link useFeedbackRetentionDays}.
 */
import { useEffect, useState } from 'react';

import { usePublicConfig } from '#app/hooks/use-public-config';
import { readServerInstance } from '#app/lib/sync/sync-actions';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';

/** One `/health` read, and whether it has answered yet. */
interface InstanceRead {
  promise: Promise<InstanceDescriptor | null>;
  isSettled: boolean;
}

/** One in-flight or settled `/health` read per server URL. Shared by every mount in the tab. */
const instanceCache = new Map<string, InstanceRead>();

/** Told of every FRESH answer, for the one hook that must follow the gate: {@link useFreshServerInstance}. */
type FreshAnswerListener = (serverUrl: string, instance: InstanceDescriptor | null) => void;

/** The mounted {@link useFreshServerInstance} hooks, told whenever a read for their server answers. */
const freshAnswerListeners = new Set<FreshAnswerListener>();

/** Tells every following hook what a read answered. `readServerInstance` never rejects, so every read gets here. */
async function announceAnswer({
  serverUrl,
  answer,
}: {
  serverUrl: string;
  answer: Promise<InstanceDescriptor | null>;
}): Promise<void> {
  const instance = await answer;
  for (const listener of freshAnswerListeners) listener(serverUrl, instance);
}

/** Sends one `/health` read and makes it the tab's answer for that server. */
function startInstanceRead(serverUrl: string): InstanceRead {
  const read: InstanceRead = { promise: readServerInstance(serverUrl), isSettled: false };
  const settle = (): void => {
    read.isSettled = true;
  };
  read.promise.then(settle, settle);
  void announceAnswer({ serverUrl, answer: read.promise });
  instanceCache.set(serverUrl, read);
  return read;
}

/** The instance descriptor for a server, read at most once per tab. Never rejects. */
export function readCachedServerInstance(serverUrl: string): Promise<InstanceDescriptor | null> {
  return (instanceCache.get(serverUrl) ?? startInstanceRead(serverUrl)).promise;
}

/**
 * The instance descriptor for a server as it answers NOW, for a route gate.
 *
 * A read that is still in flight is reused, because it was sent to this URL
 * and has not answered yet, so it reports the server's current state. A read
 * that has ANSWERED is never reused here: the tab's cache lives as long as the
 * tab, and a server can switch a door off while a tab sits open (M245/05).
 * The fresh answer replaces the cached one, so every screen that reads the
 * cache afterwards agrees with the gate. Never rejects.
 */
export function readFreshServerInstance(serverUrl: string): Promise<InstanceDescriptor | null> {
  const cached = instanceCache.get(serverUrl);
  if (cached !== undefined && !cached.isSettled) return cached.promise;
  return startInstanceRead(serverUrl).promise;
}

/**
 * What this app's sync server says about itself, or `null` while the answer is
 * unknown: no sync server configured, the read still in flight, or a service
 * that could not be reached.
 */
export function useServerInstance(): InstanceDescriptor | null {
  return useServerInstanceRead().instance;
}

/** One `/health` read as a screen sees it: whether it has answered, and what it said. */
export interface ServerInstanceRead {
  /** `false` while the read is in flight. An unreachable service is settled, with `instance: null`. */
  isSettled: boolean;
  instance: InstanceDescriptor | null;
}

/**
 * The same read, and whether it has ANSWERED.
 *
 * FOR A SCREEN THAT DRAWS ONE OF TWO DOORS (M253/02). `useServerInstance`
 * answers `null` both while the read is in flight and after it failed, which
 * is right for a hint and wrong for a door: a header that drew the invite-only
 * wording while the read ran would show it for a moment on an instance whose
 * sign-up is open. So a door draws nothing until `isSettled`, and then draws
 * the one that is true. With no sync server there is nothing to wait for, and
 * the read is settled at once.
 */
export function useServerInstanceRead(): ServerInstanceRead {
  const config = usePublicConfig();
  const syncServerUrl = config?.syncServerUrl ?? null;
  const [read, setRead] = useState<{ url: string; instance: InstanceDescriptor | null } | null>(null);

  useEffect(() => {
    // No sync server on this instance means nothing to ask and nothing that
    // could act on the answer.
    if (syncServerUrl === null) return;
    let isMounted = true;
    const ask = async (): Promise<void> => {
      // `readServerInstance` fails open and never rejects, so there is nothing
      // here for a catch to do: an unreachable service IS the `null` result.
      const next = await readCachedServerInstance(syncServerUrl);
      if (isMounted) setRead({ url: syncServerUrl, instance: next });
    };
    void ask();
    return () => {
      isMounted = false;
    };
  }, [syncServerUrl]);

  if (syncServerUrl === null) return { isSettled: true, instance: null };
  // An answer about another server is no answer about this one.
  if (read === null || read.url !== syncServerUrl) return { isSettled: false, instance: null };
  return { isSettled: true, instance: read.instance };
}

/**
 * What this app's sync server says about itself as of THIS mount, and as of
 * every read after it, or `null` while the answer is unknown.
 *
 * For a DOOR that stays on screen, the navigation entry to the plan page
 * (M250). {@link useServerInstance} may be as old as the tab, which is right
 * for a hint and wrong for a door: after the operator switches the biller off,
 * an entry drawn from the tab's first answer keeps leading to a 404. So this
 * hook asks {@link readFreshServerInstance} once when it mounts, and then
 * follows every later read for the same server, so a gate that finds the door
 * shut takes the entry away with it.
 *
 * Mounted once, in the app shell, and not per menu open: a read per open
 * would send a request per tap and would draw the entry after the menu was
 * already on screen.
 */
export function useFreshServerInstance(): InstanceDescriptor | null {
  const config = usePublicConfig();
  const syncServerUrl = config?.syncServerUrl ?? null;
  const [instance, setInstance] = useState<InstanceDescriptor | null>(null);

  useEffect(() => {
    if (syncServerUrl === null) return;
    let isMounted = true;
    const follow: FreshAnswerListener = (serverUrl, next) => {
      if (isMounted && serverUrl === syncServerUrl) setInstance(next);
    };
    freshAnswerListeners.add(follow);
    const ask = async (): Promise<void> => {
      const next = await readFreshServerInstance(syncServerUrl);
      if (isMounted) setInstance(next);
    };
    void ask();
    return () => {
      isMounted = false;
      freshAnswerListeners.delete(follow);
    };
  }, [syncServerUrl]);

  return instance;
}

/**
 * How long THIS server keeps a reported photograph, in days, or `null` when it
 * has not said.
 *
 * `null` IS NOT A NUMBER WAITING TO BE FILLED IN. It means one of: no sync
 * server, a server with reports switched off, a server older than the field, or
 * an answer that has not arrived. In every one of those cases this app knows of
 * no promise, so it must state none. The number it used to print came from a
 * constant in this repository, which is exactly the defect: an operator who
 * changed the window on their server left the app promising the old one to
 * somebody about to hand over a photograph of their food.
 */
export function useFeedbackRetentionDays(): number | null {
  return useServerInstance()?.feedback?.retentionDays ?? null;
}
