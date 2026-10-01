import { useEffect } from 'react';
import type { Route } from './+types/index';
import { data, redirect } from 'react-router';
import { z } from 'zod';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { useLanguageFromLink } from '#app/hooks/use-language-from-link';
import { CONFIG } from '#app/config';
import { NEWSLETTER_SOURCE, toNewsletterPublicConfig } from '#app/config/newsletter';
import { readNewsletterResponse, type NewsletterOutcome } from '#app/lib/newsletter-outcome';
import { NEWSLETTER_RATE_LIMIT, newsletterRateLimitKey } from '#app/lib/newsletter-rate-limit.server';
import { checkRateLimit, RateLimitExceededError } from '#app/lib/rate-limit.server';
import { createComponentLogger } from '#app/lib/logger';
import { getLocalProfileGoals, listLocalFoodLogs } from '#app/lib/local-store';
import {
  clearHomeHint,
  hasEnteredApp,
  parseHomeHintCookie,
  readHomeHint,
  resolveClientLandingEntry,
  resolveLandingRedirect,
  wantsLandingPage,
  writeHomeHint,
} from '#app/lib/home-entry';
import { instancePolicyForMode } from '#app/config/instance-policy';
import { readInstancePolicy } from '#app/lib/read-instance-policy';
import { hasDeviceSyncSession } from '#app/lib/sync/session-cache';
import { openGraphLocale } from '#app/i18n/date-locale';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { AccountDoorPage } from './account-door-page';
import { LandingOpen } from './landing-open';

// Title AND description via the pure `meta-title` seam, with the language read
// off the ROOT loader through `matches` — never the i18next singleton (see
// `meta-title.ts` for why that would leak one visitor's language into
// another's <title>). The description matters as much as the title here: this
// is the page search engines and link previews actually quote.
export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const language = metaLanguage(matches);
  // THE DESCRIPTION FOLLOWS THE POLICY TOO (M201/08). The open sentence ends
  // "Free, no account, and everything you log stays on your device", and on a
  // managed instance both halves of that are wrong: there IS an account, and
  // the diary reaches the operator's server as ciphertext. This string is the
  // `<meta name="description">`, so those two claims are what a search engine
  // and a link preview quote for beta.openplate.de.
  //
  // `meta()` runs outside the React tree, so there is no `useInstancePolicy()`
  // here. The mode comes off THIS route's own loader data, the same
  // request-scoped channel `siteOrigin` below already uses, rather than from
  // `CONFIG` (which `meta()` cannot read in the browser) or from a second
  // environment lookup. Missing loader data resolves to the OPEN policy, which
  // is the direction `getInstancePolicy` and `readInstancePolicy` both take.
  const managed = loaderData?.managed ?? false;
  const { requiresAccount, serverHoldsTheDiary } = instancePolicyForMode(managed ? 'managed' : 'open');
  // TWO HALVES, TWO QUESTIONS, and they are not the same question (M196/02).
  // The title's open form ends "a food tracker that stays on your device",
  // which is a claim about WHERE THE DIARY LIVES, so it is wrong exactly where
  // `serverHoldsTheDiary` is true. The description's open form ends "Free, no
  // account, and everything you log stays on your device", and the half that
  // makes it wrong first is "no account", so it asks `requiresAccount`. Asking
  // one question for both would tie the title to whether an account exists,
  // which is not what the sentence says.
  const title = metaTitle(language, serverHoldsTheDiary ? 'meta.landingManaged' : 'meta.landing');
  const description = metaTitle(
    language,
    requiresAccount ? 'meta.landingDescriptionManaged' : 'meta.landingDescription',
  );
  // The share card. Absolute URLs are not a style choice: every scraper
  // resolves `og:image` and `og:url` against nothing, so a root-relative path
  // is simply dropped. The origin rides in on the loader (`siteOrigin`) rather
  // than being read from `CONFIG` here, because `meta()` also runs in the
  // browser, where server config does not exist.
  const origin = loaderData?.siteOrigin ?? '';
  const image = `${origin}/og-image.png`;
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'openplate' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: `${origin}/` },
    { property: 'og:locale', content: openGraphLocale(language) },
    { property: 'og:image', content: image },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ];
};

////////////////////////////////////////////////////////////////////////////////
// "Have I already entered the app?" — three checks, one answer
////////////////////////////////////////////////////////////////////////////////

/**
 * SERVER: the no-flash path.
 *
 * A returning device carries the home hint (`#app/lib/home-entry`), so the
 * marketing HTML is never produced at all — the visitor gets a real 302 into
 * the app before a byte of it renders. A crawler never carries the cookie and
 * always gets the marketing page.
 *
 * @throws a redirect to `/dashboard` when the hint says this device is in the app.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const target = resolveLandingRedirect({
    hasHint: parseHomeHintCookie(request.headers.get('cookie')),
    wantsLanding: wantsLandingPage(url.search),
    // WHAT THIS SERVER MAY CONCLUDE (M201 spec 01): that this browser has been
    // here, and nothing more. The session is one row in an IndexedDB database
    // in the browser (`sync/session-cache.ts`) and no request carries it, so
    // on an instance where the hint does not mean "signed in" this loader
    // declines to redirect and `clientLoader` below decides where the session
    // actually is. See `resolveLandingRedirect` for the full argument.
    homeCookieProvesSession: instancePolicyForMode(CONFIG.instance.mode).homeCookieProvesSession,
  });
  // `Vary: Cookie` on BOTH branches: this response now differs by cookie, and
  // an intermediary that cached the 302 for a cookie-less visitor would trap
  // every new visitor in an app they haven't set up yet.
  // Named `varyCookie` rather than `headers`: this route also exports a
  // `headers` function (below), and the two are different things.
  const varyCookie = { Vary: 'Cookie' };
  if (target !== null) throw redirect(target, { headers: varyCookie });
  return data(landingSections(), { headers: varyCookie });
}

/**
 * Which of the ladder's optional rungs this instance actually has (M146 spec
 * 02).
 *
 * ── Gated HERE, in the loader, not in the component ──────────────────────
 *
 * Both flags are decided on the server from `CORE_URL` and
 * `NEWSLETTER_SUBSCRIBE_URL`, so an instance that configured neither renders
 * no markup for either section — not a hidden element, not an empty wrapper.
 * A component-side check would still ship the section's strings and its
 * component code to every browser, and "the self-hoster sees nothing" would
 * then depend on a `&&` rather than on the payload. This is the same contract
 * `/settings/sync` implements by 404ing (see that route's header).
 *
 * The newsletter's subscribe URL is deliberately NOT part of this: only the
 * Turnstile site key crosses (`toNewsletterPublicConfig`).
 */
function landingSections() {
  return {
    /**
     * This instance's public origin (`APP_URL`), for the Open Graph tags.
     *
     * A share card's `og:url` and `og:image` have to be absolute, and `meta()`
     * runs in the browser too, so it cannot read `CONFIG` itself. This is the
     * one value that crosses for that reason, and it is already public: it is
     * the address the visitor typed.
     */
    siteOrigin: CONFIG.app.url.replace(/\/+$/, ''),
    /** `CORE_URL`: off by default, including on every self-host. */
    syncEnabled: CONFIG.sync.syncServerUrl !== null,
    /** `NEWSLETTER_SUBSCRIBE_URL` + `NEWSLETTER_TURNSTILE_SITE_KEY` — off by default. */
    newsletter: toNewsletterPublicConfig(CONFIG.newsletter),
    /**
     * `MATOMO_EVENT_LEVEL` on an instance that set `MATOMO_URL` +
     * `MATOMO_SITE_ID`, and `null` when analytics are off, which is the
     * default, including on every self-host.
     *
     * THE LEVEL, not a boolean, and still not the config. It used to be
     * `analyticsEnabled`, which was honest while every configured instance
     * counted the same things. It stopped being honest when the level landed:
     * a `research` instance counts more than the "visits and feature use"
     * claim admits, and a `pageviews` one counts less. The card is a product
     * claim (.adr/0010-hosted-analytics.md), so both directions are wrong,
     * and under-claiming is the worse one.
     *
     * The URL and the site id still do not cross. The landing page carries no
     * Matomo address on an instance that has one, which is one fewer thing for
     * a scraper to collect, and a level name discloses nothing an operator has
     * not already chosen to say on the card itself.
     */
    analyticsLevel: CONFIG.analytics?.eventLevel ?? null,
    /**
     * `INSTANCE_MODE=managed`, for the CLIENT loader's half of the entry
     * decision (M201 spec 01).
     *
     * It crosses because the client loader runs before any component and so
     * cannot call `useInstancePolicy()`, and because the decision it makes is
     * the one the server loader deliberately refused to make. It discloses
     * nothing: `managed` is already in the root loader's public config and is
     * visible in the page source on every route.
     */
    managed: CONFIG.instance.managed,
  };
}

const logger = createComponentLogger('landing');

/** What the newsletter form submits. Parsed, never trusted — it arrives from a public page. */
const subscriptionSchema = z.object({
  email: z.email().max(320),
  locale: z.string().max(16),
  consent: z.literal(true),
  turnstileToken: z.string().min(1).max(4096),
});

/**
 * The newsletter subscribe proxy (M146 spec 02).
 *
 * ── Why the POST comes here instead of going straight to the endpoint ────
 *
 * Posting from the browser to the subscribe endpoint would publish that
 * endpoint's address to every visitor — it is normally an operator's internal
 * hostname — and would hand a bot the same address without a challenge in
 * front of it. So the browser posts here, this server forwards, and the
 * endpoint stays server-side.
 *
 * ── And why it 404s by default ───────────────────────────────────────────
 *
 * With no `NEWSLETTER_SUBSCRIBE_URL` this address is not a POST target at
 * all. An "it isn't enabled here" response would still be newsletter
 * behaviour on an instance whose operator chose to have none.
 *
 * @throws a 404 Response on an instance with no newsletter configured.
 *
 * Nothing about the submission is logged — the email address is the whole
 * personal-data payload, and it has no business in a log line.
 *
 * ── One branch answers with a status code, the rest with 200 ─────────────
 *
 * Every outcome here is a `NewsletterOutcome` the form renders as a sentence,
 * so the visitor's experience does not depend on the status. The rate-limited
 * branch additionally answers `429` with `Retry-After`, because that one is
 * not addressed only to the visitor: an over-eager script, a proxy or a
 * monitor reads the status line, and a refusal dressed as `200 OK` tells them
 * to keep going at the same rate. `data()` (rather than a thrown `Response`)
 * keeps the payload intact on `fetcher.data`, so the form still shows its
 * friendly line and still resets the challenge.
 */
export async function action({
  request,
}: Route.ActionArgs): Promise<NewsletterOutcome | ReturnType<typeof data<NewsletterOutcome>>> {
  const newsletter = CONFIG.newsletter;
  // Same shape as `/settings/sync`'s gate — a plain 404 Response, not a
  // rendered "not enabled here".
  if (newsletter === null) throw new Response('Not Found', { status: 404 });

  // BEFORE the body is read and long before anything is forwarded: the point
  // is to spend as little as possible on a caller that is over its limit, and
  // to make sure a flood can never reach the operator's internal subscribe
  // endpoint through this hop. See `newsletter-rate-limit.server.ts` for the
  // rule and why it is keyed on IP alone.
  try {
    checkRateLimit(newsletterRateLimitKey(request), NEWSLETTER_RATE_LIMIT);
  } catch (error) {
    if (!(error instanceof RateLimitExceededError)) throw error;
    // `Retry-After` is whole seconds (RFC 9110 §10.2.3), rounded UP so the
    // advertised moment is never earlier than the window actually reopens —
    // a client that obeys a rounded-down value gets refused a second time.
    return data<NewsletterOutcome>(
      { ok: false, reason: 'tooManyAttempts' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)) } },
    );
  }

  const form = await request.formData();
  const submission = subscriptionSchema.safeParse({
    email: form.get('email'),
    locale: form.get('locale'),
    // An unchecked box submits nothing at all, so a missing field IS the
    // absence of consent — never a default.
    consent: form.get('consent') === 'true',
    turnstileToken: form.get('turnstileToken'),
  });

  if (!submission.success) {
    const fields = new Set(submission.error.issues.map((issue) => issue.path[0]));
    if (fields.has('consent')) return { ok: false, reason: 'noConsent' };
    if (fields.has('turnstileToken')) return { ok: false, reason: 'invalidToken' };
    return { ok: false, reason: 'invalidEmail' };
  }

  try {
    const response = await fetch(newsletter.subscribeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...submission.data, source: NEWSLETTER_SOURCE }),
    });
    return await readNewsletterResponse(response);
  } catch (error) {
    // The endpoint's address is operator topology and the payload is personal
    // data: neither is logged. Only that the hop failed.
    logger.warn('Newsletter subscribe request failed', { error: error instanceof Error ? error.message : 'unknown' });
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * The route's response headers — the ONE place they actually reach the wire.
 *
 * ── Why this export has to exist ─────────────────────────────────────────
 *
 * `data(payload, { headers })` in a loader or an action sets the response
 * STATUS but not the headers: under single fetch the framework composes one
 * response for the whole route match, and it asks this export what its headers
 * should be. Without it the `429`'s `Retry-After` was constructed, discarded,
 * and never seen by anything — verified on the wire, not assumed.
 *
 * Both directions are carried on purpose:
 *
 * - `loaderHeaders` brings `Vary: Cookie`, which is not optional. The loader
 *   answers a 302 or a page depending on a cookie, and an intermediary that
 *   cached either one for the wrong visitor would trap every new visitor in an
 *   app they have not set up. Returning only `actionHeaders` here would have
 *   dropped it silently on every GET.
 * - `actionHeaders` brings `Retry-After` on the rate-limited POST, and nothing
 *   at all otherwise.
 */
export function headers({ actionHeaders, loaderHeaders, parentHeaders }: Route.HeadersArgs): Headers {
  // The base is the PARENT's headers, not this route's loader headers. A
  // `headers` export replaces whatever the parent match contributed rather
  // than adding to it, so seeding from `loaderHeaders` silently dropped every
  // header the public layout or the root sets on this one route — a class of
  // bug that shows up as "the policy is on every page except the landing
  // page". The route's own headers are layered on top, so a name this route
  // sets still wins.
  const merged = new Headers(parentHeaders);
  for (const [name, value] of loaderHeaders) merged.set(name, value);
  for (const [name, value] of actionHeaders) merged.set(name, value);
  return merged;
}

/**
 * CLIENT: in-app navigation to `/`.
 *
 * Deliberately NO `clientLoader.hydrate`. Hydrating would put a spinner in
 * front of the app's public SEO page for EVERY first-time visitor, to fix a
 * rare cookie-eviction case — so the marketing page keeps its instant SSR
 * first paint, and the eviction case is handled by the component effect below.
 *
 * This DOES run on every client-side navigation to `/`, where local truth is
 * cheap to read: it repairs the hint in whichever direction is wrong and
 * redirects with no flash at all.
 *
 * @throws a redirect to `/dashboard` when the local store says this device is in the app.
 */
export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  // `serverLoader()` rather than `null`: the section gates above are decided
  // on the server, so a client-side navigation to `/` has to fetch them or the
  // page would render its optional sections differently depending on how the
  // visitor arrived.
  if (wantsLandingPage(new URL(request.url).search)) return await serverLoader();

  // The policy rides in on that same fetch, so this costs no extra request.
  // It fails OPEN offline, which is the pre-M201 behaviour and the safe
  // direction: this redirect only ever moves somebody between two screens
  // they may already open.
  const { homeCookieProvesSession } = await readInstancePolicy(serverLoader);
  const [profile, logs] = await Promise.all([getLocalProfileGoals(), listLocalFoodLogs()]);
  // ASKED ONLY WHERE THE ANSWER CAN CHANGE THE DECISION, so an open instance
  // never opens the session database from its marketing page and its landing
  // path is byte-for-byte what it was.
  const hasSession = homeCookieProvesSession ? false : await hasDeviceSyncSession();
  const entry = resolveClientLandingEntry({
    wantsLanding: false,
    entered: hasEnteredApp({
      onboardingCompletedAt: profile?.onboardingCompletedAt ?? null,
      foodLogCount: logs.length,
    }),
    hasSession,
    homeCookieProvesSession,
  });

  if (entry !== 'dashboard') {
    // A wiped device, or a signed-out one on an instance where local rows are
    // an account's rather than this device's, repair downward either way.
    if (entry === 'landing-clear-hint') clearHomeHint();
    return await serverLoader();
  }
  writeHomeHint(); // repair upward (evicted cookie)
  throw redirect('/dashboard');
}

/**
 * CLIENT: the repair path for a HARD load with no hint — a cookie evicted by
 * WebKit's 7-day cap, or a device that predates this feature.
 *
 * An effect rather than a hydrating `clientLoader` for the reason above. It
 * costs one frame of marketing in that rare case and nothing at all otherwise.
 * This is a genuine external-system read plus a navigation side effect, not
 * derived state.
 */
function useHomeHintRepair(): void {
  const navigate = useAppNavigate();
  // The THIRD of the three paths (M201 spec 01). A fix to one of them is not a
  // fix: this one runs on exactly the hard loads the other two do not decide,
  // and it shares their decision function rather than restating it.
  const { homeCookieProvesSession } = useInstancePolicy();

  useEffect(() => {
    if (wantsLandingPage(window.location.search)) return;
    // A present hint means the server loader has already redirected, but ONLY
    // where the server was allowed to read the hint that way. On a managed
    // instance it deliberately was not, so a present hint there is precisely
    // the case this effect has to look at rather than skip.
    if (homeCookieProvesSession && readHomeHint()) return;

    let cancelled = false;
    void (async () => {
      const [profile, logs, hasSession] = await Promise.all([
        getLocalProfileGoals(),
        listLocalFoodLogs(),
        homeCookieProvesSession ? Promise.resolve(false) : hasDeviceSyncSession(),
      ]);
      if (cancelled) return;
      const entry = resolveClientLandingEntry({
        wantsLanding: false,
        entered: hasEnteredApp({
          onboardingCompletedAt: profile?.onboardingCompletedAt ?? null,
          foodLogCount: logs.length,
        }),
        hasSession,
        homeCookieProvesSession,
      });
      // A signed-out managed device that still carries the hint: drop it here,
      // so the next hard load's server loader has nothing stale to read even
      // before it reaches the question it is not allowed to answer.
      if (entry === 'landing-clear-hint') {
        clearHomeHint();
        return;
      }
      if (entry !== 'dashboard') return;
      writeHomeHint();
      // `replace` so Back still leaves the app rather than bouncing here again.
      void navigate('/dashboard', { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, homeCookieProvesSession]);
}

/**
 * THE PAGE, chosen ONCE (M266 design, step 3, approved 2026-09-29).
 *
 * openplate.de sells and explains; every app host is a door and then the app.
 * So on an instance whose front door is the account door (a managed one), a
 * visitor with no session gets the doors, the offer and a line to the project
 * site (`account-door-page.tsx`), and the pitch lives on openplate.de alone. An
 * open instance keeps its whole landing (`landing-open.tsx`): it is one
 * person's front door, and nobody else's storefront.
 *
 * The three paths into the app stay HERE and run for both pages, before the
 * branch: the server loader's redirect, the client loader, and the hard-load
 * repair below. A device with a session never stays on either page.
 */
export default function Index({ loaderData }: Route.ComponentProps) {
  useHomeHintRepair();
  // `?lang=` from openplate.de makes the page, and the device, speak that language.
  useLanguageFromLink();
  const { frontDoorIsTheAccountDoor } = useInstancePolicy();
  if (frontDoorIsTheAccountDoor) return <AccountDoorPage />;
  const { syncEnabled, newsletter, analyticsLevel } = loaderData;
  return <LandingOpen syncEnabled={syncEnabled} newsletter={newsletter} analyticsLevel={analyticsLevel} />;
}
