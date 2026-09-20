# 0014, fasts are a merged entity, and the merge adjudicates nothing

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** Altan Sarisin (operator)
- **Spec:** `M240/01`, "Fasts do not travel between devices"

## Context

Fasting shipped in M132 with the fast deliberately left off the sync engine.
`app/lib/local-store/schema.ts` said so in the `fasts` field's own doc comment
("NOT merged across devices by the E2EE sync engine"), `mergeSnapshots` handed
the local list straight back, `flattenSnapshot` never stamped a fast, and
`canonicalize` did not read the collection at all, so a fast starting or ending
was not even a reason to write a blob version. A fast round-tripped through the
JSON backup and nothing else.

The reason was one hard question, and the code named it: "at most one open
fast" is a genuinely hard cross-device question, because two phones each
holding a running fast have two truthful answers, and a plain last-writer-wins
merge would answer it by picking one and writing a duration nobody declared
into the other's history. M132 chose to defer rather than get that wrong.

Three things have changed since.

1. **The deferral has a price a person pays.** A fast lives on exactly one
   device. Erase that device, lose it, or open the app on a new tablet, and the
   fasting history is gone. It is the only diary collection with a delete verb,
   a Lamport-stampable shape and a real history value that does not travel.
2. **The routine beside it is merged.** The fasting rework added
   `LocalFastingSettings`, a singleton that IS stamped and merged, so one
   feature answers the same question two ways: a person's window follows them
   between devices and the fasts run under it do not.
3. **M235/03 built the precedent.** Activity marks and awards became merged
   entities through a private `DELETABLE_MERGED_ENTITY_TYPE_BY_TABLE` map that
   both exported maps spread, with no change to the merge engine at all. Adding
   a merged type is now a known, small edit.

## Decision

**A fast is an ordinary merged sync entity.** `FASTS_TABLE` is in
`DELETABLE_MERGED_ENTITY_TYPE_BY_TABLE`, so it is in `SYNC_ENTITY_TYPE_BY_TABLE`
and in `DELETE_JOURNAL_TAG_BY_TABLE` through the same spread. `SYNC_ENTITY_TYPES`
gains `fast`, `flattenSnapshot` emits one entity per fast keyed by its own
client-generated id, `toCandidateMap` therefore stamps and merges it, and
`canonicalize` compares the list so a fast that changed makes the device push.
Conflict resolution is whole-record last-writer-wins by `(lamport, deviceId)`,
exactly like a food log. A delete is journalled by `deleteLocalFast`, minted as
a tombstone by `stampSnapshot`, and applied on the peer by
`applyMergedSnapshot` through `removeEntitiesWithoutJournal`'s new `fastIds`.
`decidePassThrough` no longer sees fasts; it survives for `savedMeals`, which
is still passed through.

**Nothing adjudicates two open fasts, and that is a decision, not an
omission.** `createLocalFast` refuses a second open fast on ONE device. Two
devices offline can still each start one, and after this change both survive,
on both devices. `mergeSnapshots` has no rule about it and must not grow one.

### Why the merge answers nothing, and the screen answers everything

The app has had an answer since M132, for the backup restore that produces the
same state. `selectCurrentFast` (`app/models/fasting.ts`) shows the
LATEST-started open fast as current; `selectFastHistory` renders the other one,
and `FastHistoryRow` (`app/routes/fasting.tsx`) draws it as "Still open" with a
Remove action. The comment on `selectCurrentFast` states the principle in one
line: "nothing is fabricated, nothing is silently dropped, and the person can
clean it up". `models/fasting-stats.ts` already sums two overlapping fasts
rather than picking one, under the same reasoning.

A merge-time resolution would break that principle three ways:

- it deletes a row the person can see and could have removed themselves;
- whichever end of the order it picked, it drops one of two truthful records;
- and the earliest-start version of the rule drops the fast the screen calls
  CURRENT, so the running timer would change under the person on a sync.

The resolution the person makes is a `deleteLocalFast`, which journals, mints a
tombstone and travels like every other delete. So the state is temporary, it is
visible, and it is resolved by the one party who knows which fast was real.

### Why the merge converges anyway

Convergence needs no rule, because there is none. `mergeEntityMaps` is
deterministic and symmetric, so both devices derive the same merged set from
the same pair of payloads whichever side each one passes as `local`. Both then
hold the same two rows, and `selectCurrentFast` is a pure function of the list,
so both name the same fast as current with nothing coordinating them. The pair
goes quiet after one exchange.

`tests/unit/sync-fasts-merged.test.ts` proves both merge orders produce a
byte-identical payload and that both sides agree on the current fast;
`tests/integration/fasts-cross-device-sync.test.ts` proves it again over the
real store, the real orchestrator and a real encrypted envelope, proves a
Remove on one device reaches the other, and proves four further cycles write no
blob version.

### Compatibility with 0.35.1, and no version moves

**Neither `SCHEMA_VERSION` nor `STATE_FORMAT_VERSION` moves.** `SCHEMA_VERSION`
versions the ENTITY SHAPES a backup envelope carries and a peer's blob is
migrated against. `LocalFast` is unchanged and `fasts` has been a required key
on `LocalStoreSnapshot` since v7, so there is nothing to migrate. A bump would
also be actively harmful: `decryptWithSchemaProbe` walks DOWN from this build's
`SCHEMA_VERSION` to guess the AAD, so a device still on 0.35.1 could no longer
decrypt its own account's blob at all. That is a hard cut, and this change does
not need one. `STATE_FORMAT_VERSION` stays for the reason the M226 comment in
`sync-state.ts` gives: rejecting an old state discards the baseline and the
tombstones with it.

**What 0.35.1 does with a payload carrying fast stamps it does not know.**
Nothing, and nothing harmful. `toCandidateMap` builds candidates from
`flattenSnapshot(payload.snapshot)` and from `payload.meta.tombstones`; 0.35.1's
`flattenSnapshot` emits no fast, so a `fast:x` key in `meta.perEntity` is never
looked up. A `fast:x` TOMBSTONE is carried through, because that loop reads
every tombstone in the payload, so a delete is not lost on the way past an old
device.

**What 0.35.1 republishes.** Its `mergeSnapshots` builds `meta.perEntity` inside
the loop over merged candidates, so an old device STRIPS every `fast:*` stamp;
and its `fasts` comes from `decidePassThrough`, so the list it sends is its own,
which on a device that never started a fast is empty. Read naively, that blob
says "the account has no fasts and never stamped one".

**And a new device reads it as neither a deletion nor a loss**, under ADR-0013's
existing rule rather than anything new. Only `stampSnapshot` mints a new
tombstone, and `isTombstoneTrusted` requires this device's own delete-journal
row plus a trusted table; the remote payload's silence authorises nothing. So a
device whose baseline names two fasts keeps both, re-publishes them with their
stamps, and the account recovers. In the other direction, a fast an old device
passed through arrives with the default stamp 0, which loses to anything that
ever carried a real stamp and still beats nothing at all, so a person can
upgrade one device and keep the other's history. Both directions are pinned in
`tests/integration/fasts-cross-device-sync.test.ts`.

### Measured, not reasoned: what 0.35.1 actually does (M240 counsel item 7)

Everything above was written from a reading of the old code. It was then RUN.
A worktree at tag `v0.35.1` with its own `node_modules` was used twice.

**Direction one, an old payload into this engine.** The 0.35.1 engine's own
`stampSnapshot` and `mergeSnapshots` published a payload for a small fixed
diary; it is frozen at `tests/fixtures/sync-payload-v0.35.1.json` and driven
through the real store by `tests/integration/old-release-payload.test.ts`. The
file confirms the shape the argument assumed: fasts, pantry rows and saved
meals present in the snapshot, `meta.perEntity` holding ONE key
(`foodLog:log-kept`) and no stamp for any of them, and a real tombstone for the
food log the old device deleted. This build adopts all of it, buries the
tombstoned row and keeps its own rows beside it.

**Direction two, a payload this engine wrote into the 0.35.1 merge.** Run once,
in the old worktree, over a payload carrying a stamped fast, a stamped pantry
row, a saved meal, a food log and a tombstone. Measured result:

- **It does not crash.** The merge completes normally.
- **It keeps what it understands.** `foodLog:log-keep` survives with its stamp,
  and the `foodLog:log-deleted` tombstone is carried through, so a delete this
  build published is not undone by an old device passing it on.
- **It drops the rest from the blob it republishes.** Its output holds no
  fasts, no pantry rows and no saved meals, because it takes those lists from
  its own local side, and it strips every `fast:*` and `pantryItem:*` key from
  `meta.perEntity`.

So an old device in the mix BLANKS those collections on the account until an
upgraded device's next cycle puts them back, which it does, because the
upgraded device still holds the rows and the old device published no tombstone
for any of them. The window is one cycle wide and nothing is lost on a device.
It is still a real cost, and it is why the release notes tell people to update
every device rather than leaving it to be discovered.

**First sync after upgrade.** Existing local fasts have no stamps, and they are
stamped the way every merged row is stamped on a first sync: `stampSnapshot`
finds no `perEntity` entry for `fast:x`, computes a content hash, and writes
`{ lamport: 1, deviceId: <this device> }`. `canonicalize` now reads the list, so
that cycle is a difference and the device pushes. One cycle, no migration step,
no backfill.

**Erase.** Unchanged, and it has to stay that way: `eraseDeviceData` removes the
sync baseline in the same act as the rows, so the next sign-in stamps an empty
snapshot against an empty baseline, mints no tombstone for anything, and adopts
the account's fasts through the ordinary apply. Proved in
`tests/integration/fasts-cross-device-sync.test.ts` with the recorded-deletion
control beside it.

## Alternatives Considered

- **Keep the pass-through (accept M132's stance as final).** Rejected. It is the
  status quo and its cost is that a fast lives on one device, so an erase, a
  lost phone or a new tablet loses the history while the routine beside it syncs
  perfectly.
- **Delete the EARLIER open fast in the merge (keep the latest).** Rejected. It
  silently drops a truthful record of something the person did, and it is the
  row that carries the most real elapsed time.
- **Delete the LATER open fast in the merge (keep the earliest).** Rejected for
  the same silent drop, and worse: `selectCurrentFast` shows the latest as
  CURRENT, so this deletes the running timer the person is looking at. This was
  the first draft of M240/01 and it was reversed before the milestone shipped.
- **End the losing fast instead of deleting it.** Rejected. It writes a duration
  nobody declared into somebody's history, which is precisely the objection that
  made M132 defer the merge in the first place.

All three contradict text the codebase already carries: `selectCurrentFast`'s
"nothing is fabricated, nothing is silently dropped, and the person can clean it
up", and `fasting-stats.ts`'s "OVERLAPPING FASTS ARE COUNTED TWICE, ON
PURPOSE".
- **A per-fast merge with field-level resolution.** Rejected. Whole-record
  last-writer-wins is `PROTOCOL.md` §3.3's accepted trade-off for every other
  merged entity, and a fast is edited in one or two acts (end it, write a mood
  and a note), so a field-level merge would add a mechanism for a race nobody
  has.
- **Bump `SCHEMA_VERSION` so an old build cannot read the blob.** Rejected. It
  locks every device still on 0.35.1 out of its own account, over a change with
  no entity-shape migration behind it, and the compatibility analysis above
  shows the old build loses nobody a fast.

## Consequences

- A fast follows a person between devices, and a deletion follows it. The
  fasting feature now answers the sync question one way instead of two.
- Starting, ending or deleting a fast writes a blob version by itself. That is
  new traffic for a collection that used to be free, bounded by how often a
  person starts or ends a fast, which is once or twice a day.
- Two devices that each started a fast while offline end up showing two open
  fasts on both of them, the newest as current and the other in history as
  "Still open" with a Remove. That state was reachable before only through a
  backup restore; a sync is now a second way in, and the UI, the stats and the
  Remove action all already handle it. Nothing new was built for it.
- A device receiving a fast by sync does NOT arm its own fast-target push
  notification. `syncFastWakeAt` runs only from `/fasting`'s own actions, and
  `setFastWakeAt` patches this device's push subscription, so the notification
  stays on the device where the fast was started until the other one is used.
  Not a defect of this change, and arming it on a second device is a product
  question, not a sync one.
- `SyncBaseline.passThrough` narrows to `{ savedMeals }`. Zod strips the stale
  `fasts` key, so a state written by 0.35.1 parses whole on this build. A device
  ROLLED BACK to 0.35.1 or older fails that parse once, falls back to
  `emptySyncState()` and re-pushes in full; no diary row is lost, because the
  blob carries both the rows and the tombstones and the device pulls them back.
- While an account has one device on 0.35.1 and one on this build, the account's
  fasts list flip-flops: the old device republishes its own list and strips the
  stamps, and the new device puts its fasts back on the next cycle. Nothing is
  lost on the new device, and the churn ends when both are upgraded.
- `savedMeals` is now the only id-bearing diary collection still passed through
  with a `decidePassThrough` guard, and `pantryItems` the only one passed through
  with no guard at all. The saved-meals merge stays the smaller, lower-risk
  follow-up it always was.
- `countRestoredEntities` counts a restored fast from its withheld tombstone
  rather than from a refused table, so the heal notice a person reads is
  unchanged while the evidence behind it moved.

## References

- `M240/01` in the workspace tracker,
  `.tracker/M240-sync-device-reach/01-fasts-do-not-travel-between-devices.md`.
- ADR-0013, a recreated store cannot vouch for an absence, whose rule is what
  makes the compatibility analysis above hold with no new mechanism.
- M235/03 (`989608b`), activity marks and awards, the precedent for adding a
  merged entity type.
- M132, the fasting feature that deferred this question, and the fasting rework
  that merged the routine beside it.
- `tests/unit/sync-fasts-merged.test.ts` and
  `tests/integration/fasts-cross-device-sync.test.ts`.
