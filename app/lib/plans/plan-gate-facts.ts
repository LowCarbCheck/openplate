/**
 * THE FACTS THE PAYWALL READS, read once per session and kept in memory.
 *
 * `resolvePlanGate` (`plan-gate.ts`) is pure. This module is where its inputs
 * come from, and it exists because of one requirement: the gate must not add a
 * network wait to every navigation. So the two facts that live on the server,
 * the handshake's `plans` flag and `GET /plans/me`, are read ONCE per account,
 * kept in module memory, and read again only in the background. The third
 * fact, the account view (allowance, free scans, role), is already in the
 * session snapshot and is read live on every decision, so a last free scan
 * spent on the scan screen locks the next page without a refetch.
 *
 * ── Keyed on the account, never on a flag ─────────────────────────────────
 *
 * A client read keyed on a value fixed at mount fires before the session
 * exists and never again (the pulse tile, 2026-09-12). Every entry here names
 * the account id and the server it was read from, and a read for anybody else
 * is simply not an answer. A session that is still reopening has no account
 * yet, and the gate answers open for it; `_personal.tsx` asks again once the
 * account arrives.
 *
 * ── Fail open, always ─────────────────────────────────────────────────────
 *
 * A read that throws, a read that outlasts {@link PLAN_GATE_READ_TIMEOUT_MS},
 * a device that is offline: all of them answer open. A failed read is never
 * remembered, so it cannot hold a person out for the cache's life. The core's
 * AI proxy stays the server side backstop.
 *
 * OFFLINE OPENS EVEN OVER FRESH FACTS THAT LOCK. The plan page reads its
 * server loader and the handshake before it draws, so a locked person sent
 * there without a network would land on an error page and lose the diary that
 * works offline. There is nothing to pay offline anyway.
 *
 * ── Nothing is persisted ──────────────────────────────────────────────────
 *
 * The cache is module memory, gone with the tab. A reload reads again, once.
 */
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import type { PlanView } from '#app/lib/sync/engine/client/plans-wire';
import { readFreshServerInstance } from '#app/hooks/use-server-instance';
import { getSyncSessionSnapshot, getSyncVault } from '#app/lib/sync/sync-session';

import {
  planGateStanding,
  resolvePlanGate,
  isPlanGateExempt,
  type PlanGateAccount,
  type PlanGateOutcome,
} from './plan-gate';
import { hasPlansDoor } from './plans-door';
import { currentPlansClient } from './plans-session';

/** How long read facts decide on their own before a navigation asks again in the background. */
export const PLAN_GATE_FACTS_TTL_MS = 5 * 60_000;

/** The longest a navigation waits for the first read of a session before it opens anyway. */
export const PLAN_GATE_READ_TIMEOUT_MS = 2_500;

/** What the gate remembers about one account on one server. */
export interface PlanGateFacts {
  accountId: number;
  serverUrl: string;
  /** The handshake's descriptor, or `null` when it could not be read, which is no door. */
  instance: InstanceDescriptor | null;
  /** `GET /plans/me`, or `null` when there is no door or the biller had no view. */
  planView: PlanView | null;
  /** Epoch ms the read that produced these facts STARTED. A newer read wins. */
  readAt: number;
}

/** How the two server facts are read. Production reads the network; a test passes its own. */
export interface PlanGateReaders {
  /** The descriptor of one server. Never rejects; `null` for an unreadable one. */
  readInstance: (serverUrl: string) => Promise<InstanceDescriptor | null>;
  /** The plan view of the signed-in account, `null` for none. REJECTS when it could not be read. */
  readPlanView: () => Promise<PlanView | null>;
}

/** Who the gate is deciding for: the open session's account and the server it lives on. */
export interface PlanGateSession {
  accountId: number;
  serverUrl: string;
  account: PlanGateAccount;
}

/** The network readers, over the open session. */
const NETWORK_READERS: PlanGateReaders = {
  readInstance: readFreshServerInstance,
  readPlanView: async () => {
    const client = currentPlansClient();
    if (client === null) throw new Error('no session to read the plan over');
    const outcome = await client.readPlan();
    return outcome.status === 'ok' ? outcome.value : null;
  },
};

const OPEN: PlanGateOutcome = { kind: 'open' };

let facts: PlanGateFacts | null = null;
let inFlight: { key: string; promise: Promise<PlanGateFacts | null> } | null = null;
/** Bumped by {@link forgetPlanGateFacts}, so a read that started before it cannot write after it. */
let generation = 0;
const listeners = new Set<() => void>();

function keyOf({ accountId, serverUrl }: { accountId: number; serverUrl: string }): string {
  return `${accountId}\n${serverUrl}`;
}

function isFresh(entry: PlanGateFacts, now: Date): boolean {
  return now.getTime() - entry.readAt < PLAN_GATE_FACTS_TTL_MS;
}

/** Keeps the newer of two reads for the same account, and tells every subscriber. */
function store(next: PlanGateFacts): void {
  if (facts !== null && keyOf(facts) === keyOf(next) && facts.readAt > next.readAt) return;
  facts = next;
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore` subscribe. */
export function subscribePlanGateFacts(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** `useSyncExternalStore` getSnapshot. Identity changes only when a read is stored. */
export function getPlanGateFactsSnapshot(): PlanGateFacts | null {
  return facts;
}

/** The facts held for this account on this server, fresh or stale, or `null`. Reads nothing. */
export function peekPlanGateFacts(who: { accountId: number; serverUrl: string }): PlanGateFacts | null {
  if (facts === null || keyOf(facts) !== keyOf(who)) return null;
  return facts;
}

/** Reads both facts, the plan only behind an open door. Never rejects: a failure is `null`. */
async function fetchFacts({
  accountId,
  serverUrl,
  readAt,
  readers,
}: {
  accountId: number;
  serverUrl: string;
  readAt: number;
  readers: PlanGateReaders;
}): Promise<PlanGateFacts | null> {
  const startedIn = generation;
  try {
    const instance = await readers.readInstance(serverUrl);
    // THE DOOR FIRST, then the plan, never both at once: `PROTOCOL.md` §5.22
    // forbids asking `/v1/plans` to find out whether it exists.
    const planView = hasPlansDoor(instance) ? await readers.readPlanView() : null;
    const next: PlanGateFacts = { accountId, serverUrl, instance, planView, readAt };
    if (startedIn === generation) store(next);
    return next;
  } catch {
    return null;
  }
}

/**
 * Reads the facts for one account now, sharing a read already in flight for it.
 *
 * @returns the facts, or `null` when they could not be read. Never rejects.
 */
export function readPlanGateFacts({
  accountId,
  serverUrl,
  now,
  readers = NETWORK_READERS,
}: {
  accountId: number;
  serverUrl: string;
  now: Date;
  readers?: PlanGateReaders;
}): Promise<PlanGateFacts | null> {
  const key = keyOf({ accountId, serverUrl });
  if (inFlight !== null && inFlight.key === key) return inFlight.promise;
  const promise = fetchFacts({ accountId, serverUrl, readAt: now.getTime(), readers });
  inFlight = { key, promise };
  void promise.finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  return promise;
}

/**
 * What the plan page read, handed to the gate so the next navigation agrees.
 *
 * The checkout return polls the plan until it is active, and the gate must not
 * go on sending that person to the plan page from a read taken before they
 * paid. A read older than the one held is ignored.
 */
export function recordPlanGateView(entry: PlanGateFacts): void {
  store(entry);
}

/**
 * A plan view the plan page read, recorded for the open session. With no
 * session there is nobody to record it for, and nothing happens.
 */
export function notePlanViewForSession({
  instance,
  planView,
  readAt,
  session = currentPlanGateSession(),
}: {
  instance: InstanceDescriptor;
  planView: PlanView;
  readAt: number;
  session?: PlanGateSession | null;
}): void {
  if (session === null) return;
  store({ accountId: session.accountId, serverUrl: session.serverUrl, instance, planView, readAt });
}

/**
 * Drops every fact and any read in flight.
 *
 * For the plan page finding the door shut: a gate still holding `plans: true`
 * would send the person to a page that answers 404.
 */
export function forgetPlanGateFacts(): void {
  generation += 1;
  facts = null;
  inFlight = null;
  for (const listener of listeners) listener();
}

/** The gate's verdict over held facts and the live account. */
function verdictFrom({
  held,
  session,
  pathname,
  now,
}: {
  held: PlanGateFacts;
  session: PlanGateSession;
  pathname: string;
  now: Date;
}): PlanGateOutcome {
  return resolvePlanGate({
    hasPlansDoor: hasPlansDoor(held.instance),
    standing: planGateStanding({ instance: held.instance, account: session.account, planView: held.planView, now }),
    pathname,
  });
}

/** Whether the browser says it has a network. Anything but an explicit `false` is online. */
function isDeviceOnline(): boolean {
  return globalThis.navigator?.onLine !== false;
}

/** Resolves `null` once `timeoutMs` has passed, whatever the read is doing. */
async function withTimeout<T>(promise: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((settle) => {
    timer = setTimeout(() => settle(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The open session, as the gate needs it, or `null` when there is none.
 *
 * Read from the session SNAPSHOT and the vault's server address only: the
 * snapshot carries the account facts, and the vault is what the plan read
 * goes over. A vault for another account than the snapshot's is no session.
 */
export function currentPlanGateSession(): PlanGateSession | null {
  const account = getSyncSessionSnapshot().account;
  const vault = getSyncVault();
  if (account === null || vault === null || vault.accountId !== account.id) return null;
  return { accountId: account.id, serverUrl: vault.serverUrl, account };
}

/**
 * The verdict for a path from what is held right now, without any read.
 *
 * For `shouldRevalidate`, which must answer synchronously, and for the layout
 * deciding whether the page on screen has just become locked. No facts is
 * open.
 */
export function planGateAt({
  pathname,
  now = new Date(),
  session = currentPlanGateSession(),
  isOnline = isDeviceOnline(),
}: {
  pathname: string;
  now?: Date;
  session?: PlanGateSession | null;
  /** `false` opens, see the module header. Defaults to what the browser says. */
  isOnline?: boolean;
}): PlanGateOutcome {
  if (session === null || !isOnline) return OPEN;
  const held = peekPlanGateFacts(session);
  if (held === null) return OPEN;
  return verdictFrom({ held, session, pathname, now });
}

/**
 * The verdict for a navigation, for `_personal.tsx`'s loader.
 *
 * 1. An exempt page, a device with no open session and an offline device
 *    answer open, and read nothing.
 * 2. Fresh facts decide at once.
 * 3. Stale facts that open decide at once too, and a read starts behind them.
 * 4. Stale facts that would LOCK are read again first, so a plan bought on
 *    another device opens the app instead of showing the plan page once more.
 * 5. No facts: the first read of the session, waited for up to
 *    `timeoutMs`.
 *
 * Steps 4 and 5 answer open when the read fails or outlasts the timeout.
 */
export async function resolvePlanGateForNavigation({
  pathname,
  now = new Date(),
  timeoutMs = PLAN_GATE_READ_TIMEOUT_MS,
  session = currentPlanGateSession(),
  readers = NETWORK_READERS,
  isOnline = isDeviceOnline(),
}: {
  pathname: string;
  now?: Date;
  timeoutMs?: number;
  session?: PlanGateSession | null;
  readers?: PlanGateReaders;
  /** `false` opens, see the module header. Defaults to what the browser says. */
  isOnline?: boolean;
}): Promise<PlanGateOutcome> {
  if (isPlanGateExempt(pathname) || session === null || !isOnline) return OPEN;
  const held = peekPlanGateFacts(session);
  if (held !== null && isFresh(held, now)) return verdictFrom({ held, session, pathname, now });
  const read = () => readPlanGateFacts({ accountId: session.accountId, serverUrl: session.serverUrl, now, readers });
  if (held !== null && verdictFrom({ held, session, pathname, now }).kind === 'open') {
    void read();
    return OPEN;
  }
  const fresh = await withTimeout(read(), timeoutMs);
  if (fresh === null) return OPEN;
  return verdictFrom({ held: fresh, session, pathname, now });
}

/** The page the `_personal` layout has on screen, or `null` when it draws none. */
let renderedPath: string | null = null;

/** Set by the layout when it wants the page on screen decided after all. Taken by the next check. */
let isCheckRequested = false;

/** A path the way the gate compares two: no trailing slashes. */
function samePath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

/**
 * Tells the gate which page is on screen. The layout calls it on every
 * committed location and with `null` when it unmounts, so a later sign-in to
 * the same address is not mistaken for the page still being on screen.
 */
export function notePlanGateRenderedPath(path: string | null): void {
  renderedPath = path;
}

/**
 * Asks the next check of the page on screen to decide it anyway. The layout
 * does this once, when the first facts for an account arrive after a cold
 * boot, right before it revalidates.
 */
export function requestPlanGateCheck(): void {
  isCheckRequested = true;
}

/**
 * Whether a loader run for this path is the gate's to decide.
 *
 * A NAVIGATION IS DECIDED, THE PAGE ON SCREEN IS LEFT ALONE. A loader also
 * runs for the page already on screen: after an action on it, and when a
 * session settles. The last free scan's own action is one of those: the count
 * reaches zero with the answer, and deciding the page then replaced the review
 * of the plate the person had just scanned with the plan page. So a run for
 * the page on screen is left alone, and the next navigation away is decided,
 * unless the layout asked ({@link requestPlanGateCheck}).
 *
 * The page on screen is the one the layout RENDERED, never `window.location`:
 * a Back gesture moves the address before the loaders run, and would read as
 * the page on screen and walk past the gate.
 */
export function shouldCheckPlanGate(pathname: string): boolean {
  const isOnScreen = renderedPath !== null && samePath(pathname) === samePath(renderedPath);
  if (!isOnScreen) return true;
  const wasRequested = isCheckRequested;
  isCheckRequested = false;
  return wasRequested;
}

/**
 * Reads the facts again in the background when they are missing or stale.
 *
 * For the layout: when the account arrives, on every navigation, and when the
 * tab comes back into view. Fresh facts read nothing.
 */
export async function refreshPlanGateFacts({
  session = currentPlanGateSession(),
  now = new Date(),
  readers = NETWORK_READERS,
}: {
  session?: PlanGateSession | null;
  now?: Date;
  readers?: PlanGateReaders;
} = {}): Promise<void> {
  if (session === null) return;
  const held = peekPlanGateFacts(session);
  if (held !== null && isFresh(held, now)) return;
  await readPlanGateFacts({ accountId: session.accountId, serverUrl: session.serverUrl, now, readers });
}
