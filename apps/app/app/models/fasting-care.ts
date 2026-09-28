/**
 * The two care decisions `/fasting` has to make before it lets a fast start,
 * and the routine arithmetic that sits beside them. Pure, `nowMs` is always a
 * parameter, exactly like `models/fasting.ts` and `models/fasting-stats.ts`,
 * so `tests/unit/fasting-care.test.ts` can pin every branch with no browser,
 * no store and no clock.
 *
 * WHY THE DECISIONS LIVE HERE AND NOT IN THE ROUTE
 *
 * Both of them are the kind of rule that is quietly wrong for months if it is
 * written inline in a render tree: an off-by-one on the 24 h threshold shows
 * the long-fast sheet to someone on a 23 h fast, or, far worse, skips it for
 * someone on 24 h. A function with a name is a function a test can falsify.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 * It never BLOCKS a start. `presetsForStatus` hides the long presets and
 * `maxCustomHoursForStatus` caps the typed number, but a person who is
 * pregnant can still fast, and openplate does not get to refuse them. The
 * notice above the plan card says what the NHS says and then gets out of the
 * way (DESIGN.md section 10.1: the app states facts, it does not grade or
 * police the person).
 */
import type { FastProtocolId, ReproductiveStatus } from '#app/lib/local-store/schema';
import type { FastProtocol } from '#app/models/fasting';
import { FAST_MAX_CUSTOM_HOURS, FAST_PROTOCOLS, isValidCustomHours } from '#app/models/fasting';

const MS_PER_HOUR = 60 * 60 * 1000;
const MINUTES_PER_HOUR = 60;

/**
 * The target length from which a fast counts as extended and earns the care
 * sheet once. 24 h is the first `FAST_PROTOCOLS` entry with `daily: false`,
 * which is the same line the picker already draws between a repeatable eating
 * window and a one-off event.
 */
export const FAST_EXTENDED_TARGET_MS = 24 * MS_PER_HOUR;

/**
 * The longest fast the plan card offers while the profile says pregnant or
 * lactating. 16 h is the shortest conventional window, so the picker keeps a
 * real choice rather than collapsing to nothing.
 */
export const FAST_CARE_MAX_HOURS = 16;

export interface CareSheetInput {
  /** The target length the person is about to commit to, in ms. */
  targetMs: number;
  /** `LocalFastingSettings.extendedAcknowledgedAt`, null while never acknowledged. */
  extendedAcknowledgedAt: number | null;
}

/**
 * Whether the "Before a long fast" sheet has to be shown before this start.
 *
 * ONCE PER PERSON, not once per fast: the acknowledgement rides the synced
 * settings record, so a second device does not ask again.
 *
 * @param input - the target about to be started and the stored acknowledgement.
 * @returns true only for an unacknowledged 24 h or longer target.
 */
export function needsCareSheet({ targetMs, extendedAcknowledgedAt }: CareSheetInput): boolean {
  if (extendedAcknowledgedAt !== null) return false;
  return targetMs >= FAST_EXTENDED_TARGET_MS;
}

/**
 * Whether this profile carries the pregnancy or breastfeeding notice.
 *
 * `null` and `'none'` both read as no, so a device that has never answered the
 * question is treated as having said nothing rather than as having said yes.
 *
 * @param status - the stored reproductive status, absent when never told.
 * @returns true for pregnant or lactating.
 */
export function isCareStatus(status: ReproductiveStatus | null | undefined): boolean {
  return status === 'pregnant' || status === 'lactating';
}

/**
 * The named presets the plan card offers for this profile: all seven normally,
 * and only the windows at or under {@link FAST_CARE_MAX_HOURS} while pregnant
 * or breastfeeding.
 *
 * @param status - the stored reproductive status.
 * @returns the presets to render, in `FAST_PROTOCOLS` order.
 */
export function presetsForStatus(status: ReproductiveStatus | null | undefined): readonly FastProtocol[] {
  if (!isCareStatus(status)) return FAST_PROTOCOLS;
  return FAST_PROTOCOLS.filter((protocol) => protocol.fastingHours <= FAST_CARE_MAX_HOURS);
}

/**
 * The ceiling on the custom-hours field for this profile. The hidden presets
 * would be trivially reachable by typing the number otherwise, which would
 * make the filter above decoration.
 *
 * @param status - the stored reproductive status.
 * @returns the largest custom hour count the schema accepts.
 */
export function maxCustomHoursForStatus(status: ReproductiveStatus | null | undefined): number {
  return isCareStatus(status) ? FAST_CARE_MAX_HOURS : FAST_MAX_CUSTOM_HOURS;
}

/**
 * Whether a typed hour count is acceptable for this profile: a whole number
 * inside the model's own bounds AND at or under this profile's ceiling.
 *
 * @param hours - the parsed hour count.
 * @param status - the stored reproductive status.
 * @returns true when the plan card may start it.
 */
export function isAllowedCustomHours(hours: number, status: ReproductiveStatus | null | undefined): boolean {
  return isValidCustomHours(hours) && hours <= maxCustomHoursForStatus(status);
}

export interface RoutineOccurrenceInput {
  /** The clock reading to measure from; never read internally. */
  nowMs: number;
  /** `LocalFastingSettings.routineStartMinute`, minutes after local midnight. */
  routineStartMinute: number;
}

/**
 * The next instant the routine's wall-clock minute comes round: today when it
 * is still ahead, tomorrow when it has passed. The boundary is "already
 * passed", so exactly 20:00 rolls to tomorrow, the same rule
 * `defaultPlannedStartLocal` follows for the same reason: a schedule for the
 * instant you pressed the button is not a schedule.
 *
 * Built on the DEVICE's wall clock rather than the stored profile zone, which
 * is what `parseLocalDateTimeInput` does and for the same reason: the button
 * says "Start at 20:00" beside a native picker showing device time, and the
 * two must mean the same 20:00.
 *
 * @param input - the clock reading and the routine's minute after midnight.
 * @returns epoch-ms of the next occurrence.
 */
export function nextRoutineOccurrenceMs({ nowMs, routineStartMinute }: RoutineOccurrenceInput): number {
  const at = new Date(nowMs);
  at.setHours(Math.floor(routineStartMinute / MINUTES_PER_HOUR), routineStartMinute % MINUTES_PER_HOUR, 0, 0);
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/**
 * The catalog key holding a preset's visible label.
 *
 * The labels are CATALOG entries rather than the raw id because four of the
 * seven ("24h") need a space and a unit to read as a duration, and a German
 * reader needs the same freedom. Three of them ("16:8") are deliberately the
 * id itself, spelled out in the bundle so nothing has to know which is which.
 *
 * Read it with `nsSeparator: false`: three of the ids contain a colon, which
 * i18next otherwise takes for a namespace separator.
 *
 * @param id - the protocol id, including `custom`.
 * @returns the dotted catalog key for its label.
 */
export function protocolLabelKey(id: FastProtocolId): string {
  return `fasting.plan.protocol.${id}`;
}
