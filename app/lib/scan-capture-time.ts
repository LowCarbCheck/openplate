/**
 * When a photographed plate was actually eaten, as well as this app can honestly
 * know it, and the meal slot that follows from it (M202).
 *
 * WHY THIS EXISTS. `/add` seeds its meal select from the clock, because typing
 * a food in by hand happens at the moment you log it. A photo does not: people
 * shoot the plate and confirm it on the bus an hour later, or in the evening
 * for the whole day. Seeding the scan's slot from the confirm clock would file
 * a photographed lunch under dinner and look deliberate while doing it.
 *
 * WHY NOT EXIF. A JPEG straight from a phone camera usually carries
 * `DateTimeOriginal`, which is the real answer. Reading it means shipping an
 * EXIF parser, and the scan pipeline re-encodes every picked file through a
 * canvas (`downscaleToJpeg`) which strips EXIF anyway, so the parse would have
 * to happen on the ORIGINAL file before that step. That is a bigger change than
 * this one; it is not done here, and this module is the deliberate proxy in the
 * meantime. If EXIF is ever read, it belongs behind `resolveCaptureInstant` as
 * a preferred source, with `lastModified` demoted to the second answer.
 *
 * WHAT `lastModified` ACTUALLY IS. The file's modification time as the browser
 * reports it: for a camera capture, when the picture was written; for a library
 * pick, when the picture was saved or last edited. It is a PROXY for capture
 * time, not capture time. Browsers are also free to report nothing useful,
 * which they signal as `0` (the epoch) or as `Date.now()`.
 *
 * WHAT COUNTS AS SANE, AND WHY. A timestamp is taken only when it is finite,
 * non-zero, no further into the future than a small clock-skew tolerance, and
 * no older than one day. Both bounds exist because a wrong answer here is
 * worse than no answer:
 *  - A FUTURE timestamp means a camera clock set wrong, and it can only come
 *    from a device this app cannot reason about.
 *  - An OLD timestamp belongs to a picture from another day. The entry is
 *    logged against today (or the day the person is back-dating to), so a
 *    time-of-day lifted off last month's holiday photo describes a different
 *    meal on a different day. A plate filed into the wrong DAY is worse than
 *    one filed into the wrong meal, so the day the picture belongs to is the
 *    thing the window protects.
 * Neither bound rejects the picture. They only decide which clock names the
 * meal, and the person can change the meal on the confirm screen either way.
 */
import type { MealType } from '#types/enums';
import { mealTypeForTime } from './meal-time';

/**
 * How far ahead of the local clock a file timestamp may sit and still be
 * believed. Device clocks and file systems disagree by seconds routinely; five
 * minutes absorbs that without believing a camera set to next year.
 */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * The oldest file timestamp that still describes the meal being logged: one
 * day. Beyond that the picture is from another day (see the header).
 */
const MAX_CAPTURE_AGE_MS = 24 * 60 * 60 * 1000;

/** Which clock named the capture instant. `'clock'` means the file's own timestamp was unusable. */
export type CaptureInstantSource = 'file' | 'clock';

/** The instant a picked photo is treated as having been captured at, and where it came from. */
export interface CaptureInstant {
  atMs: number;
  source: CaptureInstantSource;
}

/**
 * Resolves the instant a picked photo is treated as having been captured at.
 * Pure: both the file timestamp and the current time are passed in.
 *
 * @param options.fileLastModifiedMs - the picked `File`'s `lastModified`, or null when there is no file.
 * @param options.nowMs - the current local instant, used as the fallback.
 * @returns the instant to read a meal slot from, and which clock it came from.
 */
export function resolveCaptureInstant({
  fileLastModifiedMs,
  nowMs,
}: {
  fileLastModifiedMs: number | null;
  nowMs: number;
}): CaptureInstant {
  if (fileLastModifiedMs === null) return { atMs: nowMs, source: 'clock' };
  if (!Number.isFinite(fileLastModifiedMs)) return { atMs: nowMs, source: 'clock' };
  // Exactly the epoch is what a browser reports when it has nothing to report.
  if (fileLastModifiedMs <= 0) return { atMs: nowMs, source: 'clock' };
  if (fileLastModifiedMs > nowMs + MAX_FUTURE_SKEW_MS) return { atMs: nowMs, source: 'clock' };
  if (fileLastModifiedMs < nowMs - MAX_CAPTURE_AGE_MS) return { atMs: nowMs, source: 'clock' };
  return { atMs: fileLastModifiedMs, source: 'file' };
}

/**
 * The meal slot a photographed plate should be preselected into. The window
 * boundaries are `#app/lib/meal-time`'s, unchanged and not duplicated. This
 * module only decides WHICH INSTANT to hand it.
 *
 * @param options.fileLastModifiedMs - the picked `File`'s `lastModified`, or null when there is no file.
 * @param options.nowMs - the current local instant, used when the file timestamp is unusable.
 * @param options.timezone - the device's IANA zone, so the slot follows the local wall clock.
 * @returns the meal slot to preselect.
 */
export function mealTypeForCapture({
  fileLastModifiedMs,
  nowMs,
  timezone,
}: {
  fileLastModifiedMs: number | null;
  nowMs: number;
  timezone: string;
}): MealType {
  const { atMs } = resolveCaptureInstant({ fileLastModifiedMs, nowMs });
  return mealTypeForTime({ at: new Date(atMs), timezone });
}
