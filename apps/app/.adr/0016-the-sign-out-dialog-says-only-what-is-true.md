# 0016, the sign-out dialog says only what it can prove

- **Status:** Amended (2026-10-02)
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

> **Amended 2026-10-02, the lines now wait for the tick; each line still speaks
> for one thing.** See "Amendment" below. Where this ADR says the dialog tells
> the person what an erase costs "above the box", read it as: after the box is
> ticked, and before an erase can be confirmed.

**Each line speaks for one thing, and is drawn only when that thing is true.**

`UnsentOnDevice.hasUncheckedRows` is replaced by two fields, and the one line
`not-covered` by two lines:

- **`hasUnsentSavedMeals`** compares the saved-meal ids on the device against
  the ids the baseline recorded when this device last agreed with the account
  (`SyncBaseline.passThrough.savedMeals`), in BOTH directions. An id the device
  holds and the baseline does not has not been sent; an id the baseline holds
  and the device does not is a removal the account has not heard. A saved
  meal whose id is unchanged but whose content differs (a rename, a changed
  ingredient) has not been sent either, so one hash of the whole list
  (`SyncBaseline.passThrough.savedMealsHash`) is compared as well. A baseline
  that recorded nothing vouches for nothing, which is `decidePassThrough`'s own
  rule one file over. The line is `saved-meals-unsent`.
- **`hasOwnerPrivateRows`** is PRESENCE, and cannot be anything else. The
  region travels as sealed bytes, comparing it needs the session's data key,
  and the dialog has no business holding one (`sync-session.ts`: the vault is
  off limits to React). So the only honest sentence is that these rows are
  outside the check, and this answers whether there are any to say it about.
  The line is `keys-not-covered`.

**A content hash for a saved meal, after all.** An earlier draft ruled it out:
`canonicalize` weighs the whole saved-meals list, so the next cycle pushes a
rename by itself. That argument fails offline, which is when people sign out:
the next cycle never runs, and an edited meal read as nothing unsent, on the
one screen that guards an irreversible erase. The baseline now carries
`savedMealsHash`, computed by `baselineFromPayload` with the engine's own
`contentHash` over the same `byId` view `canonicalize` uses, so this check has
no second definition of "changed" that could drift from the engine's. The field
is optional, so a persisted state that predates it still parses.

`holdsUnsentSavedMeals` takes the baseline as an argument, and
`readUnsentOnDevice` hands it the SAME baseline the count weighs, from the same
read under the orchestrator lock. A second load could describe a cycle that
committed in between, which would warn about meals that had just been sent, or
stay silent about ones that had not.

## Amendment, the cost shows before a confirm, not before a tick (2026-10-02)

The rule used to read "the cost of an erase shows before the box can be
ticked". It now reads **the cost of an erase shows before an erase can be
CONFIRMED**. The lines in this ADR are unchanged. Only the moment they appear
moved: they mount when the erase box is ticked, and not on open.

**Why.** A plain sign-out deletes nothing. On a managed instance it hides the
diary until the account signs in again, and on an open instance it leaves the
diary where it is. The dialog still opened with "N changes have not reached the
server, an erase loses them" and a pointer to the backup, above a box nobody
had touched, so a plain sign-out read as if it removed data. The operator
reported it as confusing (2026-10-02).

**Why the tick is the right moment.** The tick can be undone and the confirm
cannot. The person must see the cost before the second, and has no need of it
before the first. Both modes use the one dialog and the same rule, and there is
no new policy field: the instance-policy question that drives the device lock
was renamed `signOutClosesTheDiary` for what it does and decides nothing here.

**What stays true.**

- The box is drawn from the first paint and is disabled until the unsent read
  has an answer (any answer: done, failed, or no session). The lines are never
  shown as "checking" in the region's first frame.
- The notice is frozen at the tick and stays until the dialog closes. A later
  sync can only make it over-warn, which a destructive confirm is allowed to do.
  A session that ends under a running sign-out cannot turn it into "could not be
  checked".
- The region reserves its box, so nothing shifts. It is one grid cell with two
  layers, the notice and the one fixed error sentence, and the layer that is not
  showing is `invisible`, `inert` and `aria-hidden`. The dialog is anchored at
  the top, so the notice grows downward only, and the spinner in the confirm
  button is always drawn so the button never changes width.

**Tests.** `tests/e2e/sign-out-managed.spec.ts` is the operator's report: no
`data-erase-line` and no `data-slot="erase-region"` before the tick, and a line
after it. `tests/e2e/sign-out-dialog-moves-nothing.spec.ts` reads the tops, and
`tests/e2e/sign-out-erase-blocked.spec.ts` asserts the notice never flips under
a blocked erase.

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
- `tests/e2e/sign-out-unsent.spec.ts` asserts `data-erase-line="unsent-changes"`
  and pins no sentence, which is why the line names and the copy could both
  change here without it. Since the 2026-10-02 amendment it ticks the box first.

## References

- `M240/03` in the workspace tracker.
- ADR-0014 and ADR-0015, which merged the two collections this check used to
  exclude.
- M201 spec 02, which wrote this dialog after it counted a dead outbox and told
  everybody their diary was safe.
- `app/lib/sync/erase-notice.ts` and `tests/unit/erase-notice.test.ts`.

### Known edge: a refused erase can still complete later (2026-10-02)

A refused erase is a rejected `deleteDatabase` request, and that request cannot be cancelled. It stays queued and completes when the other tab finally releases its connection, even after the person pressed Cancel. Closing the other tab therefore still erases this device, which is what the ticked box asked for. The message after a failed erase says only to close the other tab and press Sign out again, and never promises that Cancel keeps the diary. In practice the other tab leaves by itself, because the erase removes the sync baseline first and the other tab hard navigates away on that storage event (`use-leave-when-another-tab-signs-out.ts`).
