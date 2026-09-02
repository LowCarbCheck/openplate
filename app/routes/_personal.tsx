import { z } from 'zod';
import type { Route } from './+types/_personal';
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
import { getLocalProfileGoals, hasEverHadData, listLocalFoodLogs, patchLocalProfileGoals } from '#app/lib/local-store';
import { isOnboardingGateExempt, resolveOnboardingGate } from '#app/lib/onboarding-gate';
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
 * The third branch is `/recover` (M123 spec 01). An empty local store is NOT
 * proof of a fresh install: the load/autosave race documented in
 * `local-store/persist.ts` empties the tables partition while the values
 * partition survives, and the `firstDataAt` marker lives in that surviving
 * partition. So before the wizard, this gate asks the marker whether this
 * device has ever held data — and if it has, and the tables are now completely
 * empty, it blocks on the recovery screen instead of presenting a wipe as a
 * first run. The decision itself is pure and lives in `#app/lib/onboarding-gate`.
 *
 * Both passing branches also refresh the home hint (`#app/lib/home-entry`) —
 * the device-local cookie `/` reads to send a returning visitor straight into
 * the app. Writing it HERE, on every app visit, is what keeps it inside
 * WebKit's 7-day cap for anyone who actually uses openplate; the gate that
 * lets you through is by definition the moment "this device is in the app"
 * became true, which is why the two live in one place.
 *
 * Two routes are exempt. `/settings/preferences` is the documented way out of
 * the instance default language, so it has to be reachable before the wizard
 * rather than behind it. `/settings/sync` is where an emailed invite link
 * lands, and the redirect dropped the URL fragment that carried the invite
 * token. Both are listed in `isOnboardingGateExempt`.
 *
 * @throws a redirect to `/recover` when this device has held data before but
 *   its tables are now empty, and to `/onboarding` when onboarding is simply
 *   pending with no prior data to self-heal from.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // The two routes this gate never tests: `/settings/preferences`, the way out
  // of the instance's default language, and `/settings/sync`, where an emailed
  // invite link lands. See `isOnboardingGateExempt`.
  if (isOnboardingGateExempt(new URL(request.url).pathname)) return null;
  const profile = await getLocalProfileGoals();
  const hasProfile = profile !== null;
  const hasCompletedOnboarding = profile?.onboardingCompletedAt != null;
  // Listing the logs parses and sorts every row, and it is the only expensive
  // input here — but it cannot change the outcome once onboarding is stamped,
  // because the resolver's first branch returns before `logCount` is read. So
  // the hot path (every app boot of an onboarded device) skips it entirely.
  const logCount = hasProfile && hasCompletedOnboarding ? 0 : (await listLocalFoodLogs()).length;
  const outcome = resolveOnboardingGate({
    hasProfile,
    hasCompletedOnboarding,
    logCount,
    hasEverHadData: await hasEverHadData(),
  });

  if (outcome.kind === 'recover') throw redirect('/recover');
  if (outcome.kind === 'onboarding') throw redirect('/onboarding');
  if (outcome.kind === 'self-heal') await patchLocalProfileGoals({ onboardingCompletedAt: Date.now() });
  writeHomeHint();
  return null;
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
