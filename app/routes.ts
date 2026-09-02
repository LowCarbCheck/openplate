import { type RouteConfig, route, layout, index } from '@react-router/dev/routes';

/**
 * The whole route tree, accountless (M128 spec 03). There is no login,
 * registration, session, or superadmin route left in this app: the tracker is
 * device-local and every visitor gets the full product on first load. Accounts
 * moved out entirely — the standalone `openplate-sync` service owns identity
 * for the optional E2EE-sync feature and is reached directly at its own origin
 * (M128 spec 04), never through this server.
 */
export default [
  // =============================================================================
  // Top-level routes (outside every layout)
  // =============================================================================
  route('/healthcheck', 'routes/healthcheck.ts'),

  // PWA share target server fallback: when the service worker isn't active yet,
  // a shared photo POSTs here and gets bounced into the scan flow. Top-level so
  // it isn't gated by the personal-chrome layout.
  route('/share-target', 'routes/share-target.ts'),

  // OpenRouter OAuth PKCE callback (M127/02) — CLIENT-ONLY (no loader/action;
  // see the route file's header doc). Top-level, outside every layout, so it
  // never depends on a layout loader that doesn't apply to it.
  route('/oauth/openrouter/callback', 'routes/oauth.openrouter.callback.tsx'),

  // Gateway-mode onboarding: where an emailed invite link lands. CLIENT-ONLY
  // for the same reason the OAuth callback is — the invite and member tokens
  // must never reach this server — and top-level so it depends on no layout
  // loader and no onboarding gate: someone arriving from an invite email may
  // never have opened this app before.
  route('/connect-gateway', 'routes/connect-gateway.tsx'),

  // Clinician onboarding: where a clinician's connect link lands (M160/08).
  // CLIENT-ONLY and top-level for the same two reasons as `/connect-gateway`,
  // plus a third that is specific to it — the payload rides in the URL
  // FRAGMENT, which no browser sends to any server, so there is nothing a
  // loader here could read. `openplate-sync` ADR-0002 prohibition 1: the
  // server never stores, serves or endorses a share public key.
  route('/connect-clinician', 'routes/connect-clinician.tsx'),

  // Joining a study: where a study's join link lands (M163/02). Same shape as
  // `/connect-clinician` and for the same reason — the study's contribution
  // key rides in the URL FRAGMENT, so no loader could read it and no server
  // ever sees it. `openplate-sync` ADR-0003: the fingerprint that authenticates
  // that key is typed from the study's printed consent document, never shown.
  route('/join-study', 'routes/join-study.tsx'),

  // The study console (M163/03): the RESEARCHER's side. CLIENT-ONLY and top
  // level for the same reasons `/join-study` is, plus one that is its own —
  // this screen signs into the STUDY's account, not this device's, and the
  // study's private key is unwrapped in the browser. It sits outside
  // `_personal` deliberately: that layout runs the onboarding gate and mounts
  // the diary's `SyncController`, and a researcher opening the console may
  // have no diary here at all. See `.adr/0008-the-study-console-lives-in-openplate.md`.
  route('/study', 'routes/study._index.tsx'),

  // Local-data recovery (M123 spec 01): where `_personal.tsx`'s gate sends a
  // device whose store has been wiped but whose `firstDataAt` marker survives.
  // TOP-LEVEL and client-only — it must sit outside `_personal`, whose gate is
  // what redirects here, and the backup file it reads never leaves the browser.
  route('/recover', 'routes/recover.tsx'),

  // Legacy path redirects (the /log → /diary and /log/plate → /scan rename,
  // and /profile → /settings once the profile card-hub became the settings hub).
  route('/log', 'routes/redirects/legacy-log.tsx'),
  route('/log/plate', 'routes/redirects/legacy-log-plate.tsx'),
  route('/profile', 'routes/redirects/legacy-profile.tsx'),

  // =============================================================================
  // Public chrome (landing, legal, onboarding)
  // =============================================================================
  layout('routes/_public.tsx', { id: '_public' }, [
    index('routes/index.tsx'),
    route('/terms', 'routes/legal/terms.tsx'),
    route('/privacy', 'routes/legal/privacy.tsx'),
    // Section 5 DDG provider identification. Public and unauthenticated on
    // purpose — an imprint behind a login does not discharge the duty.
    route('/imprint', 'routes/legal/imprint.tsx'),

    // Service-worker offline fallback: precached at install, served for failed
    // navigations. Always cacheable, never gated.
    route('/offline', 'routes/offline.tsx'),

    // Full-screen flow, no personal chrome (no sidebar/bottom-nav) — writes
    // entirely to the on-device primary store.
    route('/onboarding', 'routes/onboarding.tsx'),

    // WHAT USED TO BE HERE: `/reset-passphrase` and `/verify-email`, the two
    // landing pages for the sync service's emails (M128 spec 04). M181 deleted
    // the mailer, both endpoints and both routes — an account is a handle plus
    // a passphrase, and a lost passphrase is recovered on `/settings/sync`
    // with the recovery code the user already holds.

    // Catch-all: unmatched URLs get 404 inside the layout
    route('*', 'routes/$.tsx'),
  ]),

  // =============================================================================
  // Personal food tracker — the app itself. No middleware and no session: every
  // visitor is this device's owner (M128 spec 03).
  // =============================================================================
  layout('routes/_personal.tsx', { id: '_personal' }, [
    // The app home (M134): a glance at today plus the shortcuts into the
    // logging loop. `/diary` remains today's DETAIL; `/trends` remains the
    // history. This route composes both from existing models and owns no
    // data of its own.
    route('/dashboard', 'routes/dashboard.tsx'),
    route('/diary', 'routes/diary.tsx'),
    route('/diary/entry/:id', 'routes/diary.entry.$id.tsx'),
    route('/scan', 'routes/scan.tsx'),
    route('/add', 'routes/add.tsx'),
    route('/trends', 'routes/trends.tsx'),
    // "Your foods" (M123/07 item 5): lists/edits/deletes personal custom
    // foods, hosting the same list `/add`'s "Your foods" sheet already used
    // (see `foods.tsx`'s header for why it isn't a re-implementation).
    route('/foods', 'routes/foods.tsx'),
    // Saved meals (M123/07 item 1): a named, reusable bundle of foods, saved
    // from the diary and re-logged from here.
    route('/meals', 'routes/meals.tsx'),
    // The nutrient screen (M135/06). Client-only like every tracker surface:
    // the log and the body metrics are on-device, and the published reference
    // intakes come from the `/api/nutrients` resource route below.
    route('/nutrients', 'routes/nutrients.tsx'),
    // The fasting timer (M132). Client-only like every tracker surface: fasts
    // live in the on-device primary store and their status is derived from
    // timestamps, so there is nothing for a server loader to do.
    route('/fasting', 'routes/fasting.tsx'),
    // The settings hub: compact rows with live status, one per destination
    // below. Replaced the old `/profile` card hub (which now redirects here).
    route('/settings', 'routes/settings._index.tsx'),
    route('/settings/ai', 'routes/settings.ai.tsx'),
    // App preferences (theme + language) — M129/05. Under `_personal` rather
    // than `_public` so it wears the app chrome.
    route('/settings/preferences', 'routes/settings.preferences.tsx'),
    route('/settings/goals', 'routes/settings.goals.tsx'),
    // Export/import + the device-local photo cache — the old profile page's
    // "Your data" and "Photos on this device" cards, given their own page.
    route('/settings/data', 'routes/settings.data.tsx'),
    // Optional E2EE sync (M128 spec 04). 404s unless `SYNC_SERVER_URL` is set.
    route('/settings/sync', 'routes/settings.sync.tsx'),
    // Clinician sharing, the patient's side (M160/05). 404s unless
    // `SYNC_SERVER_URL` is set, for the same reason `/settings/sync` does — a
    // share is a third wrap of the sync DEK, so with no sync there is nothing
    // here to be a page about. When the SERVER has `SYNC_SHARING` off it
    // renders one honest sentence instead: that tree answers the ordinary 404
    // to everybody, and the client reads it as "absent", never as an error.
    route('/settings/sharing', 'routes/settings.sharing.tsx'),
    // Research contributions, the contributor's side (M161/05). Same sync
    // gate as the two rows above, for the same reason — a contribution is
    // pushed to the sync service, so with no sync there is nothing here to be
    // a page about. When the SERVER has no research lane it renders one
    // honest sentence instead (ADR-0003 prohibition 9).
    route('/settings/research', 'routes/settings.research.tsx'),
    // Clinician sharing, the grantee's side (M160/05). NO LOADER on either
    // route: the patient's blob is pulled and decrypted in the browser, and
    // `settings.data.tsx`'s rule — the diary lives on the device — has to hold
    // for somebody else's diary too, or it was never a rule.
    route('/shared', 'routes/shared._index.tsx'),
    route('/shared/:grantorAccountId', 'routes/shared.$grantorAccountId.tsx'),
    // Provenance: version, licence and the source repository (M146 spec 01).
    // Ungated — it is true on every instance, including a self-hoster's.
    route('/settings/about', 'routes/settings.about.tsx'),
    // Resource route: server-proxied LCC food-name lookup for the client-side
    // scan flow (M117/02) — see app/routes/api.food-matches.ts.
    route('/api/food-matches', 'routes/api.food-matches.ts'),
    // Resource route: server-proxied LCC nutrient/reference-intake read for
    // `/nutrients` (M135/06) — see app/routes/api.nutrients.ts.
    route('/api/nutrients', 'routes/api.nutrients.ts'),
  ]),
] satisfies RouteConfig;
