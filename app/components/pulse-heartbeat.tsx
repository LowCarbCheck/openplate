/**
 * The "still fasting" signal, as a component with no markup.
 *
 * It renders `null` and exists only for its effect: while a fast is RUNNING on
 * this device and the tab is visible, it tells the pulse once immediately and
 * then once every fifteen minutes. The server's presence window is thirty
 * minutes, so a device that closes the tab, ends the fast or goes to sleep
 * simply stops being counted a little later, with nothing to un-send.
 *
 * ── Why it mounts in the app chrome ──────────────────────────────────────
 *
 * Beside `FastChipSlot` in `app-wrapper.tsx`, for the same reason the chip is
 * there: a fast is running whatever page the person is on, and a heartbeat
 * that only beat on `/fasting` would report a person who is looking at their
 * diary as not fasting.
 *
 * ── The decision is not in here ──────────────────────────────────────────
 *
 * `heartbeatDue` is a pure function in `#app/lib/pulse`, so the three rules
 * (hidden never sends, scheduled never sends, active sends now and then every
 * fifteen minutes) are pinned by arithmetic rather than by a test that has to
 * wait a quarter of an hour. This file is the imperative shell: a clock, a
 * visibility listener and one `void` call.
 *
 * THE GATE IS STILL THE MODULE'S. Nothing here asks whether sharing is on;
 * `reportFastingHeartbeat` answers that itself, so a second opinion here could
 * not drift from the first one.
 */
import { useEffect, useRef, useState } from 'react';

import { useCurrentFast } from '#app/hooks/use-current-fast';
import { heartbeatDue, reportFastingHeartbeat, type PulseFastStatus } from '#app/lib/pulse';
import { resolveFastTimeline } from '#app/models/fasting';

/**
 * How often the component re-asks whether a beat is due.
 *
 * A minute, not fifteen: the person may make the tab visible or start a fast
 * at any moment, and `heartbeatDue` is the thing that decides whether the tick
 * actually sends anything.
 */
const TICK_MS = 60_000;

/** Whether the document is visible right now. `true` outside a browser, where the effect below never runs anyway. */
function isDocumentVisible(): boolean {
  if (globalThis.document === undefined) return true;
  return document.visibilityState === 'visible';
}

export function PulseHeartbeat(): null {
  const { fast, nowMs } = useCurrentFast();
  const [visible, setVisible] = useState(isDocumentVisible);
  const [tick, setTick] = useState(0);
  /** When this mount last sent. A ref, not state: a send must not schedule a render. */
  const lastSentMs = useRef<number | null>(null);

  useEffect(() => {
    if (globalThis.document === undefined) return;
    const onVisibility = () => setVisible(isDocumentVisible());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const status: PulseFastStatus = fast === null ? 'none' : resolveFastTimeline(fast, nowMs).status;

  useEffect(() => {
    // A fast that ended, or a tab that hid, forgets the last send: coming back
    // must beat immediately rather than wait out the remainder of an interval
    // that ran while nobody was counted.
    if (status !== 'active' || !visible) {
      lastSentMs.current = null;
      return;
    }
    const now = Date.now();
    if (!heartbeatDue({ status, visible, lastSentMs: lastSentMs.current, nowMs: now })) return;
    lastSentMs.current = now;
    void reportFastingHeartbeat();
  }, [status, visible, tick, nowMs]);

  return null;
}
