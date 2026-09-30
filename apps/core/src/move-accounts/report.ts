/**
 * The lines the move prints. Ids and counts only: never an address in full,
 * never a secret, a key, a verifier or a database URL.
 *
 * An address is shown masked, and only where the operator needs to recognise
 * WHICH account a refusal is about (the owner, skipped): its first character
 * and its top-level domain, `o***@***.de`.
 */
import type { SourceDecision } from './plan.js';
import type { SourceEscrowProof } from './escrow-proof.js';
import type { TableCount } from './copy-account.js';

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const first = email.slice(0, 1);
  const domain = at === -1 ? '' : email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const topLevel = dot === -1 ? '' : domain.slice(dot);
  return `${first}***@***${topLevel}`;
}

export function describeDecision(decision: SourceDecision): string {
  switch (decision.kind) {
    case 'move':
      return 'moves';
    case 'already-moved':
      return 'already on the target from an earlier run, nothing to do';
    case 'skipped-by-flag':
      return 'skipped (--skip-email)';
    case 'email-taken':
      return `refused: the address belongs to target account ${decision.targetId}`;
    case 'id-taken':
      return 'refused: the id is taken by a different target account, and a new id would make its diary undecryptable';
  }
}

/** Short names for the tables in a count line, in copy order. */
const TABLE_LABELS = new Map<string, string>([
  ['accounts', 'account row'],
  ['sync_key_records', 'key records'],
  ['sync_blobs', 'blobs'],
  ['ai_usage_days', 'ai usage days'],
  ['feedback_reports', 'feedback reports'],
  ['feedback_images', 'feedback images'],
  ['legal_declarations', 'legal declarations'],
  ['research_withdrawals', 'research withdrawals'],
  ['sync_shares', 'shares'],
  ['research_contributions', 'contributions'],
]);

export function formatCounts(counts: readonly TableCount[]): string {
  return counts.map((count) => `${TABLE_LABELS.get(count.table) ?? count.table} ${count.rows}`).join(', ');
}

export function formatLeftBehind(counts: readonly TableCount[]): string {
  const nonZero = counts.filter((count) => count.rows > 0);
  if (nonZero.length === 0) return '';
  return `; left on the source because the other account does not move: ${formatCounts(nonZero)}`;
}

/** The escrow half of a moving account's plan line, or nothing for an account that does not move. */
export function describeSourceProof(proof: SourceEscrowProof | undefined): string {
  if (proof?.kind !== 'opens') return '';
  const verifier = proof.recoveryVerifierMatches
    ? 'recovery verifier matches'
    : 'recovery verifier does NOT match the code (copied as it is)';
  return `; escrow opens under SOURCE_SERVER_SECRET, ${verifier}`;
}
