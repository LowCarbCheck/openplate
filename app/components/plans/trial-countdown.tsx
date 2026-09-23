/**
 * THE TRIAL COUNTDOWN in the header's status slot (M250/03).
 *
 * During a trial the header says how many days of AI scans are left, with one
 * button to the plan page and one to close it for the day. It draws NO MARKUP
 * of its own: it publishes to the app's one notification channel
 * (`#app/lib/status`), and `HeaderStatus` draws it in the title slot, inside
 * the header's fixed `min-h-16` box. So the line appears and goes without
 * moving anything on the page, which is the reason it lives there and not in a
 * banner above the content.
 *
 * ── IT NEVER TALKS OVER ANOTHER STATUS ───────────────────────────────────
 *
 * The channel is "latest wins". A countdown that published over an error
 * would wipe the one thing the person had to read, so it waits until the
 * channel is empty. And it publishes ONCE per mount of the shell, which is
 * once per page load: if something later replaces it, it does not come back
 * until the next load, where a nudge that keeps returning would be a nag.
 *
 * ── A SCAN COUNT FOLLOWS THE SCAN (M253/05) ──────────────────────────────
 *
 * On a scan trial the line says how many free AI scans are left, and the
 * proxy moves that number on every answer (`X-Trial-Scans-Left`, written into
 * the session snapshot). While the line this mount published is still the one
 * on screen, a new number REPLACES it in place, in the same slot, so "3" turns
 * into "2" without a reload. A line something else replaced stays gone.
 *
 * ── NOTHING HERE DECIDES ─────────────────────────────────────────────────
 *
 * Whether the line shows and what number it says are `trial-countdown.ts`'s
 * answers. The standing is `planStanding`'s, so a subscriber, an instance that
 * sells nothing and a person whose facts are not read yet all see nothing.
 * The funnel's "offer seen" fires when the line is published: the header is
 * sticky, so a published status is on screen.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { usePlanStanding } from '#app/hooks/use-plan-standing';
import { useTrialRecap } from '#app/hooks/use-trial-recap';
import { useSyncSession } from '#app/components/sync-status';
import { localDateToDayKey } from '#app/lib/day-key-date';
import { trackOfferSeen } from '#app/lib/matomo-events';
import { PLAN_PAGE_HREF } from '#app/lib/plans/plans-door';
import { closeCountdownForDay, readCountdownClosedDay, resolveTrialCountdown } from '#app/lib/plans/trial-countdown';
import type { TrialCountdown as Countdown } from '#app/lib/plans/trial-countdown';
import { RECAP_NEAR_END_DAYS, RECAP_NEAR_END_SCANS, recapSentenceKey } from '#app/lib/plans/trial-recap';
import type { Translate } from '#app/lib/sync/setup-flow';
import { clearStatus, publishStatus, readStatus, useStatus } from '#app/lib/status';

/**
 * `undefined` until the device's storage has been read. The read happens in
 * an effect, because the server render has no `localStorage` and must not
 * guess that the line was never closed.
 */
type ClosedDayRead = string | null | undefined;

export function TrialCountdown(): null {
  const { t } = useTranslation();
  const navigate = useAppNavigate();
  /**
   * The navigate of the page the person is on when they press the button.
   * The status outlives the render that published it, and `useAppNavigate`
   * shapes the history stack from the page it was made on.
   */
  const navigateRef = useRef(navigate);
  const { pathname } = useLocation();
  const standing = usePlanStanding();
  const session = useSyncSession();
  const status = useStatus();
  const [closedDay, setClosedDay] = useState<ClosedDayRead>(undefined);
  /** The id of the status this mount published, so it only ever withdraws its own. */
  const publishedId = useRef<number | null>(null);

  useEffect(() => {
    setClosedDay(readCountdownClosedDay(globalThis.localStorage));
  }, []);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const countdown =
    closedDay === undefined ? null : resolveTrialCountdown({ standing, now: new Date(), closedDay, pathname });
  const isChannelFree = status === null;
  // NEAR THE END, THE LINE SAYS WHAT THE TRIAL WAS USED FOR (M250/05), as the
  // status's smaller second line. Earlier in the trial there is nothing worth
  // summing up, so the diary is not read at all.
  const recap = useTrialRecap({
    standing,
    accountCreatedAt: session.account?.createdAt,
    isEnabled: countdown !== null && isNearTheEnd(countdown),
  });
  const recapCount = recap.settled ? recap.mealCount : null;
  const text = countdown === null ? null : countdownText(countdown, t);
  // No line for a count of zero: "you logged no meals" is a reproach.
  const description =
    recapCount === null || recapCount === 0 ? null : t(recapSentenceKey(standing), { count: recapCount });
  /** What the line says, as one value, so a changed number is a changed line. */
  const lineKey = text === null ? null : `${text}\n${description ?? ''}`;
  /** The line this mount last published. */
  const publishedKey = useRef<string | null>(null);

  useEffect(() => {
    if (text === null || lineKey === null) return;
    // THE WHOLE LINE AT ONCE: a second line added after the first is drawn
    // would be a status changing under the reader's eyes.
    if (!recap.settled) return;
    const hasPublished = publishedId.current !== null;
    const isOnScreen = hasPublished && readStatus()?.id === publishedId.current;
    // Replaced by something else, it stays gone until the next load.
    if (hasPublished && !isOnScreen) return;
    // The first line waits for an empty channel; a moved count replaces its own.
    if (!hasPublished && !isChannelFree) return;
    if (isOnScreen && publishedKey.current === lineKey) return;
    publishStatus({
      text,
      description: description ?? undefined,
      tone: 'info',
      // UNTIL CLOSED. A line that faded on its own could not be closed for
      // the day, and would come back on the next load as if never seen.
      ttlMs: null,
      action: { label: t('plan.countdown.action'), onClick: () => navigateRef.current(PLAN_PAGE_HREF) },
      onDismiss: () => {
        const today = localDateToDayKey(new Date());
        closeCountdownForDay({ storage: globalThis.localStorage, dayKey: today });
        setClosedDay(today);
      },
    });
    publishedId.current = readStatus()?.id ?? null;
    publishedKey.current = lineKey;
    // Seen once per load, not once per number.
    if (!hasPublished) trackOfferSeen('countdown');
  }, [text, description, lineKey, isChannelFree, recap.settled, t]);

  // WITHDRAWN WHEN IT STOPS BEING TRUE: on the plan page itself, after a
  // purchase turned the trial into a subscription, after the last free scan,
  // or once closed. Only this mount's own status is cleared, never whatever
  // replaced it.
  const isShowing = countdown !== null;
  useEffect(() => {
    if (isShowing || publishedId.current === null) return;
    if (readStatus()?.id === publishedId.current) clearStatus();
  }, [isShowing]);

  return null;
}

/** The countdown's sentence. */
function countdownText(countdown: Countdown, t: Translate): string {
  switch (countdown.basis) {
    case 'scans':
      return t('plan.countdown.scansLeft', { count: countdown.scansLeft });
    case 'scans-used':
      return t('plan.countdown.scansUsed');
    case 'days':
      // THE LAST DAY IS ITS OWN SENTENCE. "1 day left" on the day it ends
      // reads as "tomorrow too", which is not true.
      return countdown.daysLeft === 1 ?
          t('plan.countdown.lastDay')
        : t('plan.countdown.daysLeft', { count: countdown.daysLeft });
  }
}

/** Whether the line is near enough the end to carry the recap. */
function isNearTheEnd(countdown: Countdown): boolean {
  switch (countdown.basis) {
    case 'scans':
      return countdown.scansLeft <= RECAP_NEAR_END_SCANS;
    // The trial is over, and the line says so; a recap belongs to the count.
    case 'scans-used':
      return false;
    case 'days':
      return countdown.daysLeft <= RECAP_NEAR_END_DAYS;
  }
}
