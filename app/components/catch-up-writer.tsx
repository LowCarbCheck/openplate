/**
 * The catch-up writer: a component with no markup.
 *
 * It renders `null` and exists only for its effect. On mount, and again after
 * every write to the diary, it builds this morning's catch-up and stores it in
 * the notification database, so a push that arrives hours later already has its
 * words on the device. The server never writes notification text (M223's one
 * principle), which means the device has to write it BEFORE the push.
 *
 * ── Why it mounts in the app chrome ──────────────────────────────────────
 *
 * Beside `PulseHeartbeat` in `app-wrapper.tsx`, for the reason that one is
 * there: a log lands on whatever page the person is on, and a writer that only
 * ran on `/diary` would leave a person who logs from `/add` with yesterday's
 * words.
 *
 * ── Why it is debounced ──────────────────────────────────────────────────
 *
 * A whole-day repeat writes a dozen rows in a burst, and each one signals the
 * table. Two seconds of quiet collapses that burst into one rebuild, and the
 * record is read minutes later at the earliest, so the delay costs nothing.
 *
 * ── It never throws ──────────────────────────────────────────────────────
 *
 * A device with no usable IndexedDB, a storage quota refusal, a store that is
 * mid-upgrade: all of them end here, at debug level. There is nothing to tell
 * the person, because there is nothing they could do, and an unhandled
 * rejection over a notification nobody asked for yet is worse than no
 * notification.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { loadCatchUpInput } from '#app/lib/catch-up-input';
import { getPrimaryStore } from '#app/lib/local-store/persist';
import { FOOD_LOGS_TABLE } from '#app/lib/local-store/store';
import { logger } from '#app/lib/logger';
import { putCatchUpRecord } from '#app/lib/notify-store';
import { buildCatchUp } from '#app/models/catch-up';
import type { Translate } from '#app/models/fasting';

/** How long the diary has to be quiet before the record is rebuilt. */
const DEBOUNCE_MS = 2000;

/**
 * Calls `listener` after every write to the primary store's food-log table,
 * and returns the unsubscribe.
 *
 * The same seam `use-current-fast.ts` uses for the fasts table, and best effort
 * for the same reasons: on the server, and in a browser with no usable
 * IndexedDB, there is nothing to listen to.
 *
 * @param listener - called once per write, with no arguments.
 * @returns a function that removes the listener, safe to call before it attached.
 */
function subscribeToFoodLogs(listener: () => void): () => void {
  let isCancelled = false;
  let remove: (() => void) | null = null;
  void (async () => {
    try {
      const store = await getPrimaryStore();
      if (isCancelled) return;
      const listenerId = store.addTableListener(FOOD_LOGS_TABLE, () => listener());
      remove = () => store.delListener(listenerId);
    } catch {
      // No store to listen to. The mount-time write is then the only one.
    }
  })();
  return () => {
    isCancelled = true;
    if (remove) remove();
  };
}

/**
 * Builds the catch-up and stores it. Swallows every failure: see the module
 * doc for why a notification nobody has asked for yet never raises.
 *
 * @param t - the caller's translator.
 * @param locale - the active UI language, stored with the record so a worker never mixes two.
 */
export async function writeCatchUpRecord({ t, locale }: { t: Translate; locale: string }): Promise<void> {
  try {
    const catchUp = buildCatchUp(await loadCatchUpInput({ t, locale }));
    await putCatchUpRecord({
      forDay: catchUp.forDay,
      title: catchUp.title,
      body: catchUp.body,
      url: catchUp.url,
      locale,
      writtenAt: Date.now(),
    });
  } catch (error) {
    logger.debug('catch-up record not written', { error: error instanceof Error ? error : String(error) });
  }
}

export function CatchUpWriter(): null {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  useEffect(() => {
    if (globalThis.document === undefined) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        void writeCatchUpRecord({ t, locale });
      }, DEBOUNCE_MS);
    };

    // The mount write is immediate: opening the app is the one moment the
    // person is definitely not mid-burst, and waiting two seconds for it would
    // lose the write on a visit shorter than that.
    void writeCatchUpRecord({ t, locale });
    const unsubscribe = subscribeToFoodLogs(schedule);
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [t, locale]);

  return null;
}
