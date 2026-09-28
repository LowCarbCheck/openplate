# Security Policy

## Supported versions

Pre-1.0. Only the latest tagged release receives fixes.

## Reporting a vulnerability

**Please do not open a public issue for a suspected vulnerability.**

Report it privately via GitHub's [private vulnerability reporting](https://github.com/LowCarbCheck/openplate-core/security/advisories/new). This opens a draft security advisory visible only to you and the maintainers, and is the only channel we triage for security reports.

This is a small open-source project maintained without a dedicated security team and with no bug bounty. There is no SLA, but reports are read and taken seriously. Expect an initial response within a few days. If a report turns out to be valid, we will work with you on a fix and, if you want, credit you in the advisory when it is published.

## What "vulnerability" means for this service

openplate-core is the account, sync, AI proxy and mail service for openplate. The device encrypts the diary before upload. The server stores ciphertext and key records it cannot unwrap. It also stores each account's recovery code, sealed under a key derived from `SERVER_SECRET` (the escrow, [ADR-0005](./docs/adr/0005-organization-accounts-and-escrowed-recovery.md)). That escrow lets "forgot password" restore the diary and not only the login.

**So this is not end-to-end encryption against the operator.** No code path in this service opens the escrow to decrypt a blob. However, whoever holds both the database and `SERVER_SECRET` can open any account. That includes the operator of a hosted instance, or you on your own. [`PROTOCOL.md`](./PROTOCOL.md) §9 lists everything the server can read. The [README](./README.md) says the same in its first paragraphs. An account is an email address. Signup is by invitation. A password reset is a mailed link that hands the escrowed code back to the client (§5.12).

That threat model decides which reports matter most. Please report:

- **Anything that lets the service's own code, or an attacker with the database but WITHOUT `SERVER_SECRET`, decrypt a blob or open an escrowed recovery code.** The seal on the escrow is the one line between a dumped database and every diary. A bug that weakens it is the most serious class of issue this project has.
- **Any path that returns an escrowed recovery code** other than `POST /v1/auth/reset/open` with a valid, unspent, unexpired mailed token, or the operator's `POST /v1/admin/accounts/:id/reset-mail`.
- **Auth or token-handling flaws**: bypassing bearer-token or admin-token checks, forging or replaying `access` or `refresh` tokens, breaking rotation or reuse detection, or any path that lets a session outlive a revocation trigger (`change-passphrase`, `recover-rotate`, account deletion).
- **Anything that breaks the atomicity of a credential rotation.** `recover-rotate` moves both verifiers, both key records and the escrow in one transaction. A half-applied rotation is a silent data-loss bug. The user logs in and decrypts nothing. They find out only when they open their diary.
- **KDF-descriptor downgrade tricks**: anything that lets a client or attacker force weaker Argon2id parameters than the account's recorded descriptor.
- **Account enumeration beyond what `PROTOCOL.md` documents.** `reset/request` answers `202` for every address after identical work. Endpoints `kdf`, `login`, `recover` and `recover-rotate` are designed to stay indistinguishable for known and unknown accounts, in response and in work done. A way to tell them apart, or to bypass their throttles, is a real report. The one accepted oracle is `POST /v1/auth/signup` answering `409` when the invited address already has an account. Only somebody holding a live invitation addressed to that very address can ask it, so it confirms only what the operator wrote on the letter, and it does not consume the invitation (`PROTOCOL.md` §5.8).
- **Anything that breaks the compare-and-swap semantics** on `/blob` or `/key-records/:kind` in a way that lets one device silently clobber another's data.
- **Anything that makes the AI proxy write, cache or log a request body or a photograph.** It is designed to see a photograph and keep nothing.

**If a report might fall into the "decrypt without the secret" or "breaks the enumeration protections" category, report it privately, even if you are not sure it qualifies.** We would rather triage a false positive privately than have a real one discussed in a public issue.

## What is not a vulnerability: the operator can open an account

That the operator of an instance, holding the database and `SERVER_SECRET`, can decrypt its accounts is the documented design, not a finding. Deciding whether to use a hosted instance is a decision about its operator. A self-hosted instance is its own operator.

The limit of recovery is also by design. A forgotten passphrase is restored through the escrow: a mailed link, or on an instance with no mail, a link the operator makes. If `SERVER_SECRET` is lost, the escrow cannot be opened. A person who then loses both their passphrase and their recovery code cannot get their diary back. Nothing on the server can restore it. A report that some path does is the most serious class of issue above.

Non-security bugs (crashes, incorrect sync behavior, docs errors, etc.) belong in regular [GitHub issues](https://github.com/LowCarbCheck/openplate-core/issues), not here.
