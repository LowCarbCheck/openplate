/**
 * Fires a one-time celebration for a genuine first (M129/03).
 *
 * The decision, the priority order and the "never twice" bookkeeping all live
 * in `#app/lib/celebration` (pure, tested). This hook is the browser half: it
 * reads localStorage after mount — never during render, so the server and the
 * client agree on the first paint — banks every newly-true milestone at once,
 * and hands the caller an id to pulse against for a couple of seconds.
 *
 * `prefers-reduced-motion` suppresses the visual pulse but NOT the note: the
 * milestone still gets acknowledged in words, because "I asked for less
 * animation" is not "don't tell me anything".
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { celebrationMessage, markCelebrationsSeen, readSeenCelebrations, resolveCelebration } from '#app/lib/celebration';
import type { CelebrationFacts, CelebrationId } from '#app/lib/celebration';

/** How long the pulse class stays applied. Two beats of the 1.4s keyframe, plus a little slack. */
const CELEBRATION_VISIBLE_MS = 3000;

/**
 * Resolves and plays at most one celebration.
 *
 * @param facts - what the device currently holds (from the diary's loader).
 * @returns the milestone currently playing, or null.
 */
export function useCelebration(facts: CelebrationFacts): CelebrationId | null {
  const { t } = useTranslation();
  const [active, setActive] = useState<CelebrationId | null>(null);
  const { totalLogCount, aiEstimatedLogCount, loggedDaysInWindow, windowDays, weighInCount, crossedTargetOnLatest } =
    facts;

  // `t` is read through a ref rather than depended on: re-running the effect on
  // a language change would re-toast an already-banked milestone. A language
  // switch reloads the document anyway (see `app/i18n/language-prefs.ts`), so
  // the next render already has the right language from a cold start.
  const translateRef = useRef(t);
  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    if (globalThis.window === undefined) return;
    const decision = resolveCelebration({
      facts: {
        totalLogCount,
        aiEstimatedLogCount,
        loggedDaysInWindow,
        windowDays,
        weighInCount,
        crossedTargetOnLatest,
      },
      seen: readSeenCelebrations(window.localStorage),
    });
    if (decision.celebrate === null) return;
    // Banked BEFORE anything is shown, so a mid-render crash or a fast
    // navigation can't leave a milestone able to fire a second time.
    markCelebrationsSeen(window.localStorage, decision.newlySatisfied);
    setActive(decision.celebrate);
    toast(celebrationMessage(decision.celebrate, translateRef.current));
    const timer = setTimeout(() => setActive(null), CELEBRATION_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [totalLogCount, aiEstimatedLogCount, loggedDaysInWindow, windowDays, weighInCount, crossedTargetOnLatest]);

  return active;
}
