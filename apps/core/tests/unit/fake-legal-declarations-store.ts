/**
 * `legal_declarations`, in memory.
 *
 * EVERY CALL IS RECORDED, IN ORDER, in one array shared between `create` and
 * `recordForwardOutcome`: that is what lets a test prove the persist happened
 * before the forward, by reading `calls` and asserting `'create'` precedes
 * `'recordForwardOutcome'`, rather than trusting the handler's own comments.
 */
import type {
  CreateLegalDeclarationInput,
  ForwardOutcome,
  LegalDeclarationsStore,
} from '../../src/legal/legal-declarations-store.js';
import type { SelectLegalDeclaration } from '../../src/db/schema.js';
import { normalizeEmail } from '../../src/lib/verifier.js';

export type RecordedLegalDeclarationsCall =
  | { kind: 'create'; input: CreateLegalDeclarationInput }
  | { kind: 'recordForwardOutcome'; id: string; outcome: ForwardOutcome };

export interface FakeLegalDeclarationsStore extends LegalDeclarationsStore {
  calls: RecordedLegalDeclarationsCall[];
  rows: Map<string, SelectLegalDeclaration>;
}

function toRow(input: CreateLegalDeclarationInput): SelectLegalDeclaration {
  return { ...input, forwardedAt: null, forwardError: null };
}

export function createFakeLegalDeclarationsStore(): FakeLegalDeclarationsStore {
  const calls: RecordedLegalDeclarationsCall[] = [];
  const rows = new Map<string, SelectLegalDeclaration>();

  return {
    calls,
    rows,
    async create(input: CreateLegalDeclarationInput): Promise<SelectLegalDeclaration> {
      calls.push({ kind: 'create', input });
      const row = toRow(input);
      rows.set(input.id, row);
      return row;
    },
    async recordForwardOutcome(input: { id: string; outcome: ForwardOutcome }): Promise<void> {
      calls.push({ kind: 'recordForwardOutcome', id: input.id, outcome: input.outcome });
      const existing = rows.get(input.id);
      if (existing === undefined) return;
      rows.set(
        input.id,
        input.outcome.ok
          ? { ...existing, forwardedAt: input.outcome.forwardedAt, forwardError: null }
          : { ...existing, forwardedAt: null, forwardError: input.outcome.forwardError },
      );
    },
    async countReceivedFor(input: { normalizedEmail: string; since: Date }): Promise<number> {
      let total = 0;
      for (const row of rows.values()) {
        if (row.receivedAt.getTime() <= input.since.getTime()) continue;
        if (normalizeEmail(row.email) === input.normalizedEmail) total += 1;
      }
      return total;
    },
    async countReceivedSince(input: { since: Date }): Promise<number> {
      let total = 0;
      for (const row of rows.values()) {
        if (row.receivedAt.getTime() > input.since.getTime()) total += 1;
      }
      return total;
    },
    async purgeReceivedBefore(input: { before: Date }): Promise<number> {
      let deleted = 0;
      for (const [id, row] of rows) {
        if (row.receivedAt.getTime() >= input.before.getTime()) continue;
        rows.delete(id);
        deleted += 1;
      }
      return deleted;
    },
  };
}
