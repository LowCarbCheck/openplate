import type { ReactElement, ReactNode } from 'react';
import { useEffect } from 'react';
import type { Route } from './+types/index';
import { data, redirect, useNavigate } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import {
  Camera,
  Check,
  EyeOff,
  Gauge,
  Github,
  HardDrive,
  Key,
  Mail,
  RefreshCw,
  Search,
  Server,
  Smartphone,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';
import PublicWrapper from '#app/components/public-wrapper';
import { PlateGlyph } from '#app/components/plate-glyph';
import { NewsletterSignup } from '#app/components/newsletter-signup';
import { REPO_URL } from '#app/lib/brand';
import { CONFIG } from '#app/config';
import { NEWSLETTER_SOURCE, toNewsletterPublicConfig } from '#app/config/newsletter';
import { readNewsletterResponse, type NewsletterOutcome } from '#app/lib/newsletter-outcome';
import { NEWSLETTER_RATE_LIMIT, newsletterRateLimitKey } from '#app/lib/newsletter-rate-limit.server';
import { checkRateLimit, RateLimitExceededError } from '#app/lib/rate-limit.server';
import { createComponentLogger } from '#app/lib/logger';
import { SectionEyebrow } from '#app/components/typography';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardHeader } from '#app/components/ui/card';
import { cn } from '#app/lib/utils';
import { getLocalProfileGoals, listLocalFoodLogs } from '#app/lib/local-store';
import {
  clearHomeHint,
  hasEnteredApp,
  parseHomeHintCookie,
  readHomeHint,
  resolveLandingRedirect,
  wantsLandingPage,
  writeHomeHint,
} from '#app/lib/home-entry';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

// Title AND description via the pure `meta-title` seam, with the language read
// off the ROOT loader through `matches` — never the i18next singleton (see
// `meta-title.ts` for why that would leak one visitor's language into
// another's <title>). The description matters as much as the title here: this
// is the page search engines and link previews actually quote.
export const meta: Route.MetaFunction = ({ matches }) => {
  const language = metaLanguage(matches);
  return [
    { title: metaTitle(language, 'meta.landing') },
    { name: 'description', content: metaTitle(language, 'meta.landingDescription') },
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
 * Both flags are decided on the server from `SYNC_SERVER_URL` and
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
    /** `SYNC_SERVER_URL` — off by default, including on every self-host. */
    syncEnabled: CONFIG.sync.syncServerUrl !== null,
    /** `NEWSLETTER_SUBSCRIBE_URL` + `NEWSLETTER_TURNSTILE_SITE_KEY` — off by default. */
    newsletter: toNewsletterPublicConfig(CONFIG.newsletter),
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
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs): Headers {
  const merged = new Headers(loaderHeaders);
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

  const [profile, logs] = await Promise.all([getLocalProfileGoals(), listLocalFoodLogs()]);
  const entered = hasEnteredApp({
    onboardingCompletedAt: profile?.onboardingCompletedAt ?? null,
    foodLogCount: logs.length,
  });

  if (!entered) {
    clearHomeHint(); // stale hint on a wiped device — repair downward
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
  const navigate = useNavigate();

  useEffect(() => {
    if (wantsLandingPage(window.location.search)) return;
    if (readHomeHint()) return; // the server loader already handled it

    let cancelled = false;
    void (async () => {
      const [profile, logs] = await Promise.all([getLocalProfileGoals(), listLocalFoodLogs()]);
      if (cancelled) return;
      const entered = hasEnteredApp({
        onboardingCompletedAt: profile?.onboardingCompletedAt ?? null,
        foodLogCount: logs.length,
      });
      if (!entered) return;
      writeHomeHint();
      // `replace` so Back still leaves the app rather than bouncing here again.
      void navigate('/dashboard', { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);
}

////////////////////////////////////////////////////////////////////////////////
// Product imagery — real screenshots, captured from the running app
////////////////////////////////////////////////////////////////////////////////

/**
 * The hero image: the diary, as the app actually draws it.
 *
 * It REPLACES the hand-built "What you'll see" card that stood here before.
 * That card was assembled out of the app's own primitives, which made it
 * honest but not convincing — a visitor could not tell whether they were
 * looking at the product or at a drawing of it. These are screenshots of the
 * running app with a sample day logged, and the caption underneath says so.
 *
 * Four captures, and the two axes they vary on are handled by DIFFERENT
 * mechanisms — deliberately, because only one of the two is knowable to CSS:
 *
 * - FORM FACTOR is a media query, so `<picture>` decides it and the browser
 *   fetches ONE capture. A 2160×1440 laptop capture shown on a 390px phone
 *   renders the app's own text at about four pixels — a picture of a screen,
 *   not a screenshot — so the phone capture is used below `sm` and the laptop
 *   one from `sm` up. This is the fix for the version that shipped all four:
 *   a phone downloaded the desktop pair (~122 KB) in order to hide it.
 * - THEME is NOT a media query. It is a `.dark` CLASS on `<html>`
 *   (DESIGN.md §9) that the visitor can override in Preferences, so
 *   `prefers-color-scheme` in a `<source>` would show the OS's theme to
 *   someone who chose the other one. Both themes therefore stay in the
 *   document, one hidden by CSS — and a hidden `<img>` is still fetched, so
 *   this pair genuinely costs two files. That is the price of a class-based
 *   theme, and it is why every one of these is a small WebP.
 *
 * Net: two files fetched at any viewport, not four. `srcset` narrows it
 * further on the laptop branch — a display under 1080 CSS pixels takes the
 * 1080w variant rather than the 2160w one.
 *
 * Eager (no `loading="lazy"`), because whichever of these paints IS the
 * largest contentful paint on this page.
 *
 * The frame carries `.surface-brand`, so this figure is the page's ONE hero
 * card (DESIGN.md §2, "one hero per screen") — the role the preview card used
 * to hold. Adding a second brand fill anywhere on this page is a bug.
 */
function HeroShot(): ReactElement {
  const { t } = useTranslation();
  const alt = t('landing.hero.shotAlt');
  return (
    <figure className="mt-10 sm:mt-12">
      {/*
        The frame reads as a frame in BOTH themes now. It used to be
        `border-primary/30` with a plain `shadow-xl`, which on the light
        theme's pale-teal page put a faint teal hairline around a white
        screenshot and vanished. The border is stronger in light (`/40`) than
        in dark (`/30`) because a dark screenshot already separates itself
        from a dark page, and a light one does not; the inset ring adds the
        hairline that stops the screenshot's own white bleeding into the
        card's; and the shadow is tinted with the brand rather than neutral
        black so the lift belongs to the page. See DESIGN.md §5 — this is the
        one sanctioned resting shadow heavier than `shadow-sm`.
      */}
      <div className="surface-brand overflow-hidden rounded-2xl border border-primary/55 bg-card p-1.5 shadow-2xl shadow-primary/20 ring-1 ring-inset ring-black/5 dark:border-primary/40 dark:shadow-primary/10 dark:ring-white/5 sm:p-2">
        <HeroPicture
          themeClassName="hidden dark:block"
          mobileSrc="/landing/diary-mobile-dark.webp"
          desktopSrcSet="/landing/diary-desktop-dark-1080.webp 1080w, /landing/diary-desktop-dark.webp 2160w"
          alt={alt}
        />
        <HeroPicture
          themeClassName="block dark:hidden"
          mobileSrc="/landing/diary-mobile-light.webp"
          desktopSrcSet="/landing/diary-desktop-light-1080.webp 1080w, /landing/diary-desktop-light.webp 2160w"
          alt={alt}
        />
      </div>
      {/* The licence for the numbers above it. The old preview card carried the
          same disclosure as a card subtitle; it belongs to the image now. */}
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">
        {t('landing.hero.shotCaption')}
      </figcaption>
    </figure>
  );
}

/**
 * The bottom-edge fade every cropped phone capture carries.
 *
 * These are 780×1688 captures of a scrolling screen, so each one ends
 * wherever the viewport did — mid-row, through a food name and half a number.
 * A hard edge there reads as a broken image; a fade reads as a list that
 * continues past the frame, which is what it is. 84% keeps the fade clear of
 * everything legible and spends the last sixth of the image on it.
 */
const CROP_FADE = '[mask-image:linear-gradient(to_bottom,black_84%,transparent_100%)]';

/**
 * The ONE frame recipe for every non-hero screenshot on this page.
 *
 * The hero's frame is heavier on purpose (`.surface-brand`, `shadow-2xl`, an
 * inset ring) because it is the page's one hero card. Everything else was
 * `border bg-card shadow-sm` — a neutral hairline that disappeared into the
 * light theme's pale-teal page, so half the product shots on the page had no
 * visible frame at all in the theme most visitors arrive in. One brand-tinted
 * recipe, stated once, used everywhere below the hero.
 */
const SHOT_FRAME = 'rounded-xl border border-primary/25 bg-card p-1 shadow-md shadow-primary/5';

/**
 * ONE theme of the hero capture, with the form-factor choice delegated to the
 * browser.
 *
 * The `<source>` is the whole point: a `media` query on it means only ONE of
 * the two captures inside this element is ever fetched. The theme, which no
 * media query can know (see `HeroShot`'s header), stays a CSS toggle on the
 * `<picture>` itself.
 *
 * `sizes` is the container's real cap — `max-w-5xl` minus the page and frame
 * padding — rather than `100vw`, which would make every laptop take the 2160w
 * file.
 *
 * The `40rem` breakpoint is Tailwind's `sm` written out, because a media query
 * cannot read a Tailwind token: it MUST stay in step with the `sm:` classes on
 * the `<img>` below, which undo the phone-sized cap and the crop fade.
 */
function HeroPicture({
  themeClassName,
  mobileSrc,
  desktopSrcSet,
  alt,
}: {
  themeClassName: string;
  mobileSrc: string;
  desktopSrcSet: string;
  alt: string;
}): ReactElement {
  return (
    <picture className={themeClassName}>
      <source
        media="(min-width: 40rem)"
        srcSet={desktopSrcSet}
        sizes="(min-width: 64rem) 61rem, 100vw"
        width={2160}
        height={1440}
      />
      <img
        src={mobileSrc}
        alt={alt}
        width={780}
        height={1688}
        decoding="async"
        className={cn(
          'mx-auto w-full max-w-[20rem] rounded-xl',
          // The phone capture is 2.16 screens tall and is cropped mid-diary,
          // so its bottom edge cuts a row of food in half. The fade turns that
          // slice into "the list continues" instead of a rendering fault. The
          // laptop capture is a whole screen and needs neither.
          CROP_FADE,
          'sm:max-w-none sm:[mask-image:none]',
        )}
      />
    </picture>
  );
}

/**
 * A screenshot that exists in both themes, rendered as the `dark:`/`dark:hidden`
 * PAIR that a `.dark`-class theme requires.
 *
 * ── Why this is a component and not two `<img>` tags at each call site ───
 *
 * Because a call site can forget one. Every screenshot on this page was
 * captured in dark only at first, so the light theme showed a black phone on
 * a pale-teal page four times over — and nothing failed, because a missing
 * light variant is not an error, it is just the dark one showing through.
 * Making the pair the ONLY way to render a screenshot means the type checker
 * asks for `srcLight` and the omission cannot recur.
 *
 * Both images are in the document and both are downloaded; that is the cost of
 * a class-based theme and it is why every one of these files is a small WebP.
 */
function ThemedShot({
  srcDark,
  srcLight,
  alt,
  width,
  height,
  className,
  loading,
}: {
  srcDark: string;
  srcLight: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  loading?: 'lazy' | 'eager';
}): ReactElement {
  // `alt` is spelled out on each element rather than folded into the spread:
  // the a11y lint rule cannot see an `alt` that arrives through `{...shared}`,
  // and a rule that can't see the attribute is a rule that can't protect it.
  const shared = { width, height, loading, decoding: 'async' } as const;
  return (
    <>
      <img {...shared} alt={alt} src={srcDark} className={cn('hidden dark:block', className)} />
      <img {...shared} alt={alt} src={srcLight} className={cn('block dark:hidden', className)} />
    </>
  );
}

/**
 * One phone screenshot, framed, in both themes. The CALLER sizes it, because a
 * 390×844 capture is 2.16 screens tall at its own aspect ratio — left to fill a
 * one-column mobile layout it would push every word of the step it illustrates
 * off the bottom of the viewport, which is the opposite of what a screenshot is
 * for.
 *
 * Below the fold in every use, so `loading="lazy"`; the intrinsic size is on
 * the element so nothing reflows when it arrives.
 *
 * Carries `SHOT_FRAME` and `CROP_FADE` for every caller, because both are
 * properties of what these files ARE — cropped phone captures below the hero —
 * rather than choices a call site should be making one at a time.
 */
function PhoneShot({
  srcDark,
  srcLight,
  alt,
  className,
}: {
  srcDark: string;
  srcLight: string;
  alt: string;
  className?: string;
}): ReactElement {
  return (
    <ThemedShot
      srcDark={srcDark}
      srcLight={srcLight}
      alt={alt}
      width={780}
      height={1688}
      loading="lazy"
      className={cn(SHOT_FRAME, CROP_FADE, className)}
    />
  );
}

////////////////////////////////////////////////////////////////////////////////
// Section furniture
////////////////////////////////////////////////////////////////////////////////

/**
 * One step of "how it works" — a screenshot, an icon, a title, a paragraph.
 * Deliberately NOT a `Card`: three boxes in a row would read as three separate
 * offers, and this is one sequence.
 */
function HowStep({
  icon: Icon,
  title,
  body,
  shotDark,
  shotLight,
  shotAlt,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  shotDark: string;
  shotLight: string;
  shotAlt: string;
}): ReactElement {
  return (
    <div className="flex flex-col">
      {/*
        The screenshot is BACK on phones, at a readable size and in the right
        place. It first sat beside the copy at `w-24` — 96 CSS pixels for a
        capture of a 390px screen, which renders the app's own 14px text at
        about three pixels; that is a texture, not a screenshot, and the fix
        for it was to drop the picture below `sm` entirely. Which left the one
        section that shows what using openplate LOOKS like showing nothing at
        all to the visitors who will use it on a phone.

        So: full width of the step, under the copy it illustrates, capped at
        `11rem` where the app's own body text lands at a legible size — and
        centred, because on a phone each step is a single centred column with
        nothing to align a left edge to.

        From `sm` the order flips (picture above copy, as a row of three
        parallel steps) and the cap goes to the page's one step-shot width.
        `mx-0` at that breakpoint is the point of the flip: `mx-auto` there
        floated each shot ~38px away from the left edge of its own caption, so
        three pictures and three captions made six different left edges.
      */}
      <div className="order-2 mt-6 sm:order-1 sm:mt-0">
        <PhoneShot
          srcDark={shotDark}
          srcLight={shotLight}
          alt={shotAlt}
          className="mx-auto w-full max-w-[11rem] sm:mx-0 sm:max-w-[15rem]"
        />
      </div>
      <div className="order-1 min-w-0 space-y-2 sm:order-2 sm:mt-4 sm:space-y-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

/**
 * One card of the feature grid.
 *
 * The icon chip is the SAME recipe as every other chip on this page —
 * `bg-primary/10 text-primary` — and that is a reversal. The previous pass
 * made these six neutral (`bg-muted` + `text-foreground/70`) on the argument
 * that six teal chips would turn the page's one accent into wallpaper. In
 * dark mode that argument held; in light mode `--muted` is a pale teal at 93%
 * lightness sitting on a `bg-card` white, so the chips simply vanished and
 * six of the page's icons had no container at all. One recipe, both themes,
 * everywhere: a 10%-alpha brand tint is quiet enough at six repetitions and
 * is the only version that is visible in both.
 *
 * No `foot` slot any more. The source card used to carry a "read the source"
 * link, which put a second GitHub destination three sections above the closing
 * one — the close carries that ask, and one card in a six-card grid growing an
 * extra line also made the grid's rows uneven for no gain.
 */
function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }): ReactElement {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-3 font-display text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/** One bullet in the goals list. */
function GoalPoint({ children }: { children: ReactNode }): ReactElement {
  return (
    <li className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

/** One numbered step of the setup ladder. An ordered list, because the order is the point. */
function SetupStep({ step, title, body }: { step: number; title: string; body: string }): ReactElement {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold tabular-nums text-primary"
      >
        {step}
      </span>
      <div className="space-y-1.5">
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

/**
 * One rung of the ladder below the hero, on a plain `bg-card` surface.
 *
 * `bg-card` is not a style preference: the hero screenshot's frame is this
 * page's ONE `.surface-brand` (DESIGN.md §2, "one hero per screen"), so every
 * section added here stays neutral no matter how much it would like the
 * attention.
 *
 * ── A real `<h2>`, and no eyebrow ────────────────────────────────────────
 *
 * The title used to be `CardTitle`, which is a `<div>`. Three of these cards
 * carry the page's last three arguments — goals, sync, the newsletter — and a
 * screen-reader user moving by heading skipped every one of them, landing on
 * the closing CTA from the feature grid. They are sections of the document,
 * so they are headings, at the same size as the four `<h2>`s above them.
 *
 * The eyebrow went with the div. `SectionEyebrow` marks a SECTION, and these
 * three now live inside one shared section (see the page below); an eyebrow
 * per card meant three "section labels" stacked six inches apart, each one
 * announcing a section that was really a card.
 */
function LadderCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="space-y-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      </CardHeader>
      {/*
        The CARD is full width; its PROSE is not. A `max-w-5xl` container is
        for screenshots and grids — a paragraph running the whole way across
        one is 130-odd characters per line, roughly double the measure at
        which an eye reliably finds the start of the next line. The cap is on
        the content rather than on the card so the card keeps its place in the
        page's rhythm.
      */}
      <CardContent className="max-w-[65ch] space-y-4">{children}</CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Page
////////////////////////////////////////////////////////////////////////////////

/**
 * The page is a CONVERSION LADDER, ordered by what the visitor gets rather
 * than by what we get (M146 spec 02):
 *
 *   1. try it        — the hero. One primary CTA, one destination, `/dashboard`.
 *   2. set it up     — what the first minute actually looks like.
 *   3. keep it       — sync across devices. Only on an instance that has sync.
 *   4. stay in touch — the newsletter. Only on an instance that has one.
 *   5. own it        — read the source, run your own, star it.
 *
 * Rungs 3-5 descend in commitment on purpose: a visitor who bounced off rung 2
 * can still convert on rung 5.
 *
 * THE RULE THIS PAGE IS IMPLEMENTED AGAINST: exactly one CTA destination may
 * be a filled primary button, and `/dashboard` is it. The closing button is
 * the same destination and the same label as the hero's — a restatement for a
 * reader who has finished scrolling, not a competing offer. Sync, the
 * newsletter and GitHub are outline buttons or plain links, always.
 *
 * ── Rhythm (this pass) ───────────────────────────────────────────────────
 *
 * Sections are `py-12 sm:py-16`, and the hero has no minimum height at all.
 * It used to be `min-h-[70vh]` with the copy and a card centred inside it,
 * which on a laptop produced a screen and a half of teal-black nothing before
 * the first word of substance. What fills a hero is the product, not padding.
 */
export default function Index({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  useHomeHintRepair();
  const { syncEnabled, newsletter } = loaderData;

  return (
    <PublicWrapper wide>
      {/* `overflow-x-clip`, not just `overflow-hidden`: the decorative glyph
          below is a fixed 22rem wide and centred, so on a 320–390px viewport it
          hangs ~20px past each edge. Unclipped, that extra width became a real
          horizontal scroll on the smallest phones — the page slid sideways
          against a backdrop nobody can even see. Clipping horizontally only
          leaves vertical overflow alone. `PublicWrapper` carries the same guard
          at the layout level; both are deliberate, because either one alone is
          a single point of failure for a bug with no visible symptom until you
          try to scroll. */}
      <div className="relative isolate overflow-x-clip pb-12 pt-2 sm:pb-16 sm:pt-6">
        {/*
          Hero backdrop, two layers, both decorative and both out of the
          reading order (`pointer-events-none`, `aria-hidden`, `-z-10`).

          The watermark is CENTERED horizontally rather than hung off the
          top-right corner. The corner placement cropped the mark into an
          unreadable arc and, on mobile, drove that arc straight through the
          headline — a circle sliced diagonally at the edge of the viewport
          reads as a rendering bug, not as brand texture.

          Vertically it now starts BELOW the copy instead of being centred on
          it. Line art at 3.5% alpha is texture, but it is texture with edges,
          and two of those edges were crossing the tagline: a faint stroke
          through a sentence is something a reader notices without being able
          to say what it is. Behind the CTA row and the top of the screenshot
          it has nothing to interfere with.

          The two opacities are NOT the same value in both themes, and neither
          is a compromise between them. On the dark page the mark sits on a
          near-black field where 7% is already barely there; on the light page
          the same 7% teal on a pale-teal ground drew a visible grey ring, so
          light gets 3.5%.

          Under it, `brand-glow` (app.css) puts a soft elliptical teal light
          behind the wordmark, so the page has depth instead of being a flat
          field with a screenshot dropped on it. That one IS anchored to the
          top: the hero is copy-then-image, so its optical centre is the
          headline.
        */}
        <div className="brand-glow pointer-events-none absolute inset-x-0 -top-32 -z-10 h-[34rem]" aria-hidden="true" />
        <PlateGlyph className="pointer-events-none absolute left-1/2 top-[16rem] -z-10 h-[22rem] w-[22rem] -translate-x-1/2 text-primary/[0.035] dark:text-primary/[0.07] sm:top-[15rem] sm:h-[30rem] sm:w-[30rem]" />
        {/* The hero's COPY keeps a reading measure even though the page
            container is now `max-w-5xl` (M146 round-1 fix 1): a wide container
            is for the screenshot and the grids, never for a 1024px-long
            sentence. */}
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h1 className="font-display text-5xl font-bold tracking-tight sm:text-6xl">openplate</h1>
          {/* A short brand rule under the wordmark — the smallest possible
              piece of furniture that turns "a heading with paragraphs under
              it" into a composed masthead. */}
          <span aria-hidden="true" className="mt-5 block h-1 w-16 rounded-full bg-primary" />
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground sm:text-xl">
            {t('landing.hero.tagline')}
          </p>
          {/* Two full paragraphs used to stand here — one on installing, one
              on privacy and BYOK — and both were the feature grid's own cards
              said first, almost word for word. A hero that says everything
              leaves the rest of the page repeating it, and a visitor who has
              already read the argument has no reason to keep scrolling to the
              button. The tagline states what the thing IS; the ticks below
              state what it costs; the grid makes the case. */}
          {/* One CTA, one label, one destination (M128 spec 03: there is no
              account to have, so a returning visitor and a brand-new one want
              exactly the same thing from this page — the tracker). The
              secondary is an in-page anchor, not a second destination: a fresh
              visitor either wants to try it or wants to read more, and there is
              no third thing to sell. */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Button asChild size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/20">
              <Link to="/dashboard">{t('landing.cta.tryIt')}</Link>
            </Button>
            <a
              href="#how"
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {t('landing.cta.howItWorks')}
            </a>
          </div>
          {/* The three deleted paragraphs, compressed into the part a visitor
              was actually reading them for. It sits UNDER the CTA rather than
              above it because it is reassurance about pressing the button, not
              an argument for pressing it — and it is the smallest type on the
              page for the same reason.

              No `whitespace-nowrap`: at 320px this wraps to two lines, and a
              wrapped line is better than the horizontal scroll that forcing it
              onto one would produce on the narrowest phones. */}
          <p className="mt-4 text-xs text-muted-foreground">{t('landing.hero.ticks')}</p>
        </div>
        <HeroShot />
      </div>

      <section id="how" className="py-12 sm:py-16">
        <SectionEyebrow>{t('landing.how.eyebrow')}</SectionEyebrow>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.how.title')}</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">{t('landing.how.subtitle')}</p>
        <div className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-6">
          <HowStep
            icon={Camera}
            title={t('landing.how.scan.title')}
            body={t('landing.how.scan.body')}
            shotDark="/landing/scan-mobile-dark.webp"
            shotLight="/landing/scan-mobile-light.webp"
            shotAlt={t('landing.how.scan.shotAlt')}
          />
          <HowStep
            icon={Search}
            title={t('landing.how.search.title')}
            body={t('landing.how.search.body')}
            shotDark="/landing/add-mobile-dark.webp"
            shotLight="/landing/add-mobile-light.webp"
            shotAlt={t('landing.how.search.shotAlt')}
          />
          <HowStep
            icon={Gauge}
            title={t('landing.how.see.title')}
            body={t('landing.how.see.body')}
            shotDark="/landing/diary-mobile-dark.webp"
            shotLight="/landing/diary-mobile-light.webp"
            shotAlt={t('landing.how.see.shotAlt')}
          />
        </div>
      </section>

      {/* Rung 2 — set it up. The one section that answers "what does the first
          minute actually cost me?", which is the question the hero cannot
          answer without becoming a manual. The CTA is an OUTLINE button: same
          destination as the hero, deliberately not a second filled primary.

          NOT a duplicate of `#how` above it, and the two were nearly merged
          for looking like one. They answer different questions: `#how` is
          what EVERY day looks like once you are using it, this is the ONCE
          you do first. Their eyebrows and subtitles now say which is which,
          in both locales — that is the fix, rather than deleting one of
          them. */}
      <section className="py-12 sm:py-16">
        <SectionEyebrow>{t('landing.setup.eyebrow')}</SectionEyebrow>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.setup.title')}</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">{t('landing.setup.subtitle')}</p>
        {/* `sm:items-center`, not `sm:items-start`. The phone shot is roughly
            twice the height of the three-step list, so top-aligning them left
            a ~147px hole under the list — and the CTA, which used to sit
            OUTSIDE this grid, was pushed below that hole and read as belonging
            to the next section rather than to the steps it closes. The button
            now lives in the left column directly under the `<ol>` (where the
            reader's eye already is), and the two columns are centred against
            each other so neither one dangles. */}
        <div className="mt-8 gap-10 sm:grid sm:grid-cols-[1fr_15rem] sm:items-center">
          <div>
            <ol className="space-y-6">
              <SetupStep
                step={1}
                title={t('landing.setup.steps.open.title')}
                body={t('landing.setup.steps.open.body')}
              />
              <SetupStep
                step={2}
                title={t('landing.setup.steps.connect.title')}
                body={t('landing.setup.steps.connect.body')}
              />
              <SetupStep
                step={3}
                title={t('landing.setup.steps.scan.title')}
                body={t('landing.setup.steps.scan.body')}
              />
            </ol>
            <Button asChild variant="outline" size="lg" className="mt-6">
              <Link to="/dashboard">{t('landing.setup.cta')}</Link>
            </Button>
          </div>
          {/* What step 3 ends in, so the list finishes on a picture of the
              result rather than on a promise about it. */}
          <PhoneShot
            srcDark="/landing/overview-mobile-dark.webp"
            srcLight="/landing/overview-mobile-light.webp"
            alt={t('landing.setup.shotAlt')}
            className="mx-auto mt-8 w-full max-w-[15rem] sm:mt-0"
          />
        </div>
      </section>

      {/* The feature grid. It REPLACES the three trust cards that stood at the
          bottom of the page — privacy, BYOK and self-hosting — which said
          three true things and left the other three unsaid, one of them
          ("our server has one table") no longer even accurate after the
          database was removed entirely. Everything here is checkable in the
          repository; nothing here is a roadmap item. */}
      <section className="py-12 sm:py-16">
        <SectionEyebrow>{t('landing.features.eyebrow')}</SectionEyebrow>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {t('landing.features.title')}
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">{t('landing.features.subtitle')}</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <FeatureCard
            icon={HardDrive}
            title={t('landing.features.local.title')}
            body={t('landing.features.local.body')}
          />
          <FeatureCard icon={Key} title={t('landing.features.byok.title')} body={t('landing.features.byok.body')} />
          <FeatureCard
            icon={Smartphone}
            title={t('landing.features.install.title')}
            body={t('landing.features.install.body')}
          />
          <FeatureCard
            icon={Github}
            title={t('landing.features.source.title')}
            body={t('landing.features.source.body')}
          />
          <FeatureCard
            icon={Server}
            title={t('landing.features.selfHost.title')}
            body={t('landing.features.selfHost.body')}
          />
          <FeatureCard
            icon={EyeOff}
            title={t('landing.features.noTracking.title')}
            body={t('landing.features.noTracking.body')}
          />
        </div>
      </section>

      {/*
        ONE chapter, three cards — goals, sync, the newsletter.

        These were three separate `<section>`s, each with its own `py-12
        sm:py-16`, which put a 128px break between three cards that are the
        same kind of thing on the same kind of surface. Three cards separated
        by a screen-third of empty page do not read as three points; they read
        as the page having ended twice and started again. One section, one
        break before it and one after, and `space-y-6` between the cards —
        the gap a card grid uses, because that is what this is.

        All three sit on a plain `bg-card` surface: the hero screenshot's
        frame is this page's one `.surface-brand` (DESIGN.md §2).

        Two of the three are conditional and the section is not. That is
        deliberate — the goals card always renders, so the chapter always has
        at least one card in it, and an instance with neither sync nor a
        newsletter simply has a one-card chapter rather than an empty section.
      */}
      <section className="space-y-6 py-12 sm:py-16">
        <LadderCard icon={Target} title={t('landing.goals.title')}>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('landing.goals.body')}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            <GoalPoint>{t('landing.goals.points.ring')}</GoalPoint>
            <GoalPoint>{t('landing.goals.points.grid')}</GoalPoint>
            <GoalPoint>{t('landing.goals.points.weight')}</GoalPoint>
            <GoalPoint>{t('landing.goals.points.tone')}</GoalPoint>
          </ul>
        </LadderCard>

        {/* Rung 3 — keep it. Renders ONLY where the loader said sync exists; on
            every other instance there is no card, no heading and no mention. */}
        {syncEnabled && (
          <LadderCard icon={RefreshCw} title={t('landing.sync.title')}>
            <p className="text-sm leading-relaxed text-muted-foreground">{t('landing.sync.body')}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{t('landing.sync.photos')}</p>
            <Link to="/settings/sync" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t('landing.sync.link')}
            </Link>
          </LadderCard>
        )}

        {/* Rung 4 — stay in touch. Same rule as sync above, and the stricter one
            from M146/00: an instance that configured no list renders no form, no
            consent copy and no third-party script. */}
        {newsletter !== null && (
          <LadderCard icon={Mail} title={t('landing.newsletter.title')}>
            <p className="text-sm leading-relaxed text-muted-foreground">{t('landing.newsletter.body')}</p>
            <NewsletterSignup turnstileSiteKey={newsletter.turnstileSiteKey} />
          </LadderCard>
        )}
      </section>

      {/* The close. The button repeats the hero — same label, same
          destination — for a reader who has finished scrolling, and stays the
          page's only other filled primary. Rung 5 sits under it as a plain
          muted link: starring the repository is a favour, not a call to
          action, and teal is reserved for the way in (DESIGN.md §1). */}
      <section className="border-t py-12 text-center sm:py-16">
        {/* Eyebrow → h2 → muted line, at the same sizes as every other section
            on the page. This heading used to be one step smaller than the four
            above it and had no eyebrow at all, which made the page's closing
            argument look like a footnote to the newsletter card. */}
        <SectionEyebrow>{t('landing.close.eyebrow')}</SectionEyebrow>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.close.title')}</h2>
        {/* `mx-auto max-w-[65ch]`: a centred line running the full width of a
            `max-w-5xl` container is the same over-long measure the cards had,
            and centring makes it worse — every line starts in a different
            place, so the eye has nothing to return to. */}
        <p className="mx-auto mt-3 max-w-[65ch] text-muted-foreground">{t('landing.close.body')}</p>
        {/* `shadow-md`, where the hero's CTA has `shadow-lg`. Both are the same
            label and the same destination, so the two cannot compete on colour
            or on wording — the only thing left to rank them by is weight, and
            the one above the fold has to win it. */}
        <Button asChild size="lg" className="mt-7 h-12 px-7 text-base shadow-md shadow-primary/20">
          <Link to="/dashboard">{t('landing.cta.tryIt')}</Link>
        </Button>
        <p className="mt-6">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            {t('landing.close.star')}
          </a>
        </p>
      </section>
    </PublicWrapper>
  );
}
