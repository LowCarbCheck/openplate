/**
 * THE AREAS OF THE BROWSER TIER, AND WHICH TOUCHED PATH RUNS WHICH AREA.
 *
 * A push runs the specs whose area the push touched, plus the fixed smoke set; the full tier runs
 * at release time and nightly (`select.ts` is the pure function, `scripts/e2e-select.ts` the CLI).
 * Every spec names exactly one area in its header (`@area <name>`), and `spec-meta.ts` reads it.
 * `tests/unit/e2e-areas.test.ts` keeps this file and the spec headers from drifting apart.
 *
 * The list is short on purpose. An area is a thing a person would name ("the plan pages"), not a
 * folder, so a spec lands where its subject lives even when it reads code from two places.
 */

export const AREAS = [
  'shell',
  'diary-and-add',
  'scan',
  'insights',
  'settings',
  'onboarding',
  'accounts-and-sign-in',
  'sign-out',
  'plans-and-paywall',
  'admin',
  'health-consent',
  'content-and-legal',
  'brand-and-lineage',
  'offline-and-updates',
] as const;

export type Area = (typeof AREAS)[number];

export type PathRule = { pattern: RegExp; area: Area | 'all' | 'none' };

/**
 * Matched in order against a path relative to `apps/app`, the first match wins, so the order is
 * part of the meaning: the narrow rule goes above the wide one it would otherwise lose to.
 *
 * WHY UNMAPPED CODE MEANS `all`. A path no rule names is a path nobody has decided about, and the
 * cheap mistake is the expensive one: skipping a spec that would have failed lets a regression
 * reach main, while running too many specs costs minutes. So the gap defaults to the full tier,
 * and a new file under `app/` pays for it until somebody writes the rule that says what it
 * touches. The same goes for anything outside `app/` and `tests/` (the selector applies it when
 * this list has no match). Only `none` may skip, and only for a path no browser can reach.
 */
export const PATH_RULES: ReadonlyArray<PathRule> = [
  // A spec file is handled by the selector itself (that spec runs). Everything else in this folder
  // is the harness: a helper, a stub, the config or the font setup, and every spec runs on it.
  { pattern: /^tests\/e2e\//, area: 'all' },

  // The unit and integration tiers never boot the production build the browser tier drives.
  { pattern: /^tests\/(unit|integration)\//, area: 'none' },
  // The fixtures are mounted or read by the webServer and by specs; which ones is not tracked here.
  { pattern: /^tests\/fixtures\//, area: 'all' },

  // Build, toolchain and server: they change what every page is made of or served by.
  {
    pattern:
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|playwright\.config\.ts|vite\.config\.ts|react-router\.config\.ts|server\.ts|tsconfig[^/]*\.json|Dockerfile[^/]*)$/,
    area: 'all',
  },
  { pattern: /^(scripts|\.githooks|server|public)\//, area: 'all' },
  // The shared frame of the app: the root, the route table, the entries, the stylesheet, the
  // primitives and the translations are read by every screen.
  { pattern: /^app\/(root\.tsx|routes\.ts|entry\.[^/]+|app\.css)$/, area: 'all' },
  { pattern: /^app\/(components\/ui|i18n|lib\/sync|services)\//, area: 'all' },

  // Prose a browser never loads. Below the `all` rules so `app/i18n/memory/README.md` stays `all`.
  { pattern: /^(docs|\.adr|\.claude)\//, area: 'none' },
  { pattern: /\.md$/, area: 'none' },
  { pattern: /^LICENSE$/, area: 'none' },

  // Routes. Layouts and the catch-all wrap every page, so they are `all`; so is the account page,
  // which three areas have a spec on (settings, health consent, plans).
  { pattern: /^app\/routes\/(_personal|_public|\$|index|healthcheck)\.tsx?$/, area: 'all' },
  { pattern: /^app\/routes\/settings\.account\.tsx$/, area: 'all' },
  { pattern: /^app\/routes\/settings\.plan\.tsx$/, area: 'plans-and-paywall' },
  { pattern: /^app\/routes\/settings\.whats-new\.tsx$/, area: 'offline-and-updates' },
  { pattern: /^app\/routes\/settings\./, area: 'settings' },
  { pattern: /^app\/routes\/oauth\.openrouter\.callback\.tsx$/, area: 'settings' },
  { pattern: /^app\/routes\/admin[^/]*\.tsx$/, area: 'admin' },
  { pattern: /^app\/routes\/(trends|insights)/, area: 'insights' },
  { pattern: /^app\/routes\/(add\.photo|api\.food-|pantry)/, area: 'scan' },
  {
    pattern: /^app\/routes\/(add|diary|dashboard|meals|foods|catch-up|awards|fasting)[.\w$]*\.tsx$/,
    area: 'diary-and-add',
  },
  { pattern: /^app\/routes\/onboarding\.tsx$/, area: 'onboarding' },
  { pattern: /^app\/routes\/consent\.tsx$/, area: 'health-consent' },
  { pattern: /^app\/routes\/legal\//, area: 'content-and-legal' },
  { pattern: /^app\/routes\/offline\.tsx$/, area: 'offline-and-updates' },
  {
    pattern: /^app\/routes\/(account-door-page|forgot|recover|reset|join|sign-in|sign-up|welcome|landing-open)\.tsx$/,
    area: 'accounts-and-sign-in',
  },

  // Components, by folder first and by file-name prefix for the flat ones.
  { pattern: /^app\/components\/sign-out/, area: 'sign-out' },
  {
    pattern: /^app\/components\/(add\/(no-ai-intake-notice|use-ai-connection|use-provider-capabilities)|intake\/)/,
    area: 'scan',
  },
  { pattern: /^app\/components\/(add|dashboard|fasting|gamification|weight)\//, area: 'diary-and-add' },
  { pattern: /^app\/components\/trends\//, area: 'insights' },
  { pattern: /^app\/components\/settings\//, area: 'settings' },
  { pattern: /^app\/components\/onboarding\//, area: 'onboarding' },
  { pattern: /^app\/components\/plans\//, area: 'plans-and-paywall' },
  { pattern: /^app\/components\/admin\//, area: 'admin' },
  { pattern: /^app\/components\/health-consent/, area: 'health-consent' },
  {
    pattern:
      /^app\/components\/(account-door|accounts-need-https|needs-https-notice|create-account-panel|credential-submit-button|password-fields|sign-in-panel|invite-only-dialog|paste-invite-link)\b/,
    area: 'accounts-and-sign-in',
  },
  { pattern: /^app\/components\/(offline-banner|update-ribbon|whats-new-card)\b/, area: 'offline-and-updates' },
  { pattern: /^app\/components\/(wordmark)\b/, area: 'brand-and-lineage' },
  { pattern: /^app\/components\/(content-article)\b/, area: 'content-and-legal' },
  { pattern: /^app\/components\/(allergen-fields|eating-style-picker)\b/, area: 'onboarding' },
  { pattern: /^app\/components\/(sync-setup-flow|backup-nudge|oauth-connect|photo-cache-card)/, area: 'settings' },
  {
    pattern:
      /^app\/components\/(app-sidebar|app-wrapper|app-loading|avatar-|bottom-nav|build-stamp|header-status|more-sheet|public-shell|public-wrapper|status-fallback-host|sticky-subheader)/,
    area: 'shell',
  },
  {
    pattern:
      /^app\/components\/(add-launcher|catch-up-writer|day-|fast-|habit-strip|hero-stat|logging-to-banner|macro-|meal-select-field|pulse-|repeat-yesterday-door|ring-progress|usual-at-slot)/,
    area: 'diary-and-add',
  },
  { pattern: /^app\/components\/(food-caution-chip|report-estimate)\b/, area: 'scan' },

  // Hooks and lib, by name prefix. Both are shared by many screens, so only a name that says what
  // it serves is mapped; the rest (`utils`, `store`, `env`, `macros`) fall through to `all`.
  { pattern: /^app\/lib\/(sign-out)/, area: 'sign-out' },
  { pattern: /^app\/lib\/(admin\/|feedback\/)/, area: 'admin' },
  { pattern: /^app\/lib\/health-consent\//, area: 'health-consent' },
  { pattern: /^app\/lib\/content\//, area: 'content-and-legal' },
  { pattern: /^app\/lib\/(moved\/|update-|bundle-freshness|whats-new|service-worker)/, area: 'offline-and-updates' },
  { pattern: /^app\/lib\/(trend-|adherence-|insights-|range-summary|rolling-average|slot-stats)/, area: 'insights' },
  { pattern: /^app\/lib\/(scan-|intake-|photo-|plate-photo|pantry-|recipe-)/, area: 'scan' },
  { pattern: /^app\/lib\/(onboarding|eating-style)/, area: 'onboarding' },
  { pattern: /^app\/lib\/(join-|sign-in-flow|turnstile)/, area: 'accounts-and-sign-in' },
  {
    pattern: /^app\/lib\/(gamification\/|repeated-meal|save-meal-hint|usual-at-slot|add-|catch-up-|query-parts)/,
    area: 'diary-and-add',
  },
  { pattern: /^app\/hooks\/use-leave-when-another-tab-signs-out/, area: 'sign-out' },
  { pattern: /^app\/hooks\/use-(update-status|install-affordance)/, area: 'offline-and-updates' },
  { pattern: /^app\/hooks\/use-(plan|trial|offer|payment|intended-plan|public-plan)/, area: 'plans-and-paywall' },
  { pattern: /^app\/hooks\/use-(ai-connection|plate-photo|provider)/, area: 'scan' },
  {
    pattern: /^app\/hooks\/use-(copy-yesterday|current-fast|day-swipe|pulse|celebration|count-up)/,
    area: 'diary-and-add',
  },
  { pattern: /^app\/models\/adherence-grid/, area: 'insights' },
  { pattern: /^app\/models\/(ai-provider-recommendation|ai-usage)/, area: 'scan' },
  {
    pattern: /^app\/models\/(fasting|catch-up|daily-totals|dashboard|day-ridge|food-log-summary|habit-strip)/,
    area: 'diary-and-add',
  },
];
