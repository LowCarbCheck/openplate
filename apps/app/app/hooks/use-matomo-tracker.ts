import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { z } from 'zod';

import type { AnalyticsConfig } from '#app/config/analytics';
import { ANALYTICS_OPT_OUT_EVENT, mayCountVisits } from '#app/lib/analytics-opt-out';
import { setAnalyticsEventLevel, stampAnalyticsPage, trackOfflinePageview } from '#app/lib/matomo-events';

/**
 * Loads Matomo and reports SPA navigations.
 *
 * Ported from `selfhostedworld-com/apps/web/app/hooks/use-matomo-tracker.ts`,
 * with three deliberate differences:
 *
 * 1. **`config` is nullable and there are no defaults.** SHW hardcodes a
 *    fallback site id and URL, which is right for a single-deployment site and
 *    wrong here: openplate is a public repo that self-hosters run. A default
 *    would mean every self-hosted instance quietly reporting into SPRQVNTRS's
 *    Matomo. `null` — the self-host default — loads no script and sends
 *    nothing, keeping the "no third-party script on an unconfigured instance"
 *    claim in `content-security-policy.ts`.
 *
 * 2. **The `hasRun` guard is a ref-free module flag, as in SHW, but the effect
 *    depends on the config object's FIELDS rather than the object.** The root
 *    loader hands back a fresh object every navigation; depending on the
 *    object itself would re-run the effect forever.
 *
 * 3. **`disableCookies` is pushed before the tracker script is inserted**, so
 *    it applies to the very first pageview rather than the second. openplate
 *    stores nothing on the device for analytics, which is what keeps this out
 *    of consent-banner territory.
 *
 * 4. **The reported URL and referrer are scrubbed** through
 *    `sanitizeAnalyticsUrl`. SHW reports `location.href` directly; doing that
 *    here would have posted live email-verification tokens, password-reset
 *    tokens and OAuth codes to Matomo. This is the difference that matters —
 *    read `matomo-url.ts` before changing either push below. The scrubbed URL
 *    and referrer are put in the queue by `stampAnalyticsPage`, which has to
 *    be the FIRST entry of every page: an event queued before the script
 *    loads is replayed with whatever custom URL came before it, and with the
 *    real `location.href` when none did. See `matomo-events.ts`.
 *
 * 5. **This hook owns the event LEVEL.** `matomo-events.ts` starts at
 *    `pageviews` and fires nothing until it is told the instance's level, so
 *    the call below is what turns custom events on at all. It happens before
 *    the script is inserted, so no event can slip out under the wrong level,
 *    and `eventLevel` is an effect dependency for the same reason `matomoUrl`
 *    and `siteId` are: an operator changing the level must not need a second
 *    deploy to have it take effect. `null` config means analytics are off and
 *    leaves the module at `pageviews`.
 *
 * 6. **A person's "no" wins over the config** (2026-09-28). Do Not Track,
 *    Global Privacy Control and the Preferences switch are read through
 *    `analytics-opt-out.ts`, and while any of them says no, no script is
 *    inserted and nothing is sent. The privacy notice promised Do Not Track
 *    and a live browser sending it was counted anyway. Turning the switch off
 *    during a visit stops a tracker that already loaded: `requireConsent`
 *    holds every later request, the heartbeat included, and no consent is
 *    ever given, so nothing more leaves. Turning it back on counts from the
 *    next page load if the tracker never loaded, and from the next visit if
 *    it was stopped.
 */
let hasRun = false;
let isStopped = false;

/** What `setAnalyticsOptOut` puts on its event. */
const optOutDetailSchema = z.object({ optedOut: z.boolean() });

/** Test seam: resets the module-level load guard. Never called by app code. */
export function __resetMatomoForTests(): void {
  hasRun = false;
  isStopped = false;
}

export function useMatomoTracker(config: AnalyticsConfig | null): boolean {
  const location = useLocation();
  const [matomoLoaded, setMatomoLoaded] = useState(false);

  const matomoUrl = config?.matomoUrl ?? null;
  const siteId = config?.siteId ?? null;
  const eventLevel = config?.eventLevel ?? null;
  // Bumped when the Preferences switch changes, so the load effect asks again.
  const [optOutChanges, setOptOutChanges] = useState(0);

  useEffect(() => {
    function onOptOutChange(event: Event): void {
      const detail = optOutDetailSchema.safeParse(event instanceof CustomEvent ? event.detail : null);
      const optedOut = detail.success && detail.data.optedOut;
      if (optedOut && hasRun && !isStopped) {
        (window._paq = window._paq || []).push(['requireConsent']);
        isStopped = true;
      }
      setOptOutChanges((count) => count + 1);
    }
    window.addEventListener(ANALYTICS_OPT_OUT_EVENT, onOptOutChange);
    return () => window.removeEventListener(ANALYTICS_OPT_OUT_EVENT, onOptOutChange);
  }, []);

  useEffect(() => {
    // Before the gate below, and before the script: the events module has to
    // know the level even on a re-render that the `hasRun` guard exits early
    // from, or a level change would never reach it.
    setAnalyticsEventLevel(eventLevel);

    // The whole feature gate. No config → no script tag, no request, no
    // globals touched.
    if (matomoUrl === null || siteId === null) return;
    if (hasRun) return;
    // Do Not Track, Global Privacy Control, or the person's own switch.
    if (!mayCountVisits()) return;

    // First entry of the queue, before even `disableCookies`: an event a child
    // effect already queued stamped it, and when none did this is the stamp.
    stampAnalyticsPage();
    const _paq = (window._paq = window._paq || []);
    _paq.push(['disableCookies']);
    _paq.push(['enableLinkTracking']);

    const u = matomoUrl.endsWith('/') ? matomoUrl : `${matomoUrl}/`;
    _paq.push(['setTrackerUrl', `${u}matomo.php`]);
    _paq.push(['setSiteId', `${siteId}`]);
    _paq.push(['enableHeartBeatTimer']);

    const d = document;
    const g = d.createElement('script');
    const s = d.getElementsByTagName('script')[0];
    g.type = 'text/javascript';
    g.async = true;
    g.defer = true;
    g.src = `${u}matomo.js`;
    g.addEventListener('load', () => setMatomoLoaded(true));
    s.parentNode?.insertBefore(g, s);

    hasRun = true;
  }, [matomoUrl, siteId, eventLevel, optOutChanges]);

  // SPA navigations. openplate is a single-page app after the first load, so
  // without this every session would report exactly one pageview.
  useEffect(() => {
    if (!hasRun || !matomoLoaded) return;
    if (isStopped || !mayCountVisits()) return;

    const _paq = (window._paq = window._paq || []);
    // NEVER `window.location.href` raw — openplate puts single-use tokens in
    // the query string and account ids in the path. The stamp scrubs the URL
    // and the referrer: an in-app navigation FROM `/verify-email?token=…`
    // would otherwise leak the token as a referrer even though the
    // destination page was harmless. See `matomo-url.ts`.
    stampAnalyticsPage({ force: true });
    _paq.push(['setDocumentTitle', document.title]);
    _paq.push(['trackPageView']);
    if (!navigator.onLine) {
      trackOfflinePageview();
    }
  }, [location, matomoLoaded]);

  return hasRun;
}
