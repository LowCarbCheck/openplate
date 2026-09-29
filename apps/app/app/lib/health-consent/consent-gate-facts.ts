/**
 * THE FACTS THE CONSENT GATE READS, read once per session and kept in memory.
 *
 * `resolveConsentGate` (`consent-gate.ts`) is pure. This module is where its
 * inputs come from, and it is shaped like `#app/lib/plans/plan-gate-facts`
 * for the same requirement: the gate must not add a network wait to every
 * navigation. So the one fact that lives on the server, the version the
 * instance asks for (`instance.healthConsent` on `/health`), is read ONCE per
 * server, kept in module memory, and read again only in the background. The
 * other fact, the version the account agreed to, is already in the session
 * snapshot and is read live on every decision, so the navigation right after
 * "Agree and continue" is open without a refetch.
 *
 * ── Its own read, not the plan gate's ─────────────────────────────────────
 *
 * The plan gate reads the same handshake, and sharing its cache would save a
 * request. It would also make this gate fail open whenever `GET /plans/me`
 * fails, because that module drops the whole read on a failed plan read. A
 * consent the operator must be able to show cannot hang off a biller.
 *
 * ── Fail open, always ─────────────────────────────────────────────────────
 *
 * A handshake that cannot be read, a read that outlasts
 * {@link CONSENT_GATE_READ_TIMEOUT_MS}, a device that is offline and a session
 * whose account view has not been read yet all answer open. An unreadable
 * handshake is never remembered, so it cannot hold the question off for the
 * cache's life either: the next navigation asks again.
 *
 * ── Nothing is persisted ──────────────────────────────────────────────────
 *
 * The cache is module memory, gone with the tab. A reload reads again, once.
 */
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import { readFreshServerInstance } from '#app/hooks/use-server-instance';
import { refreshSyncAccount } from '#app/lib/sync/sync-actions';
import { getSyncSessionSnapshot, getSyncVault } from '#app/lib/sync/sync-session';
import { withTimeout } from '#app/lib/with-timeout';

import {
  DEFAULT_CONSENT_NEXT,
  isConsentGateExempt,
  resolveConsentGate,
  safeConsentNext,
  type ConsentGateAccount,
  type ConsentGateOutcome,
} from './consent-gate';
import { requiredHealthConsentVersion } from './health-consent';

/** How long a read decides on its own before a navigation asks again in the background. */
export const CONSENT_GATE_FACTS_TTL_MS = 5 * 60_000;

/** The longest a navigation waits for the first read of a session before it opens anyway. */
export const CONSENT_GATE_READ_TIMEOUT_MS = 2_500;

/** What the gate remembers about one server. */
export interface ConsentGateFacts {
  serverUrl: string;
  /** `instance.healthConsent.version`, or `null` for a readable handshake that asks for none. */
  requiredVersion: string | null;
  /** Epoch ms the read that produced these facts STARTED. A newer read wins. */
  readAt: number;
}

/** How the handshake is read. Production reads the network; a test passes its own. */
export interface ConsentGateReaders {
  /** The descriptor of one server. Never rejects; `null` for an unreadable one. */
  readInstance: (serverUrl: string) => Promise<InstanceDescriptor | null>;
}

/** Who the gate is deciding for: the open session's server and its account's consent. */
export interface ConsentGateSession {
  serverUrl: string;
  account: ConsentGateAccount;
}

const NETWORK_READERS: ConsentGateReaders = { readInstance: readFreshServerInstance };

const OPEN: ConsentGateOutcome = { kind: 'open' };

let facts: ConsentGateFacts | null = null;
let inFlight: { serverUrl: string; promise: Promise<ConsentGateFacts | null> } | null = null;
/** Bumped by {@link forgetConsentGateFacts}, so a read that started before it cannot write after it. */
let generation = 0;
const listeners = new Set<() => void>();

function isFresh(entry: ConsentGateFacts, now: Date): boolean {
  return now.getTime() - entry.readAt < CONSENT_GATE_FACTS_TTL_MS;
}

/** Keeps the newer of two reads for the same server, and tells every subscriber. */
function store(next: ConsentGateFacts): void {
  if (facts !== null && facts.serverUrl === next.serverUrl && facts.readAt > next.readAt) return;
  facts = next;
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore` subscribe. */
export function subscribeConsentGateFacts(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** `useSyncExternalStore` getSnapshot. Identity changes only when a read is stored. */
export function getConsentGateFactsSnapshot(): ConsentGateFacts | null {
  return facts;
}

/** The facts held for this server, fresh or stale, or `null`. Reads nothing. */
export function peekConsentGateFacts(serverUrl: string): ConsentGateFacts | null {
  if (facts === null || facts.serverUrl !== serverUrl) return null;
  return facts;
}

/** Reads the handshake once. Never rejects: an unreadable one is `null` and is not stored. */
async function fetchFacts({
  serverUrl,
  readAt,
  readers,
}: {
  serverUrl: string;
  readAt: number;
  readers: ConsentGateReaders;
}): Promise<ConsentGateFacts | null> {
  const startedIn = generation;
  try {
    const instance = await readers.readInstance(serverUrl);
    // NOT REMEMBERED WHEN UNREADABLE. `null` here is a failed read, not an
    // instance that asks for nothing (that one is a descriptor whose
    // `healthConsent` is `null`), and remembering it would keep the question
    // off for five minutes after one flaky request.
    if (instance === null) return null;
    const next: ConsentGateFacts = { serverUrl, requiredVersion: requiredHealthConsentVersion(instance), readAt };
    if (startedIn === generation) store(next);
    return next;
  } catch {
    return null;
  }
}

/**
 * Reads the facts for one server now, sharing a read already in flight for it.
 *
 * @returns the facts, or `null` when the handshake could not be read. Never rejects.
 */
export function readConsentGateFacts({
  serverUrl,
  now,
  readers = NETWORK_READERS,
}: {
  serverUrl: string;
  now: Date;
  readers?: ConsentGateReaders;
}): Promise<ConsentGateFacts | null> {
  if (inFlight !== null && inFlight.serverUrl === serverUrl) return inFlight.promise;
  const promise = fetchFacts({ serverUrl, readAt: now.getTime(), readers });
  inFlight = { serverUrl, promise };
  void promise.finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  return promise;
}

/**
 * Drops every fact and any read in flight.
 *
 * For the consent screen finding that the instance changed its wording, or
 * stopped asking: the next decision must read the handshake again rather than
 * trust the old answer.
 */
export function forgetConsentGateFacts(): void {
  generation += 1;
  facts = null;
  inFlight = null;
  for (const listener of listeners) listener();
}

/**
 * The open session, as the gate needs it, or `null` when there is none.
 *
 * `null` too while the account view has not been read (`role === null`): a
 * placeholder account says nothing about a consent, and asking it would ask
 * somebody who agreed long ago. A vault for another account than the
 * snapshot's is no session.
 */
export function currentConsentGateSession(): ConsentGateSession | null {
  const account = getSyncSessionSnapshot().account;
  const vault = getSyncVault();
  if (account === null || vault === null || vault.accountId !== account.id) return null;
  if (account.role === null) return null;
  return { serverUrl: vault.serverUrl, account: { consentedVersion: account.healthConsent?.version ?? null } };
}

/**
 * Reads BOTH facts again, because the core has just refused a data route for
 * want of the consent (`403 health-consent-required`, 2026-09-29).
 *
 * The refusal is the service saying the gate's facts are wrong, and either one
 * can be: the handshake held here is up to five minutes old, so a wording the
 * operator changed since is not in it, and the account in the snapshot is the
 * one read at sign-in. So the held facts are dropped, the account view is read
 * again, and only then is the handshake read, so the verdict that follows is
 * taken over two fresh facts. Every step fails open, as everything in this
 * module does: an unreadable account keeps the old view, and an unreadable
 * handshake stores nothing.
 */
export async function rereadAfterConsentRefusal({
  now = new Date(),
  readers = NETWORK_READERS,
  refreshAccount = refreshSyncAccount,
  readSession = currentConsentGateSession,
}: {
  now?: Date;
  readers?: ConsentGateReaders;
  /** Re-reads the account view into the session. Never rejects. */
  refreshAccount?: () => Promise<void>;
  /** The session AFTER the account read, which is why it is a function rather than a value. */
  readSession?: () => ConsentGateSession | null;
} = {}): Promise<void> {
  forgetConsentGateFacts();
  await refreshAccount();
  const session = readSession();
  if (session === null) return;
  await readConsentGateFacts({ serverUrl: session.serverUrl, now, readers });
}

/** Whether the browser says it has a network. Anything but an explicit `false` is online. */
function isDeviceOnline(): boolean {
  return globalThis.navigator?.onLine !== false;
}

/** The gate's verdict over held facts and the live account. */
function verdictFrom({
  held,
  session,
  pathname,
  search,
}: {
  held: ConsentGateFacts;
  session: ConsentGateSession;
  pathname: string;
  search: string;
}): ConsentGateOutcome {
  return resolveConsentGate({ requiredVersion: held.requiredVersion, account: session.account, pathname, search });
}

/**
 * The verdict for a path from what is held right now, without any read.
 *
 * For `shouldRevalidate`, which must answer synchronously, and for the layout
 * deciding whether the page on screen has just become one to ask on. No facts
 * is open.
 */
export function consentGateAt({
  pathname,
  search,
  session = currentConsentGateSession(),
  isOnline = isDeviceOnline(),
}: {
  pathname: string;
  search: string;
  session?: ConsentGateSession | null;
  /** `false` opens, see the module header. Defaults to what the browser says. */
  isOnline?: boolean;
}): ConsentGateOutcome {
  if (session === null || !isOnline) return OPEN;
  const held = peekConsentGateFacts(session.serverUrl);
  if (held === null) return OPEN;
  return verdictFrom({ held, session, pathname, search });
}

/**
 * The verdict for a navigation, for `_personal.tsx`'s loader.
 *
 * 1. An exempt page, a device with no session (or an unread account view)
 *    and an offline device answer open, and read nothing.
 * 2. Fresh facts decide at once.
 * 3. Stale facts that open decide at once too, and a read starts behind them.
 * 4. Stale facts that would ASK are read again first, so a wording the
 *    operator withdrew does not ask once more.
 * 5. No facts: the first read of the session, waited for up to `timeoutMs`.
 *
 * Steps 4 and 5 answer open when the read fails or outlasts the timeout.
 */
export async function resolveConsentGateForNavigation({
  pathname,
  search,
  now = new Date(),
  timeoutMs = CONSENT_GATE_READ_TIMEOUT_MS,
  session = currentConsentGateSession(),
  readers = NETWORK_READERS,
  isOnline = isDeviceOnline(),
}: {
  pathname: string;
  search: string;
  now?: Date;
  timeoutMs?: number;
  session?: ConsentGateSession | null;
  readers?: ConsentGateReaders;
  /** `false` opens, see the module header. Defaults to what the browser says. */
  isOnline?: boolean;
}): Promise<ConsentGateOutcome> {
  if (isConsentGateExempt(pathname) || session === null || !isOnline) return OPEN;
  const held = peekConsentGateFacts(session.serverUrl);
  if (held !== null && isFresh(held, now)) return verdictFrom({ held, session, pathname, search });
  const read = () => readConsentGateFacts({ serverUrl: session.serverUrl, now, readers });
  if (held !== null && verdictFrom({ held, session, pathname, search }).kind === 'open') {
    void read();
    return OPEN;
  }
  const fresh = await withTimeout(read(), timeoutMs);
  if (fresh === null) return OPEN;
  return verdictFrom({ held: fresh, session, pathname, search });
}

/**
 * Reads the facts again in the background when they are missing or stale.
 *
 * For the layout: when the account arrives and on every navigation. Fresh
 * facts read nothing.
 */
export async function refreshConsentGateFacts({
  session = currentConsentGateSession(),
  now = new Date(),
  readers = NETWORK_READERS,
}: {
  session?: ConsentGateSession | null;
  now?: Date;
  readers?: ConsentGateReaders;
} = {}): Promise<void> {
  if (session === null) return;
  const held = peekConsentGateFacts(session.serverUrl);
  if (held !== null && isFresh(held, now)) return;
  await readConsentGateFacts({ serverUrl: session.serverUrl, now, readers });
}

/** What the consent screen does when it is opened: ask, or go on to the page it was given. */
export type ConsentScreenDecision = { kind: 'ask' } | { kind: 'continue'; destination: string };

/**
 * Whether the consent screen has anything to ask, for its own loader.
 *
 * It asks the GATE about the page it would continue to, so the screen and the
 * gate can never disagree: when the gate would let the person through to
 * `next`, there is nothing to ask and the screen continues there. That covers
 * a consent already on record, an instance that asks for none, a signed-out
 * device and every unreadable fact.
 *
 * AN EXEMPT `next` IS STILL A QUESTION (M266). The gate answers open for an
 * exempt page whatever the account holds, so asking it about one would say
 * nothing. The account page links here with `next=/settings/account` when a
 * form was refused for want of the consent, and the screen bounced straight
 * back. For an exempt page the gate is asked about a guarded one instead,
 * which is the question "does this account owe the consent", and the person
 * still returns to the exempt page afterwards.
 *
 * WHILE THE SESSION IS STILL REOPENING it asks, and decides nothing. A reload
 * of this screen meets a session that is not open yet; continuing then would
 * bounce the person to `next` and straight back here once the session opened.
 * The layout draws its loading screen for that moment and revalidates, and
 * this runs again with the settled session.
 *
 * @param input.next - the raw `next` parameter, guarded here with {@link safeConsentNext}.
 */
export async function decideConsentScreen({
  next,
  isResuming = getSyncSessionSnapshot().isResuming,
  session = currentConsentGateSession(),
  readers = NETWORK_READERS,
  now = new Date(),
  isOnline = isDeviceOnline(),
}: {
  next: string | null;
  isResuming?: boolean;
  session?: ConsentGateSession | null;
  readers?: ConsentGateReaders;
  now?: Date;
  isOnline?: boolean;
}): Promise<ConsentScreenDecision> {
  const destination = safeConsentNext(next);
  if (isResuming) return { kind: 'ask' };
  const probe = 'https://openplate.invalid';
  const target = new URL(
    isConsentGateExempt(new URL(destination, probe).pathname) ? DEFAULT_CONSENT_NEXT : destination,
    probe,
  );
  const verdict = await resolveConsentGateForNavigation({
    pathname: target.pathname,
    search: target.search,
    now,
    session,
    readers,
    isOnline,
  });
  return verdict.kind === 'consent' ? { kind: 'ask' } : { kind: 'continue', destination };
}

/**
 * What the instance asks right now, for "Agree and continue".
 *
 * - `asks`: the version to send.
 * - `asks-nothing`: a readable handshake with no consent in it, so there is
 *   nothing to record and the screen continues.
 * - `unknown`: the handshake could not be read, so nothing can be sent.
 */
export type RequiredConsent = { kind: 'asks'; version: string } | { kind: 'asks-nothing' } | { kind: 'unknown' };

/** The held facts, or a read, as a {@link RequiredConsent}. */
function requiredConsentOf(entry: ConsentGateFacts | null): RequiredConsent {
  if (entry === null) return { kind: 'unknown' };
  return entry.requiredVersion === null ? { kind: 'asks-nothing' } : { kind: 'asks', version: entry.requiredVersion };
}

/**
 * The version to send with "Agree and continue": the held one when it is
 * fresh, a new read otherwise. Never rejects.
 */
export async function readRequiredConsent({
  serverUrl,
  now = new Date(),
  readers = NETWORK_READERS,
}: {
  serverUrl: string;
  now?: Date;
  readers?: ConsentGateReaders;
}): Promise<RequiredConsent> {
  const held = peekConsentGateFacts(serverUrl);
  if (held !== null && isFresh(held, now)) return requiredConsentOf(held);
  return requiredConsentOf(await readConsentGateFacts({ serverUrl, now, readers }));
}
