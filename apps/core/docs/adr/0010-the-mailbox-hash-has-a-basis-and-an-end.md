# ADR-0010: The mailbox hash has a basis and an end

- **Status:** proposed, waiting for the owner's sign-off. The legal basis has NOT been reviewed by a lawyer.
- **Date:** 2026-10-05
- **Amends:** the sentence in `PROTOCOL.md` §5.15 that says the hash is kept, and §9.2

## Context

An instance that gives new accounts free AI scans (`TRIAL_SCANS`) has to stop
one person from collecting those scans again and again with one mailbox. The
rule is "one mailbox, one trial, ever". When an account that held a trial is
deleted, the rule still has to recognise its mailbox, so the service keeps one
thing about the deleted person: a keyed one-way hash of the mailbox in
`trial_address_hashes`.

Until now that row had no end. The table held one column, `hash`, with no date,
so nothing could expire it, and the privacy text said only that it is kept "as
long as the instance offers free scans". That is not a period. Under the GDPR a
keyed hash of an address is still personal data, because whoever holds the key
can compute the hash of any address and match it. A retained data point needs a
named purpose, a legal basis and an end.

## Decision

Keep the hash, state why, and delete it after a fixed period.

### What the hash is

`HMAC-SHA256(TRIAL_ADDRESS_PEPPER, trial key of the mailbox)`, as 64 hex
characters (`accounts/trial-address.ts`). The trial key folds the spellings of
one mailbox into one string (a `+tag`, Gmail dots), so a person cannot get a
second trial by writing their address another way. The row holds the hash and
the instant the account was deleted (`created_at`). It holds no name, no
address, no account id and no reference to anything. It is written in the
transaction that deletes the account, only when the account held a scan trial,
only on an instance with the pepper, and, since this ADR, only on an instance
that still grants a scan trial.

### The basis

Article 6(1)(f) GDPR, a legitimate interest: preventing abuse of the free
scans, which cost the operator real money per request.

The balance test, as written down by the engineer and not reviewed by a lawyer:

- **Purpose.** Refusing a second free trial to a mailbox that already had one.
  The cost of not doing it is a provider bill paid by whoever hosts the
  instance, for requests nobody agreed to pay for.
- **Necessity.** The rule needs to recognise a mailbox after the account is
  gone, so something must be kept. What is kept is the smallest thing that does
  it: a keyed hash and not the address. Without the operator's secret the table
  cannot be matched against a list of addresses, and it links to nothing else.
  Nothing is kept for a person whose account never held a trial.
- **Balance.** The person loses nothing they were promised: they got their
  scans, and they deleted their account. What they carry is a hash that only the
  operator can match, for a stated period, to be refused a second helping of a
  free offer. The data is not used for anything else, is not shared, and ends.
- **Expectation.** The privacy text says it, in the retention table written in
  M3, with the period from this ADR.

An open point for a lawyer: whether the balance holds on an instance that
promotes the free scans widely, because the number of people carrying a hash
grows with it.

### The end

`TRIAL_HASH_RETENTION_DAYS`, default **365**, counted from the deletion. The
hourly sweep that already scrubs finished invitations deletes every row whose
`created_at` is older (`db/trial-hash-retention.ts`). One year is the proposal
from the tracker; the number is a setting so the owner can change it without a
release, from 1 to 3650 days.

A row that existed before the column was added got the migration's instant as
its `created_at`, so its year starts at that migration, not at the deletion it
records. That makes those rows live up to a year longer than a new row would.
It is the honest limit of what the table knew.

### What the end costs

When the hash is gone the same mailbox can have a trial again. That is the price
of an end date and it is accepted: a person who waits a year for a handful of
free scans is not the abuse the rule is for.

### Pepper rotation

Changing `TRIAL_ADDRESS_PEPPER` makes every stored hash stop matching, at once.
It is a blunt tool for an emergency, such as a leaked pepper, and it forgets
every mailbox, including the ones the rule should still hold. It is NOT the end
of life of a row. The sweep is. Rotating the pepper is also not a substitute for
the sweep: the old hashes stay in the table, unreadable but present, until the
sweep deletes them.

### An instance with no scan trial keeps nothing

An instance that does not grant a scan trial (for example one that uses
`DEFAULT_FREE_DAILY_AI_LIMIT` instead) has nothing for a hash to refuse, so a
deletion on it writes no hash. The address is still scrubbed from the invitation
rows. Hashes written while the trial ran are deleted by the same sweep when
their year is over, and the sweep runs on every instance for exactly that reason.

## Consequences

- One migration adds `trial_address_hashes.created_at`.
- One new setting, `TRIAL_HASH_RETENTION_DAYS`, in every compose file and in
  the environment page.
- The privacy text names the period. The wording is written in the retention
  table work (M3), and this ADR supplies the basis, the period and what the
  hash is.
- A person who asks to have the hash deleted before its year is over cannot be
  found by name, because the row has none. With their address the operator can
  compute the hash and delete the row. There is no tool for that yet, and it
  should be written if the first such request arrives.
- If the owner decides to drop the scan trial for good, the table and the rule
  that reads it can be removed instead. Until that decision this ADR stands.
