/**
 * One-time celebrations for genuine firsts (M129/03).
 *
 * The rule this module exists to enforce: a celebration fires ONCE, ever, per
 * device, for a milestone that actually is one. Not on every log, not on every
 * good day, not as a badge the user can go collect. Three qualify:
 *
 * - `first-log` — the first food ever logged on this device.
 * - `first-scan` — the first plate identified by the user's own AI provider.
 * - `streak-7` — every day in the seven-day habit window logged.
 * - `target-weight` — the weigh-in that first reached the target weight.
 *
 * Everything here is pure except the two `localStorage` helpers, which take
 * their storage as an argument so the "never twice" guarantee is testable
 * without a browser.
 *
 * Deliberately NOT part of the TinyBase primary store (same reasoning as the
 * diary's favorites key): losing this costs a user one extra pulse, not health
 * data, and it must not travel in a backup export — importing a backup on a
 * new device should not suppress that device's own first-log moment.
 */

/** The milestones, in the order they're offered when more than one is newly true. */
export type CelebrationId = 'first-log' | 'first-scan' | 'streak-7' | 'target-weight';

/** localStorage key holding the ids already celebrated on this device. Versioned so a future retune can start clean. */
export const CELEBRATIONS_STORAGE_KEY = 'openplate:celebrations:v1';

/** Priority order — a device whose very first log is a scan celebrates the log, and the scan is banked as already seen. */
const CELEBRATION_ORDER: CelebrationId[] = ['first-log', 'first-scan', 'streak-7', 'target-weight'];

/** Translator seam — see `celebrationMessage`. Structural so any `t` satisfies it. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** The catalog key for each milestone's one-line note. Warm, brief, and never a score. */
const CELEBRATION_MESSAGE_KEY = {
  'first-log': 'diary.celebration.firstLog',
  'first-scan': 'diary.celebration.firstScan',
  'streak-7': 'diary.celebration.streak7',
  // The `diary.*` prefix is not a mistake: every id maps into that namespace,
  // and splitting it would leave this module reading from two places.
  'target-weight': 'diary.celebration.targetWeight',
} satisfies Record<CelebrationId, string>;

/**
 * The message for a milestone.
 *
 * Takes its translator explicitly (M129/05) rather than importing the i18next
 * singleton, so this module stays pure and testable without a provider — the
 * same seam every other copy-holding lib in the app uses.
 *
 * @param id - the milestone being celebrated.
 * @param t - the caller's translator.
 * @returns the sentence to show.
 */
export function celebrationMessage(id: CelebrationId, t: Translate): string {
  return t(CELEBRATION_MESSAGE_KEY[id]);
}

/** What the diary knows about the device, as far as milestones are concerned. */
export interface CelebrationFacts {
  /** Total food-log entries on this device. */
  totalLogCount: number;
  /** How many of those came from an AI plate identification. */
  aiEstimatedLogCount: number;
  /** Days logged within the habit window. */
  loggedDaysInWindow: number;
  /** Length of that window (7 today). */
  windowDays: number;
  /**
   * Weigh-ins in the Progress page's window. A milestone needs a series, not a
   * single reading: someone who installs the app already at their target and
   * weighs in once has not reached anything here.
   */
  weighInCount: number;
  /**
   * True when the LATEST weigh-in reached the target and the one before it had
   * not (`computeWeightProgress`). A surface that doesn't read weight passes
   * `false` — this milestone is resolved on `/trends`, which does.
   */
  crossedTargetOnLatest: boolean;
}

/** What `resolveCelebration` decided: the one to show now, and every milestone that is currently true. */
export interface CelebrationDecision {
  /** The milestone to celebrate right now, or null when there is nothing new. */
  celebrate: CelebrationId | null;
  /**
   * Every milestone true on this device and not yet seen — including the one
   * being celebrated. The caller banks ALL of them, so a device that crossed
   * two at once doesn't pulse again on the next render for the runner-up.
   */
  newlySatisfied: CelebrationId[];
}

/** Whether a milestone's condition currently holds. */
function isSatisfied(id: CelebrationId, facts: CelebrationFacts): boolean {
  // EXACTLY one, not "at least one". A device that already holds a hundred
  // entries when this shipped must never be told it just logged its first
  // food — the milestone has to be true, not merely un-banked.
  if (id === 'first-log') return facts.totalLogCount === 1;
  if (id === 'first-scan') return facts.aiEstimatedLogCount === 1;
  // A genuine CROSSING, never a standing state — so a device that was already
  // at target when this shipped is never congratulated for holding still.
  if (id === 'target-weight') return facts.weighInCount >= 2 && facts.crossedTargetOnLatest;
  return facts.windowDays > 0 && facts.loggedDaysInWindow >= facts.windowDays;
}

/**
 * Picks the milestone to celebrate, if any.
 *
 * @param facts - what the device currently holds.
 * @param seen - the ids already celebrated here.
 * @returns the milestone to show and every newly-true milestone to bank.
 */
export function resolveCelebration({
  facts,
  seen,
}: {
  facts: CelebrationFacts;
  seen: ReadonlySet<CelebrationId>;
}): CelebrationDecision {
  const newlySatisfied = CELEBRATION_ORDER.filter((id) => !seen.has(id) && isSatisfied(id, facts));
  return { celebrate: newlySatisfied[0] ?? null, newlySatisfied };
}

/** Minimal storage surface — `localStorage` satisfies it, and so does a plain fake in a test. */
export interface CelebrationStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * Reads the banked ids. Any unreadable/corrupt value degrades to "nothing seen
 * yet" rather than throwing — a broken preference must never take the diary
 * down with it.
 *
 * @param storage - the storage to read from.
 * @returns the set of already-celebrated ids.
 */
export function readSeenCelebrations(storage: CelebrationStorage): Set<CelebrationId> {
  try {
    const raw = storage.getItem(CELEBRATIONS_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is CelebrationId => CELEBRATION_ORDER.includes(id)));
  } catch {
    return new Set();
  }
}

/**
 * Banks ids so they never celebrate again. Write failures (private mode, full
 * quota) are swallowed for the same reason as above.
 *
 * @param storage - the storage to write to.
 * @param ids - the ids to add to the seen set.
 */
export function markCelebrationsSeen(storage: CelebrationStorage, ids: readonly CelebrationId[]): void {
  if (ids.length === 0) return;
  try {
    const seen = readSeenCelebrations(storage);
    for (const id of ids) seen.add(id);
    storage.setItem(CELEBRATIONS_STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Ignored by design — see this function's doc.
  }
}
