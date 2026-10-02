# 0022, the device lock names its owner, and another account erases first

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Altan Sarisin (owner), with an architecture brief from Fable and a review by Opus

## Context

On a managed instance the diary belongs to an account, and signing out without
an erase hides it behind a device lock (`sync-state.ts`, M201 spec 02). Nothing
is deleted: the rows stay in plaintext in `openplate-primary`, so a person who
signs in again finds their diary, unsent changes included.

The lock was the bare value `locked` under `openplate.device-locked`. It named
no account, `openSyncSession` lifted it for any account, and the onboarding gate
let the device through once any session existed. So on a shared device a second
person who signed in, redeemed an invitation or followed a reset link opened the
first person's diary. Worse, the first sync of the new session diffed every
local row against the new account's empty baseline, counted all of it as unsent,
and pushed the first person's diary into the second account. Three doors reached
it: `/sign-in`, `/join` (whose "Sign out and continue" signs out without an
erase, then offers the form) and "Not you?" on `/welcome` followed by a sign-in.
No test covered it, because the one spec about a second account on `/join` runs
on an open instance with an empty first account.

## Decision

The lock names whose diary it closes, a session for any other account refuses to
open, and the one way on for another account is to erase the held diary first.

**The lock format.** The key stays `openplate.device-locked`. The value is now
`{"v":2,"accountId":<int>,"email":"<canonical address or null>"}`. Reading
(`readDeviceLock`) answers unlocked, locked with a known owner, or locked with
the owner unknown, and reading never writes. The old value `locked` still means
locked, and its owner is worked out on every read: the one account whose
baseline (`openplate.sync.state.v1:<id>`) names an entity of a diary. Zero or
several such baselines mean the owner is unknown. Any other value means
unlocked, as before, so a half-written string never locks anyone out.
`isDeviceLocked()` keeps its boolean shape for the onboarding gate.

**Who writes it.** `lockDevice({ owner })` writes the owned value when the owner
is known. With no owner it writes the old value only where no owned value stands
already: a named owner is never replaced by nobody. A sign-out names the account
the dialog was opened for (or the open session, read before it closes), `/join`
names the cached session before it signs that session out, and a session the
server ended names the open vault, else the cached row, both read before
anything closes.

**Fail closed.** The first statement of `openSyncVault`, the one place a session
opens, is `assertDeviceMayOpen`. It passes when the device is unlocked or the
lock names this very account, and otherwise throws
`DeviceHeldByAnotherAccountError` before a vault, a cache row, a remembered
address, a token store or an unlock exists. `openSyncSession` asks again,
because that is where the lock lifts, and it lifts only for the account it
names (`releaseDeviceLockForOwner`). The only other way the lock clears is
`clearDeviceLockAfterErase`, called only from `account-switch.ts` after an erase
resolved. A unit source test keeps `openSyncSession(` to `session-cache.ts` and
the clearing functions to their two modules, so a flow that forgets to ask
fails closed and never opens another person's diary.

**The account-switch step.** Each door asks before the guard has to, as early as
the incoming identity is known, and shows one step in place of its form:

- `/sign-in` compares the typed address with the lock's before the handshake and
  the Argon2id run, so no request about the other account is made. When the
  lock knows its owner only by id (an old value), the core is asked, and the id
  decides right after the login, before the key records are read; the new
  tokens are logged out again.
- `/join` compares the invitation's address. An invitation always creates a new
  account, so the step shows unless the lock's address is the invitation's own,
  and then the signup answers `409` and the existing card sends the person to
  sign in. `createSyncAccount` asks the same question before the signup, with
  the idempotent invite lookup, so an invitation is never spent on an account
  this device would refuse.
- `/reset` cannot ask early: the link names no address, and the core cannot read
  a token without spending it. So the token is spent, and the reset then stops
  BEFORE it recovers or rotates anything: by address right after `/reset/open`,
  and by id right after `/v1/auth/recover`, before the consent, the key-record
  read and `recover-rotate`. A guard that fired inside `openSyncVault` on this
  path would fire after the rotation had committed, and the compartment's
  rewrap, which follows the vault, would never run: its doors would stay on a
  passphrase and a code that no longer exist, and the share keys, the pinned
  peers and the research identity would be lost for good. On a held device the
  reset link is therefore spent, the old password stays valid, and a new link
  returns the same escrowed recovery code. The step says so, and its erase
  leads to `/forgot`, filled in for the address the link was for.
- `/welcome` never shows the step. "Not you?" still clears only the remembered
  address; the lock carries its own, so `/sign-in` can still compare after it.

The step (`account-switch-card.tsx`) names the owner by address when the lock
knows it, shows what an erase would lose with the sign-out dialog's own lines
(read for the owner, with no session, within five seconds, and settled before
the step is drawn), and says the owner's other way: sign in with the account
that signed out. "Erase it and continue" removes every baseline key, erases the
diary (`eraseDeviceData`), and lifts the lock only after that resolved
(`eraseDiaryAndReleaseLock`); a failed erase, another tab holding the database,
leaves the lock set and says so. It then remembers the incoming address and
loads the next page as a new document. Cancel leaves everything as it was. The
sign-out dialog's opt-in erase runs the same function, so a device whose diary
was erased at sign-out is not left locked over nothing.

`/sign-in` is drawn top-aligned, like `/join`, so the step replacing the form
moves nothing above it.

**The resume.** A cached session for an account the lock does not name is not
reopened: its row is cleared, its tokens revoked, the boot settles signed out,
and the lock stays.

## Alternatives Considered

- **Merge the held diary into the next account.** Rejected. Nothing on the
  device can tell which rows a second person would want, and anything the second
  session kept is pushed into the second account on its first cycle, which is
  the defect itself.
- **Refuse every other account until the first person returns.** Rejected. A
  shared device, a household tablet or a study laptop, would be stuck for
  everyone else for as long as the first person stays away, with no way on that
  a person can take on the device.
- **Check only inside `openSyncVault`.** Rejected on its own, kept as the last
  defence. It is the line that cannot be forgotten, but on the reset path it
  fires after the rotation and loses the compartment, and on `/join` after the
  invitation is spent.

## Consequences

- No account opens on a managed device that holds another account's diary
  without that diary being erased first. The person whose diary it is signs in
  as before and finds it, unsent changes included.
- **An old-format lock with an unknown owner forces an erase for every account,
  the one that signed out included.** A device that signed out on a build before
  this one, and never finished a cycle (no baseline with a diary entity) or held
  several accounts' baselines, cannot say whose diary it holds. Opening it for
  anybody could be the defect again, so everybody meets the step. This is the
  accepted cost: it falls only on devices locked by an older build, and their
  unsent rows are named before anything is erased.
- On a held device a reset link is spent with nothing to show for it. The old
  password still works and a new link restores the account; the step says both.
- One race remains, and it is named here rather than hidden: another tab may
  write a lock between the reset's check after the recover and `openSyncVault`.
  The guard then refuses after the rotation, and the compartment's rewrap does
  not run. It needs a second tab signing out in the same second as a reset in
  the first, on the same device.
- The step's copy (`accountSwitch.*`) is English until the translation run.
  `erase-notice-text.tsx` is a copy of the dialog's private component, to be
  made one again once the sign-out dialog restructuring lands.

## References

- `app/lib/sync/sync-state.ts` (the lock), `app/lib/sync/session-cache.ts`
  (`openSyncVault`, the resume, `endSessionRefused`), `app/lib/sync/sync-session.ts`
  (`openSyncSession`), `app/lib/sync/sync-actions.ts` (the flows),
  `app/lib/sync/account-switch.ts` (the erase), `app/components/account-switch-card.tsx`.
- Tests: `tests/unit/device-lock.test.ts`, `tests/unit/device-held-session.test.ts`,
  `tests/unit/account-switch.test.ts`, `tests/unit/account-switch-source.test.ts`,
  `tests/integration/account-switch-flows.test.ts`, `tests/e2e/account-switch-managed.spec.ts`.
- [ADR-0016](0016-the-sign-out-dialog-says-only-what-is-true.md), whose notice lines the step reuses.
