/**
 * `node dist/move-accounts.js`: moves accounts from one openplate-core
 * database to another, keeping every password, recovery code and diary.
 *
 * Built into the image beside `dist/server.js` (`scripts/build.ts`), because
 * the real run happens ON the database host, in a throwaway container of the
 * core image, so neither instance's secret leaves that host. The runbook is
 * `docs/operations/move-accounts.md`.
 *
 * ── WHY A MOVE NEEDS THE TARGET TO ADOPT THE SOURCE'S SECRET ────────────────
 * Two things on an account row bind to the instance, and a copy has to respect
 * both (found 2026-09-30, before this tool was built):
 *
 *  1. The password verifier is `HMAC(pepper, authHash)`, and the pepper is a
 *     subkey of `SERVER_SECRET` (`lib/server-secrets.ts`). The server never
 *     holds `authHash`, so no tool can re-key a verifier. The target therefore
 *     SWITCHES TO THE SOURCE'S `SERVER_SECRET`, and verifiers, recovery
 *     verifiers and escrows of moved accounts travel unchanged. The accounts
 *     that already live on the target are re-sealed in the same run: escrow
 *     opened with the old key and sealed with the new one, recovery verifier
 *     recomputed from the escrowed code (`lib/recovery-auth.ts`). Their
 *     password verifier cannot be recomputed, so each needs one mailed reset
 *     after the switch, and the run says so per account.
 *  2. The numeric account id is bound into the AAD of every blob (PROTOCOL.md
 *     §3.2), of the owner-private compartment inside it, of every share wrap
 *     (§3.4) and of every research contribution and pseudonym (§3.5). A new id
 *     makes the diary undecryptable. So IDS ARE KEPT: an account moves only
 *     into a free id with a free address, the target's id sequence is moved
 *     past the source's highest id first, and anything else is refused and
 *     reported, never merged and never remapped.
 *
 * ── WHAT MOVES (the SQL is in `move-accounts/tables.ts`) ────────────────────
 *  - `accounts`: copied byte for byte, id included, EXCEPT the standing, which
 *    the move sets: `free_daily_ai_limit` from `--free-daily-ai-limit`
 *    (the standing free grant, 2026-09-30), `daily_ai_limit` 0, no
 *    `allowance_expires_at`, no scan trial (`trial_scans` and `trial_ends_at`
 *    NULL, `trial_scans_used` 0 because the column is NOT NULL), the label
 *    from `--label`, and `updated_at` now. The health-consent pair is kept:
 *    both instances publish the same consent version.
 *  - `sync_key_records`, `sync_blobs`: the diary and the wraps of its key,
 *    every retained blob version with its `pinned_until`, verbatim.
 *  - `ai_usage_days`: the account's own counter. It keeps the operator's
 *    activity strip whole, and today's row keeps the new daily limit honest
 *    today instead of handing out a second allowance on moving day.
 *  - `feedback_reports`, `feedback_images`: reports the person sent to the
 *    same operator with their consent; erasure already treats them as the
 *    account's. An image follows its report by `(account_id, idempotency_key)`.
 *  - `legal_declarations` linked to the account: a compliance record that must
 *    outlive the source instance. Its UUID is the person's receipt and is kept.
 *    Unlinked rows (`account_id` NULL) stay in the source database's backups.
 *  - `research_withdrawals` of a study account: the purge ledger moves with
 *    the study it instructs.
 *  - `sync_shares`, `research_contributions`: only when BOTH accounts move,
 *    copied with whichever of the two moves second. A row to an account that
 *    stays (the owner, a refused account) is left behind and counted: its wrap
 *    is addressed to a key that account's target twin does not hold.
 *
 * ── WHAT STAYS ON THE SOURCE ────────────────────────────────────────────────
 *  - `account_tokens`, `password_resets`: sessions and mailed links issued to
 *    the source's origin. The person signs in again at the new address.
 *  - `push_subscriptions`: each endpoint was registered by the source origin's
 *    service worker under the source's VAPID key; the device registers again.
 *  - `signup_invites`: the source's door records. Carried over they would
 *    count against the target's member-invite cap and its one-trial rule for
 *    letters the target never sent.
 *  - `ai_trial_intakes`: scan-trial bookkeeping kept 24 hours, and a moved
 *    account has no scan trial.
 *  - `trial_address_hashes`: hashes of deleted accounts under the source's
 *    own `TRIAL_ADDRESS_PEPPER`, linked to no account.
 *  - `ai_instance_days`, `pulse_days`, `instance_settings`: the source
 *    instance's own totals and settings, not any account's.
 *  - `ai_trial_network_days`: today's trial counters per caller network,
 *    keyed under the source's own `TRIAL_ADDRESS_PEPPER`, linked to no
 *    account, and deleted the next day.
 *  - `ai_budget_alerts`: one row per budget reset period for the low-budget
 *    operator mail, instance state about the operator's provider key, not any
 *    account's.
 *  - `pulse_day_contributors`, `pulse_presence`, `pulse_idempotency`: live
 *    pulse bookkeeping for sums that stay on the source; copied, they would
 *    stop a moved person contributing to today's target pulse.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * Dry run unless `--apply`. The source is read in one `READ ONLY` snapshot and
 * never written; a dry run holds the target `READ ONLY` too. `--apply` refuses
 * before its first write unless every escrow proof holds. One target
 * transaction per account, compared after the write (row counts, row digests,
 * and each blob's SHA-256 computed by Postgres on both sides) and rolled back
 * on any difference. A second `--apply` recognises its own work and writes
 * nothing. Output carries ids and counts, never an address in full, a secret,
 * a key or a URL.
 */
import { MOVE_USAGE, parseMoveCommand } from './move-accounts/options.js';
import { runMove } from './move-accounts/run.js';

/** 0: the proofs hold (dry run) or everything planned happened (apply). 1: refused or incomplete. 2: usage. */
async function run(): Promise<number> {
  const command = parseMoveCommand({ argv: process.argv.slice(2), env: process.env });
  if (command.kind === 'help') {
    process.stdout.write(MOVE_USAGE);
    return 0;
  }
  if (command.kind === 'usage-error') {
    process.stderr.write(`move-accounts: ${command.reason}\n\n${MOVE_USAGE}`);
    return 2;
  }
  const result = await runMove({ options: command.options, write: (line) => process.stdout.write(`${line}\n`) });
  return result.status === 'ready' || result.status === 'applied' ? 0 : 1;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await run();
  } catch (cause) {
    // A connection or driver failure. Its message names a host or a SQLSTATE,
    // never a password: the URLs are only ever handed to the driver.
    process.stderr.write(`move-accounts: stopped: ${cause instanceof Error ? cause.message : 'unknown failure'}\n`);
    process.exitCode = 1;
  }
}

await main();
