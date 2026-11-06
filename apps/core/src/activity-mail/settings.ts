/**
 * The administrator's switches for the two activity reminder kinds, their
 * bounds, and the parser for `PATCH /v1/admin/settings`.
 *
 * OFF BY DEFAULT, BOTH KINDS. A self-hosted instance that upgrades mails
 * nobody until its administrator turns a kind on, and the migration's column
 * defaults say the same thing as {@link DEFAULT_ACTIVITY_MAIL_SETTINGS}.
 *
 * THE BOUNDS ARE CHECKED TWICE, here with the numbers in the message and by
 * the check constraints on `instance_settings`, so a value that reached the
 * row by another path is refused as well.
 */
import { asNumber, asObject, type JsonValue } from '../lib/json.js';
import type { ActivityMailKind } from './due-rules.js';

/** One kind's switch and its number of days. */
export interface ActivityMailKindSettings {
  enabled: boolean;
  days: number;
}

/** Both kinds, in the wire shape `GET /v1/admin/settings` answers with. */
export interface ActivityMailSettings {
  firstScan: ActivityMailKindSettings;
  quiet: ActivityMailKindSettings;
}

/** A partial change: any kind, any field, each absent field left as it is. */
export interface ActivityMailSettingsPatch {
  firstScan?: Partial<ActivityMailKindSettings>;
  quiet?: Partial<ActivityMailKindSettings>;
}

export interface DayBounds {
  min: number;
  max: number;
}

/** Days after sign-up before the first-scan reminder. */
export const FIRST_SCAN_DAY_BOUNDS: DayBounds = { min: 3, max: 30 };

/** Days since last seen before the quiet reminder. */
export const QUIET_DAY_BOUNDS: DayBounds = { min: 7, max: 60 };

/** What an instance holds before anybody changed anything. The column defaults agree. */
export const DEFAULT_ACTIVITY_MAIL_SETTINGS: ActivityMailSettings = {
  firstScan: { enabled: false, days: 7 },
  quiet: { enabled: false, days: 14 },
};

/** The settings each kind is read from, by kind, so a third kind is a compile error here. */
export function kindSettingsOf(input: {
  settings: ActivityMailSettings;
  kind: ActivityMailKind;
}): ActivityMailKindSettings {
  const byKind = {
    'first-scan': input.settings.firstScan,
    quiet: input.settings.quiet,
  } satisfies Record<ActivityMailKind, ActivityMailKindSettings>;
  return byKind[input.kind];
}

/**
 * Whether the public handshake says `activityMail: true`: a real mailer AND
 * at least one kind on. A client draws the sign-up box only then, so a
 * person is never asked for a consent this instance has no way to use.
 */
export function isActivityMailOffered(input: { isMailConfigured: boolean; settings: ActivityMailSettings }): boolean {
  if (!input.isMailConfigured) return false;
  return input.settings.firstScan.enabled || input.settings.quiet.enabled;
}

/** A patch applied to what the process holds. Pure. */
export function applyActivityMailPatch(input: {
  current: ActivityMailSettings;
  patch: ActivityMailSettingsPatch;
}): ActivityMailSettings {
  return {
    firstScan: { ...input.current.firstScan, ...input.patch.firstScan },
    quiet: { ...input.current.quiet, ...input.patch.quiet },
  };
}

export type ParsedActivityMailPatch = { ok: true; value: ActivityMailSettingsPatch } | { ok: false; reason: string };

function parseKindPatch(input: {
  value: JsonValue | undefined;
  field: string;
  bounds: DayBounds;
}): { ok: true; value: Partial<ActivityMailKindSettings> | undefined } | { ok: false; reason: string } {
  if (input.value === undefined) return { ok: true, value: undefined };
  const object = asObject(input.value);
  if (object === null) return { ok: false, reason: `${input.field} must be an object` };
  const unknown = Object.keys(object).filter((key) => key !== 'enabled' && key !== 'days');
  if (unknown.length > 0) return { ok: false, reason: `${input.field} has an unknown field: ${unknown.join(', ')}` };

  const patch: Partial<ActivityMailKindSettings> = {};
  const enabled = object.enabled;
  if (enabled !== undefined && enabled !== true && enabled !== false) {
    return { ok: false, reason: `${input.field}.enabled must be true or false` };
  }
  if (enabled !== undefined) patch.enabled = enabled;

  if (object.days === undefined) return { ok: true, value: patch };
  const days = asNumber(object.days);
  const inBounds = days !== null && Number.isInteger(days) && days >= input.bounds.min && days <= input.bounds.max;
  if (days === null || !inBounds) {
    return {
      ok: false,
      reason: `${input.field}.days must be a whole number from ${input.bounds.min} to ${input.bounds.max}`,
    };
  }
  patch.days = days;
  return { ok: true, value: patch };
}

/**
 * The `activityMail` field of an admin settings PATCH. Every field is
 * optional, and an unknown one is a 400 rather than silently dropped: a
 * misspelled `enabeld` is a change the administrator believes they made.
 */
export function parseActivityMailPatch(value: JsonValue | undefined): ParsedActivityMailPatch {
  const object = asObject(value);
  if (object === null) return { ok: false, reason: 'activityMail must be an object' };
  const unknown = Object.keys(object).filter((key) => key !== 'firstScan' && key !== 'quiet');
  if (unknown.length > 0) return { ok: false, reason: `activityMail has an unknown field: ${unknown.join(', ')}` };

  const firstScan = parseKindPatch({
    value: object.firstScan,
    field: 'activityMail.firstScan',
    bounds: FIRST_SCAN_DAY_BOUNDS,
  });
  if (!firstScan.ok) return firstScan;
  const quiet = parseKindPatch({ value: object.quiet, field: 'activityMail.quiet', bounds: QUIET_DAY_BOUNDS });
  if (!quiet.ok) return quiet;

  const patch: ActivityMailSettingsPatch = {};
  if (firstScan.value !== undefined) patch.firstScan = firstScan.value;
  if (quiet.value !== undefined) patch.quiet = quiet.value;
  return { ok: true, value: patch };
}
