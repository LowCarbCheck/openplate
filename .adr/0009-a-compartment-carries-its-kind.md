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
  nothing, so the refusal lands **before** any write; on the diary it reaches
  `describeSyncFailure` and the sync status surface.
- **A malformed plaintext is NOT a refusal.** It stays the region schema's own
  error, which each `tryOpen` turns into the existing `null`. Only a plaintext
  that reads as the other kind — or as a kind this build does not know — throws.

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

## References

- [ADR-0008](0008-the-study-console-lives-in-openplate.md) — why a study account and a diary account meet in the same browser profile at all.
- `openplate-sync/docs/adr/0002-sharing-a-diary-without-giving-the-server-a-key.md` — the partition amendment and the one-wrap-implementation rule.
- `openplate-sync/docs/adr/0003-research-contributions-pseudonymous-but-never-anonymous.md` — "a study is an ordinary sync account", and the private key's home.
- `.tracker/M164-openplate-research-hardening/01-the-seal-must-never-blank-a-compartment-it-could-not-open.md` — the re-emit invariant this decision splits.
- `.tracker/M164-openplate-research-hardening/02-a-compartment-carries-its-kind-and-a-wrong-kind-is-refused.md`
