/**
 * The "this device has had data before" marker — one store VALUE
 * (`firstDataAt`, see `HAD_DATA_MARKER_VALUE`) holding the epoch-ms the first
 * food log or profile write ever landed on this device (M123 spec 01).
 *
 * WHY A VALUE AND NOT A TABLE. The data-loss incident this spec closes empties
 * the primary store's TABLES partition (`t`) while the VALUES partition (`v`)
 * survives untouched — see `persist.ts`'s module doc and
 * `shouldRefuseAutosave`. So "zero food logs" is ambiguous on its own: it is
 * either a device that never onboarded, or a device whose tables were just
 * wiped. This marker is the invariant that separates them, which is only
 * possible because it lives in the partition that outlives the wipe. Reading
 * it never consults `t`.
 *
 * WHEN IT IS WRITTEN. On the first FOOD LOG or PROFILE write, never on app
 * boot and never on store creation — see `marksDeviceHasData`. A store that
 * merely exists proves nothing; a store that has been WRITTEN to by the user
 * is what "this device has had data" means. Stamping at boot would mark a
 * genuinely new device and get it misread as a data-loss victim.
 *
 * WRITE-ONCE. `markDeviceHasData` returns early whenever the value is already
 * present, so the marker records the FIRST such write and every later write
 * costs one `getValue` — no re-stamp, no reset, and no spurious TinyBase
 * transaction on the hot write path. Nothing in the app clears it: the marker
 * is a statement about the device's history, and history does not un-happen.
 * (A user who deletes every log still had data; the backup nudge — spec 01's
 * fourth item — reads this same value as "days since data first existed".)
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import { FOOD_LOGS_TABLE, HAD_DATA_MARKER_VALUE, PROFILE_GOALS_TABLE } from './store';
import { getPrimaryStore } from './persist';

/** The marker as it comes back off the store — a TinyBase value, not yet an epoch-ms. */
const firstDataAtValueSchema = z.number();

/**
 * The primary tables whose write means "this device has real user data".
 *
 * Deliberately just these two. A food log is the app's unit of tracked data,
 * and the profile row is what completing onboarding stamps — between them they
 * cover every path by which a device stops being a fresh install. Personal
 * foods, weight entries and fasts are all reachable only from behind those two
 * writes, so including them would widen the marker without covering a single
 * state it does not already cover.
 */
const MARKING_TABLES: ReadonlySet<string> = new Set([FOOD_LOGS_TABLE, PROFILE_GOALS_TABLE]);

/** Pure: whether a write to `table` is one of the writes that stamps the marker. */
export function marksDeviceHasData(table: string): boolean {
  return MARKING_TABLES.has(table);
}

/**
 * Stamps the marker if it is not already there. Idempotent, synchronous, and
 * cheap on every subsequent write (one `getValue`, then return).
 *
 * The guard tests PRESENCE, not parseability: a value that is present but
 * malformed is still evidence this device once held data, and overwriting it
 * would move `firstDataAt` forward to a moment that is not the first one.
 */
export function markDeviceHasData(store: Store, { now }: { now?: () => number } = {}): void {
  if (store.getValue(HAD_DATA_MARKER_VALUE) !== undefined) return;
  store.setValue(HAD_DATA_MARKER_VALUE, (now ?? Date.now)());
}

/**
 * Stamps the marker for a write to `table`, doing nothing for a table that is
 * not one of the marking ones. This is the single call site `primary-store.ts`
 * makes from its one write chokepoint, so no future entity write can forget it.
 */
export function markDeviceHasDataForTable(store: Store, table: string, { now }: { now?: () => number } = {}): void {
  if (!marksDeviceHasData(table)) return;
  markDeviceHasData(store, { now });
}

interface StoreOption {
  store?: Store;
}

async function resolveStore(store: Store | undefined): Promise<Store> {
  return store ?? (await getPrimaryStore());
}

/**
 * Whether this device has ever held tracker data — read from the values
 * partition alone, so it stays true across a tables wipe.
 *
 * Presence is the whole test. A marker that is present but unparseable still
 * answers this question with `true`; only `getFirstDataAt` cares whether the
 * stamp itself is usable.
 */
export async function hasEverHadData({ store }: StoreOption = {}): Promise<boolean> {
  return (await resolveStore(store)).getValue(HAD_DATA_MARKER_VALUE) !== undefined;
}

/**
 * The epoch-ms this device first held data, or null when it never has (or the
 * marker is present but malformed). The datum the backup nudge reads as "days
 * since data first existed".
 */
export async function getFirstDataAt({ store }: StoreOption = {}): Promise<number | null> {
  const value = firstDataAtValueSchema.safeParse((await resolveStore(store)).getValue(HAD_DATA_MARKER_VALUE));
  return value.success ? value.data : null;
}
