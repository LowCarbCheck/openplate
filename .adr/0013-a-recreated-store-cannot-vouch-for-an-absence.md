# 0013 — A recreated store cannot vouch for an absence

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** Altan Sarisin (operator), Fable (architecture review)

## Context

On 2026-09-12 a real account lost its whole diary. The sync baseline lives in
`localStorage` and the diary in IndexedDB. Chromium evicted the second and kept
the first, so `stampSnapshot` compared a full baseline against an empty store
and read every missing entity as a delete. One push emptied the account, and a
second device would have pulled that result.

Two fixes shipped the same day and did not hold. Versions 0.29.1 and 0.29.2
vouched for the store by comparing persisted row counts against memory
(`LocalStoreIntegrity`). The app primes an empty database at boot, in
`initPersistedStore`, before `readLocalSnapshot` probes it, so on the real
start order an evicted device read as healthy with zero rows on both sides.
Any evidence rule that reads the store's own state can be defeated by the
store being recreated first. That is the shape this ADR decides.

The same shape showed up in three more places once we looked: the pass-through
lists `fasts` and `savedMeals`, which have no tombstones and were handed over
verbatim from the local side; the owner private compartment, which a live
session sealed as an empty region and published one lamport above the
account's copy; and the compartment on a resumed session, where "not looked
yet" and "there is none" were the same `null`.

## Decision

A delete is sent only when this device wrote the delete down at the moment it
performed it. Absence is never evidence.

Concretely:

- Every delete verb on a synced table writes a row to `DELETED_ENTITIES_TABLE`
  in the same store transaction as the row removal (`deleteEntity` in
  `primary-store.ts`). This is the delete journal.
- `stampSnapshot` mints a tombstone only for a key the baseline names, the
  snapshot lacks, and the journal holds. A key missing from the journal is
  withheld: it stays out of the wire and out of the baseline, and the account's
  copy is pulled back down.
- Pass-through lists get the same rule against the baseline instead of
  tombstones. The baseline records the ids it agreed to
  (`SyncBaseline.passThrough`), the two delete verbs journal, and a local list
  may shrink the account's list only by journalled ids. Otherwise the account's
  list stands and is imported back.
- The compartment seal is three-valued plus a write flag. `unknown` means not
  looked yet, `absent` means looked and none, `sealed` carries whether this
  session wrote the region or re-emitted the account's bytes, and `held` means
  the region would shrink by a key this device never journalled. A held or
  re-emitted compartment publishes none of this device's removals.
- A journal key is spent only after a cycle in which its delete reached the
  account. Withheld tombstone keys, refused pass-through keys and owner-private
  keys on an unpublished cycle survive the prune.
- A peer's delete applied by the merge bypasses the journal through one
  function with one call site, so a device never claims another device's
  delete.

The server side (ADR-0009 territory, openplate-core 0.14.0) keeps the last
five blob versions, pins the version before any shrink for fourteen days, and
refuses a push that halves the blob unless the client declares it minted or
published a delete that cycle. This is the recovery net, not the rule.

## Alternatives Considered

The M224 spec named four candidate directions. All four were weighed.

1. **The baseline's own entity count as evidence.** Rejected as the primary
   rule. The baseline proves what this device once agreed to, and it does
   carry that record, but a count says nothing about whether a missing entity
   was deleted on purpose or evicted. It is adopted in one place: the
   pass-through lists use the baseline's recorded ids as the set a device must
   account for, with the journal as the account.
2. **Making `had-data.ts`'s marker survive, or mirroring it outside IndexedDB.**
   Rejected. A had-data marker in `localStorage` would say "this device once
   held rows", which is exactly what the baseline already says, and it still
   cannot tell an eviction from a deliberate clear. It is also the same
   inference from absence, one storage medium over.
3. **Gating tombstone eligibility on a completed first sync after recreation.**
   Rejected. It closes the offline-write case but not the ordinary one: a
   device can go from a healthy install straight into eviction and an
   immediate online write, and its first sync after recreation is the one that
   wipes. The disk-versus-memory probe of 0.29.1 was a cousin of this idea and
   it was defeated by the boot-time prime.
4. **Server-side judgement.** Partly adopted, as the net rather than the rule.
   The server cannot decrypt the blob, so it can judge only size. A shrink
   guard with an explicit acknowledgment plus retention and a pre-shrink pin
   makes every wipe reversible. It cannot make one correct, because a device
   that acknowledges a shrink it did not mean still gets through.

A fifth option surfaced during the work and is the one taken: positive
evidence written by the act of deleting. It is the only candidate that does
not infer anything from what is missing.

## Consequences

- A device that loses its local data can never delete anything on the
  account. Its next sync restores the account's copy and says so on screen.
- Every delete verb on a synced table must route through the journal. A new
  table that syncs and gains a delete verb outside `deleteEntity` reopens the
  hole; `tests/unit/delete-journal-single-writer.test.ts` pins the call sites.
- The offline-write case is closed. A recreated store written to before its
  first sync has an empty journal, so its writes are adds and nothing is a
  delete. The one-cycle migration for a baseline without pass-through ids
  reads as untrusted and imports the account's lists once.
- The cost is one extra table and a prune rule that must be reasoned about
  carefully. Two prune rules were blocked in review for spending a key before
  its delete had published. The rule is now: forget only what this cycle
  published.
- What this does not cover: an EDIT made while a sync apply is in flight is
  overwritten by the cycle's copy. Closing it needs a per-row write clock or an
  edit journal and is a separate decision. Two devices that both hold a fast
  ping-pong a deleted one through the blob, because pass-through lists are not
  merged; that is the deferred M132 merge design.

## References

- M224 in the workspace tracker, worklog `M224-rebuilt-store-still-agreed.md`.
- ADR-0009, a compartment carries its kind.
- openplate-core `docs/adr/0009-a-shrinking-blob-is-acknowledged-or-refused.md`.
- Releases 0.29.1 through 0.29.5, all on 2026-09-12 and 2026-09-13.
- `tests/integration/sync-eviction-boot-order.test.ts`, the test that drives
  the real boot order and proved the earlier fixes did not hold.
