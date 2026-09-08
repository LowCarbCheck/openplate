/**
 * "Is there a newer openplate than the one this instance runs?"
 *
 * ── WHY THE SERVER ASKS, AND NOT THE BROWSER ────────────────────────────────
 *
 * The production `connect-src` (`app/config/content-security-policy.ts`) is a
 * closed allowlist, and it is load-bearing: it is what stops an injected script
 * exfiltrating a BYOK key that lives in the page. Adding `api.github.com` to it
 * to satisfy a version banner would widen the one list the security promise
 * rests on, for a cosmetic feature. Asking from here keeps the header
 * byte-for-byte what it was, and means no visitor's browser ever contacts
 * GitHub. See ADR-0012.
 *
 * ── WHAT LEAVES THE BOX ─────────────────────────────────────────────────────
 *
 * One anonymous GET to the public tags endpoint of a public repository, at most
 * once every six hours, carrying nothing about anybody. No token, no instance
 * id, no version number in the query. GitHub sees the instance's IP and the
 * default user agent, and nothing else. `UPDATE_CHECK=off` stops even that.
 *
 * ── WHY IT NEVER THROWS AT A CALLER ─────────────────────────────────────────
 *
 * A version banner is the least important thing this server does. GitHub being
 * slow, rate-limiting the instance's IP, or being down must cost the user
 * nothing, so every failure keeps the previous answer and logs at warn. That is
 * the one place in this repository where "log and continue" is right: there is
 * no invalid state to fail fast on, only an unanswered question.
 *
 * The pure pieces (version parsing, comparison, tag selection) are exported and
 * covered by `tests/unit/update-check.test.ts`; the checker itself takes its
 * `fetch` and its clock as parameters so the same test can drive the cache, the
 * fail-soft path and the throttle without a network.
 */
import { z } from 'zod';

import { createComponentLogger } from '#app/lib/logger';
import { REPO_URL } from '#app/lib/brand';
import { SERVER_BUILD } from '#app/lib/build-info.server';
import type { UpdateStatus } from '#app/lib/update-status';

const logger = createComponentLogger('update-check');

/** How long a GitHub call may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 10_000;

/** How long after boot the first check runs. Late enough to stay out of the startup path. */
export const FIRST_CHECK_DELAY_MS = 90_000;

/** The routine cadence once the first check has run. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The shortest gap between two MANUAL checks, server wide. */
export const MANUAL_CHECK_COOLDOWN_MS = 60_000;

/** How many tags to ask for. Enough to see past a run of prereleases. */
const TAG_PAGE_SIZE = 30;

/**
 * `owner/name`, derived from the one repository literal in `app/`
 * (`brand.ts`). A fork that edits that line points this check at its own tags
 * too, which is the correct behaviour and costs the forker nothing.
 */
export function repoSlug(repoUrl: string): string {
  return new URL(repoUrl).pathname.replace(/^\/+|\/+$/g, '');
}

/** A version broken into the parts semver orders it by. */
export interface VersionParts {
  major: number;
  minor: number;
  patch: number;
  /** The `-tail`, or null for a plain release. */
  prerelease: string | null;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses `1.2.3` or `1.2.3-beta.4` into its parts, or null when it is not a version. */
export function parseVersion(version: string): VersionParts | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (match === null) return null;
  const [, major, minor, patch, tail] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: tail === undefined ? null : tail,
  };
}

/** Whether a version carries a `-prerelease` tail. An unparseable string is not one. */
export function isPrereleaseVersion(version: string): boolean {
  const parsed = parseVersion(version);
  return parsed !== null && parsed.prerelease !== null;
}

/**
 * Compares two prerelease tails by semver clause 11: dot-separated identifiers,
 * numeric ones compare numerically and sort below alphanumeric ones, and a
 * shorter run of otherwise equal identifiers sorts lower.
 */
function comparePrereleaseTails(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const one = left[index];
    const two = right[index];
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    const oneNumeric = /^\d+$/.test(one);
    const twoNumeric = /^\d+$/.test(two);
    if (oneNumeric && twoNumeric) {
      if (Number(one) !== Number(two)) return Number(one) < Number(two) ? -1 : 1;
      continue;
    }
    if (oneNumeric !== twoNumeric) return oneNumeric ? -1 : 1;
    if (one !== two) return one < two ? -1 : 1;
  }
  return 0;
}

/**
 * Orders two versions: negative when `a` is older, positive when it is newer.
 *
 * A prerelease sorts BELOW the release it leads to (`1.0.0-rc.1` < `1.0.0`),
 * which is what makes "the newest tag" mean the right thing on a repository
 * that ships release candidates. An unparseable string sorts below everything,
 * so a stray tag name can never be reported as the latest release.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return comparePrereleaseTails(left.prerelease, right.prerelease);
}

/**
 * The highest `vX.Y.Z` tag worth reporting, as a dotted version with no `v`.
 *
 * Prereleases are invisible unless THIS instance is running one. Someone who
 * deployed `0.19.0-rc.1` has already opted into the release candidate train and
 * wants to hear about `0.19.0-rc.2`; someone on `0.18.3` has not, and telling
 * them a release candidate is "available" would push a whole instance onto an
 * unfinished build. A tag that is not `v` plus a version is ignored outright.
 */
export function selectLatestTag({
  tags,
  currentVersion,
}: {
  tags: readonly string[];
  currentVersion: string;
}): string | null {
  const followPrereleases = isPrereleaseVersion(currentVersion);
  return tags.reduce<string | null>((best, tag) => {
    if (!tag.startsWith('v')) return best;
    const version = tag.slice(1);
    const parsed = parseVersion(version);
    if (parsed === null) return best;
    if (parsed.prerelease !== null && !followPrereleases) return best;
    return best === null || compareSemver(version, best) > 0 ? version : best;
  }, null);
}

/**
 * One page of the tags endpoint, decoded at the boundary.
 *
 * `.loose()` because GitHub sends a commit object, a zipball URL and more on
 * every entry, none of which this file reads; refusing the page over an unread
 * field would turn an API addition into a broken banner.
 */
const tagsPageSchema = z.array(z.object({ name: z.string() }).loose());

/** A `fetch`, narrowed to what this module uses so a test can supply one. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** What the checker remembers between calls. */
export interface UpdateCheckState {
  latest: string | null;
  releaseUrl: string | null;
  checkedAt: string | null;
  updateAvailable: boolean;
}

/** What a manual check answers with: the state, plus whether it actually ran. */
export interface ManualCheckOutcome {
  state: UpdateCheckState;
  throttled: boolean;
  nextCheckAllowedAt: string | null;
}

export interface UpdateChecker {
  /** The cached answer. Never fetches. */
  read(): UpdateCheckState;
  /** Runs the routine (unthrottled) check. Used by the boot and interval timers. */
  refresh(): Promise<UpdateCheckState>;
  /** Runs a manual check unless one ran inside the cooldown. */
  checkNow(): Promise<ManualCheckOutcome>;
}

export interface UpdateCheckerOptions {
  /** False for `UPDATE_CHECK=off`: nothing ever leaves the box. */
  enabled: boolean;
  /** The version this instance runs. */
  currentVersion: string;
  /** `owner/name` of the repository whose tags are read. */
  repo: string;
  /** Where a reader is sent to read about a version. */
  releaseUrlFor: (version: string) => string;
  /** Injected so a test can answer without a network. */
  fetchImpl: FetchLike;
  /** Injected so a test can move the clock. */
  now: () => number;
}

const EMPTY_STATE: UpdateCheckState = {
  latest: null,
  releaseUrl: null,
  checkedAt: null,
  updateAvailable: false,
};

/**
 * Builds a checker over an injected fetch and clock.
 *
 * A factory rather than a module-level singleton so the tests get a fresh one
 * per case; `updateChecker` below is the single production instance.
 */
export function createUpdateChecker(options: UpdateCheckerOptions): UpdateChecker {
  let state: UpdateCheckState = EMPTY_STATE;
  let lastManualAt: number | null = null;
  /**
   * The call already on the wire, if any.
   *
   * Without this, a page with two tabs open and a routine check due at the same
   * moment turns one question into three requests against an endpoint that rate
   * limits by IP. Every caller waits on the same promise instead.
   */
  let inFlight: Promise<UpdateCheckState> | null = null;

  async function fetchTags(): Promise<UpdateCheckState> {
    const url = `https://api.github.com/repos/${options.repo}/tags?per_page=${TAG_PAGE_SIZE}`;
    const response = await options.fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    // Decoded here, at the boundary, so nothing downstream handles an unparsed
    // payload. A page that does not fit the schema reads as "no tags", which
    // leaves the previous answer standing exactly as a network failure does.
    const page = tagsPageSchema.safeParse(await response.json());
    const latest = selectLatestTag({
      tags: page.success ? page.data.map((tag) => tag.name) : [],
      currentVersion: options.currentVersion,
    });
    return {
      latest,
      releaseUrl: latest === null ? null : options.releaseUrlFor(latest),
      checkedAt: new Date(options.now()).toISOString(),
      updateAvailable: latest !== null && compareSemver(latest, options.currentVersion) > 0,
    };
  }

  async function refresh(): Promise<UpdateCheckState> {
    if (!options.enabled) return state;
    if (inFlight !== null) return inFlight;
    inFlight = fetchTags()
      .then((next) => {
        state = next;
        return state;
      })
      .catch((error) => {
        // Fail soft: the previous answer stands. See this module's header.
        logger.warn('Update check failed, keeping the previous result', {
          error: error instanceof Error ? error.message : String(error),
        });
        return state;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  async function checkNow(): Promise<ManualCheckOutcome> {
    if (!options.enabled) return { state, throttled: false, nextCheckAllowedAt: null };
    const at = options.now();
    const elapsed = lastManualAt === null ? Number.POSITIVE_INFINITY : at - lastManualAt;
    if (elapsed < MANUAL_CHECK_COOLDOWN_MS) {
      return {
        state,
        throttled: true,
        nextCheckAllowedAt: new Date((lastManualAt ?? at) + MANUAL_CHECK_COOLDOWN_MS).toISOString(),
      };
    }
    lastManualAt = at;
    const next = await refresh();
    return {
      state: next,
      throttled: false,
      nextCheckAllowedAt: new Date(at + MANUAL_CHECK_COOLDOWN_MS).toISOString(),
    };
  }

  return {
    read: () => state,
    refresh,
    checkNow,
  };
}

/**
 * Assembles the wire object from a cached check and this server's own build.
 *
 * Pure, and shared by both endpoints, so `GET` and `POST` cannot answer with
 * differently shaped bodies.
 */
export function toUpdateStatus({
  enabled,
  state,
  throttled,
  nextCheckAllowedAt,
}: {
  enabled: boolean;
  state: UpdateCheckState;
  throttled: boolean;
  nextCheckAllowedAt: string | null;
}): UpdateStatus {
  return {
    enabled,
    currentVersion: SERVER_BUILD.version,
    sha: SERVER_BUILD.sha,
    builtAt: SERVER_BUILD.builtAt,
    latest: state.latest,
    releaseUrl: state.releaseUrl,
    checkedAt: state.checkedAt,
    updateAvailable: state.updateAvailable,
    throttled,
    nextCheckAllowedAt,
  };
}

/**
 * Starts the boot check and the six-hourly one.
 *
 * Both timers are `unref`ed, so a process that is otherwise finished exits
 * instead of waiting six hours for a version banner. Returns a stop function
 * for symmetry with the graceful shutdown path; nothing calls it today.
 */
export function startUpdateCheckSchedule(checker: UpdateChecker, enabled: boolean): () => void {
  if (!enabled) return () => undefined;
  const first = setTimeout(() => {
    void checker.refresh();
  }, FIRST_CHECK_DELAY_MS);
  first.unref();
  const repeat = setInterval(() => {
    void checker.refresh();
  }, CHECK_INTERVAL_MS);
  repeat.unref();
  return () => {
    clearTimeout(first);
    clearInterval(repeat);
  };
}

/** The release page for a version, derived from the repository's one literal. */
export function releaseUrlFor(version: string): string {
  return `${REPO_URL}/releases/tag/v${version}`;
}
