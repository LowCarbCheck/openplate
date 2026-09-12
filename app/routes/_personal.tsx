import { z } from 'zod';
import type { Route } from './+types/_personal';
import type { BaseHandle } from '#types/base';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import {
  useLocation,
  useMatches,
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useRevalidator,
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
import { useSyncSession } from '#app/components/sync-status';
import { getSyncSessionSnapshot } from '#app/lib/sync/sync-session';
import { hasSyncBaselineEntities, isDeviceLocked } from '#app/lib/sync/sync-state';
import { resolveSignInDestination } from '#app/lib/sign-in-flow';
import { PublicShell } from '#app/components/public-shell';
import { StrangerNote, strangerNoteVariantForPath } from '#app/components/stranger-note';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { shellForGate } from '#app/lib/personal-shell';
import { useSettleAppNavigation } from '#app/hooks/use-app-navigate';

/**
 * The onboarding gate — the only gate this layout still runs, and it is purely
 * local (M128 spec 03). The account-scoped server → device migration gate that
 * used to sit in front of it is gone with the account system itself: there is
 * no `users` table, no session, and no server-side health data left to migrate,
 * so there is no server loader on this layout at all any more.
 *
 * A visitor who hasn't finished onboarding is sent to `/welcome` — unless
 * the local store already holds a food log (a device that pre-dates the local
 * `onboardingCompletedAt` stamp), in which case we self-heal by stamping local
 * completion so nobody is ever trapped in the flow. `/welcome`, not
 * `/onboarding`: the wizard is one of the two doors that screen offers, and
 * the other one is for the returning user whose profile has not arrived yet
 * (M183 spec 02).
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
 * Four routes are exempt. `/settings/preferences` is the documented way out of
 * the instance default language, so it has to be reachable before the wizard
 * rather than behind it. `/settings/sync` is where an emailed invite link
 * lands, and the redirect dropped the URL fragment that carried the invite
 * token. `/welcome` and `/sign-in` are this gate's own destinations. All four
 * are listed in `isOnboardingGateExempt`.
 *
 * @throws a redirect to `/recover` when this device has held data before but
 *   its tables are now empty, and to `/welcome` when onboarding is simply
 *   pending with no prior data to self-heal from.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // THE ROUTES THIS GATE NEVER REDIRECTS: `/settings/preferences`, the way out
  // of the instance's default language, `/settings/account` and
  // `/settings/sync`, where an emailed link lands, `/settings/about`, which the
  // landing footer links to, and the gate's own destinations. See
  // `isOnboardingGateExempt`.
  //
  // IT USED TO RETURN HERE (M204 spec 09). Returning early made every exempt
  // page wear the app shell, because the layout had no answer to render
  // anything else from. The path fact is now an INPUT instead, and the gate
  // answers `exempt` for a visitor with no diary on one of those pages; the
  // three kinds an exempt path can produce are all handled below without a
  // single redirect, exactly as the early return guaranteed.
  const isExemptPath = isOnboardingGateExempt(new URL(request.url).pathname);
  const profile = await getLocalProfileGoals();
  const hasProfile = profile !== null;
  const hasCompletedOnboarding = profile?.onboardingCompletedAt != null;
  // Listing the logs parses and sorts every row, and it is the only expensive
  // input here — but it cannot change the outcome once onboarding is stamped,
  // because the resolver's first branch returns before `logCount` is read. So
  // the hot path (every app boot of an onboarded device) skips it entirely.
  //
  // AN EXEMPT PATH SKIPS IT TOO (M204 spec 09), and that is the requirement
  // that no diary read runs for a stranger: the listing is the one read here
  // that asks the diary for its contents, and `resolveForExemptPath` cannot
  // reach a different answer from it than from the marker below, which any
  // written log has already set. What is left are two reads that no diary need
  // exist for, a profile row that is `null` on a fresh device and a boolean.
  const logCount = isExemptPath || (hasProfile && hasCompletedOnboarding) ? 0 : (await listLocalFoodLogs()).length;
  // THE SNAPSHOT, READ SYNCHRONOUSLY. On a cold boot it says `isResuming`,
  // because `SyncController` (which settles it) is rendered by this layout and
  // therefore has not mounted yet. That is not a race to paper over: it is the
  // honest state, and the gate answers `wait` for it.
  const session = getSyncSessionSnapshot();
  const outcome = resolveOnboardingGate({
    hasProfile,
    hasCompletedOnboarding,
    logCount,
    hasEverHadData: await hasEverHadData(),
    // FROM `localStorage`, SYNCHRONOUSLY, and that is the point: it is the one
    // input here that an IndexedDB eviction cannot take (M224).
    hasSyncBaseline: session.account !== null && hasSyncBaselineEntities({ accountId: session.account.id }),
    hasSyncAccount: session.account !== null,
    isResumingSession: session.isResuming,
    // THE LOCK (M201 spec 02). Read synchronously from `localStorage`, which is
    // why it is a marker and not the instance policy: this layout has no server
    // loader, so it cannot learn its instance's mode before it has to decide,
    // and it must decide offline too. The marker is written at sign-out, where
    // the policy IS known.
    isDeviceLocked: isDeviceLocked(),
    isExemptPath,
  });

  // NOT A REDIRECT. This layout renders the loading screen and mounts the
  // controller that reopens the session, then revalidates. A redirect here
  // would unmount the only thing that can settle the question.
  if (outcome.kind === 'wait') return { gateKind: 'wait' as const, isExemptPath };
  // A STRANGER ON A PAGE THAT IS OPEN TO THEM. No redirect, and no app shell
  // either: the component below draws the public chrome for this kind. Only an
  // exempt path can produce it, so no gated route can reach this line.
  if (outcome.kind === 'exempt') return { gateKind: 'exempt' as const, isExemptPath };
  if (outcome.kind === 'recover') throw redirect('/recover');
  // SIGNED IN WITH NO DIARY: the questionnaire, not the door. This is what a
  // freshly joined account hits on its first full navigation, and sending it
  // to `/welcome` asked somebody to sign in who just had (M192/06).
  if (outcome.kind === 'onboard') throw redirect(resolveSignInDestination({ gate: 'onboard' }));
  // NOT `/onboarding` any more (M183 spec 02). A device with no local profile
  // is not necessarily a new person: a returning user's profile row rides in
  // the encrypted sync snapshot and lands only after they sign in. `/welcome`
  // is where that question gets asked instead of assumed.
  if (outcome.kind === 'welcome') throw redirect('/welcome');
  if (outcome.kind === 'self-heal') await patchLocalProfileGoals({ onboardingCompletedAt: Date.now() });
  writeHomeHint();
  return { gateKind: 'pass' as const, isExemptPath };
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
 *
 * IT IS ONLY HALF OF THE NO-FLASH STORY, and the first version of M204 spec 09
 * claimed it was all of it. This fallback covers the frames before the client
 * loader RESOLVES, and it draws neither shell, which is correct. What it
 * cannot cover is the answer that loader gives on a cold boot: the session
 * snapshot reports `isResuming` before `SyncController` has mounted, so the
 * first answer for everybody, stranger included, is `wait`. A browser walk
 * measured about 240 ms of sidebar and device chip on `/settings/preferences`
 * because that `wait` was drawn as the app shell. The mapping in
 * `#app/lib/personal-shell` is what covers it, by giving `wait` on an exempt
 * path its own chrome: the same loading screen this fallback shows.
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <AppLoading label={t('chrome.loading')} />;
}

// Onboarding-gate data only flips via an action (the onboarding form, or this
// loader's own self-heal on first entry into the layout — never a revalidation
// of an already-mounted route). A plain GET nav's parent `.data` fetch fails
// unhandled offline, so skip it; keep default revalidation after a submission.
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  // THE GATE RE-ASKING ITSELF. When the loader answered `wait`, the layout
  // revalidates once the session has settled, and a revalidation keeps the
  // same url. That cannot be the plain GET nav the rule below suppresses,
  // which is by definition a nav to a DIFFERENT url — so this branch buys the
  // second look without giving back the offline failure it was added to avoid.
  if (currentUrl.href === nextUrl.href) return true;
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
  const { gateKind, isExemptPath } = useLoaderData<typeof clientLoader>();
  const { strangerSeesThePublicShell } = useInstancePolicy();
  const { pathname } = useLocation();
  // THE HISTORY STACK, MOUNTED ONCE. Records what pathname sits at each history
  // index and settles a pop that landed on the right screen with the wrong
  // query. This is what makes the Back gesture in the installed app mean "up"
  // rather than "replay every step", see `#app/hooks/use-app-navigate` for the
  // rules and the four worked walks. It sits ABOVE every early return below so
  // the note is kept even while the gate is still deciding, and it is here
  // rather than in the root because the public shell keeps "earlier" as the
  // right meaning of Back.
  useSettleAppNavigation();
  useRevalidateWhenTheSessionEnds();
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

  // THE KIND-TO-SHELL MAPPING. The rules and their order live in
  // `#app/lib/personal-shell`, where a test can reach them; this is the only
  // place that turns the answer into elements. `isExemptPath` comes from the
  // LOADER, so the mapping reads the same path fact the gate read rather than
  // a second reading of the URL.
  const shell = shellForGate({ gateKind, isExemptPath, strangerSeesThePublicShell });

  if (shell === 'public') {
    return (
      <PublicShell title={title}>
        {/* `pathname` and not the loader's path fact, because this picks a
            SENTENCE per page rather than deciding the chrome. */}
        <StrangerNote variant={strangerNoteVariantForPath(pathname)} />
        <Outlet />
      </PublicShell>
    );
  }

  // NEITHER SHELL WHILE THE ANSWER IS STILL COMING. The screen is the same one
  // `HydrateFallback` shows, deliberately: a cold boot goes fallback, then
  // this, then the answer, and a person sees one loading screen throughout.
  // The app shell is not allowed around it on an exempt path because the
  // cold-boot `wait` is what every stranger gets first, and drawing the
  // sidebar for it is the 240 ms flash this branch exists to remove.
  //
  // BOTH CHILDREN ARE LOAD-BEARING. `SyncController` is what ends the wait,
  // and unmounting it here would leave the wait for ever; `SessionResumeGate`
  // is what revalidates once the session has settled.
  if (shell === 'loading') {
    return (
      <>
        <SyncController />
        <SessionResumeGate />
      </>
    );
  }

  return (
    <AppWrapper title={title} backTo={backTo}>
      {/* Flushes queued offline writes on app start / reconnect / focus; renders nothing. */}
      <OutboxSyncController />
      {/* Drives E2EE sync on boot / reconnect / after local writes; renders
          nothing, and attaches nothing at all unless `SYNC_SERVER_URL` is set.
          MOUNTED EVEN WHILE WAITING, because it is what ends the wait. */}
      <SyncController />
      {gateKind === 'wait' ?
        <SessionResumeGate />
      : <Outlet />}
    </AppWrapper>
  );
}

/**
 * Asks the gate again the moment a session ENDS under the app's feet.
 *
 * WHY IT IS NEEDED (0.10.3). A session the SERVER ends, a revoked token
 * family, a suspension, used to change nothing on screen: the diary carries
 * on rendering from the local store, because it is device data and does not
 * need a session. On a managed instance that is precisely wrong. `sync-actions`
 * now locks the device on that refusal (`endSessionRefused`), and this is what
 * makes the lock take effect without a reload: `clientLoader` above reads the
 * marker synchronously and its `isDeviceLocked && !hasSyncAccount` branch sends
 * the person to `/welcome`, which is the screen with the door.
 *
 * ON THE TRANSITION ONLY, not on `account === null`. That is also the state of
 * every device that has never signed in, and revalidating for it would re-run
 * the gate on every boot of an open instance for nothing.
 */
function useRevalidateWhenTheSessionEnds(): void {
  const session = useSyncSession();
  const revalidator = useRevalidator();
  const hadAccount = useRef(session.account !== null);

  useEffect(() => {
    const hasAccount = session.account !== null;
    const ended = hadAccount.current && !hasAccount;
    hadAccount.current = hasAccount;
    if (!ended) return;
    if (revalidator.state !== 'idle') return;
    void revalidator.revalidate();
  }, [session.account, revalidator]);
}

/**
 * The screen a returning device sees for the moment its session takes to
 * reopen, and the one thing it does when that moment ends.
 *
 * WHY A SCREEN AND NOT A REDIRECT (M192/06). A cached session survives a
 * reload now, but it is reopened asynchronously, and until it has been the
 * device looks exactly like one that has never signed in. Deciding then sent a
 * person who had joined minutes earlier to `/welcome`, where they were offered
 * a sign-in for the account they were already signed into.
 *
 * It revalidates rather than navigating, so the gate above answers a second
 * time with the settled facts and every branch of it stays in one place. The
 * effect fires once: after the revalidation the loader no longer answers
 * `wait`, so this component unmounts.
 */
function SessionResumeGate() {
  const { t } = useTranslation();
  const session = useSyncSession();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (session.isResuming) return;
    if (revalidator.state !== 'idle') return;
    void revalidator.revalidate();
  }, [session.isResuming, revalidator]);

  return <AppLoading label={t('chrome.loading')} />;
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
