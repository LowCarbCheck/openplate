/**
 * Which source accounts move, which are refused, and which target accounts
 * stay where they are. Pure: two account lists and a skip list in, a plan out.
 *
 * NEVER MERGED, NEVER REMAPPED. An account moves only into an empty slot: its
 * id free AND its address free on the target. Anything else is reported and
 * left on the source, because the two ways out are both wrong: a merge would
 * join two people's credentials into one row, and a new id would make every
 * blob the account ever wrote undecryptable (PROTOCOL.md §3.2 binds the id into
 * the AAD).
 *
 * A SECOND RUN IS A NO-OP by recognising its own work. A target row with the
 * same id, the same address AND the same `verifier` as a source row is that
 * source row, already moved: the verifier is an HMAC the move copies
 * unchanged, and no independently created account shares it. The owner, whose
 * address exists on both instances as two different accounts, differs in the
 * verifier and is therefore refused as `email-taken`, never mistaken for a
 * moved account.
 */

/** What the plan reads of an account row, on either side. */
export interface AccountIdentity {
  readonly id: number;
  readonly email: string;
  readonly verifier: string;
}

export type SourceDecision =
  /** Id and address are both free on the target. */
  | { readonly kind: 'move'; readonly id: number }
  /** A previous run moved it; nothing to do. */
  | { readonly kind: 'already-moved'; readonly id: number }
  /** Named by `--skip-email`. */
  | { readonly kind: 'skipped-by-flag'; readonly id: number }
  /** The address belongs to a different account on the target. */
  | { readonly kind: 'email-taken'; readonly id: number; readonly targetId: number }
  /** The id belongs to a different account on the target; the account cannot move without a new id. */
  | { readonly kind: 'id-taken'; readonly id: number };

export interface MovePlan {
  /** One decision per source account, ascending by id. */
  readonly decisions: readonly SourceDecision[];
  /**
   * The target's own accounts: every target row that is not a moved source
   * account. Their escrow is re-sealed under the new secret in the same run.
   */
  readonly residentTargetIds: readonly number[];
  /** The source's highest account id; the target's id sequence is moved past it before any insert. */
  readonly highestSourceId: number;
  /** `--skip-email` values that match no source account, a likely typo. */
  readonly unmatchedSkipEmails: readonly string[];
}

function decide(input: {
  account: AccountIdentity;
  targetById: ReadonlyMap<number, AccountIdentity>;
  targetByEmail: ReadonlyMap<string, AccountIdentity>;
  skipEmails: ReadonlySet<string>;
}): SourceDecision {
  const { account } = input;
  if (input.skipEmails.has(account.email)) return { kind: 'skipped-by-flag', id: account.id };

  const sameEmail = input.targetByEmail.get(account.email);
  if (sameEmail !== undefined) {
    const isSameAccount = sameEmail.id === account.id && sameEmail.verifier === account.verifier;
    if (isSameAccount) return { kind: 'already-moved', id: account.id };
    return { kind: 'email-taken', id: account.id, targetId: sameEmail.id };
  }
  if (input.targetById.has(account.id)) return { kind: 'id-taken', id: account.id };
  return { kind: 'move', id: account.id };
}

/** `skipEmails` must already be canonical (`normalizeEmail`), as both account lists are. */
export function planMove(input: {
  source: readonly AccountIdentity[];
  target: readonly AccountIdentity[];
  skipEmails: readonly string[];
}): MovePlan {
  const targetById = new Map(input.target.map((account) => [account.id, account]));
  const targetByEmail = new Map(input.target.map((account) => [account.email, account]));
  const skipEmails = new Set(input.skipEmails);

  const ordered = input.source.toSorted((left, right) => left.id - right.id);
  const decisions = ordered.map((account) => decide({ account, targetById, targetByEmail, skipEmails }));

  const alreadyMovedIds = new Set(decisions.filter((decision) => decision.kind === 'already-moved').map((d) => d.id));
  const residentTargetIds = input.target
    .map((account) => account.id)
    .filter((id) => !alreadyMovedIds.has(id))
    .toSorted((left, right) => left - right);

  const sourceEmails = new Set(input.source.map((account) => account.email));
  return {
    decisions,
    residentTargetIds,
    highestSourceId: ordered.reduce((highest, account) => Math.max(highest, account.id), 0),
    unmatchedSkipEmails: input.skipEmails.filter((email) => !sourceEmails.has(email)),
  };
}
