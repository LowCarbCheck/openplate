# 0008 — The study console lives in openplate, at `/study`, on its own account

- **Status:** Accepted
- **Date:** 2026-08-28
- **Deciders:** openplate maintainers (M163 spec 03)

## Context

`openplate-sync` ADR-0003 gives a research study an ordinary sync account and
puts its ECIES private key in **that account's own owner-private compartment**.
Somebody has to serve the JavaScript that generates that key pair, unwraps that
compartment, and opens a cohort with it. Three properties of this system decide
where that code may live.

1. **The app server is the one trusted code origin for key handling.** Every
   key ceremony in this product — the diary's passphrase derivation, the
   clinician share wrap (ADR-0002), the study enrolment fingerprint — runs in a
   browser on JavaScript served by the openplate app server. The sync service is
   deliberately outside that boundary: it is zero-knowledge, and both sync ADRs
   are written so that a hostile or compromised sync operator learns nothing.
2. **The owner-private compartment rides inside the synced snapshot**
   (`app/lib/sync/snapshot-partition.ts`), and openplate's local store is
   DEVICE-scoped — one flat store per browser profile, no per-user namespacing.
3. **A study account and a researcher's own diary account can be used from the
   same browser profile.** In practice they usually will be: the researcher is a
   person with a phone and a laptop, not a sterile appliance.

Point 2 and point 3 together are the hazard this ADR exists to record. A study
session that reused the diary's outgoing-snapshot path would push the
researcher's own diary as the study account's shareable region, the first time
she signed into the study account in the browser profile that holds her diary.
Nothing would fail and nothing would warn — and the resulting blob belongs to an
account whose fingerprint is printed in a consent document.

## Decision

**The study console is a route of the openplate app, at the top-level path
`/study`, and it operates on a SEPARATE sync account held in a SEPARATE vault
that never reads this device's store.**

Concretely:

- `app/routes/study._index.tsx` is client-only and exports no `loader`,
  `action`, `clientLoader` or `clientAction` — the same rule `/shared` and
  `/join-study` follow, because the study's private key is unwrapped in the
  browser and a server that could see any part of that traffic is a server that
  could be asked for it.
- It is **top level, not a `/settings` tab and not inside `_personal`**. A
  settings tab is a page about _this device's owner_; a study console is a
  second persona, exactly as `/shared` is for a clinician. `_personal` also runs
  the onboarding gate and mounts the diary's `SyncController`, neither of which
  should touch a researcher who may have no diary on this device at all.
- The session lives in `app/lib/sync/research/study-session.ts`, in a
  module-private vault that is **never** published to `sync-session.ts`. Two
  accounts, two passphrases, two compartments, two vaults; no vault holds both
  accounts' keys. It is **sign-in per use** — memory only, closed when the
  screen unmounts, with no account hint, no token and no state written to disk.
- The blob a study session pushes is built by
  `app/lib/sync/research/study-snapshot.ts`: an **empty** shareable region plus
  the study's own sealed compartment. This is a dedicated path, **not a flag on
  the diary path**, because a flag is a thing that can be false.
- The study identity is **not** a key on `LocalStoreSnapshot`. It is the
  plaintext of the study account's own compartment
  (`research/study-keyring.ts`), so the diary's fail-closed classification map
  is never asked about it.

## Alternatives Considered

- **Host the console in `openplate-sync`.** It already has a web surface and the
  contributions live there. Rejected: it would let a sync operator serve the
  JavaScript that handles a study's private key, which defeats the reason
  ADR-0003's prohibition 10 exists — not merely its letter. The whole research
  design assumes the sync service never touches key material.
- **A second deployable (a standalone study client).** Rejected: it would be a
  second implementation of the compartment wrap and the contribution AAD, and
  both ADR-0002 and ADR-0003 forbid a second wrap implementation precisely
  because that is how a packed-IV or an AAD convention silently drifts.
- **A tab under `/settings`.** Rejected: `/settings/*` is about the person
  holding this device, it sits inside the onboarding gate, and it would put a
  study account beside the controls that act on the diary account — which is the
  layout most likely to produce the cross-account push described above.
- **One vault, with the study account as a second session in
  `sync-session.ts`.** Rejected: `SyncController`, `syncNow` and every sharing
  surface read that one session. A study account there is exactly how a boot-time
  sync pushes a diary to a study.
- **A `isStudy` flag threaded through `sync-actions.ts`.** Rejected for the
  reason stated in the decision: the flag would have to be right in the snapshot
  source, the vault and the account hint, every time, forever.

## Consequences

- **The diary product's repository now carries a researcher persona.** That is
  the accepted cost. openplate is a food tracker, and `/study` is a screen for
  somebody who is not tracking food. The alternative was worse in each direction
  considered above.
- The console is **dark in production** while `SYNC_RESEARCH` is unset: every
  research path answers the ordinary unknown-route 404, and this screen reports
  that as "this server has no research lane" rather than as an error.
- The study console does **not** build a join link. There is no registry to
  publish a study key to, and the trust anchor is the printed consent document;
  `buildStudyLink` in `app/lib/study-link.ts` remains for a study's own tooling.
- A researcher who uses the console in the same browser profile as her own diary
  now has two independent sessions on screen at different times. Sign-in per use
  is what keeps that honest for v1; a longer-lived study session would need its
  own answer to "which account is this page acting as".

## References

- `openplate-sync/docs/adr/0003-research-contributions-pseudonymous-but-never-anonymous.md` — "A study is an ordinary sync account", and prohibitions 4, 8 and 10.
- `openplate-sync/docs/adr/0002-sharing-a-diary-without-giving-the-server-a-key.md` — the partition amendment, and the one-wrap-implementation rule.
- [ADR-0006](0006-the-app-server-holds-no-accounts.md) — why this server holds no account of its own, which is why the study account is a sync-service account.
- `.tracker/M163-openplate-research-surfaces/03-study-surfaces-the-cohort-screen-and-the-export.md`
