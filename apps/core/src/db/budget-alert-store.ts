/**
 * Drizzle implementation of `BudgetAlertStore`: the claim on one reset period
 * of the provider key, so the low-budget mail goes out once per period across
 * restarts and replicas. See `ai/budget-alert.ts`.
 *
 * THE PRIMARY KEY IS THE DECISION. The claim is one insert that does nothing on
 * a conflict, and `RETURNING` says whether this statement wrote the row. Two
 * callers racing for the same period get one row between them.
 */
import { eq } from 'drizzle-orm';
import type { BudgetAlertStore } from '../ai/budget-alert.js';
import type { Database } from './client.js';
import { aiBudgetAlerts } from './schema.js';

export function createDrizzleBudgetAlertStore(db: Database): BudgetAlertStore {
  return {
    async claimPeriod(input: { period: string; now: Date }): Promise<{ claimed: boolean }> {
      const rows = await db
        .insert(aiBudgetAlerts)
        .values({ period: input.period, alertedAt: input.now })
        .onConflictDoNothing({ target: aiBudgetAlerts.period })
        .returning({ period: aiBudgetAlerts.period });
      return { claimed: rows.length > 0 };
    },

    async releasePeriod(input: { period: string }): Promise<void> {
      await db.delete(aiBudgetAlerts).where(eq(aiBudgetAlerts.period, input.period));
    },
  };
}
