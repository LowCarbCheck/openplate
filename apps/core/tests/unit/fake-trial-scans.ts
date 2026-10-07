/**
 * The scan-trial half of an `AiQuotaStore` fake, for suites whose accounts
 * carry no scan trial (M253).
 *
 * THE CLAIM AND ITS GIVE-BACK THROW, so a suite whose accounts were never meant
 * to reach the scan gate fails loudly if one does, rather than passing on a
 * fake answer. The sweep answers zero and the day counter answers "taken", which
 * is what the real store says for an instance with no trial accounts.
 * `tests/integration/scan-trial.test.ts` owns the real statements.
 */
import type { AiFreeBoundStore, AiTrialScanStore, ReserveResult, TrialClaim } from '../../src/ai/quota-store.js';

export function createUnusedTrialScanStore(): AiTrialScanStore {
  return {
    async claimTrialScan(): Promise<TrialClaim> {
      throw new Error('this suite has no scan-trial account, so nothing should claim a scan');
    },
    async releaseTrialScan(): Promise<{ givenBack: boolean }> {
      throw new Error('this suite has no scan-trial account, so nothing should give a scan back');
    },
    async markTrialScanDelivered(): Promise<void> {
      throw new Error('this suite has no scan-trial account, so nothing should mark a scan delivered');
    },
    async purgeTrialIntakesBefore(): Promise<number> {
      return 0;
    },
    async reserveTrialInstance(): Promise<ReserveResult> {
      return { ok: true, used: 1, limit: Number.MAX_SAFE_INTEGER };
    },
    async releaseTrialInstance(): Promise<void> {},
    async reserveTrialNetwork(): Promise<ReserveResult> {
      throw new Error('this suite has no scan-trial account, so nothing should take a network share');
    },
    async releaseTrialNetwork(): Promise<void> {
      throw new Error('this suite has no scan-trial account, so nothing should give a network share back');
    },
    async purgeTrialNetworkDaysBefore(): Promise<number> {
      return 0;
    },
  };
}

/**
 * The free-bound half of an `AiQuotaStore` fake (2026-10-07), for suites that
 * set no free bound. The reserves THROW, so a suite that reaches them without
 * setting a bound fails loudly; the sweep answers zero, which is what the real
 * store says for an instance that never wrote a row.
 */
export function createUnusedFreeBoundStore(): AiFreeBoundStore {
  return {
    async reserveFreeInstance(): Promise<ReserveResult> {
      throw new Error('this suite sets no free ceiling, so nothing should take a unit of it');
    },
    async releaseFreeInstance(): Promise<void> {
      throw new Error('this suite sets no free ceiling, so nothing should give a unit of it back');
    },
    async reserveFreeNetwork(): Promise<ReserveResult> {
      throw new Error('this suite sets no free network bound, so nothing should take a unit of it');
    },
    async releaseFreeNetwork(): Promise<void> {
      throw new Error('this suite sets no free network bound, so nothing should give a unit of it back');
    },
    async purgeFreeNetworkDaysBefore(): Promise<number> {
      return 0;
    },
  };
}
