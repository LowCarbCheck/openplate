import { z } from 'zod';
import type { BaseHandle } from '#types/base';
import { useTranslation } from 'react-i18next';
import {
  useMatches,
  Outlet,
  isRouteErrorResponse,
  useRouteError,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from 'react-router';
import { getLocalProfileGoals, listLocalFoodLogs, patchLocalProfileGoals } from '#app/lib/local-store';
import { writeHomeHint } from '#app/lib/home-entry';
import AppWrapper from '#app/components/app-wrapper';
import { AppLoading } from '#app/components/app-loading';
import { OutboxSyncController } from '#app/components/outbox-sync-controller';
import { SyncController } from '#app/components/sync-controller';
import { ErrorFallback } from '#app/components/route-error-boundary';

/**
 * The onboarding gate — the only gate this layout still runs, and it is purely
 * local (M128 spec 03). The account-scoped server → device migration gate that
 * used to sit in front of it is gone with the account system itself: there is
 * no `users` table, no session, and no server-side health data left to migrate,
 * so there is no server loader on this layout at all any more.
 *
 * A visitor who hasn't finished onboarding is sent to `/onboarding` — unless
 * the local store already holds a food log (a device that pre-dates the local
 * `onboardingCompletedAt` stamp), in which case we self-heal by stamping local
 * completion so nobody is ever trapped in the flow.
 *
 * Both passing branches also refresh the home hint (`#app/lib/home-entry`) —
 * the device-local cookie `/` reads to send a returning visitor straight into
 * the app. Writing it HERE, on every app visit, is what keeps it inside
 * WebKit's 7-day cap for anyone who actually uses openplate; the gate that
 * lets you through is by definition the moment "this device is in the app"
 * became true, which is why the two live in one place.
 *
 * @throws a redirect to `/onboarding` when onboarding is pending and there's no
 *   prior local food log to self-heal from.
 */
export async function clientLoader() {
  const profile = await getLocalProfileGoals();
  if (profile !== null && profile.onboardingCompletedAt !== null) {
    writeHomeHint();
    return null;
  }

  const logs = await listLocalFoodLogs();
  if (logs.length > 0) {
    await patchLocalProfileGoals({ onboardingCompletedAt: Date.now() });
    writeHomeHint();
    return null;
  }
  throw redirect('/onboarding');
}
clientLoader.hydrate = true as const;

/**
 * The app's boot screen.
 *
 * This layout has no server loader at all, so the initial hydration render
 * waits on the client one before any child route paints — and because this is
 * the OUTERMOST route in the tracker with a hydrating `clientLoader`, React
 * Router shows THIS fallback rather than any leaf route's, for every one of
 * `/diary`, `/scan`, `/add`, `/trends` and `/settings/*`. The leaf fallbacks
 * below it still exist and still matter (a leaf's own client loader can run
 * again later); this one is the first-paint screen, and only on first paint —
 * a client-side nav never re-renders a `HydrateFallback`.
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <AppLoading label={t('chrome.loading')} />;
}

// Onboarding-gate data only flips via an action (the onboarding form, or this
// loader's own self-heal on first entry into the layout — never a revalidation
// of an already-mounted route). A plain GET nav's parent `.data` fetch fails
// unhandled offline, so skip it; keep default revalidation after a submission.
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs): boolean {
  return formMethod ? defaultShouldRevalidate : false;
}

/** The slice of a leaf route's loader data that carries its own dynamic `backTo`. */
const leafBackToSchema = z.object({ backTo: z.string() });

/**
 * Layout for the food-tracker routes (/diary, /scan, /add, /settings/*): the
 * app chrome plus device-local boot housekeeping. Nothing here is gated — the
 * tracker belongs to whoever holds the device (M128 spec 03).
 */
export default function PersonalLayout() {
  const { t } = useTranslation();
  const matches = useMatches();
  const leafMatch = matches[matches.length - 1];
  // SAFETY: every route under this layout declares a `handle` matching
  // `BaseHandle` (all of its fields are optional), and React Router types
  // `handle` as `unknown` because it cannot see those declarations.
  const handle = leafMatch?.handle as BaseHandle;
  // A leaf route's loader can return its own `backTo` (e.g. the entry detail
  // page routing back to the day its entry belongs to) — that takes
  // precedence over the route's static `handle.backTo`.
  const backTo = leafBackToSchema.safeParse(leafMatch?.loaderData).data?.backTo ?? handle?.backTo;
  // `titleKey` wins where a route has been through string extraction (M129/05);
  // `title` remains the English fallback for the ones that haven't.
  const title = handle?.titleKey ? t(handle.titleKey) : handle?.title;

  return (
    <AppWrapper title={title} backTo={backTo}>
      {/* Flushes queued offline writes on app start / reconnect / focus; renders nothing. */}
      <OutboxSyncController />
      {/* Drives E2EE sync on boot / reconnect / after local writes; renders
          nothing, and attaches nothing at all unless `SYNC_SERVER_URL` is set. */}
      <SyncController />
      <Outlet />
    </AppWrapper>
  );
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const title = isRouteErrorResponse(error) && error.status === 404 ? t('errors.notFoundTitle') : t('errors.title');
  return (
    <AppWrapper title={title}>
      <ErrorFallback error={error} homeTo="/diary" homeLabel={t('errors.backToDiary')} boundary="personal-layout" />
    </AppWrapper>
  );
}
