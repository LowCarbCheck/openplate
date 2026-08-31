import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import type { AnalyticsConfig } from '#app/config/analytics';
import { trackOfflinePageview } from '#app/lib/matomo-events';
import { sanitizeAnalyticsUrl } from '#app/lib/matomo-url';

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
 *    read `matomo-url.ts` before changing either push below.
 */
let hasRun = false;

/** Test seam: resets the module-level load guard. Never called by app code. */
export function __resetMatomoForTests(): void {
  hasRun = false;
}

export function useMatomoTracker(config: AnalyticsConfig | null): boolean {
  const location = useLocation();
  const [matomoLoaded, setMatomoLoaded] = useState(false);

  const matomoUrl = config?.matomoUrl ?? null;
  const siteId = config?.siteId ?? null;

  useEffect(() => {
    // The whole feature gate. No config → no script tag, no request, no
    // globals touched.
    if (matomoUrl === null || siteId === null) return;
    if (hasRun) return;

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
  }, [matomoUrl, siteId]);

  // SPA navigations. openplate is a single-page app after the first load, so
  // without this every session would report exactly one pageview.
  useEffect(() => {
    if (!hasRun || !matomoLoaded) return;

    const _paq = (window._paq = window._paq || []);
    // NEVER `window.location.href` raw — openplate puts single-use tokens in
    // the query string and account ids in the path. See `matomo-url.ts`.
    const safeUrl = sanitizeAnalyticsUrl(window.location.href);
    if (safeUrl !== null) _paq.push(['setCustomUrl', safeUrl]);
    _paq.push(['setDocumentTitle', document.title]);
    // The referrer gets the same treatment: an in-app navigation FROM
    // `/verify-email?token=…` would otherwise leak the token as a referrer
    // even though the destination page was harmless.
    const safeReferrer = sanitizeAnalyticsUrl(document.referrer);
    if (safeReferrer !== null) _paq.push(['setReferrerUrl', safeReferrer]);
    _paq.push(['trackPageView']);
    if (!navigator.onLine) {
      trackOfflinePageview();
    }
  }, [location, matomoLoaded]);

  return hasRun;
}
