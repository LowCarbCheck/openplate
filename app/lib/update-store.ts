/**
 * The browser's view of "is this instance current?", held outside React.
 *
 * ── WHY A STORE AND NOT A HOOK'S OWN STATE ──────────────────────────────────
 *
 * Three surfaces ask the same question at once: the ribbon at the top of the app,
 * the build stamp in the sidebar footer, and the Updates section on
 * `/settings/about`. A hook holding its own state would poll three times and,
 * worse, could show three different answers on one screen. One module-level store
 * read through `useSyncExternalStore` gives one poll and one answer, which is the
 * same shape `sync-status.tsx` uses and for the same reason.
 *
 * ── TWO INDEPENDENT QUESTIONS ───────────────────────────────────────────────
 *
 * `status` is what the SERVER learned from GitHub about the project. `bundleStale`
 * is whether THIS page is older than what the server is serving, folded from the
 * `X-Openplate-Build` header on the very same response (see `bundle-freshness.ts`).
 * Only the second one has a button that changes anything.
 *
 * ── WHAT IS PERSISTED ───────────────────────────────────────────────────────
 *
 * Exactly one string: the release version whose ribbon was dismissed. It is a UI
 * preference about the software, not diary data, so `localStorage` is the right
 * place rather than the IndexedDB primary store. A dismissal is per version by
 * design: closing the ribbon for 0.19.0 must not hide 0.20.0.
 */
import { BUILD } from '#app/lib/build-info';
import { FRESH_BUNDLE, observeServerBuild, type BundleFreshness } from '#app/lib/bundle-freshness';
import { BUILD_HEADER, updateStatusSchema, type UpdateStatus } from '#app/lib/update-status';

/** How often a visible tab asks the server again. */
export const POLL_INTERVAL_MS = 30 * 60 * 1000;

/** Where a dismissed release version is remembered. */
export const DISMISSED_STORAGE_KEY = 'openplate:update-dismissed';

const STATUS_ENDPOINT = '/api/update-status';
const CHECK_ENDPOINT = '/api/update-status/check';

/** Everything a component needs to render the update subject. */
export interface UpdateSnapshot {
  /** The server's answer, or null before the first response. */
  status: UpdateStatus | null;
  /** True while a manual check is on the wire, so a button can say so. */
  isChecking: boolean;
  /** True once this page has seen two consecutive newer server commits. */
  bundleStale: boolean;
  /** The release version whose ribbon was dismissed, or null. */
  dismissedVersion: string | null;
}

/** What server-rendered markup sees. Nothing has been fetched at that point. */
const SERVER_SNAPSHOT: UpdateSnapshot = {
  status: null,
  isChecking: false,
  bundleStale: false,
  dismissedVersion: null,
};

let snapshot: UpdateSnapshot = SERVER_SNAPSHOT;
let freshness: BundleFreshness = FRESH_BUNDLE;
let lastPolledAt = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();

function emit(next: UpdateSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Reads the dismissed version. A browser that refuses storage simply never dismisses. */
function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Folds one response into the store: the parsed body, and the freshness signal
 * carried by the same response's header.
 */
function absorb(status: UpdateStatus | null, serverSha: string | null): void {
  freshness = observeServerBuild({ state: freshness, serverSha, bundleSha: BUILD.sha });
  emit({
    status: status ?? snapshot.status,
    isChecking: false,
    bundleStale: freshness.isStale,
    dismissedVersion: snapshot.dismissedVersion,
  });
}

/**
 * Asks the server. Never throws: this is a banner, and a failed poll leaves the
 * previous answer standing exactly as the server side does.
 */
async function poll(endpoint: string, method: 'GET' | 'POST'): Promise<void> {
  lastPolledAt = Date.now();
  try {
    const response = await fetch(endpoint, { method, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      absorb(null, response.headers.get(BUILD_HEADER));
      return;
    }
    const parsed = updateStatusSchema.safeParse(await response.json());
    absorb(parsed.success ? parsed.data : null, response.headers.get(BUILD_HEADER));
  } catch {
    emit({ ...snapshot, isChecking: false });
  }
}

/** Polls if the tab is visible and the last poll is older than the interval. */
function pollIfDue(): void {
  if (document.hidden) return;
  if (Date.now() - lastPolledAt < POLL_INTERVAL_MS) return;
  void poll(STATUS_ENDPOINT, 'GET');
}

function onVisibilityChange(): void {
  pollIfDue();
}

/**
 * Starts polling on the first subscriber and stops on the last.
 *
 * Passed straight to `useSyncExternalStore`, so the lifetime is the lifetime of
 * the components that care. Nothing polls on a page with no update surface.
 */
export function subscribeUpdateStatus(listener: () => void): () => void {
  const isFirst = listeners.size === 0;
  listeners.add(listener);
  if (isFirst) {
    emit({ ...snapshot, dismissedVersion: readDismissed() });
    void poll(STATUS_ENDPOINT, 'GET');
    pollTimer = setInterval(pollIfDue, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export function getUpdateSnapshot(): UpdateSnapshot {
  return snapshot;
}

export function getServerUpdateSnapshot(): UpdateSnapshot {
  return SERVER_SNAPSHOT;
}

/** Asks the server to look at GitHub now. The server may answer `throttled`. */
export async function checkForUpdateNow(): Promise<void> {
  emit({ ...snapshot, isChecking: true });
  await poll(CHECK_ENDPOINT, 'POST');
}

/** Stops the ribbon nagging about one particular release. */
export function dismissRelease(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, version);
  } catch {
    // A browser refusing storage just means the ribbon returns on the next load.
  }
  emit({ ...snapshot, dismissedVersion: version });
}

/** Which of the ribbon's two things to say, or neither. */
export type RibbonState = 'none' | 'newer-bundle' | 'newer-release';

/**
 * Decides the ribbon from the snapshot. Pure, so
 * `tests/unit/update-ribbon-state.test.ts` can cover it without a DOM.
 *
 * A stale bundle WINS over a newer release, because it is the only one of the two
 * with a button that does anything: reloading adopts assets this server already
 * has, while a GitHub release needs an operator to deploy it. Saying both at once
 * in a one-line ribbon would make the actionable half compete with the
 * informational one.
 *
 * The release arm is suppressed once its version has been dismissed. The bundle
 * arm is not dismissible at all: it is about the page in front of the person, it
 * is resolved by the button next to it, and it goes away by itself the moment
 * they take it.
 */
export function ribbonState(current: UpdateSnapshot): RibbonState {
  if (current.bundleStale) return 'newer-bundle';
  const status = current.status;
  if (status === null || !status.updateAvailable || status.latest === null) return 'none';
  return status.latest === current.dismissedVersion ? 'none' : 'newer-release';
}
