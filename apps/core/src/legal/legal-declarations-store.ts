/**
 * The only module that writes `legal_declarations`.
 *
 * TWO WRITES, NEVER ONE STATEMENT. `create` is the persist-first step
 * `server/legal-declarations.ts` calls before it does anything else; the row
 * exists, with `forwarded_at` and `forward_error` both `null`, the instant
 * this resolves. `recordForwardOutcome` is a SEPARATE later write that only
 * ever touches those two columns, because the forward to the biller is
 * best-effort work that must never be allowed to make the persisted row
 * disappear if it throws.
 */
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { legalDeclarations, type SelectLegalDeclaration } from '../db/schema.js';
import type { InstanceLanguage } from '../protocol.js';

export interface CreateLegalDeclarationInput {
  id: string;
  kind: 'kuendigung' | 'widerruf';
  name: string;
  email: string;
  contractReference: string | null;
  terminationType: 'ordentlich' | 'ausserordentlich' | null;
  reason: string | null;
  requestedDate: string | null;
  timing: 'earliest' | 'onDate' | null;
  language: InstanceLanguage;
  receivedAt: Date;
  accountId: number | null;
}

/** Either the forward succeeded (`forwardedAt` is when) or it did not (`forwardError` says why). Never both, never neither. */
export type ForwardOutcome = { ok: true; forwardedAt: Date } | { ok: false; forwardError: string };

export interface LegalDeclarationsStore {
  create(input: CreateLegalDeclarationInput): Promise<SelectLegalDeclaration>;
  recordForwardOutcome(input: { id: string; outcome: ForwardOutcome }): Promise<void>;
  /**
   * How many declarations were received after `since` whose typed address
   * normalises to `normalizedEmail`. Each of them mailed a receipt to that
   * mailbox, so this is the per-recipient count the receipt cap reads
   * (`server/legal-declarations.ts`).
   *
   * COUNTED FROM THE ROWS, not from a counter in memory, so a restart or a
   * second container cannot reset it.
   */
  countReceivedFor(input: { normalizedEmail: string; since: Date }): Promise<number>;
  /**
   * How many declarations were received after `since`, from anybody to
   * anybody: the instance-wide receipt ceiling's count (M270/11). Every
   * declaration COULD have mailed a receipt, so this is an upper bound on the
   * receipts sent, and a skipped receipt still counts. That errs towards
   * fewer letters, which is the side the ceiling exists to err on.
   */
  countReceivedSince(input: { since: Date }): Promise<number>;
  /**
   * Deletes every declaration received before `before`, and answers how many
   * went. The retention half of this table (`legal/legal-declarations-retention.ts`),
   * driven by the hourly usage sweep. Idempotent: the predicate is an instant.
   */
  purgeReceivedBefore(input: { before: Date }): Promise<number>;
}

export function createDrizzleLegalDeclarationsStore(db: Database): LegalDeclarationsStore {
  return {
    async create(input: CreateLegalDeclarationInput): Promise<SelectLegalDeclaration> {
      const [row] = await db.insert(legalDeclarations).values(input).returning();
      if (row === undefined) {
        throw new Error(`insert of legal declaration ${input.id} returned no row`);
      }
      return row;
    },

    async recordForwardOutcome(input: { id: string; outcome: ForwardOutcome }): Promise<void> {
      await db
        .update(legalDeclarations)
        .set(
          input.outcome.ok
            ? { forwardedAt: input.outcome.forwardedAt, forwardError: null }
            : { forwardedAt: null, forwardError: input.outcome.forwardError },
        )
        .where(eq(legalDeclarations.id, input.id));
    },

    async countReceivedFor(input: { normalizedEmail: string; since: Date }): Promise<number> {
      // `normalize(..., NFKC)` then `lower(...)` is `normalizeEmail` in SQL.
      // The column is stored trimmed, so the trim needs no counterpart here.
      const [row] = await db
        .select({ total: count() })
        .from(legalDeclarations)
        .where(
          and(
            gt(legalDeclarations.receivedAt, input.since),
            eq(sql`lower(normalize(${legalDeclarations.email}, NFKC))`, input.normalizedEmail),
          ),
        );
      return row?.total ?? 0;
    },

    async countReceivedSince(input: { since: Date }): Promise<number> {
      const [row] = await db
        .select({ total: count() })
        .from(legalDeclarations)
        .where(gt(legalDeclarations.receivedAt, input.since));
      return row?.total ?? 0;
    },

    async purgeReceivedBefore(input: { before: Date }): Promise<number> {
      const deleted = await db
        .delete(legalDeclarations)
        .where(lt(legalDeclarations.receivedAt, input.before))
        .returning({ id: legalDeclarations.id });
      return deleted.length;
    },
  };
}
