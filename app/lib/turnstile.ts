/**
 * Cloudflare Turnstile — the app's ONLY third-party script, and it is loaded
 * on demand, never from the document head (M146 spec 02).
 *
 * ── Read this before importing it anywhere else ──────────────────────────
 *
 * openplate ships with zero third-party scripts. That is a product claim (see
 * DESIGN.md §11: no CDN assets; AGENTS.md: nothing about a visitor leaves this
 * server), so the exception below is narrow on purpose:
 *
 * - It is fetched only from the newsletter form, which itself renders only
 *   when `NEWSLETTER_SUBSCRIBE_URL` is configured. A self-hoster who set
 *   nothing never has this module's code path executed and never contacts
 *   Cloudflare.
 * - The production CSP widens for this origin under the same condition —
 *   `newsletterEnabled` in `app/config/content-security-policy.ts`.
 *
 * Loading it in the head, or unconditionally, would give the claim up for
 * every instance in exchange for a feature most of them do not run.
 */

/** The slice of Cloudflare's widget API this app uses. */
export interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      language?: string;
      /**
       * `auto` follows `prefers-color-scheme`. This is the ONE place a media
       * query is the right answer for theme: the widget is Cloudflare's own
       * iframe, so the app's `.dark` class cannot reach inside it, and an OS
       * guess is closer than hardcoding one theme for everybody.
       */
      theme?: 'auto' | 'light' | 'dark';
      /**
       * `interaction-only` renders nothing at all unless the visitor is
       * actually challenged — which, for the overwhelming majority, is never.
       * The alternative (`always`) parks a branded Cloudflare box in the
       * middle of a form on a page whose whole argument is that nothing here
       * phones anyone. See the container in `newsletter-signup.tsx` for why
       * this also removes a reserved hole.
       */
      appearance?: 'always' | 'execute' | 'interaction-only';
      /** `flexible` takes the container's width instead of a fixed 300px. */
      size?: 'normal' | 'flexible' | 'compact';
      callback?: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Explicit rendering (`?render=explicit`) rather than the implicit `cf-turnstile`
 * class scan: the form needs the token in React state so the submit button can
 * stay disabled until the challenge passes, and needs `reset()` after a failed
 * submit because a token is single-use.
 *
 * Reached only while `NEWSLETTER_SUBSCRIBE_URL` is configured — see the module
 * doc above.
 */
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * In-flight or SUCCESSFULLY settled load, so two mounted forms share one
 * `<script>`.
 *
 * Cleared again on rejection (see below). It used to keep the rejected promise
 * forever, which cached one transient failure — a dropped connection, a
 * blocker that was switched off a second later — for the lifetime of the tab:
 * every later mount got the same stale rejection back without so much as
 * attempting a fetch, so "reload the page" was the only recovery from a
 * network blip.
 */
let scriptPromise: Promise<TurnstileApi> | null = null;

/**
 * Injects the widget script (once) and resolves with its API.
 *
 * Rejects if the script fails to load or does not publish `window.turnstile` —
 * the caller renders a plain error rather than a permanently-pending form.
 *
 * CLIENT-ONLY. It touches `document` directly and carries no server guard,
 * because its one caller is a `useEffect` in the newsletter form and effects
 * do not run during SSR. Do not call it from a loader.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (scriptPromise !== null) return scriptPromise;

  const pending = new Promise<TurnstileApi>((resolve, reject) => {
    const resolveApi = () => {
      const api = window.turnstile;
      if (api === undefined) {
        reject(new Error('Turnstile loaded without publishing its API'));
        return;
      }
      resolve(api);
    };

    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', resolveApi);
    script.addEventListener('error', () => {
      // Take the dead tag back out of the head. A failed load is RETRIED (see
      // the cache note below), and each retry appends another `<script>`; the
      // one that failed can never load or be replaced, so leaving it behind
      // grows the document by one permanently-broken third-party tag per
      // attempt — visible in devtools, and misleading about what this page
      // actually loaded.
      script.remove();
      reject(new Error('Turnstile script failed to load'));
    });
    document.head.appendChild(script);
  });

  // Only a SUCCESSFUL load is cached. On rejection the module goes back to
  // "never loaded", so the next mount — a visitor who scrolled away and back,
  // or who disabled the thing that blocked it — gets a real second attempt.
  //
  // The `catch` below is a side-effecting OBSERVER on a separate branch of the
  // chain, not error handling: every caller is handed `pending` itself, so
  // `pending` still rejects and the form still shows its error. `void` marks
  // the observer branch's own (resolved) promise as deliberately unused.
  void pending.catch(() => {
    scriptPromise = null;
  });
  scriptPromise = pending;

  return pending;
}
