/**
 * The mailbox hashes of deleted accounts end (2026-10-05, ADR-0010).
 *
 * WHAT IS KEPT AND WHY. After an account that held a scan trial is deleted,
 * `trial_address_hashes` keeps one keyed one-way hash of its mailbox, so the
 * one mailbox, one trial rule still recognises the mailbox (`db/trial-mailbox.ts`).
 * A keyed hash of an address is still personal data: whoever holds the key can
 * match it again. So it is kept for a stated, fixed period and then deleted.
 *
 * THE PERIOD IS `TRIAL_HASH_RETENTION_DAYS`, 365 by default, counted from the
 * row's `created_at`, which is the instant of the deletion. When the hash is
 * gone the same mailbox can have a trial again. That is the price of an end
 * date, and the ADR names it as the accepted one.
 *
 * ONE STATEMENT, so a sweep that overlaps another deletes each row once and a
 * crash half way leaves nothing half done. It runs on the hourly tick in
 * `main.ts`, beside the invitation scrub, on every instance: an instance that
 * stopped its trial still holds the hashes from when it ran one, and a sweep
 * wired behind the trial flag would leave exactly those rows in place for ever.
 */
import { lt } from 'drizzle-orm';
import type { Database } from './client.js';
import { trialAddressHashes } from './schema.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PurgeExpiredTrialHashesInput {
  now: Date;
  /** How many days a hash is kept after the deletion it records. At least 1. */
  retentionDays: number;
}

/** Deletes every hash older than the retention period. Returns how many went. */
export async function purgeExpiredTrialHashes(db: Database, input: PurgeExpiredTrialHashesInput): Promise<number> {
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1) {
    throw new Error(`a retention period is a whole number of days, at least 1, got ${input.retentionDays}`);
  }
  const cutoff = new Date(input.now.getTime() - input.retentionDays * MS_PER_DAY);
  const deleted = await db
    .delete(trialAddressHashes)
    .where(lt(trialAddressHashes.createdAt, cutoff))
    .returning({ hash: trialAddressHashes.hash });
  return deleted.length;
}
