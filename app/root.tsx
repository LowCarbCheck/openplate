import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/victor-mono/index.css';
import { useEffect } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  useLoaderData,
  useRouteLoaderData,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from 'react-router';
import type { Route } from './+types/root';
import { getToast } from '#app/utils/toast.server';
import stylesheet from './app.css?url';
import { combineHeaders } from '#app/utils/misc';
import { Toaster } from '#app/components/ui/toaster';
import { useToast } from '#app/hooks/use-toast';
import { useMatomoTracker } from '#app/hooks/use-matomo-tracker';
import { useResolvedTheme } from '#app/hooks/use-resolved-theme';
import { registerServiceWorker } from '#app/lib/service-worker';
import { startPwaInstallCapture } from '#app/lib/pwa-install-capture';
import { ErrorFallback } from '#app/components/route-error-boundary';
import { useTranslation } from 'react-i18next';
import { I18nProvider } from '#app/i18n/I18nProvider';
import { DEFAULT_LANGUAGE, resolveRequestLanguage, type LanguageCode } from '#app/i18n/language-prefs';
import { CONFIG } from '#app/config';
import type { PublicConfig } from '#app/config/public-config';

export const links: Route.LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
  { rel: 'manifest', href: '/site.webmanifest' },
  // Cache-busted (?v=2): the icon files were replaced in-place and browsers
  // cling to the old cached favicon otherwise.
  { rel: 'icon', href: '/favicon.ico?v=2', sizes: '48x48' },
  { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icons/icon-192.png?v=2' },
  { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png?v=2' },
];

export async function loader({ request }: Route.LoaderArgs) {
  const { pathname, search } = new URL(request.url);
  if (pathname.endsWith('/') && pathname !== '/') {
    // Redirect to the same URL without a trailing slash
    return redirect(`${pathname.slice(0, -1)}${search}`, 301);
  }

  const { toast, headers: toastHeaders } = await getToast(request);

  // The UI locale is a device preference (M129/05) — read straight off the
  // cookie, never the DB, so `<html lang>` is correct in the very first byte
  // of HTML without costing this hot path a round trip. See
  // `app/i18n/language-prefs.ts` for why the cookie is the only server signal.
  //
  // The fallback is the INSTANCE default (`DEFAULT_UI_LANGUAGE`, M167/01), not
  // the constant `DEFAULT_LANGUAGE`. This is the only line in the app where the
  // two differ, and the difference is the whole feature: the constant is what a
  // BAD value falls back to, this is what a visitor who has not chosen yet is
  // served. The cookie still wins over both, so setting the variable picks a
  // starting language, never a locked one.
  //
  // There is deliberately no `user` here any more (M128 spec 03): this app has
  // no accounts, no session cookie, and no `users` table — every visitor is the
  // owner of the device they're on, so there is nothing to resolve.
  const language = resolveRequestLanguage(request.headers.get('cookie'), CONFIG.i18n.defaultLanguage);

  // The app's ONE server → browser config channel (M128 spec 04). A minimal
  // allowlist, deliberately spelled out field by field rather than spread from
  // `CONFIG`, so nothing new reaches the page by accident when `CONFIG` grows.
  // `syncServerUrl` is `null` unless an operator set `SYNC_SERVER_URL`, and
  // `null` means every sync surface in the app renders nothing.
  //
  // `instancePreset` (M138 spec 06) is the same deal one level louder: it is
  // `null` unless an operator set `DEFAULT_INFERENCE_BASE_URL`, and when it is
  // set it carries that endpoint's API key — which every browser that can load
  // this instance then has. Deliberate (a household instance's own inference
  // box), documented at `InstanceInferencePreset` and in `.env.example`, and
  // never to be used for a metered cloud provider key.
  const publicConfig: PublicConfig = {
    syncServerUrl: CONFIG.sync.syncServerUrl,
    instancePreset: CONFIG.inference.instancePreset,
    // The gateway address, and the one fact derived from it (M187 spec 03).
    // `managed` decides the SHAPE of the app rather than the presence of a
    // card: on a managed instance the welcome screen offers one door, the
    // anonymous onboarding path is closed, and the join ceremony runs without
    // a skip. `false` on every instance that set no GATEWAY_URL, which is
    // today's app in full.
    gatewayUrl: CONFIG.gateway.gatewayUrl,
    managed: CONFIG.gateway.managed,
    // `null` unless an operator set MATOMO_URL + MATOMO_SITE_ID. Carries no
    // secret: a Matomo URL and site id are both public by construction (they
    // are in the tracker request every page makes).
    analytics: CONFIG.analytics,
  };

  return {
    toast,
    language,
    publicConfig,
    headers: combineHeaders(toastHeaders),
  };
}

// Root data (the toast flash) only changes via an action (redirectWithToast);
// a plain GET nav's parent `.data` fetch fails unhandled offline, so skip it
// and only revalidate after a submission.
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs): boolean {
  return formMethod ? defaultShouldRevalidate : false;
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Read through `useRouteLoaderData` rather than `useLoaderData`: `Layout`
  // also wraps the root ErrorBoundary, where this loader may never have run —
  // in that case there is no data and the default is the right answer.
  const rootData = useRouteLoaderData<typeof loader>('root');
  const language: LanguageCode = rootData?.language ?? DEFAULT_LANGUAGE;

  return (
    <html lang={language} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* PWA: brand-tint the browser UI and mark the app installable/standalone. */}
        <meta name="theme-color" content="#0d968b" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="openplate" />
        <Meta />
        <Links />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function applyTheme() {
                  var theme = localStorage.getItem('theme');
                  var isDark = theme === 'dark' || (!theme || theme === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches;
                  document.documentElement.classList.toggle('dark', isDark);
                  window.dispatchEvent(new CustomEvent('themechange', { detail: isDark ? 'dark' : 'light' }));
                }
                applyTheme();
                window.__applyTheme = applyTheme;
                window.__getStoredTheme = function() {
                  return localStorage.getItem('theme') || 'system';
                };
              })();
            `,
          }}
        />
      </head>
      {/* Sans (Inter) is the prose/UI voice — this is a consumer health app, not a
          code editor. Victor Mono stays imported and available via `font-mono` for
          the few contexts that are genuinely monospace-shaped (e.g. a sync pairing
          code); numeric columns (macros, dates) get alignment from the `tabular-nums`
          utility, which Inter supports, not from switching the whole face to mono. */}
      <body className="font-sans">
        <I18nProvider language={language}>{children}</I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const data = useLoaderData<typeof loader>();
  useToast(data?.toast);
  const resolvedTheme = useResolvedTheme();

  // Analytics. `null` on every instance whose operator did not configure
  // MATOMO_URL + MATOMO_SITE_ID — the default and the self-host default — and
  // the hook then loads no script and sends nothing. Mounted at the ROOT so a
  // single-page navigation still reports a pageview; see the hook for why the
  // reported URL is scrubbed rather than taken from `location.href`.
  useMatomoTracker(data?.publicConfig.analytics ?? null);

  // Register the service worker once on the client (SSR-safe; the helper guards
  // on `navigator`). Powers offline navigation, the update flow, and the
  // share-target handoff into /scan.
  //
  // Also capture `beforeinstallprompt` here — before any particular route's
  // component has mounted — rather than in a component further down the tree;
  // see `pwa-install-capture.ts`'s doc comment for the bug this fixes (the
  // event used to be missed entirely unless the visitor's first navigation
  // happened to be to the settings hub).
  useEffect(() => {
    registerServiceWorker();
    startPwaInstallCapture();
  }, []);

  // Every in-app link (`#app/components/link`) defaults to react-router's
  // `viewTransition`, which calls `document.startViewTransition()` on nav. When
  // a second navigation lands while a transition is still mid-flight the
  // browser aborts the first one and its `finished` promise rejects with an
  // InvalidStateError ("Transition was aborted because of invalid state") that
  // react-router never awaits. It is console noise only — the navigation itself
  // has already committed, and all that was skipped is the cross-fade — but an
  // unhandled rejection is exactly the kind of thing that trains people to
  // ignore the console. Swallow that one rejection and nothing else.
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      const reason: unknown = event.reason;
      if (
        reason instanceof DOMException &&
        reason.name === 'InvalidStateError' &&
        reason.message.includes('Transition was aborted')
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection);
  }, []);

  return (
    <>
      <Outlet />
      <Toaster
        closeButton
        // Below the header, not over the bottom nav. The old bottom placement
        // put every confirmation on top of the mobile tab bar and the raised
        // Scan button — the app's two most-tapped targets — so the feedback for
        // an action sat on the control you use to take the next one.
        position="top-center"
        theme={resolvedTheme}
        // The band starts just under the 4rem header (`app-wrapper.tsx`'s
        // `min-h-16`, `public-wrapper.tsx`'s fixed `h-16`), which is why one
        // offset works for both the app chrome and the public pages.
        // `safe-area-inset-top` is 0 in every current configuration (the PWA
        // uses the non-translucent status-bar style) and is included so a future
        // `black-translucent` switch can't push the band under the notch.
        offset={{ top: 'calc(env(safe-area-inset-top, 0px) + 4.75rem)' }}
        mobileOffset={{
          top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)',
          left: '0.75rem',
          right: '0.75rem',
        }}
        visibleToasts={2}
        gap={8}
        // The container must never intercept a tap: the header device menu and
        // the nav drawer both open into this band, and they sit at z-50 while
        // sonner renders far above them. Only the toast box itself is
        // interactive (`pointer-events-auto`, in `ui/toaster.tsx`).
        //
        // `toaster group` is repeated here on purpose: the wrapper spreads
        // `{...props}` AFTER its own `className`, so a bare `pointer-events-none`
        // would REPLACE those two classes and silently kill every
        // `group-[.toaster]:` variant in its `classNames` recipe. Same trap as
        // passing `toastOptions` from here — which is why we don't.
        className="toaster group pointer-events-none"
      />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation();
  // Rendered inside the `Layout` document shell above — return only the body
  // content, delegating to the shared fallback so the root screen matches every
  // other boundary. `Layout`'s theme script still applies dark mode here.
  return <ErrorFallback error={error} homeTo="/" homeLabel={t('errors.backToHome')} boundary="root" />;
}
