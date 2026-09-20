# 0015, the pantry is a merged entity, reversing M233/02

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** Altan Sarisin (operator)
- **Spec:** `M240/02`

## Context

M233/02 built the pantry and decided, explicitly and at length, that it should
not sync. The `NOTE (M233/02, the pantry)` block in
`app/lib/local-store/schema.ts` carried the argument:

> The journal exists to tell a list somebody EMPTIED from a list a browser
> EVICTED, and it earns that cost where the thing lost is a record of something
> that happened: a fast somebody kept, a meal they named and bundled. A pantry
> is a WORKING LIST of what is in the fridge this week. It is rewritten
> wholesale every time somebody photographs a shelf, it is stale within days by
> its own nature, and the worst case of losing the distinction is that a peer's
> older list comes back and the person photographs the shelf again.

So `pantryItems` was passed through from the local side with no
`decidePassThrough` guard at all, it was absent from `SYNC_ENTITY_TYPE_BY_TABLE`
AND from `DELETE_JOURNAL_TAG_BY_TABLE`, and `canonicalize` did not read it, so
photographing a shelf did not even make the device push. It was the only
id-bearing diary collection with no evidence of any kind behind its removals.

The owner overruled it. A shopping list that is only on the phone you left at
home is not a shopping list. Somebody photographs a fridge on a tablet and
cooks from a phone, or stands in a supermarket with the wrong device in their
hand, and a device-local answer fails both. M240/01 having merged fasts one
milestone earlier also changes the shape of the objection: the delete journal
and the tombstone machinery are now the ordinary path for a diary collection,
not an exception earned by importance.

## Decision

**The pantry is an ordinary merged sync entity, on exactly the terms fasts got
in ADR-0014.** `PANTRY_ITEMS_TABLE` is in
`DELETABLE_MERGED_ENTITY_TYPE_BY_TABLE`, so it is in `SYNC_ENTITY_TYPE_BY_TABLE`
and in `DELETE_JOURNAL_TAG_BY_TABLE` through the same spread.
`SYNC_ENTITY_TYPES` gains `pantryItem`, `flattenSnapshot` emits one entity per
row keyed by its own client-generated id, `toCandidateMap` stamps and merges it,
and `canonicalize` compares the list so a photographed shelf pushes on its own.
Conflict resolution is whole-record last-writer-wins by `(lamport, deviceId)`.
`applyMergedSnapshot` gains a `survivingPantry` set feeding
`removeEntitiesWithoutJournal`'s new `pantryItemIds`.

**Two shelves do not fight.** Two devices that each photographed a fridge wrote
two different sets of row ids, so `mergeEntityMaps` keeps both and the person
sees one combined list they can edit down. That is the same thing they already
do when they photograph the same fridge twice on one device; `mergePantry`
reconciles two CAPTURES by name, this merges two DEVICES by row id, and the two
never meet, because a row that arrived by sync is an ordinary stored row by the
time the next capture is reconciled against it.

### Every path that removes a pantry row, and what it does now

Found by grepping every reference to `PANTRY_ITEMS_TABLE` and every caller of a
pantry verb outside the store.

| Path | Who calls it | Before | Now |
|---|---|---|---|
| `replaceLocalPantry` reconcile (`primary-store.ts`) | `app/routes/pantry.tsx:530`, the ONE write the screen performs, for a list edit, a photo capture and a typed capture alike | bare `delRow` per dropped row inside one transaction, no journal | `deleteEntity` per dropped row inside the same transaction, which journals |
| `deleteLocalPantryItem` (`primary-store.ts`) | no caller in `app/` today; exported on the barrel | `deleteEntity` on a table absent from the journal map, so no row written | unchanged code, and it journals now because the table entered the map |
| `removeEntitiesWithoutJournal` (`primary-store.ts`) | `applyMergedSnapshot` only, pinned to one call site by `tests/unit/delete-journal-single-writer.test.ts` | had no pantry ids at all | gains `pantryItemIds`, deliberately UNjournalled, because those rows were removed by a peer |
| `importSnapshot` (`backup.ts:903`) | a backup restore and every sync apply | `putLocalPantryItem` upsert only, removes nothing | unchanged, and correct: a restore is non-destructive and the apply's removals are done before it |

There is no consume-on-log path. Recipes read the pantry to size a suggestion
and never write it; `git grep` finds no removal outside the four rows above.

`replaceLocalPantry` is the one that matters. `/pantry` performs EVERY removal a
person makes through it, so a reconcile that skipped the journal would be a
pantry a merged device could never shrink: the account's copy would come back on
every pull, forever.

### What is NOT in the synced record

Nothing was excluded, because `LocalPantryItem` carries nothing that has to stay
on the device: an id, the person's own name for the item, an amount, a unit, a
category, how the row arrived (`'photo' | 'text' | 'manual'`) and two
timestamps. **No image bytes.** The fridge photograph is read in the browser,
sent straight to the person's own AI provider and never stored, under the same
rule that keeps plate photos out of every export and every sync payload. What
lands in the store is the ingredient list the person confirmed, which is the
same class of fact as a meal they typed.

`SNAPSHOT_KEY_REGIONS` keeps `pantryItems: 'shared'` unchanged. That key decides
DISCLOSURE, never merge: a clinician holding a grant reading "eggs, butter,
spinach" is reading the same class of fact as the diary she was granted.

### Compatibility with 0.35.1, and no version moves

**Neither `SCHEMA_VERSION` nor `STATE_FORMAT_VERSION` moves**, for ADR-0014's
reasons exactly. `LocalPantryItem` is unchanged and `pantryItems` has been a
required `LocalStoreSnapshot` key since v22, so there is nothing to migrate, and
`decryptWithSchemaProbe` walks DOWN from this build's `SCHEMA_VERSION`, so a
bump would stop a 0.35.1 device decrypting its own account's blob.

**What 0.35.1 does with a payload carrying pantry stamps it does not know.**
Nothing. `toCandidateMap` builds candidates from
`flattenSnapshot(payload.snapshot)` and `payload.meta.tombstones`; 0.35.1's
`flattenSnapshot` emits no pantry row, so a `pantryItem:x` key in `perEntity` is
never looked up. A `pantryItem:x` TOMBSTONE IS carried through, so a removal
survives a trip past an old device.

**What 0.35.1 republishes.** Its `meta.perEntity` is built inside the
merged-candidate loop, so it strips every `pantryItem:*` stamp; and its
`pantryItems` came straight off its own local side with no guard, so the list it
sends is its own, which on a device that never photographed a shelf is empty.

**And a new device reads that as neither a removal nor a loss**, under ADR-0013
and nothing new: only `stampSnapshot` mints a tombstone, and
`isTombstoneTrusted` requires this device's own journal row plus a trusted
table. In the other direction, a shelf an old device passed through arrives with
the default stamp 0, which loses to any real stamp and beats nothing at all.
Both directions are pinned in
`tests/integration/pantry-cross-device-sync.test.ts`.

**First sync after upgrade.** Existing local pantry rows have no stamps, and
`stampSnapshot` gives each `{ lamport: 1, deviceId: <this device> }` on the next
cycle; `canonicalize` now reads the list, so that cycle is a difference and the
device pushes. One cycle, no backfill.

**An evicted or recreated store.** Its rows and its journal die together, so it
mints no tombstone, the account's shelf survives the merge, and the apply writes
it back. This is strictly better than the pass-through it replaces, which kept
the emptiness. Pinned as its own case, with the recorded-removal control beside
it.

**Erase.** `eraseDeviceData` takes the baseline with the rows, so the next
sign-in stamps an empty snapshot against an empty baseline and adopts the
account's shelf.

## Alternatives Considered

- **Keep M233/02's device-local pantry.** Rejected by the owner. It is the
  status quo and its cost is the shopping list on the wrong device.
- **Sync the pantry without a delete journal.** Rejected, and it is not
  available: without journalled removals an evicted store and a person who
  emptied their fridge are the same act, and ADR-0013 would refuse both, so the
  account's shelf would come back on every pull and nothing could ever be
  removed.
- **Journal only `deleteLocalPantryItem` and leave `replaceLocalPantry`
  bare.** Rejected. It is the cheaper edit and it covers no real path:
  `/pantry` performs every removal through the whole-list reconcile, and
  `deleteLocalPantryItem` has no caller in the app at all.
- **A pass-through with `decidePassThrough`, like saved meals.** Rejected. It
  still needs the journal, so it costs the same, and it buys less: the whole
  list would be one device's answer rather than the union of two shelves.

## Consequences

- The pantry follows the person. Photographing a shelf on one device puts it on
  the other, and an edit or a removal travels.
- Photographing a shelf now writes a blob version. That is new traffic for a
  collection that used to be free, bounded by how often somebody captures a
  fridge.
- Two devices that each photographed a fridge show one combined list. Rows the
  two captures both named still arrive as two rows, because `mergePantry`
  reconciles by name only within one device's capture. The person edits the list
  down, which is the same act the screen already exists for.
- `replaceLocalPantry` now writes a journal row per dropped row. For a list a
  person rewrites weekly that is a handful of rows per capture, spent on the
  next cycle that publishes them.
- `savedMeals` is the only pass-through collection left in the app, and the only
  one still using `decidePassThrough`.
- A device rolled back to 0.35.1 keeps its own local shelf and strips the
  account's stamps; the upgraded device puts them back on its next cycle.

## References

- `M240/02` in the workspace tracker.
- ADR-0014, fasts are a merged entity, whose mechanism this copies exactly.
- ADR-0013, a recreated store cannot vouch for an absence, which is what makes
  the journal a requirement rather than a nicety.
- M233/02, the pantry, whose `NOTE` block in `schema.ts` carries both halves of
  the argument and which one the owner took.
- `tests/unit/sync-pantry-merged.test.ts` and
  `tests/integration/pantry-cross-device-sync.test.ts`.
