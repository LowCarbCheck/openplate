/**
 * Resolves the active IANA time zone for local-first day-bucketing (M117/03):
 * the user's saved local profile zone when set, else the device's own zone.
 * Every tracker route's `clientLoader`/`clientAction` uses this instead of a
 * server-side `profile.timezone` read, since the profile is now local-only.
 */
import type { LocalProfileGoals } from './schema';

/**
 * @param profile - the local profile/goals row, or null when never written.
 * @returns the profile's saved time zone, else the browser's resolved zone.
 */
export function resolveLocalTimezone(profile: Pick<LocalProfileGoals, 'timezone'> | null): string {
  return profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
