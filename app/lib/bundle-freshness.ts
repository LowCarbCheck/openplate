/**
 * "Is the page I am looking at older than the one this server now serves?"
 *
 * A different question from the release check. That one asks GitHub what the
 * PROJECT has published; this one asks the server this tab is already talking to
 * what IT is serving, by comparing the commit in the `X-Openplate-Build` response
 * header against the commit compiled into this bundle. A newer bundle is one
 * reload away, so this is the only one of the two that can offer a button that
 * actually changes something.
 *
 * ── WHY TWO MISMATCHES AND NOT ONE ──────────────────────────────────────────
 *
 * A deploy replaces containers one at a time. During that window two versions
 * answer requests, so a single tab can see the new commit, then the old one, then
 * the new one again. Acting on the first mismatch offers "reload for the newest
 * version" to a person who would reload onto the same build they are already on,
 * and the offer reappears on the next poll. Requiring two consecutive mismatches
 * costs one poll interval of latency and removes the whole class of flapping.
 *
 * A match resets the count outright, so the two have to be consecutive rather
 * than merely two in a session.
 *
 * ── UNKNOWN IS NOT A MISMATCH ───────────────────────────────────────────────
 *
 * Either side can be `unknown`: a build with no git and no override stamps that
 * word, and `pnpm dev` serves it from both ends. An unknown commit is an absence
 * of evidence, so it resets rather than accumulating. Without that rule a dev
 * server would nag about an update on its second poll, every time.
 *
 * Pure and exported for `tests/unit/bundle-freshness.test.ts`; the state lives in
 * `update-store.ts`.
 */

/** The sha a build stamps when it could not learn its own commit. */
export const UNKNOWN_SHA = 'unknown';

/** How many consecutive mismatches make a bundle stale. */
export const STALE_AFTER_MISMATCHES = 2;

/** What the freshness check remembers between polls. */
export interface BundleFreshness {
  /** Consecutive polls that saw a different server commit. */
  mismatches: number;
  /** Whether the page should now offer a reload. */
  isStale: boolean;
}

/** No evidence yet: the starting value, and what a match returns to. */
export const FRESH_BUNDLE: BundleFreshness = { mismatches: 0, isStale: false };

/** Whether a sha carries any information at all. */
function isKnownSha(sha: string | null): sha is string {
  return sha !== null && sha !== '' && sha !== UNKNOWN_SHA;
}

/**
 * Folds one observation of the server's commit into the running count.
 *
 * @param state - the previous result, `FRESH_BUNDLE` on the first poll.
 * @param serverSha - the `X-Openplate-Build` header, or null when it was absent.
 * @param bundleSha - this bundle's own commit (`BUILD.sha`).
 */
export function observeServerBuild({
  state,
  serverSha,
  bundleSha,
}: {
  state: BundleFreshness;
  serverSha: string | null;
  bundleSha: string;
}): BundleFreshness {
  if (!isKnownSha(serverSha) || !isKnownSha(bundleSha)) return FRESH_BUNDLE;
  if (serverSha === bundleSha) return FRESH_BUNDLE;
  const mismatches = state.mismatches + 1;
  return { mismatches, isStale: mismatches >= STALE_AFTER_MISMATCHES };
}
