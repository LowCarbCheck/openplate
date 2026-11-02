/**
 * THE LIMIT LINE, decided here and drawn by the header's status slot (2026-11-02).
 *
 * When a person has used their whole AI allowance, the header says so and offers
 * the plan page, with a close. This module holds every rule about that line and
 * no React: `components/plans/limit-ribbon.tsx` only publishes what this answers.
 *
 * ── WHO SEES IT, AND WHAT THAT COSTS TO KNOW ─────────────────────────────
 *
 * - A person with no paid plan (`trial`, `free`): the standing alone answers.
 *   The door says a biller stands behind this instance, and no offer is read.
 * - A subscriber: only below the top tier, and only the offer knows that, so the
 *   offer is read ONCE AND ONLY AT THE LIMIT ({@link needsOfferRead}). A failed
 *   read, a legacy plan, an unknown tier and an overdue payment all say no.
 * - `trial-ended` and `lapsed`: NEVER. The paywall owns them. `_personal` sends
 *   every feature screen to the plan page, and an exempt page already carries
 *   the countdown's "free scans used" line.
 * - `no-plans`: never. That is a self-hosted instance, one with `plans: false`,
 *   and every fact not read yet.
 * - Somebody's own key: never. {@link LimitRibbonInput.isManagedAi} is `false`
 *   unless this instance supplies the AI, and a managed instance refuses a key
 *   the person brought. Fail closed: only the instance's own credential is
 *   counted by `aiQuota`.
 *
 * ── CLOSED FOR ONE WINDOW, ON THIS DEVICE ────────────────────────────────
 *
 * Closing records the window's `resetsAt` in `localStorage`, the
 * `trial-countdown.ts` reasoning: a dismissed nudge is a preference about a nudge
 * and not health data. The next window names another instant, so the record no
 * longer matches, which is the promise "closed until it starts again" makes.
 *
 * Pure but for the two storage calls, and both take their storage as an argument.
 */
import type { AiLimitPeriod, AiQuota } from '#app/lib/plans/ai-quota';
import type { PlanStanding } from '#app/lib/plans/plan-standing';
import { isPlanPage } from '#app/lib/plans/trial-countdown';

/** Where the closed window lives. Versioned, so a future retune can start clean. */
export const LIMIT_RIBBON_STORAGE_KEY = 'openplate:limit-ribbon-closed:v1';

/** Minimal storage surface. `localStorage` satisfies it, and so does a plain fake in a test. */
export interface LimitRibbonStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** What the line says. */
export interface LimitRibbon {
  limit: number;
  period: AiLimitPeriod;
  /** The window this line belongs to, which is also what a close records. */
  resetsAt: string;
}

export interface LimitRibbonInput {
  standing: PlanStanding;
  quota: AiQuota | null | undefined;
  /** `true` only where this instance supplies the AI, so `aiQuota` counts this person's scans. */
  isManagedAi: boolean;
  /** The subscriber's answer from the offer: a higher tier can be bought now. `false` until it is known. */
  canMoveUp: boolean;
  /** The `resetsAt` of the window last closed on this device, or `null`. */
  closedWindow: string | null;
  pathname: string;
  now: Date;
}

/** The quota, when every fact but the higher tier says the line would show, or `null`. */
function spentQuotaOf({
  quota,
  isManagedAi,
  closedWindow,
  pathname,
  now,
}: Omit<LimitRibbonInput, 'standing' | 'canMoveUp'>): AiQuota | null {
  if (!isManagedAi || quota === null || quota === undefined) return null;
  if (isPlanPage(pathname) || quota.resetsAt === closedWindow) return null;
  // A WINDOW THAT HAS ENDED SAYS NOTHING: the count starts again at zero.
  if (quota.used < quota.limit || Date.parse(quota.resetsAt) <= now.getTime()) return null;
  return quota;
}

/**
 * Whether a subscriber's offer must be read to answer. Everybody else needs no
 * read, and a subscriber below the limit does not pay for one either.
 */
export function needsOfferRead(input: Omit<LimitRibbonInput, 'canMoveUp'>): boolean {
  return input.standing.kind === 'subscribed' && spentQuotaOf(input) !== null;
}

/** Whether this standing may be sold a higher tier. A `Record`, so a new standing fails to compile here. */
function isSellable({ standing, canMoveUp }: Pick<LimitRibbonInput, 'standing' | 'canMoveUp'>): boolean {
  const byKind = {
    'no-plans': false,
    trial: true,
    free: true,
    subscribed: canMoveUp,
    'trial-ended': false,
    lapsed: false,
  } satisfies Record<PlanStanding['kind'], boolean>;
  return byKind[standing.kind];
}

/** What the line says, or `null` when it does not show. See the header for who sees it. */
export function resolveLimitRibbon(input: LimitRibbonInput): LimitRibbon | null {
  const quota = spentQuotaOf(input);
  if (quota === null || !isSellable(input)) return null;
  return { limit: quota.limit, period: quota.period, resetsAt: quota.resetsAt };
}

/**
 * The window the line was last closed for on this device, or `null`.
 *
 * Anything unreadable reads as never closed, because a broken preference must
 * never take the header down with it.
 */
export function readLimitRibbonClosedWindow(storage: LimitRibbonStorage): string | null {
  try {
    return storage.getItem(LIMIT_RIBBON_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Records that the line was closed for this window. A failed write (private mode,
 * a full quota) is swallowed: the line then comes back on the next load, which is
 * a nudge too many and not a broken page.
 */
export function closeLimitRibbonForWindow({
  storage,
  resetsAt,
}: {
  storage: LimitRibbonStorage;
  resetsAt: string;
}): void {
  try {
    storage.setItem(LIMIT_RIBBON_STORAGE_KEY, resetsAt);
  } catch {
    // Ignored by design, see this function's doc.
  }
}
