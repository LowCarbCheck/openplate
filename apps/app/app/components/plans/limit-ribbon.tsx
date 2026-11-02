/**
 * THE LIMIT LINE in the header's status slot (2026-11-02).
 *
 * When a person has used their whole AI allowance the header says so, with one
 * button to the plan page and one to close it until the window starts again. It
 * draws NO MARKUP of its own: it publishes to the app's one notification channel,
 * exactly as `trial-countdown.tsx` does, so the line appears and goes without
 * moving anything on the page.
 *
 * It never talks over another status, and it publishes once per mount of the
 * shell. Whether it shows at all is `limit-ribbon.ts`'s answer; this file gathers
 * the facts and reads the offer only for a subscriber at the limit.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useSyncSession } from '#app/components/sync-status';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { usePlanOffer } from '#app/hooks/use-plan-offer';
import { planViewOf, usePlanRead, usePlanStanding } from '#app/hooks/use-plan-standing';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { trackOfferSeen } from '#app/lib/matomo-events';
import {
  closeLimitRibbonForWindow,
  needsOfferRead,
  readLimitRibbonClosedWindow,
  resolveLimitRibbon,
  type LimitRibbon as Ribbon,
} from '#app/lib/plans/limit-ribbon';
import { PLAN_PAGE_HREF, offerLocaleFor } from '#app/lib/plans/plans-door';
import { canMoveUp } from '#app/lib/plans/tier-view';
import type { Translate } from '#app/lib/sync/setup-flow';
import { clearStatus, publishStatus, readStatus, useStatus } from '#app/lib/status';

/** `undefined` until the device's storage has been read, which only the browser can do. */
type ClosedWindowRead = string | null | undefined;

/** The line's sentence. */
function ribbonText(ribbon: Ribbon, t: Translate): string {
  const key = ribbon.period === 'week' ? 'plan.limitRibbon.usedWeek' : 'plan.limitRibbon.usedDay';
  return t(key, { count: ribbon.limit });
}

export function LimitRibbon(): null {
  const { t, i18n } = useTranslation();
  const navigate = useAppNavigate();
  /** The navigate of the page the person is on when they press the button. See `trial-countdown.tsx`. */
  const navigateRef = useRef(navigate);
  const { pathname } = useLocation();
  const standing = usePlanStanding();
  const session = useSyncSession();
  const status = useStatus();
  const { aiComesFromTheInstance } = useInstancePolicy();
  const [closedWindow, setClosedWindow] = useState<ClosedWindowRead>(undefined);
  /** The id of the status this mount published, so it only ever withdraws its own. */
  const publishedId = useRef<number | null>(null);

  useEffect(() => {
    setClosedWindow(readLimitRibbonClosedWindow(globalThis.localStorage));
  }, []);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const quota = session.account?.aiQuota;
  const now = new Date();
  const facts = {
    standing,
    quota,
    isManagedAi: aiComesFromTheInstance,
    closedWindow: closedWindow ?? null,
    pathname,
    now,
  };
  // THE OFFER AND THE PLAN'S TIER ARE READ ONLY FOR A SUBSCRIBER AT THE LIMIT.
  // Everybody else, and a subscriber with scans left, sends no request at all.
  const isReadWanted = closedWindow !== undefined && needsOfferRead(facts);
  const planRead = usePlanRead({ isEnabled: isReadWanted });
  const offerRead = usePlanOffer({ isEnabled: isReadWanted, locale: offerLocaleFor(i18n.language) });
  const ownTierId = planViewOf(planRead)?.tier ?? null;
  const isMoveUpOpen =
    standing.kind === 'subscribed' &&
    offerRead.settled &&
    offerRead.offer !== null &&
    canMoveUp({
      offer: offerRead.offer,
      own: { tierId: ownTierId, planKey: standing.planKey, isPastDue: standing.isPastDue },
    });
  const ribbon = closedWindow === undefined ? null : resolveLimitRibbon({ ...facts, canMoveUp: isMoveUpOpen });
  const text = ribbon === null ? null : ribbonText(ribbon, t);
  const resetsAt = ribbon?.resetsAt ?? null;
  const isChannelFree = status === null;

  useEffect(() => {
    if (text === null || resetsAt === null) return;
    // ONCE PER LOAD, AND NEVER OVER ANOTHER STATUS. Replaced by something else,
    // it stays gone until the next load: a nudge that keeps returning is a nag.
    // THE CHANNEL IS READ HERE, NOT FROM THE RENDER: the countdown beside this
    // component may have published in this same commit, and latest wins.
    if (publishedId.current !== null || readStatus() !== null) return;
    publishStatus({
      text,
      tone: 'info',
      // UNTIL CLOSED. A line that faded on its own could not be closed for the
      // window, and would come back on the next load as if never seen.
      ttlMs: null,
      action: { label: t('plan.countdown.action'), onClick: () => navigateRef.current(PLAN_PAGE_HREF) },
      onDismiss: () => {
        closeLimitRibbonForWindow({ storage: globalThis.localStorage, resetsAt });
        setClosedWindow(resetsAt);
      },
    });
    publishedId.current = readStatus()?.id ?? null;
    trackOfferSeen('ai-limit');
  }, [text, resetsAt, isChannelFree, t]);

  // WITHDRAWN WHEN IT STOPS BEING TRUE: on the plan page itself, after a purchase
  // or in a new window. Only this mount's own status is cleared.
  const isShowing = ribbon !== null;
  useEffect(() => {
    if (isShowing || publishedId.current === null) return;
    if (readStatus()?.id === publishedId.current) clearStatus();
  }, [isShowing]);

  return null;
}
