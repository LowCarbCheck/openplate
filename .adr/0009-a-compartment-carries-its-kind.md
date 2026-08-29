# 0009 — A compartment carries its kind, and a wrong kind is refused

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** openplate maintainers (M164 spec 02)

## Context

Two different plaintexts now ride inside one crypto construction
(`app/lib/sync/engine/crypto/private-store.ts`): the diary's **owner-private
compartment** (`OwnerPrivateRegion` — share key pair, pinned peers, pseudonym
root, study enrolments) and the study console's own compartment
(`StudyPrivateRegion` — every ECIES key generation the study has minted).
ADR-0008 put the second one there deliberately, and `openplate-sync` ADR-0002's
one-wrap-implementation rule is why they share the construction rather than
growing a second wrap format.

Nothing in the plaintext said which one it was.

**Measured, both directions, 2026-08-28.** Each region's zod schema parses the
other's plaintext without throwing, and returns a plausible EMPTY region:

- `ownerPrivateRegionSchema` over a study compartment →
  `{"shareIdentity":null,"sharePeers":[],"researchIdentity":null,"studyEnrolments":[]}`
- `studyPrivateRegionSchema` over a diary compartment → `{"studyKeyring":[]}`

Every field on both sides carries a zod default, and zod strips the keys it does
not recognise. That is not a bug in either schema — it is the forward-migration
property both of them need.

The crypto does not stop it either, and could not. `K_pp` derives from the
passphrase of whichever account signed in, so the passphrase slot unwraps; the
AAD binds the account id the compartment really belongs to, so the tag check
passes. Both checks do exactly what they were designed to do. They authenticate
the BYTES. Nobody ever asked them what the bytes mean.

**The reachable direction is the quiet one.** `/study` is an unconditional
client route (`app/routes.ts`) and is not gated on `SYNC_RESEARCH` — creating a
study account and minting a generation are ordinary sync operations. A
researcher who types her own DIARY address into `/study` therefore gets a
working sign-in, because the address and the passphrase are genuinely hers.
`loadStudyIdentity` would hand her an empty keyring, and the next mint would
seal `{studyKeyring:[…]}` over her clinician share private key, her pseudonym
root and every study she has joined.

**We cannot check whether an untagged study compartment already exists.** The
sync service is zero-knowledge by construction: nobody, including us, can look
inside a compartment on the server. "No study compartment predates the tag" is
an assumption, not a fact, and the code must not rest on it.

## Decision

**The compartment plaintext carries one field saying what it is —
`kind: 'diary' | 'study'` — an absent tag means `diary`, and a compartment of
the wrong kind is REFUSED with a named typed error rather than opened as an
empty region.**

Concretely:

- `app/lib/sync/compartment-kind.ts` is the single place that writes the tag
  (`taggedCompartmentPlaintext`, called by both seals) and the single place that
  reads it (`parseCompartmentPlaintext`, called by both opens). One helper, so
  the twins cannot drift into a refusal that exists on one side only. The two
  region schemas and the two session types stay distinct: nothing accepts
  either.
- **An absent tag parses as `diary`, and that default IS the whole forward
  migration** — the same pattern `app/lib/local-store/backup.ts` uses for every
  field it has ever added. No migration step, and no retroactive tagging: an
  existing compartment gains the tag the next time its own client seals it, and
  is read correctly until then.
- **The study open additionally SNIFFS.** An untagged plaintext carrying a
  `studyKeyring` is a study compartment. The diary's region has never had that
  key; the study's region always does. Without this, a study account created
  between M163/03 and today would be locked out of its own keyring — not
  destroyed, thanks to M164/01's re-emit, but unreadable, which one support
  ticket later is the same outcome. Since the server cannot be asked whether
  such an account exists, the sniff is mandatory rather than defensive.
- **A wrong kind THROWS `WrongCompartmentKindError`; a decrypt failure still
  returns `null`.** These are opposite states and must not collapse into one.
  `null` means "we learned nothing" — a GCM tag check does not say why it
  failed, and the caller keeps what the device already holds. A wrong kind is
  the one case where the client learned exactly what it is holding. On the
  console it surfaces at `loadStudyIdentity`, which runs at sign-in and pushes
  nothing, so the refusal lands **before** any write; on the diary it lands at
  `assertOwnerPrivateCompartment`, which the sync cycle runs after the pull and
  before the push (see the 2026-08-29 amendment).
- **A malformed plaintext is NOT a refusal.** It stays the region schema's own
  error, which each `tryOpen` turns into the existing `null`. Only a plaintext
  that reads as the other kind — or as a kind this build does not know — throws.
  "Malformed" means **not an object at all**, and nothing wider: a plaintext
  that IS an object and carries a `kind` this build cannot read is a refusal,
  not a malformed plaintext (see the 2026-08-29 amendment).

## Alternatives considered

- **Refuse on any unrecognised KEY in the compartment plaintext.** Rejected.
  It would have caught this hazard as a side effect, and it bricks every older
  client on every compartment schema bump: the moment a new field is added, an
  older build stops opening its own account's compartment and — under M164/01 —
  carries it forever without publishing anything of its own. The whole
  `.default()` convention in `backup.ts` exists so that a schema addition is
  invisible to an older reader, and this would have inverted it. **Spec 03
  depends on this rejection**: unknown keys are to be PRESERVED, not refused.
  The two questions are different and get different answers — "is this mine?"
  is answered strictly, "do I understand all of it?" is answered generously.
- **Refuse on the wrong kind by inspecting the ciphertext or the wraps.** Not
  possible, and worth writing down so nobody re-derives it: the wraps and the
  AAD are identical between the two compartments by design, and making them
  differ would mean a second wrap format, which `openplate-sync` ADR-0002
  forbids for exactly the drift reasons that produced this hazard.
- **Gate `/study` behind `SYNC_RESEARCH` and call the hazard unreachable.**
  Rejected. It narrows the entry point without removing the confusion, it does
  nothing about compartments already written, and the reverse direction — a
  study account pulled by a diary client — does not pass through `/study` at
  all.
- **A server-side notion of account kind.** Rejected: the protocol is frozen,
  and the service cannot see a compartment. Asking the server what an account
  is would be asking it to classify data it is not allowed to read.
- **Return `null` on a wrong kind, like every other open failure.** Rejected.
  Under M164/01 a `null` means the compartment is carried verbatim forever and
  this device's own key material is never published — silently. The researcher
  who mistyped her address would see a working, empty study console and no
  indication that she was looking at her own diary.

## Consequences

- **Both seals now write a tag**, so an untagged compartment can only be
  produced by a client older than this change. The two tests that cover the
  untagged path build their bytes with `sealPrivateStore` directly, because the
  seals can no longer emit them.
- **`parseOwnerPrivateRegion` is gone** from `snapshot-partition.ts`. A second
  entry point that did the schema parse WITHOUT the kind check is exactly the
  drift the shared helper exists to prevent.
- **A completed sync cycle can now report an error.** With the wrong-kind case
  split out, "this session could not open the compartment" means one thing — a
  passphrase this device does not hold — and `syncNow` says so on the status
  surface instead of reporting a clean sync while silently dropping the
  device's own owner-private changes (M164/01's carried-forward finding).
- **A kind this build does not recognise is refused, not defaulted.** A future
  third compartment will therefore be visibly rejected by today's clients rather
  than read as an empty diary. That is the intended trade: the cost is a hard
  failure on a downgrade, and the alternative is a silent overwrite.

## Amendment — 2026-08-29 (M164 spec 06)

The decision above is unchanged. Three places did not apply it, all found by
the M164 milestone review and each reproduced as a failing test first.

**1. `'unreadable'` was a door around the refusal.** `readCompartmentKind`
parsed the whole plaintext through one tag schema and answered `'unreadable'`
whenever that parse failed — so a `kind` of `5` was indistinguishable from an
absent tag, and `{"kind":5,"studyKeyring":[…]}` opened as an empty diary with
no refusal at all. A whole-object schema cannot tell "this build cannot read
the tag" (a refusal) from "there is no tag" (a migration), and those two must
take different exits. The tag is now read out of a plain
`z.record(z.string(), z.unknown())` and every field is narrowed by hand.
`'unreadable'` now means exactly one thing: **the plaintext is not an object, so
there is nowhere for a tag to be.**

The untagged `studyKeyring` sniff also stopped demanding an array. Presence is
the evidence — a `studyKeyring` this build cannot parse is still a key the
diary side has never written, and requiring a shape would have handed the
malformed case straight back to the diary open.

**2. The diary's refusal landed after the push.** The throw lives inside
`openOwnerPrivateRegion`, which the sync cycle reaches through
`applySnapshot` — and the orchestrator calls `applySnapshot` on the line after
`pushBlob`. A person who typed a study address into the DIARY sign-in therefore
pushed the whole device diary into the study account's blob and only then saw
the refusal. A study passphrase is normally held by more than one researcher,
so that is a disclosure.

`SyncCycleDeps.assertPulledSnapshot` is now a required dependency, run on the
snapshot exactly as pulled, before the merge and before the push, on every CAS
round. Production wires it to `assertOwnerPrivateCompartment`, which adopts
nothing — no CDK, no wraps, no extras, not even `pulled` — so it can sit there
without changing what the cycle does. Its boundary is the load-bearing part: it
is **silent** for a compartment under a passphrase this session does not hold,
for a blob with no compartment, and for an account whose first device has not
minted one. It refuses only when the bytes decrypted and said they belong to
the other kind. Proved the way the console side is proved: the account's blob is
byte-identical after the refusal, read back off the wire.

**3. A session could hold a CDK without ever having opened the compartment.**
`adoptRewrappedSlots` takes the CDK out of a rewrapped slot; the rewrap never
decrypts the compartment, so the session's M164/03 extras were still the empty
set it started with, and the next seal wrote `{ …{}, kind, …region }` over a
newer client's key. `PrivateStoreSession.extras` is therefore now
`CompartmentExtras | null`, where `null` is ignorance and `{}` is knowledge, and
`sealOwnerPrivateRegion` re-emits `session.pulled` rather than sealing from
`null` — the same rule as M164/01, one level in: **a session may only write a
plaintext it has read.** `adoptRewrappedSlots` records the rewrapped bytes as
`pulled`, so the re-emission publishes the new door and preserves the
ciphertext, and the state clears on the session's very next pull.

This replaces an accident with an invariant. The loss was previously masked by
the rewrap bumping the compartment's Lamport to `previous + 1` while the fresh
device's own stamp was `1`, so the remote copy won and the extras came back.
That ordering is **not** safe in the tie case — a blob carrying a compartment
with no `perEntity` stamp for it makes the rewrap's bump `1` as well, against
the same device id, and a tie means neither copy is newer. With the seal
refusing, the tie stops mattering for the right reason: both candidates carry
the same ciphertext, so whichever one wins is the same bytes.

The study console's `StudyCompartmentSession.extras` is deliberately left
non-nullable: there is no rewrap adopt on that side, so no path there can
acquire a CDK without an open.

## References

- [ADR-0008](0008-the-study-console-lives-in-openplate.md) — why a study account and a diary account meet in the same browser profile at all.
- `openplate-sync/docs/adr/0002-sharing-a-diary-without-giving-the-server-a-key.md` — the partition amendment and the one-wrap-implementation rule.
- `openplate-sync/docs/adr/0003-research-contributions-pseudonymous-but-never-anonymous.md` — "a study is an ordinary sync account", and the private key's home.
- `.tracker/M164-openplate-research-hardening/01-the-seal-must-never-blank-a-compartment-it-could-not-open.md` — the re-emit invariant this decision splits.
- `.tracker/M164-openplate-research-hardening/02-a-compartment-carries-its-kind-and-a-wrong-kind-is-refused.md`
- `.tracker/M164-openplate-research-hardening/06-a-refusal-that-arrives-after-the-write-is-not-a-refusal.md` — the three places this decision was not applied.
