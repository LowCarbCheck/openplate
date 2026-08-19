/**
 * Device-local "this gate has been confirmed clear here" stamp — a single
 * store VALUE (`migrationGateClearedFor`) holding the owner id the gate was
 * last cleared for on this device.
 *
 * CURRENTLY UNREFERENCED BY THE APP (M128 spec 03). It was written for the
 * one-time server → device migration gate (M117/03): `_personal.tsx`'s
 * `clientLoader` had to call the SERVER-side gate at least once per signed-in
 * session, but not on every purely local navigation, which would have turned
 * each personal-route nav into a server round trip and defeated the whole
 * point of the local-first cutover. That gate is gone — there is no `users`
 * table, no `localFirstMigratedAt`, and no `/migrate-confirm` — so nothing
 * calls these functions today.
 *
 * Kept rather than deleted for two reasons: the VALUE still exists in the
 * primary store of every device that ran an M117-era build (so the readers
 * below are the honest way to inspect or clear it), and the sync client
 * (M128 spec 04) needs exactly this shape of once-per-device stamp. The
 * account-switching rules the original design turned on — clearing on login
 * and logout so a second account on a shared device never inherited the
 * first's stamp — no longer apply, because there are no accounts to switch
 * between; a device has one owner.
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import { MIGRATION_GATE_CLEARED_FOR_VALUE } from './store';
import { getPrimaryStore } from './persist';

/** The stamped owner id as it comes back off the store — a TinyBase value, not yet a user id. */
const clearedForUserIdSchema = z.number().int();

interface StoreOption {
  store?: Store;
}

async function resolveStore(store: Store | undefined): Promise<Store> {
  return store ?? (await getPrimaryStore());
}

/**
 * Pure decision: whether the gate has already been confirmed clear on this
 * device and can be skipped.
 *
 * Deliberately checks only non-null, NOT equality against some independently
 * verified "expected current owner" id: the caller is a `clientLoader`, which
 * has no way to obtain a freshly-verified id without making the very round
 * trip this function exists to conditionally skip.
 *
 * @param clearedForUserId - the stamped owner id on this device, or null when
 *   never stamped (or cleared).
 * @returns true when the gate has already been confirmed clear on this device.
 */
export function shouldSkipMigrationGateCheck({ clearedForUserId }: { clearedForUserId: number | null }): boolean {
  return clearedForUserId !== null;
}

/** The owner id the gate was last confirmed clear for on this device, or null. */
export async function getMigrationGateClearedFor({ store }: StoreOption = {}): Promise<number | null> {
  const value = (await resolveStore(store)).getValue(MIGRATION_GATE_CLEARED_FOR_VALUE);
  const parsed = clearedForUserIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Stamps the gate as cleared for `userId` on this device. */
export async function setMigrationGateClearedFor(userId: number, { store }: StoreOption = {}): Promise<void> {
  (await resolveStore(store)).setValue(MIGRATION_GATE_CLEARED_FOR_VALUE, userId);
}

/** Removes the stamp, so the gate runs again on this device. */
export async function clearMigrationGateStamp({ store }: StoreOption = {}): Promise<void> {
  (await resolveStore(store)).delValue(MIGRATION_GATE_CLEARED_FOR_VALUE);
}
