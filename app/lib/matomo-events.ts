/**
 * Custom Matomo events for openplate.
 *
 * ── THE ONE RULE, and why it is stricter here than on the sibling sites ──
 *
 * NO EVENT MAY EVER CARRY DIARY CONTENT.
 *
 * SelfHostedWorld tracks `bookmark-added` with a software slug, and that is
 * fine there: the slug names a row in a public catalogue. openplate has no
 * such thing. A food name, a weight, a goal, a meal time, a photo, a fasting
 * window or a study id is the user's own health data, and the product's whole
 * claim is that it stays on their device. An event carrying one would break
 * that claim far more quietly than a visible network request would — it would
 * look exactly like this file's other lines.
 *
 * So every function below takes either NOTHING or a fixed enum of feature
 * names chosen at the call site. NO NUMERIC VALUES either: M117 design spec
 * D9 (`app/lib/sync/telemetry.ts`) bars values and dimensions on these events
 * and says any addition "re-enters D8's legal review scope; it does not ship
 * as a quiet addition". Architecture review on 2026-08-31 read a literal-union
 * `name` as a finite family of distinct EVENT NAMES — which carries no content
 * and satisfies D9 — while numeric values remain barred. Two earlier drafts
 * (scan item count, fasting hours) were cut on that basis.
 *
 * If you find yourself adding a parameter that a user typed, that a food
 * database returned, or that is a number measured off the person, the answer
 * is no. It goes to M120's legal review, not into this file.
 *
 * ── Why free-form strings are impossible here rather than discouraged ────
 *
 * The exported types are unions of literals, not `string`. A call site cannot
 * pass a food name without a type error, which is the only form of this rule
 * that survives a hurried change six months from now.
 *
 * ── Safe when analytics are off ──────────────────────────────────────────
 *
 * `_paq` is a plain array that Matomo drains when its script loads. On an
 * instance with no `MATOMO_URL` the script never loads, so these pushes
 * accumulate in an array nobody reads and nothing leaves the browser. Call
 * sites therefore never need to ask whether analytics are configured — which
 * is what keeps the feature flag out of forty components.
 */

declare global {
  interface Window {
    _paq: unknown[][];
  }
}

/**
 * Push a custom event to Matomo.
 *
 * Safe to call before the tracker loads (`_paq` buffers), and safe to call on
 * an instance with analytics off (nothing ever drains the buffer). Returns
 * early during SSR, where there is no `window`.
 */
function trackEvent(category: string, action: string, name?: string, value?: number): void {
  // `globalThis.window === undefined` rather than a `typeof` check — the same
  // SSR guard idiom `app/lib/sync/sync-state.ts` uses for `localStorage`.
  if (globalThis.window === undefined) return;
  const _paq = (window._paq = window._paq || []);
  const args: unknown[] = ['trackEvent', category, action];
  if (name !== undefined) args.push(name);
  if (value !== undefined) args.push(value);
  _paq.push(args);
}

// ─── Onboarding ──────────────────────────────────────────────────────────────
// The funnel that decides whether an install becomes a user at all.

export function trackOnboardingCompleted(): void {
  trackEvent('Onboarding', 'completed');
}

// ─── AI provider setup ───────────────────────────────────────────────────────
// openplate is BYOK, so "connected a provider" is the single most load-bearing
// conversion in the product: nothing can be scanned before it happens.

// ─── Plate scan ──────────────────────────────────────────────────────────────
// The flagship feature. Success rate here is the product's health metric.

/**
 * No item count, deliberately.
 *
 * A count of what the model found on a plate is derived from the plate — a
 * health measurement, not feature telemetry — and M117 design spec D9 bars
 * values and dimensions on these events outright, routing any addition back
 * into D8's legal review (which is M120). Ruled out at architecture review
 * 2026-08-31. If the count is ever genuinely needed, it goes through M120, not
 * through this file.
 */
export function trackScanSucceeded(): void {
  trackEvent('Scan', 'succeeded');
}

/**
 * Why a scan failed, as a fixed CATEGORY.
 *
 * Never the provider's error text: those strings routinely quote the request,
 * and a quoted request can contain the endpoint, the model, or a fragment of
 * the user's own prompt. Map to one of these at the call site.
 */
export type ScanFailureReason =
  // Mirrors `VisionFailureCause` (`app/services/vision/failure-cause.ts`)
  // exactly, so the failure path needs no mapping. A mapping between two
  // vocabularies is precisely where a real failure quietly becomes 'unknown'.
  | 'auth'
  | 'reconsent-required'
  | 'credit'
  | 'rate-limit'
  | 'model-not-found'
  | 'invalid-request'
  | 'transient'
  | 'genuinely-no-food'
  // Not provider causes: the photo never reached a provider at all.
  | 'no-provider'
  | 'unreadable-image'
  | 'unknown';

export function trackScanFailed(reason: ScanFailureReason): void {
  trackEvent('Scan', 'failed', reason);
}

/**
 * The model answered but found no food. Its own outcome, deliberately: it is
 * not a crash and it is not a success, and collapsing it into either would
 * hide the single most useful signal about whether plate recognition is good
 * enough — the app already bills tokens for it.
 */
export function trackScanFoundNothing(): void {
  trackEvent('Scan', 'found-nothing');
}

// ─── Diary ───────────────────────────────────────────────────────────────────
// What gets logged is private. HOW it got logged tells us which input path is
// worth improving, and carries nothing about the person.

// ─── Fasting ─────────────────────────────────────────────────────────────────

// ─── Sync ────────────────────────────────────────────────────────────────────
// Never an email, an account id, or a device id — the sync server itself is
// designed not to learn what it stores, and this must not be the leak.

// ─── Backup ──────────────────────────────────────────────────────────────────
// The local-first safety net. If exports are rare, the nudge is not working.

export function trackBackupExported(): void {
  trackEvent('Backup', 'exported');
}

export function trackBackupImported(): void {
  trackEvent('Backup', 'imported');
}

export function trackCsvExported(): void {
  trackEvent('Backup', 'csv-exported');
}

// ─── PWA ─────────────────────────────────────────────────────────────────────

export function trackInstallPromptShown(): void {
  trackEvent('PWA', 'install-prompt-shown');
}

export function trackInstalled(): void {
  trackEvent('PWA', 'installed');
}

export function trackOfflinePageview(): void {
  trackEvent('PWA', 'offline-pageview');
}

// ─── Landing ─────────────────────────────────────────────────────────────────

export function trackNewsletterSubscribed(): void {
  trackEvent('Landing', 'newsletter-subscribed');
}
