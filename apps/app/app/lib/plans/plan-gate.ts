/**
 * THE PAYWALL, as a pure decision (owner decision, 2026-09-28).
 *
 * On an instance that sells plans, a new account gets free AI scans and no
 * card. Until now the only gate was the core's AI proxy, so an account whose
 * scans were spent kept the diary for ever. The owner's rule: when the free
 * scans are used up, or a paid plan has lapsed, every feature screen sends the
 * person to the plan page until they pay.
 *
 * It is shaped like `resolveOnboardingGate` and for the same reason: the order
 * below is the whole policy, and a pure function is where a test can hold all
 * of it without a router, a session or a network.
 *
 * ── UNKNOWN NEVER LOCKS ──────────────────────────────────────────────────
 *
 * `planStanding` already answers `no-plans` for every fact it cannot read: a
 * handshake not answered, a plan read that failed, an account view not yet
 * fetched. This module adds nothing that could turn "not known" into
 * "locked". The caller (`plan-gate-facts.ts`) fails open on a timeout and on
 * an offline device for the same reason, and the core's AI proxy stays the
 * server side backstop: this gate is a door on the client, not a lock on data.
 *
 * ── WHAT STAYS OPEN, AND WHY EACH ONE ────────────────────────────────────
 *
 * GDPR is the reason most of the list exists. A person owes nothing to take
 * their data out, delete their account or withdraw a consent, so none of that
 * may sit behind a payment. See {@link PLAN_GATE_EXEMPT_PATHS}.
 *
 * Everything outside the `_personal` layout (the legal pages, sign-in, join,
 * welcome, the cancellation and withdrawal pages) never reaches this gate at
 * all, because the layout's loader is where it runs.
 */
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import type { PlanView } from '#app/lib/sync/engine/client/plans-wire';

import { NO_PLANS, planStanding, type PlanStanding, type StandingAccount } from './plan-standing';
import { PLAN_PAGE_HREF } from './plans-door';

/** What the gate decided. `paywall` names where the caller sends the person. */
export type PlanGateOutcome = { kind: 'open' } | { kind: 'paywall'; destination: typeof PLAN_PAGE_HREF };

/** Everything the gate looks at. */
export interface PlanGateInput {
  /** `hasPlansDoor(instance)`: does this instance sell a plan at all? */
  hasPlansDoor: boolean;
  /** Where the person stands, from {@link planGateStanding}. */
  standing: PlanStanding;
  /** The pathname the person is going to, e.g. `/dashboard`. */
  pathname: string;
}

/** The single open answer, so no caller builds a second one. */
const OPEN: PlanGateOutcome = { kind: 'open' };

/** The single paywall answer. */
const PAYWALL: PlanGateOutcome = { kind: 'paywall', destination: PLAN_PAGE_HREF };

/**
 * The pages a locked person can still open, exactly as written.
 *
 * - `/settings/plan`, the page the gate sends them to. Without it the redirect
 *   would loop.
 * - `/settings`, the hub, so the way to every page below is on screen.
 * - `/settings/data`, the export. Taking the diary out is never paid for.
 * - `/settings/account`, delete the account and sign out. `/settings/sync` is
 *   the old address of that page and only redirects to it, so it is open too,
 *   or the redirect would be swallowed by this gate first.
 * - `/settings/preferences`, the language and the "Count my visits" switch,
 *   the objection legitimate interest requires.
 * - `/settings/research`, the one place a contributor leaves a study, which is
 *   the withdrawal of a consent.
 * - `/settings/sharing`, where a clinician share is revoked.
 * - `/settings/notifications`, where the daily notification is switched off,
 *   so a locked person is not sent a message they cannot open.
 * - `/consent`, the one-time consent to health data
 *   (`#app/lib/health-consent/consent-gate`). A consent is never paid for, and
 *   the consent gate runs first, so a locked account that never agreed is
 *   asked there and sees the plan page after.
 *
 * `/admin` and every page below it are open as well, see
 * {@link isPlanGateExempt}: an administrator runs the instance whatever their
 * own standing says.
 *
 * EXACT PATHS, never a prefix: `/settings` is open as the hub, and a prefix
 * would open every settings page under it.
 */
export const PLAN_GATE_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/settings',
  PLAN_PAGE_HREF,
  '/settings/data',
  '/settings/account',
  '/settings/sync',
  '/settings/preferences',
  '/settings/research',
  '/settings/sharing',
  '/settings/notifications',
  '/consent',
]);

/** The one prefix the gate opens a whole subtree for. */
const ADMIN_PATH = '/admin';

/**
 * A pathname the way the router matches it: without trailing slashes, and
 * without regard to case (route matching is case insensitive by default).
 */
function normalisePath(pathname: string): string {
  return pathname.replace(/\/+$/, '').toLowerCase() || '/';
}

/**
 * Is this path reachable while the app is locked?
 *
 * @param pathname - the request's pathname, e.g. `/settings/data`.
 * @returns `true` for a page in {@link PLAN_GATE_EXEMPT_PATHS}, and for
 *   `/admin` and every page below it.
 */
export function isPlanGateExempt(pathname: string): boolean {
  const path = normalisePath(pathname);
  if (PLAN_GATE_EXEMPT_PATHS.has(path)) return true;
  return path === ADMIN_PATH || path.startsWith(`${ADMIN_PATH}/`);
}

/**
 * Does this standing lock the app?
 *
 * Only two do: the free trial is over with no plan (`trial-ended`, on either
 * basis, including an account that never had an allowance), and a plan that
 * existed is over (`lapsed`). A subscription that will not renew, or whose
 * last payment is being retried, is still a subscription.
 */
export function isLockingStanding(standing: PlanStanding): boolean {
  return standing.kind === 'trial-ended' || standing.kind === 'lapsed';
}

/**
 * Decides whether this navigation goes through or goes to the plan page.
 *
 * 1. **An instance that sells nothing never locks.** Beta and self-hosted
 *    instances answer `plans: false`, or nothing at all.
 * 2. **Only a locking standing locks.** Every other standing, and every fact
 *    not yet known (`no-plans`), is open.
 * 3. **An exempt page stays open**, even for a locked person.
 *
 * @param input - the door, the standing and the path.
 * @returns `open`, or `paywall` with the plan page as the destination.
 */
export function resolvePlanGate({ hasPlansDoor, standing, pathname }: PlanGateInput): PlanGateOutcome {
  if (!hasPlansDoor) return OPEN;
  if (!isLockingStanding(standing)) return OPEN;
  if (isPlanGateExempt(pathname)) return OPEN;
  return PAYWALL;
}

/** The account facts the gate reads: the standing's own, and the role. */
export interface PlanGateAccount extends StandingAccount {
  /** `null` is "not read yet", which is read as a member, never as an administrator. */
  role: 'admin' | 'member' | null;
}

/**
 * Where this person stands, for the gate.
 *
 * `planStanding`, with one rule on top: an ADMINISTRATOR is never locked. An
 * administrator's account may carry no allowance of its own, which reads as an
 * ended trial, and the person who runs the instance must still reach the
 * diary. A role that has not been read yet is not an administrator.
 *
 * @param input.instance - the handshake's descriptor, or `null` while unread.
 * @param input.account - the session's account facts, or `null` with no session.
 * @param input.planView - `GET /plans/me`, or `null` while unread, absent or failed.
 * @param input.now - the instant every date is compared against.
 */
export function planGateStanding({
  instance,
  account,
  planView,
  now,
}: {
  instance: InstanceDescriptor | null;
  account: PlanGateAccount | null;
  planView: PlanView | null;
  now: Date;
}): PlanStanding {
  if (account?.role === 'admin') return NO_PLANS;
  return planStanding({ instance, account, planView, now });
}

/**
 * What the plan page says above the plans when the app is locked.
 *
 * - `scans-used`: the free scans are spent. `count` is how many there were.
 * - `choose`: a dated trial ended, or there never was an allowance, or the
 *   number of free scans is not known.
 * - `lapsed`: a plan the person paid for is over.
 */
export type PaywallNotice = { kind: 'scans-used'; count: number } | { kind: 'choose' } | { kind: 'lapsed' };

/**
 * The notice for one standing, or `null` when the standing does not lock.
 *
 * @param input.standing - where the person stands.
 * @param input.scansGranted - how many free scans this account was given, or
 *   `null` when nothing says. The caller reads the account first and the
 *   instance descriptor second, and never types a number.
 */
export function paywallNoticeFor({
  standing,
  scansGranted,
}: {
  standing: PlanStanding;
  scansGranted: number | null;
}): PaywallNotice | null {
  if (standing.kind === 'lapsed') return { kind: 'lapsed' };
  if (standing.kind !== 'trial-ended') return null;
  if (standing.basis === 'scans' && scansGranted !== null && scansGranted > 0) {
    return { kind: 'scans-used', count: scansGranted };
  }
  return { kind: 'choose' };
}

/**
 * Whether the plan page offers "use my free scans first": a scan trial with
 * scans still left. A dated trial has days, not scans, so the sentence would
 * not be true of it.
 */
export function hasFreeScansLeft(standing: PlanStanding): boolean {
  return standing.kind === 'trial' && standing.basis === 'scans';
}
