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
 * ── The two TIERS, and what the second one is for ────────────────────────
 *
 * Every function below declares a tier, `product` or `research`, and fires
 * only when the instance's `MATOMO_EVENT_LEVEL` permits it. The levels are
 * ordered, `pageviews` < `product` < `research`, and the default is `product`.
 *
 * The tiers exist because a content-free event is not automatically a harmless
 * one. Two timestamps can be subtracted into a duration, and two events can be
 * correlated into a health fact. A `Fasting / started` followed by a
 * `Fasting / ended` is a fasting duration whether or not anybody wrote the
 * number down, and a `Sharing / granted` says the person has a clinician. That
 * is exactly the reasoning architecture review used on 2026-08-31 when it cut
 * the drafted scan count and fasting duration.
 *
 * What has changed since is the ANSWER, not the reasoning. These events now
 * ship behind a level an operator must opt into, rather than not shipping at
 * all, because a researcher who runs their own instance genuinely needs them
 * and is the only person who can consent on their own users' behalf. Making
 * them switchable and saying so is better than omitting them and having every
 * researcher patch the file.
 *
 * An instance running at `product`, which is what an operator gets for turning
 * analytics on and configuring nothing else, is UNCHANGED from before this
 * file gained tiers: the same events, the same shapes, nothing extra. An
 * instance at `pageviews` fires no custom event at all.
 *
 * The numeric-value ban and the no-diary-content rule are NOT tiered. They
 * hold at every level, including `research`. The research tier widens WHICH
 * events fire, never what an event may carry.
 *
 * ── Safe when analytics are off ──────────────────────────────────────────
 *
 * `_paq` is a plain array that Matomo drains when its script loads. On an
 * instance with no `MATOMO_URL` the script never loads, so these pushes
 * accumulate in an array nobody reads and nothing leaves the browser. Call
 * sites therefore never need to ask whether analytics are configured — which
 * is what keeps the feature flag out of forty components.
 */
import type { AnalyticsEventLevel } from '#app/config/analytics';

declare global {
  interface Window {
    _paq: unknown[][];
  }
}

/** Which level an event needs. There is no `pageviews` tier: that level fires nothing. */
type EventTier = 'product' | 'research';

/** How much each level permits. A tier fires when its rank is at most the level's. */
const LEVEL_RANK = { pageviews: 0, product: 1, research: 2 } satisfies Record<AnalyticsEventLevel, number>;
const TIER_RANK = { product: 1, research: 2 } satisfies Record<EventTier, number>;

/**
 * The level this instance runs at.
 *
 * `pageviews` until the tracker hook says otherwise, deliberately. The config
 * arrives with the root loader, so there is a window at boot in which nothing
 * has told this module anything, and the safe answer in that window is to fire
 * nothing rather than to guess the default.
 */
let currentLevel: AnalyticsEventLevel = 'pageviews';

/**
 * Sets the level from the instance config.
 *
 * Called by `use-matomo-tracker.ts` and by nothing else. `null` means the
 * instance has no analytics at all, which keeps the level at `pageviews`.
 */
export function setAnalyticsEventLevel(level: AnalyticsEventLevel | null): void {
  currentLevel = level ?? 'pageviews';
}

/** Test seam: puts the level back to its pre-hook default. Never called by app code. */
export function __resetAnalyticsEventLevelForTests(): void {
  currentLevel = 'pageviews';
}

/**
 * Push a custom event to Matomo, if this instance's level permits its tier.
 *
 * Safe to call before the tracker loads (`_paq` buffers), and safe to call on
 * an instance with analytics off (nothing ever drains the buffer). Returns
 * early during SSR, where there is no `window`.
 *
 * There is no `value` parameter. The numeric-value ban is easier to keep when
 * the argument does not exist.
 */
function trackEvent(tier: EventTier, category: string, action: string, name?: string): void {
  // `globalThis.window === undefined` rather than a `typeof` check — the same
  // SSR guard idiom `app/lib/sync/sync-state.ts` uses for `localStorage`.
  if (globalThis.window === undefined) return;
  if (LEVEL_RANK[currentLevel] < TIER_RANK[tier]) return;
  const _paq = (window._paq = window._paq || []);
  const args: unknown[] = ['trackEvent', category, action];
  if (name !== undefined) args.push(name);
  _paq.push(args);
}

// ─── Onboarding ──────────────────────────────────────────────────────────────
// The funnel that decides whether an install becomes a user at all.

export function trackOnboardingCompleted(): void {
  trackEvent('product', 'Onboarding', 'completed');
}

/**
 * WHICH step of onboarding a person finished, as a fixed step name.
 *
 * The step name says what the screen asked for, never what was answered. That
 * a person passed the weight step is a fact about the funnel; the weight is
 * diary content and stays on the device.
 */
export type OnboardingStepName = 'focus' | 'weight' | 'body';

export function trackOnboardingStepCompleted(step: OnboardingStepName): void {
  trackEvent('product', 'Onboarding', 'step-completed', step);
}

export function trackOnboardingStepSkipped(): void {
  trackEvent('product', 'Onboarding', 'step-skipped');
}

// ─── AI provider setup ───────────────────────────────────────────────────────
// openplate is BYOK, so "connected a provider" is the single most load-bearing
// conversion in the product: nothing can be scanned before it happens.

/** HOW a provider was connected. Never WHICH provider, and never the key. */
export type AiConnectMethod = 'manual' | 'oauth' | 'preset';

export function trackAiProviderConnected(method: AiConnectMethod): void {
  trackEvent('product', 'AI', 'connected', method);
}

/**
 * A key check that did not pass, as a fixed outcome.
 *
 * `rejected` is the provider saying no. `unverified` is openplate not getting
 * an answer it could read. Never the provider's error text: those strings quote
 * the request, and a quoted request can contain the key itself.
 */
export type AiKeyCheckOutcome = 'rejected' | 'unverified';

export function trackAiKeyCheckFailed(outcome: AiKeyCheckOutcome): void {
  trackEvent('product', 'AI', 'key-check-failed', outcome);
}

export function trackAiProviderDisconnected(): void {
  trackEvent('product', 'AI', 'disconnected');
}

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
  trackEvent('product', 'Scan', 'succeeded');
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
  | 'photo-too-large'
  | 'ai-not-allowed'
  | 'account-suspended'
  // Not provider causes: the photo never reached a provider at all.
  | 'no-provider'
  | 'unreadable-image'
  | 'unknown';

export function trackScanFailed(reason: ScanFailureReason): void {
  trackEvent('product', 'Scan', 'failed', reason);
}

/**
 * The model answered but found no food. Its own outcome, deliberately: it is
 * not a crash and it is not a success, and collapsing it into either would
 * hide the single most useful signal about whether plate recognition is good
 * enough — the app already bills tokens for it.
 */
export function trackScanFoundNothing(): void {
  trackEvent('product', 'Scan', 'found-nothing');
}

// `Scan / mode-chosen` was here until 2026-09-08. It counted a person
// switching from the plate scanner to the label scanner, and it went when the
// two merged (amends ADR-0005): there is one photo path now, so there is no
// choice left to report and an event nobody can fire is a dead export
// (`no-telemetry-wiring.test.ts` enforces that).

export function trackScanStartedFromShare(): void {
  trackEvent('product', 'Scan', 'started-from-share');
}

// ─── Diary ───────────────────────────────────────────────────────────────────
// What gets logged is private. HOW it got logged tells us which input path is
// worth improving, and carries nothing about the person.

/**
 * The INPUT PATH a log entry arrived by, never the entry.
 *
 * This is the whole point of the Diary category: it says which of the ways
 * into the diary a person used, so the weak ones can be improved. It says
 * nothing about the food, the amount, the meal or the time.
 *
 * `scan-text` is the AI intake reached by writing what was eaten rather than
 * photographing it. It is the same pipeline and the same review screen as
 * `scan-plate` by design, which is exactly why it needs its own name here:
 * this is the only remaining place that can say which way in a person actually
 * took, and whether a way in is worth improving is the one question this event
 * exists to answer. It stays a fixed literal union, and it still carries no
 * content.
 *
 * `scan-speech` is HISTORIC. It named the app's own Web Speech microphone,
 * which M203 removed: every failure of it reached only an `sr-only` region, so
 * on a phone it was a button that visibly did nothing. Dictation is the
 * keyboard's now and arrives as `scan-text`. The member stays because events
 * already recorded under it exist in the analytics data, and a name dropped
 * from the union would make the old rows unreadable rather than historic.
 * Nothing emits it any more.
 *
 * `scan-label` was a member until 2026-09-08 and is not one any more. It named
 * the second scanner, which is gone (amends ADR-0005): one photo path now
 * reads a plate, a single item or a printed panel, so photographing a packet
 * is `scan-plate`. Whether an ITEM's macros were transcribed rather than
 * estimated is a fact about the item, not about the way in, and this event has
 * never carried facts about items. A member nothing can emit is a dead name
 * that would quietly read as zero volume rather than as no such path.
 */
export type LogInputPath =
  | 'add-search'
  | 'add-manual'
  | 'scan-plate'
  | 'scan-text'
  | 'scan-speech'
  | 'diary-chip'
  | 'diary-copy-day'
  | 'entry-log-again'
  | 'saved-meal';

export function trackFoodLogged(path: LogInputPath): void {
  trackEvent('product', 'Diary', 'logged', path);
}

export function trackEntryEdited(): void {
  trackEvent('product', 'Diary', 'entry-edited');
}

export function trackEntryDeleted(): void {
  trackEvent('product', 'Diary', 'entry-deleted');
}

export function trackEntryRestored(): void {
  trackEvent('product', 'Diary', 'entry-restored');
}

export function trackMealSaved(): void {
  trackEvent('product', 'Diary', 'meal-saved');
}

// ─── Foods ───────────────────────────────────────────────────────────────────
// A person's own food library. That they curate it is a product fact; what is
// in it is diary content.

export function trackCustomFoodEdited(): void {
  trackEvent('product', 'Foods', 'edited');
}

export function trackCustomFoodDeleted(): void {
  trackEvent('product', 'Foods', 'deleted');
}

// ─── Preferences ─────────────────────────────────────────────────────────────
// WHICH setting was changed, never the value it was changed to. The chosen
// language would be an identifying attribute; that it was changed is not.

export type PreferenceName = 'theme' | 'language';

export function trackPreferenceChanged(setting: PreferenceName): void {
  trackEvent('product', 'Preferences', 'changed', setting);
}

// ─── Backup ──────────────────────────────────────────────────────────────────
// The local-first safety net. If exports are rare, the nudge is not working.

export function trackBackupExported(): void {
  trackEvent('product', 'Backup', 'exported');
}

export function trackBackupImported(): void {
  trackEvent('product', 'Backup', 'imported');
}

export function trackCsvExported(): void {
  trackEvent('product', 'Backup', 'csv-exported');
}

export function trackPhotoCacheCleared(): void {
  trackEvent('product', 'Backup', 'photo-cache-cleared');
}

// ─── Account ─────────────────────────────────────────────────────────────────
// The sync account, which is the one account in the system. Never an email,
// an account id or a device id: the sync server is designed not to learn what
// it stores, and this must not be the leak.

export function trackAccountCreated(): void {
  trackEvent('product', 'Account', 'created');
}

export function trackAccountDeleted(): void {
  trackEvent('product', 'Account', 'deleted');
}

export function trackPasswordChanged(): void {
  trackEvent('product', 'Account', 'password-changed');
}

export function trackPasswordResetRequested(): void {
  trackEvent('product', 'Account', 'password-reset-requested');
}

export function trackPasswordResetCompleted(): void {
  trackEvent('product', 'Account', 'password-reset-completed');
}

export function trackSetupCeremonyCompleted(): void {
  trackEvent('product', 'Account', 'setup-completed');
}

// ─── Join ────────────────────────────────────────────────────────────────────
// The invite flow. NEVER the invite token or any part of it: the token is a
// credential, and this server never sees it either.

export function trackInviteLinkPasted(): void {
  trackEvent('product', 'Join', 'link-pasted');
}

export function trackJoinCompleted(): void {
  trackEvent('product', 'Join', 'completed');
}

// ─── PWA ─────────────────────────────────────────────────────────────────────

export function trackInstallPromptShown(): void {
  trackEvent('product', 'PWA', 'install-prompt-shown');
}

export function trackInstalled(): void {
  trackEvent('product', 'PWA', 'installed');
}

export function trackOfflinePageview(): void {
  trackEvent('product', 'PWA', 'offline-pageview');
}

// ─── Landing ─────────────────────────────────────────────────────────────────

export function trackNewsletterSubscribed(): void {
  trackEvent('product', 'Landing', 'newsletter-subscribed');
}

/** WHICH of the four calls to action a visitor used. A page position, not a person. */
export type LandingCta = 'hero' | 'setup' | 'mid' | 'footer';

export function trackLandingCtaClicked(cta: LandingCta): void {
  trackEvent('product', 'Landing', 'cta-clicked', cta);
}

// ─── Fasting (RESEARCH tier) ─────────────────────────────────────────────────
//
// What this reveals: that the person fasts, and for how long. The duration is
// never sent, but a `started` and an `ended` are two timestamps in the same
// visit, and one subtracted from the other IS the fasting duration. That is
// the exact reasoning that cut the drafted fasting-hours value on 2026-08-31,
// and it applies to the pair as much as to the number.
//
// Why the tier and not omission: intermittent fasting is what a nutrition
// researcher running their own instance is most likely to be studying, and the
// events are useless to them if the software does not have them. An operator
// who sets `research` is answering for their own users; the default answers
// for everyone else.

/** WHETHER a fast began now or was scheduled. Never the schedule, and never the target. */
export type FastStartMode = 'now' | 'scheduled';

export function trackFastStarted(mode: FastStartMode): void {
  trackEvent('research', 'Fasting', 'started', mode);
}

export function trackFastEnded(): void {
  trackEvent('research', 'Fasting', 'ended');
}

// ─── Goals and body metrics (RESEARCH tier) ──────────────────────────────────
//
// What this reveals: that the person is actively managing their body, and how
// often they weigh themselves. The weight is never sent. A weekly rhythm of
// `weight-logged` is still a behavioural health fact about one visitor, and
// frequency alone distinguishes casual use from a weight-loss attempt.
//
// Why the tier and not omission: adherence is the outcome variable in most
// dietary studies, and a study that cannot see whether people kept measuring
// cannot report anything. The default keeps it off for instances that are not
// running a study.

/** WHICH half of the goals screen was saved. Never a target and never a measurement. */
export type GoalsSection = 'targets' | 'body-metrics';

export function trackGoalsSaved(section: GoalsSection): void {
  trackEvent('research', 'Goals', 'saved', section);
}

export function trackWeightLogged(): void {
  trackEvent('research', 'Goals', 'weight-logged');
}

// ─── Clinician sharing (RESEARCH tier) ───────────────────────────────────────
//
// What this reveals: that the person has a clinician. A share is granted TO
// somebody, and in openplate that somebody is a doctor, a dietitian or a
// therapist. "Is under professional care" is a health fact about the person on
// its own, before anything in the diary is looked at, and `key-rotated` or
// `revoked` traces the shape of that relationship over time.
//
// Why the tier and not omission: whether people can complete the share
// ceremony at all is the only way to tell if clinician sharing works, and it
// is the feature most likely to fail silently. An operator running a clinic's
// own instance already knows their users have clinicians; the default assumes
// the operator does not.

/** WHERE a share was granted from. A screen, never the recipient. */
export type ShareGrantEntry = 'settings' | 'clinician-link';

export function trackShareGranted(entry: ShareGrantEntry): void {
  trackEvent('research', 'Sharing', 'granted', entry);
}

export function trackShareRevoked(): void {
  trackEvent('research', 'Sharing', 'revoked');
}

export function trackShareKeyRotated(): void {
  trackEvent('research', 'Sharing', 'key-rotated');
}

export function trackShareIdentityCreated(): void {
  trackEvent('research', 'Sharing', 'identity-created');
}

export function trackSharedDiaryOpened(): void {
  trackEvent('research', 'Sharing', 'diary-opened');
}

// ─── Study participation (RESEARCH tier) ─────────────────────────────────────
//
// What this reveals: that the person takes part in a health study. Under Art. 9
// GDPR that is special-category data about them, on its own and with no study
// named, because the study is a health study. A `withdrawn` says more still.
//
// Why the tier and not omission: the study console cannot be operated blind,
// and the instance firing these events is by definition the one running the
// study, whose participants have already consented to it in writing. That is
// the narrow case where these events have a lawful home, and the level is what
// keeps them out of every other instance.

export function trackStudyEnrolled(): void {
  trackEvent('research', 'Research', 'enrolled');
}

export function trackStudyWithdrawn(): void {
  trackEvent('research', 'Research', 'withdrawn');
}

export function trackContributionSent(): void {
  trackEvent('research', 'Research', 'contribution-sent');
}
