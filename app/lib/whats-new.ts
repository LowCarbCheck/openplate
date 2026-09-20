/**
 * What changed in this build, and whether to say so once.
 *
 * The release notes SHIP IN THE BUNDLE: `app/i18n/locales/<lang>/releases.json`
 * is an ordinary i18next namespace, so the reader gets them in their own
 * language and nothing is ever fetched. This module is the pure half: it turns
 * that catalog into an ordered list, and it answers the one question the card
 * and the page both ask, "has this device been told about this build yet".
 *
 * ── WHY `localStorage` AND NOT THE PRIMARY STORE ─────────────────────────
 *
 * The acknowledgement is a UI preference about a nudge, not health data, the
 * same call `#app/lib/insights-hint` and `#app/lib/save-meal-hint` make. In the
 * synced store it would ride in every backup and onto every other device, so
 * reading the notes on a phone would silently hide them on a laptop, where the
 * update has not been seen at all.
 *
 * ── WHY THE STORED VALUE IS A VERSION AND NOT A FLAG ─────────────────────
 *
 * A flag can only say "seen something". A version says WHICH build was
 * acknowledged, which is what lets the next update show only the releases
 * between the two, and what lets a rollback stay quiet instead of re-announcing
 * a release the device already read.
 *
 * ── WHY THE COMPARE IS LOCAL ─────────────────────────────────────────────
 *
 * `compareSemver` already exists, in `#app/lib/update-check.server`, and it has
 * to stay there: importing a `.server` module from a client component builds in
 * dev and fails only in the production client build. The triple below is
 * deliberately narrower than semver too, see {@link parseVersionTriple}.
 *
 * ── WHY THE CATALOG ARRIVES AS AN ARGUMENT ───────────────────────────────
 *
 * This module imports no JSON. Its two callers each hand
 * {@link entriesFromCatalog} the English `releases.json`, which is one pure
 * derivation performed twice rather than a shared constant, and that is the
 * price of keeping this file loadable by a plain ESM loader: Playwright's
 * runner has no JSON-module loader, and `tests/e2e/whats-new.spec.ts` has to
 * import {@link WHATS_NEW_STORAGE_KEY} from here rather than transcribe it.
 */
import { z } from 'zod';

/** Where the acknowledgement lives. Versioned, so a future retune can start clean. */
export const WHATS_NEW_STORAGE_KEY = 'openplate:whats-new-seen:v1';

/** Minimal storage surface, `localStorage` satisfies it, and so does a plain fake in a test. */
export interface WhatsNewStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * The version this device last acknowledged, or null.
 *
 * Anything unreadable degrades to null rather than throwing, because a broken
 * preference must never take the diary down with it.
 *
 * @param storage - the storage to read from.
 * @returns the stored version string, or null when there is none.
 */
export function readWhatsNewSeen(storage: WhatsNewStorage): string | null {
  try {
    return storage.getItem(WHATS_NEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Records a version as acknowledged on this device. Write failures (private
 * mode, full quota) are swallowed for the same reason as above.
 *
 * @param storage - the storage to write to.
 * @param version - the version to record, normally this bundle's own.
 */
export function writeWhatsNewSeen(storage: WhatsNewStorage, version: string): void {
  try {
    storage.setItem(WHATS_NEW_STORAGE_KEY, version);
  } catch {
    // Ignored by design, see this function's doc.
  }
}

////////////////////////////////////////////////////////////////////////////////
// Versions
////////////////////////////////////////////////////////////////////////////////

/**
 * A plain `x.y.z` and nothing else.
 *
 * NARROWER THAN SEMVER ON PURPOSE. `0.0.0-unstamped` is what `#app/lib/build-info`
 * reports when Vite's `define` never ran, and a prerelease is a build whose
 * release notes have not been written yet. Both must read as "no version I can
 * reason about" rather than sorting somewhere plausible.
 */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** Major, minor and patch, in the order a comparison reads them. */
export type VersionTriple = readonly [number, number, number];

/**
 * Parses `1.2.3` into its three numbers, or null for anything else.
 *
 * @param version - the candidate version string.
 * @returns the triple, or null when it is not a plain `x.y.z`.
 */
export function parseVersionTriple(version: string): VersionTriple | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether a value is a plain `x.y.z` version this module can order. */
export function isKnownVersion(version: string | null): boolean {
  return version !== null && parseVersionTriple(version) !== null;
}

/**
 * Orders two versions: negative when `a` is older, 0 when they are equal,
 * positive when `a` is newer. An unparseable string sorts below everything, so
 * a junk value in storage can never be read as the newest build.
 *
 * POSITIONAL, not an options object, because this is a comparator: it is handed
 * to `toSorted` below, and swapping its two arguments only flips the sign,
 * which is what the name already says it does.
 *
 * @param a - the left version.
 * @param b - the right version.
 * @returns the ordering of `a` against `b`.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersionTriple(a);
  const right = parseVersionTriple(b);
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  for (const [index, part] of left.entries()) {
    const other = right[index] ?? 0;
    if (part !== other) return part < other ? -1 : 1;
  }
  return 0;
}

////////////////////////////////////////////////////////////////////////////////
// The catalog
////////////////////////////////////////////////////////////////////////////////

/** One group of leads, keyed `01`..`NN` in reading order. */
const leadsSchema = z.record(z.string(), z.string());

/**
 * One release. The three groups exist only where they have content, so a
 * release that only fixed things carries `fixed` alone.
 */
const releaseSchema = z.object({
  date: z.string(),
  added: leadsSchema.optional(),
  changed: leadsSchema.optional(),
  fixed: leadsSchema.optional(),
});

/** The whole `releases` namespace, keyed by `v` plus the version with underscores. */
const releasesCatalogSchema = z.record(z.string(), releaseSchema);

/** The shape `entriesFromCatalog` reads. The shipped JSON satisfies it structurally. */
export type ReleasesCatalog = z.infer<typeof releasesCatalogSchema>;

/** The three groups, in the order a release note is read. */
export const RELEASE_GROUPS = ['added', 'changed', 'fixed'] as const;

/** One of the three groups a lead can sit in. */
export type ReleaseGroup = (typeof RELEASE_GROUPS)[number];

/** One non-empty group of one release, as full i18n key paths. */
export interface ReleaseGroupEntry {
  group: ReleaseGroup;
  /** `v0_35_0.added.01` and so on, in reading order. */
  keys: string[];
}

/** One release, ready to render. */
export interface ReleaseEntry {
  /** The dotted version, `0.35.0`. */
  version: string;
  /** The catalog key this came from, `v0_35_0`. */
  versionKey: string;
  /** The release date, `YYYY-MM-DD`. */
  date: string;
  /** The non-empty groups, in `added`, `changed`, `fixed` order. */
  groups: ReleaseGroupEntry[];
}

/** `v0_35_0` back to `0.35.0`, or null when the key is not one of ours. */
function versionFromKey(versionKey: string): string | null {
  if (!versionKey.startsWith('v')) return null;
  const version = versionKey.slice(1).replaceAll('_', '.');
  return parseVersionTriple(version) === null ? null : version;
}

/** The lead keys of one group, ordered by their number rather than by string. */
function orderedLeadKeys(versionKey: string, group: ReleaseGroup, leads: Readonly<Record<string, string>>): string[] {
  return Object.keys(leads)
    .toSorted((a, b) => Number(a) - Number(b))
    .map((lead) => `${versionKey}.${group}.${lead}`);
}

/**
 * The shipped releases, newest first, with every lead as a full i18n key path.
 *
 * A KEY THAT IS NOT A VERSION IS IGNORED, never thrown on, the same call
 * `selectLatestTag` makes about a stray git tag: this runs while the diary is
 * rendering, and a typo in a catalog nobody can edit at run time must not be
 * able to blank the screen. `tests/e2e/whats-new.spec.ts` reads the real
 * catalog, so a typo still fails a push.
 *
 * @param catalog - the English `releases` namespace, as shipped.
 * @returns one entry per release, newest first.
 */
export function entriesFromCatalog(catalog: ReleasesCatalog): ReleaseEntry[] {
  const entries: ReleaseEntry[] = [];
  for (const [versionKey, release] of Object.entries(catalog)) {
    const version = versionFromKey(versionKey);
    if (version === null) continue;
    const groups: ReleaseGroupEntry[] = [];
    for (const group of RELEASE_GROUPS) {
      const leads = release[group];
      if (leads === undefined) continue;
      const keys = orderedLeadKeys(versionKey, group, leads);
      if (keys.length > 0) groups.push({ group, keys });
    }
    entries.push({ version, versionKey, date: release.date, groups });
  }
  return entries.toSorted((a, b) => compareVersions(b.version, a.version));
}

/** Every lead of every entry, counted. */
export function countLeads(entries: readonly ReleaseEntry[]): number {
  return entries.reduce((total, entry) => total + entry.groups.reduce((sum, group) => sum + group.keys.length, 0), 0);
}

////////////////////////////////////////////////////////////////////////////////
// The decision
////////////////////////////////////////////////////////////////////////////////

/**
 * What to do about this device on this build.
 *
 * `stamp` is not a quieter `none`: it means the caller must record `current`
 * silently, so the NEXT update has a baseline to measure from. `none` means the
 * stored value is already right and writing would make it wrong.
 */
export type WhatsNewDecision = { kind: 'none' } | { kind: 'stamp' } | { kind: 'show'; unseen: readonly ReleaseEntry[] };

/** Everything the decision reads. All of it is already on the device or in the bundle. */
export interface WhatsNewInputs {
  /** This bundle's version, `BUILD.version`. */
  current: string;
  /** What this device last acknowledged, or null when it never has. */
  seen: string | null;
  /** `LocalProfileGoals.onboardingCompletedAt`, or null when there is no profile row. */
  onboardedAt: number | null;
  /** When this bundle was built (ISO 8601), `BUILD.builtAt`. */
  builtAt: string;
  /** The shipped releases, newest first, from {@link entriesFromCatalog}. */
  entries: readonly ReleaseEntry[];
}

/** `show` when there is something to show, `stamp` otherwise. */
function showOrStamp(unseen: readonly ReleaseEntry[]): WhatsNewDecision {
  return unseen.length === 0 ? { kind: 'stamp' } : { kind: 'show', unseen };
}

/**
 * Whether this device was already in use before this bundle was built.
 *
 * This is the whole reason a brand-new person is not told what changed: they
 * onboarded onto THIS build, so there is no "before" for them to have missed.
 * An unparseable build time answers false, which lands on the quiet side.
 */
function isEstablishedDevice({ onboardedAt, builtAt }: { onboardedAt: number | null; builtAt: string }): boolean {
  if (onboardedAt === null || !Number.isFinite(onboardedAt)) return false;
  return onboardedAt < Date.parse(builtAt);
}

/**
 * Whether to tell this device what changed, and about which releases.
 *
 * The four cases, in the order they are decided:
 *
 * 1. A build with no readable version (a local `pnpm dev`, `0.0.0-unstamped`)
 *    says nothing and records nothing. There is no version to record.
 * 2. A device that acknowledged this version OR a newer one is up to date. A
 *    ROLLBACK lands here, and the stored value is deliberately left alone: the
 *    device has read those notes, and overwriting it with the older version
 *    would announce them again on the way back up.
 * 3. A device that acknowledged an OLDER version is shown every release in
 *    between, that version exclusive, this one inclusive.
 * 4. A device with no acknowledgement at all is the interesting one. If it
 *    finished onboarding BEFORE this bundle was built it has been using the app
 *    across an update and simply never had the flag, so it is shown this build's
 *    own notes, and only those: there is no baseline, so "everything since" is
 *    unanswerable. Anything else is a new device, which is stamped silently.
 *
 * @param inputs - the build, the device and the shipped releases.
 * @returns nothing to do, record silently, or show these releases.
 */
export function decideWhatsNew({ current, seen, onboardedAt, builtAt, entries }: WhatsNewInputs): WhatsNewDecision {
  if (parseVersionTriple(current) === null) return { kind: 'none' };

  if (isKnownVersion(seen) && seen !== null) {
    if (compareVersions(seen, current) >= 0) return { kind: 'none' };
    return showOrStamp(
      entries.filter(
        (entry) => compareVersions(seen, entry.version) < 0 && compareVersions(entry.version, current) <= 0,
      ),
    );
  }

  if (!isEstablishedDevice({ onboardedAt, builtAt })) return { kind: 'stamp' };
  return showOrStamp(entries.filter((entry) => entry.version === current));
}
