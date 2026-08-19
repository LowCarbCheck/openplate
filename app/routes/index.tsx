import type { ReactElement, ReactNode } from 'react';
import { useEffect } from 'react';
import type { Route } from './+types/index';
import { data, redirect, useNavigate } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { Camera, Check, Code, Key, Search, ShieldCheck, Target, type LucideIcon } from 'lucide-react';
import PublicWrapper from '#app/components/public-wrapper';
import { PlateGlyph } from '#app/components/plate-glyph';
import { RingProgress } from '#app/components/ring-progress';
import { HeroStat, formatHeroStat } from '#app/components/hero-stat';
import { SectionEyebrow } from '#app/components/typography';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { getCarbStatus, carbStatusBadgeClass } from '#app/utils/carb-status';
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
  const headers = { Vary: 'Cookie' };
  if (target !== null) throw redirect(target, { headers });
  return data(null, { headers });
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
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  if (wantsLandingPage(new URL(request.url).search)) return null;

  const [profile, logs] = await Promise.all([getLocalProfileGoals(), listLocalFoodLogs()]);
  const entered = hasEnteredApp({
    onboardingCompletedAt: profile?.onboardingCompletedAt ?? null,
    foodLogCount: logs.length,
  });

  if (!entered) {
    clearHomeHint(); // stale hint on a wiped device — repair downward
    return null;
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
// The sample day — the only mock on the page
////////////////////////////////////////////////////////////////////////////////

/** The illustrative day the preview card draws. Not real data, never fetched. */
const SAMPLE_DAY = { netCarbs: 38, ceiling: 50 } as const;

/**
 * One illustrative logged-meal row. Reuses the app's actual carb-status
 * coloring (`#app/utils/carb-status`) so it isn't just a mockup that lies about
 * the real product.
 */
function PreviewRow({ name, method, netCarbs }: { name: string; method: string; netCarbs: number }) {
  const { t } = useTranslation();
  const carbStatus = getCarbStatus(netCarbs);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{method}</p>
      </div>
      <span
        className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${carbStatusBadgeClass[carbStatus]}`}
      >
        {t('landing.preview.carbs', { grams: netCarbs })}
      </span>
    </div>
  );
}

/**
 * A static, illustrative "sample day" — a first-time visitor should be able to
 * SEE what the app produces before committing to trying it, in place of a real
 * screenshot (built in markup, not a fabricated image).
 *
 * M129/02: the preview reads as "the product, behind glass" rather than another
 * neutral card next to the pitch copy — the directional brand wash
 * (`surface-brand`, app.css) over an opaque card, a brand-tinted border and a
 * real shadow so it sits ABOVE the hero backdrop instead of dissolving into it.
 *
 * M134: it leads with a REAL `RingProgress` driven by the app's own
 * `formatHeroStat`, rather than describing the goals feature in prose — this is
 * the component the diary actually renders, with sample numbers. The
 * "A sample day — not your real data" subtitle above it is what licenses those
 * numbers, and it is the ONLY fabricated dataset on the page: every other
 * section below is text and an icon.
 */
function AppPreview() {
  const { t, i18n } = useTranslation();
  const stat = formatHeroStat({
    netCarbs: SAMPLE_DAY.netCarbs,
    netCarbsCeiling: SAMPLE_DAY.ceiling,
    kcal: 0,
    kcalTarget: null,
    hasEstimates: false,
    t,
    language: i18n.language,
  });

  return (
    <Card className="surface-brand w-full overflow-hidden border-primary/30 bg-card text-left shadow-xl lg:max-w-md">
      <CardHeader className="border-b border-primary/20 pb-4">
        <CardTitle className="font-display text-lg">{t('landing.preview.title')}</CardTitle>
        <CardDescription>{t('landing.preview.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-center gap-4">
          <RingProgress
            value={SAMPLE_DAY.netCarbs}
            max={SAMPLE_DAY.ceiling}
            size={96}
            strokeWidth={9}
            className="[--ring-box:96px]"
            trackClassName="text-primary/20"
            progressClassName="text-primary"
            label={stat.srLabel}
          >
            <HeroStat stat={stat} value={stat.value} />
          </RingProgress>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('landing.preview.ringCaption')}</p>
        </div>
        <PreviewRow
          name={t('landing.preview.rows.salad.name')}
          method={t('landing.preview.rows.salad.method')}
          netCarbs={4}
        />
        <PreviewRow
          name={t('landing.preview.rows.yogurt.name')}
          method={t('landing.preview.rows.yogurt.method')}
          netCarbs={9}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">{t('landing.preview.caption')}</p>
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Section furniture
////////////////////////////////////////////////////////////////////////////////

/**
 * One step of "how it works" — an icon, a title, a paragraph. Deliberately NOT
 * a `Card`: three boxes in a row would read as three separate offers, and this
 * is one sequence.
 */
function HowStep({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }): ReactElement {
  return (
    <div className="space-y-2">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/** One of the three promises the app is actually built on: privacy, BYOK, source. */
function TrustCard({
  icon: Icon,
  title,
  body,
  foot,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  /** An optional closing line — a caveat, or the link out to the repository. */
  foot?: ReactNode;
}): ReactElement {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="space-y-3 pb-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <CardTitle className="font-display text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        {foot}
      </CardContent>
    </Card>
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

////////////////////////////////////////////////////////////////////////////////
// Page
////////////////////////////////////////////////////////////////////////////////

export default function Index() {
  const { t } = useTranslation();
  useHomeHintRepair();

  return (
    <PublicWrapper>
      <div className="relative isolate flex min-h-[70vh] flex-col items-center justify-center gap-10 overflow-hidden py-10 sm:py-16 lg:grid lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-center lg:gap-16 lg:py-20">
        {/*
          Hero backdrop, two layers, both decorative and both out of the
          reading order (`pointer-events-none`, `aria-hidden`, `-z-10`).

          The watermark is CENTERED on the composition rather than hung off the
          top-right corner. The corner placement cropped the mark into an
          unreadable arc and, on mobile, drove that arc straight through the
          headline — a circle sliced diagonally at the edge of the viewport
          reads as a rendering bug, not as brand texture. Centered, the same
          circle is cropped symmetrically top and bottom, which reads as
          deliberate; and because the glyph is line art rather than a filled
          shape, it survives the low opacity it needs in order to sit behind
          text without touching its contrast.

          Under it, `brand-glow` (app.css) puts a soft elliptical teal light
          behind the wordmark, so the page has depth instead of being a flat
          field with a card dropped on it.
        */}
        <div className="brand-glow pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[46rem]" aria-hidden="true" />
        {/* Anchored to the masthead (30% down) on narrow screens, where the
            hero is a tall single column and a mark centered on the whole
            column would sit squarely on top of the body copy; re-centered on
            the composition from `sm` up, where the hero is short and wide. */}
        <PlateGlyph className="pointer-events-none absolute left-1/2 top-[26%] -z-10 h-[23rem] w-[23rem] -translate-x-1/2 -translate-y-1/2 text-primary/[0.07] sm:top-1/2 sm:h-[36rem] sm:w-[36rem] lg:h-[42rem] lg:w-[42rem]" />
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <h1 className="font-display text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">openplate</h1>
          {/* A short brand rule under the wordmark — the smallest possible
              piece of furniture that turns "a heading with paragraphs under
              it" into a composed masthead. */}
          <span aria-hidden="true" className="mt-5 block h-1 w-16 rounded-full bg-primary" />
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground sm:text-xl">
            {t('landing.hero.tagline')}
          </p>
          <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">{t('landing.hero.privacy')}</p>
          {/* One CTA, one label, one destination (M128 spec 03: there is no
              account to have, so a returning visitor and a brand-new one want
              exactly the same thing from this page — the tracker). The
              secondary is an in-page anchor, not a second destination: a fresh
              visitor either wants to try it or wants to read more, and there is
              no third thing to sell. */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
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
        </div>
        <AppPreview />
      </div>

      <section id="how" className="py-16 sm:py-20">
        <SectionEyebrow>{t('landing.how.eyebrow')}</SectionEyebrow>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.how.title')}</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">{t('landing.how.subtitle')}</p>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <HowStep icon={Camera} title={t('landing.how.scan.title')} body={t('landing.how.scan.body')} />
          <HowStep icon={Search} title={t('landing.how.search.title')} body={t('landing.how.search.body')} />
          <HowStep icon={Target} title={t('landing.how.see.title')} body={t('landing.how.see.body')} />
        </div>
      </section>

      {/* The goals capability, on a plain `bg-card` surface — the preview card
          above is this page's one `.surface-brand` (DESIGN.md §2). */}
      <section className="py-16 sm:py-20">
        <Card className="rounded-2xl">
          <CardHeader>
            <SectionEyebrow>{t('landing.goals.eyebrow')}</SectionEyebrow>
            <CardTitle className="font-display text-2xl">{t('landing.goals.title')}</CardTitle>
            <CardDescription>{t('landing.goals.body')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2">
              <GoalPoint>{t('landing.goals.points.ring')}</GoalPoint>
              <GoalPoint>{t('landing.goals.points.grid')}</GoalPoint>
              <GoalPoint>{t('landing.goals.points.weight')}</GoalPoint>
              <GoalPoint>{t('landing.goals.points.tone')}</GoalPoint>
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="py-16 sm:py-20">
        <div className="grid gap-6 md:grid-cols-3">
          <TrustCard
            icon={ShieldCheck}
            title={t('landing.privacy.title')}
            body={t('landing.privacy.body')}
            foot={<p className="text-sm leading-relaxed text-muted-foreground">{t('landing.privacy.sync')}</p>}
          />
          <TrustCard
            icon={Key}
            title={t('landing.byok.title')}
            body={t('landing.byok.body')}
            foot={<p className="text-sm leading-relaxed text-muted-foreground">{t('landing.byok.optional')}</p>}
          />
          <TrustCard
            icon={Code}
            title={t('landing.selfHost.title')}
            body={t('landing.selfHost.body')}
            foot={
              // A plain external anchor, not the in-app `Link`.
              <a
                href="https://github.com/LowCarbCheck/openplate"
                target="_blank"
                rel="noopener"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('landing.selfHost.link')}
              </a>
            }
          />
        </div>
      </section>

      <section className="border-t py-16 text-center sm:py-20">
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{t('landing.close.title')}</h2>
        <p className="mt-3 text-muted-foreground">{t('landing.close.body')}</p>
        <Button asChild size="lg" className="mt-7 h-12 px-7 text-base shadow-lg shadow-primary/20">
          <Link to="/dashboard">{t('landing.cta.tryIt')}</Link>
        </Button>
      </section>
    </PublicWrapper>
  );
}
