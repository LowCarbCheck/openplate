/**
 * The mark row shape and its id (M235/01).
 *
 * Why the id carries the whole fact: sync merges whole records, last write
 * wins, per entity id (`app/lib/sync/engine/merge/merge-entities.ts`). A row
 * holding "the set of things done on 2026-09-18" would therefore lose one
 * device's half whenever a phone and a tablet were both used offline on the
 * same day. Making the ROW the unit of the FACT removes the conflict instead of
 * resolving it: two devices write two different ids, both survive, and the
 * merge engine is not touched.
 *
 * There is no timestamp on a mark for the same reason. Two devices seeing the
 * same signal on the same day would write different times, last-write-wins
 * would flip between them, and nothing reads the value. The day IS the fact.
 */
import type { ActivitySignal } from './catalog';

/**
 * One immutable mark: a day carried a signal.
 *
 * THE SHAPE LIVES IN THE STORE (`#app/lib/local-store/schema`, M235/02) and is
 * re-exported here so this module stays the one place a reader looks for
 * everything about a mark. M235/01 declared it locally because the table did
 * not exist yet; there is exactly ONE definition now, and it is the store's.
 *
 * Importing it costs this module nothing it is banned from having: `schema.ts`
 * is pure types and id constants, with no runtime dependency on TinyBase and no
 * clock.
 */
export type { LocalActivityMark } from '#app/lib/local-store/schema';

/** The one separator between the two halves of a mark id. Neither half may contain it. */
const MARK_ID_SEPARATOR = '#';

/** A bare `YYYY-MM-DD` day key. A shape check, not a calendar check; see `parseMarkId`. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The row id for a (day, signal) pair.
 *
 * @param dayKey - the local calendar day, `YYYY-MM-DD`.
 * @param signal - the signal recorded on that day.
 * @returns the immutable row id.
 */
export function markId(dayKey: string, signal: ActivitySignal): string {
  return `${dayKey}${MARK_ID_SEPARATOR}${signal}`;
}

/**
 * The two halves of a mark id, or null when the id is not one.
 *
 * Deliberately strict about the SHAPE and deliberately silent about the
 * calendar: an id must be exactly one separator with a `YYYY-MM-DD` left half
 * and a non-empty right half, but `2026-13-45` parses. A calendar check would
 * reject nothing this app mints, and it would quietly discard a day key from a
 * build that is right about a date this one is wrong about.
 *
 * The signal comes back as `string`, not `ActivitySignal`, because an id may
 * name a signal a newer build added. Callers ask `signalCountsTowardActive`.
 *
 * @param id - the row id to split.
 * @returns the day key and signal, or null when `id` is not a mark id.
 */
export function parseMarkId(id: string): { dayKey: string; signal: string } | null {
  const parts = id.split(MARK_ID_SEPARATOR);
  if (parts.length !== 2) return null;
  const [dayKey, signal] = parts;
  if (!DAY_KEY_PATTERN.test(dayKey)) return null;
  if (signal.length === 0) return null;
  return { dayKey, signal };
}
