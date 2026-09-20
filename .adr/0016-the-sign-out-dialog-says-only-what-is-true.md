# 0016, the sign-out dialog says only what it can prove

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** Altan Sarisin (operator)
- **Spec:** `M240/03`

## Context

The sign-out dialog stands above a box that erases the diary, and it tells the
person what an erase would cost. `countUnsentChanges` answers most of it by
running the sync engine's own `stampSnapshot` over the live snapshot and the
last agreed baseline, so a new row, an edit, a resurrection and a journalled
delete all count.

Three collections sat outside that diff, and one blanket sentence covered them:

> Fasts, saved meals, the pantry, and your sharing and research keys are not
> part of this check. If you erase, you may lose them.

Two things were wrong with it after M240/01 and M240/02.

**Most of it became false.** Fasts and the pantry are merged entities now, so
`stampSnapshot` stamps them exactly like a food log and the count already
covers a started fast, an ended one, a photographed shelf and a removed row.
Naming them as uncheckable warns twice about one change.

**The rest of it was never a measurement.** `holdsUncheckedRows` returned true
on the mere PRESENCE of a saved meal or a key pair. A person whose saved meals
had all reached the account, which is every person on an ordinary cycle, was
told they might lose them. On every sign-out. For ever. A warning that is
always on is a warning nobody reads, and it sat on the one screen where the
person has to decide something irreversible.

## Decision

**Each line speaks for one thing, and is drawn only when that thing is true.**

`UnsentOnDevice.hasUncheckedRows` is replaced by two fields, and the one line
`not-covered` by two lines:

- **`hasUnsentSavedMeals`** compares the saved-meal ids on the device against
  the ids the baseline recorded when this device last agreed with the account
  (`SyncBaseline.passThrough.savedMeals`), in BOTH directions. An id the device
  holds and the baseline does not has not been sent; an id the baseline holds
  and the device does not is a removal the account has not heard. A baseline
  that recorded nothing vouches for nothing, which is `decidePassThrough`'s own
  rule one file over. The line is `saved-meals-unsent`.
- **`hasOwnerPrivateRows`** is PRESENCE, and cannot be anything else. The
  region travels as sealed bytes, comparing it needs the session's data key,
  and the dialog has no business holding one (`sync-session.ts`: the vault is
  off limits to React). So the only honest sentence is that these rows are
  outside the check, and this answers whether there are any to say it about.
  The line is `keys-not-covered`.

**No content hash for a saved meal, deliberately.** A RENAME is invisible to
this check, and that is correct rather than a gap: `canonicalize` weighs the
whole saved-meals list, so a rename makes the very next cycle push by itself
(M234's `sync-saved-meal-pushes-once.test.ts` pins it). Hashing here would put
a second definition of "changed" beside the engine's own, free to drift from
it, in order to warn about a meal the next cycle was about to send anyway.

`holdsUnsentSavedMeals` takes the baseline as an argument, and
`readUnsentOnDevice` hands it the SAME baseline the count weighs, from the same
read under the orchestrator lock. A second load could describe a cycle that
committed in between, which would warn about meals that had just been sent, or
stay silent about ones that had not.

## Alternatives Considered

- **Keep the blanket sentence and just drop the two collection names.**
  Rejected. It fixes the false half and leaves the always-on half: a person
  with an ordinary sharing key pair and no unsent meals is still warned about
  meals.
- **Compare ids only, and let the next cycle carry a rename.** Rejected on
  review, and the reasoning is above: there is no next cycle for somebody
  signing out on a train, and this confirm is destructive. It was this ADR's
  own first answer.
- **Seal the owner-private region inside the dialog to compare it.** Rejected.
  It needs the session's data key in React, which is the boundary
  `sync-session.ts` exists to hold.
- **Drop the keys line entirely.** Rejected. The key material really is outside
  the check, and an erase really can lose a share identity that exists nowhere
  else. Saying nothing would be the same class of lie the M201 fix removed.

## Consequences

- A person whose saved meals are all on the account sees no sentence about
  saved meals, which on an ordinary device is the normal case.
- The dialog can now show three lines instead of two, when meals are unsent AND
  the person holds key material. That is more text, and each line is true.
- A saved meal RENAMED and not yet synced DOES draw a warning, and a device
  whose baseline predates the hash draws one for any saved meal at all, once,
  until its next cycle commits a baseline that carries the hash. Over-warning
  once is the accepted cost of never under-warning.
- `holdsUnsentSavedMeals` is the second reader of
  `SyncBaseline.passThrough.savedMeals` after `decidePassThrough`. The day saved
  meals become a merged entity, both go, and this dialog loses its last
  exclusion but the keys.
- The browser tier is untouched: `tests/e2e/sign-out-unsent.spec.ts` asserts
  `data-erase-line="unsent-changes"` and pins no sentence, which is why the line
  names and the copy could both change here without it.

## References

- `M240/03` in the workspace tracker.
- ADR-0014 and ADR-0015, which merged the two collections this check used to
  exclude.
- M201 spec 02, which wrote this dialog after it counted a dead outbox and told
  everybody their diary was safe.
- `app/lib/sync/erase-notice.ts` and `tests/unit/erase-notice.test.ts`.
