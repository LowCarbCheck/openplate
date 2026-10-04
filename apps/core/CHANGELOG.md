# Changelog

All notable changes to `openplate-core` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, a breaking
change moves the minor.

## [Unreleased]

### Changed

- **A caught error reaches a log line only as a name and a code.** Log lines used to carry `error.message`, and a body parser or a driver can quote the request in it. They now carry `errorName` and `errorCode`. A failure at boot, in the `move-accounts` tool, or in an admin mail send still writes its words, scrubbed and cut to 200 characters. `tests/unit/log-allow-list.test.ts` fails when a log call reads `.message`.
- **The scrubber catches more.** It now redacts base64 with JSON-escaped slashes, URL-safe base64 and percent-encoded base64, and it cuts its output at 4096 characters.

### Fixed

- **The AI proxy no longer follows a redirect from the provider.** A 307 or 308 made the proxy send the request body, photograph included, to the host in the `Location` header. It now answers 502, as for any unreachable provider.
- **The terminal error handler no longer logs the error message.**
- **The invitation and sign-up letters no longer say your data stays on your own device.** Both English letters said openplate "keeps your data on your own device", which was not true: your diary lives on your device, and your account keeps an encrypted copy on the server so you can use it on other devices and restore it. The letters now say that. The other languages still carry the old sentence until their translation pass runs.

### Added

- **The photo path guard.** `pnpm test:guard` starts the real core, sends a marked photograph through every failure mode and searches the logs, the responses and the database for it. It runs in the integration suite and every night.
- **Two optional OpenRouter routing settings.** `UPSTREAM_ZDR=true` adds `zdr: true` to the `provider` object of every forwarded body, so a request goes only to endpoints with zero data retention. `UPSTREAM_PROVIDER_ONLY=google-vertex` (comma separated slugs) adds `only` and `allow_fallbacks: false`, so a request goes to one of those providers or fails. Both are off by default, and the body is then what it was. Both act on an OpenRouter host only, and a caller still cannot set the `provider` object. A value that is not `true`, `false` or empty in `UPSTREAM_ZDR`, or a slug list with an empty or malformed entry, stops the boot. `tests/unit/chat-body-policy.test.ts` and `tests/unit/config.test.ts` assert the exact objects.
- **Letters with a secret link ask Pigeon to keep no body.** The invitation, the password reset and the sign-up link now post `retain_body: false` over the HTTP mail API, so Pigeon keeps no copy of the body after the send. An older Pigeon ignores the field, and SMTP is untouched. Letters with no secret post exactly what they did. `tests/unit/mailer.test.ts` asserts the request body, with the quiet letters as the control.
- **A delete asks Pigeon to forget the address.** When `MAIL_API_URL` ends in `/v1/emails` (Pigeon), `POST /v1/auth/delete` and `DELETE /v1/admin/accounts/:id` send `POST <base>/v1/recipients/erase` with the address in the body once the account is gone. The call never fails a delete, is tried up to three times with the answer held two seconds at most, and logs one line without the address when it fails, because no table keeps the address to retry from. Pigeon's retention limit is the backstop. SMTP and other mail APIs are untouched. `tests/unit/recipient-eraser.test.ts` and `tests/integration/account-erase-erases-mail-recipient.test.ts` assert it.
- **`pnpm core-api canary --email <address>` sends one marked photograph through a live instance.** It mints an invite with five AI requests a day, reads the token off the admin response, signs up, posts one small PNG with a random 16 byte marker (in a tEXt chunk and in the pixel data) to `/v1/chat/completions` with an `X-Intake-Id`, and deletes the account (`--keep` skips that). It prints the scan status and the marker as hex, base64 at three alignments and URL-safe base64, so an operator can search the host's logs after a release. Exit code 1 unless the scan answered 2xx and the account is gone. The marker forms moved to `src/lib/marker-forms.ts`, shared with the photo path guard.
- **`DEFAULT_FREE_DAILY_AI_LIMIT`, a standing free daily limit for every account.** It is the AI requests per UTC day for an account whose own `freeDailyAiLimit` is 0, 1 to 10000, never ending and never scan gated. A live paid window still wins and an own limit is kept. A day used up answers 429 with `Retry-After`, not the 403 `ai-not-allowed` of an account with no grant. `GET /v1/auth/account` now reports the limit the proxy enforces in `freeDailyAiLimit`. It is off when unset or 0, and then nothing changes. It cannot be set beside `TRIAL_SCANS`: the boot stops naming both, and an account that already holds a trial falls under the limit and spends no scan. `tests/unit/ai-proxy.test.ts`, `tests/unit/config.test.ts` and `tests/integration/standing-free-limit.test.ts` assert it, each with the unset instance as the control.

## [0.30.0] - 2026-10-01

### Changed

- **The self-host files call the service `core`.** `docker/topologies/compose.sync.yml` is now `docker/topologies/compose.core.yml`, and the compose service `sync` is now `core` in `compose.core.yml`, `compose.full.yml` and the quickstart `apps/core/docker/compose.yml`. The Quadlet folder `docker/quadlet/sync/` is `docker/quadlet/core/`, the unit `sync.container` is `core.container`, and `sync.defaults.env` is `core.defaults.env` in `docker/quadlet/core/`, `docker/quadlet/full/` and `apps/core/docker/quadlet/core/`. An existing install keeps its data, because the volume names and the project name `openplate-with-sync` did not change. The old `compose.sync.yml` still works for one release as a stub that includes `compose.core.yml`, and `docker/quadlet/sync/` keeps only a README that points to the new folder. Stop a running stack with the old file name and `down --remove-orphans`, then start it with the new one. A Quadlet install stops `sync.service`, renames `sync.env` to `core.env` and copies the new units over. Both sets of steps are in `docker/topologies/README.md` and `docker/quadlet/core/README.md`. A command that names the service, such as `docker compose logs sync`, now says `core`. The variable `SYNC_SERVER_URL` and the script `pnpm sync-api` keep their names in this change. The old file name stops working in the first release after 2026-11-01. ([80fae0d](https://github.com/LowCarbCheck/openplate/commit/80fae0d))
- **The self-host files run Postgres 18 (`postgres:18-alpine`) with a new `pg-data-18` volume.** To upgrade an existing Postgres 17 setup, follow the notes in docker/topologies/README.md: dump, start, and restore. Production remains on Postgres 17. ([240c0d2](https://github.com/LowCarbCheck/openplate/commit/240c0d2))
- **Docs and prose call the server core, not sync.** READMEs, docs, code comments and screen text name openplate-core as the core server. Names you type, such as `SYNC_SERVER_URL`, stay as they are. ([56e14f4](https://github.com/LowCarbCheck/openplate/commit/56e14f4))
- **`pnpm core-api` is the admin CLI; `pnpm sync-api` still works with a notice.** `pnpm sync-api` prints one line to standard error, naming the new command, and then runs the same CLI. The CLI reads the service address from `CORE_URL`, with `SYNC_SERVER_URL` as the deprecated fallback: the old name prints one warning to standard error, and when the two names hold different addresses, the old name wins for this release, with one warning on standard error that names both values. `--url` still beats both. The old command and the old name stop working in a later release. Every command in the README, the operations guides and the `.env.example` comments now uses `pnpm core-api`. `pnpm sync-api` stops working in the first release after 2026-11-01. ([b9aab11](https://github.com/LowCarbCheck/openplate/commit/b9aab11), [184c523](https://github.com/LowCarbCheck/openplate/commit/184c523))

## [0.29.1] - 2026-10-01

This release adds migration 0030, which creates the table `ai_trial_network_days` and runs on boot as usual. No env change is required. New optional variables are `AI_TRIAL_NETWORK_DAILY_LIMIT`, `LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY` and `LEGAL_DECLARATION_RECEIPTS_PER_DAY`.

### Added

- **One network can spend only a share of the trial ceiling.** Roughly twenty farmed trial accounts could exhaust `AI_TRIAL_INSTANCE_DAILY_LIMIT`, blocking every genuine new user on their first scan. Trial requests from one caller network can now consume at most `AI_TRIAL_NETWORK_DAILY_LIMIT` units per UTC day. When unset, the limit defaults to one-tenth of the trial ceiling, rounded down, with a minimum of 1 (100 of the 1000 production units). It is inactive when no trial ceiling is configured. A network is an IPv6 /64 or a single IPv4 address, folded by `src/lib/client-address.ts` matching the sign-in throttles. Refused requests return `503 ai-instance-ceiling` with `Retry-After`, requiring no client changes. They deduct no scans or units, and trigger no upstream provider calls. Requests under paid windows or free grants are neither counted nor blocked. Multiple users behind one IPv4 carrier NAT share a bucket by design; IPv6 callers receive their own /64. Migration 0030 adds the `ai_trial_network_days` table, which stores one counter per network per day. Keys are an HMAC-SHA256 under `TRIAL_ADDRESS_PEPPER` of the network and day, never raw addresses. An hourly sweep deletes rows older than today. Values of zero, values exceeding the trial ceiling, or values set without a trial ceiling halt startup. `tests/unit/trial-network.test.ts`, `tests/unit/config.test.ts`, and `tests/integration/trial-network-share.test.ts` verify this behavior.
- **Declaration receipts have a daily ceiling per sender network and per instance.** The per-address cap prevented mail floods to a single target, but an IPv6 /64 sending five requests a minute could still dispatch thousands of domain emails daily to varied recipients. One sender network (an IPv4 address or an IPv6 /64 tracked by the burst limiter) now triggers at most `LEGAL_DECLARATION_RECEIPTS_PER_NETWORK_PER_DAY` (default 10) receipts per 24 hours. The entire instance sends at most `LEGAL_DECLARATION_RECEIPTS_PER_DAY` (default 200). When either ceiling is met, the service still records the declaration, forwards it, and alerts the operator. The `202` response remains byte-identical. A `warn` log records the receipt count and limit, omitting the address. The instance count is read from stored declarations. The network count is kept in memory to avoid storing network details with statutory records; it clears on restart. Setting zero or a non-numeric value in either variable halts startup. Verified by `tests/integration/legal-declarations.test.ts`, `tests/unit/receipt-ceilings.test.ts`, and `tests/unit/config.test.ts`.

### Changed

- **Every sign-in throttle counts an IPv6 caller by its /64.** Throttles for signup, login, recover, recover-rotate, reset request, reset open, KDF, invite lookup, member invite, and sign-up requests previously keyed on full addresses. This gave individual home connections, with 2^64 IPv6 addresses, a fresh allowance per address. An IPv4-mapped address now resolves to its underlying IPv4 address. Direct IPv4 accounting is unchanged. Address folding for these throttles, price lists, and declaration limits is unified in `src/lib/client-address.ts`. Verified by `tests/unit/sign-in-throttle-address.test.ts`, `tests/unit/ip-rate-limit.test.ts`, and `tests/integration/abuse-controls.test.ts`.
- **Login also counts failures per account, from any address.** The login throttle previously keyed on address and email together, granting rotating IP attacks five guesses per address. A secondary bucket keyed only on the email now allows twenty failed attempts before locking for one minute. The lock duration doubles with repeated failures up to fifteen minutes. A successful login clears the bucket, and fifteen minutes of inactivity resets it. Non-existent accounts are throttled identically and return the standard address-bucket `429` with `Retry-After`, avoiding account enumeration and client-side changes. `tests/unit/sign-in-throttle-address.test.ts`, `tests/unit/throttle.test.ts`, and `tests/integration/abuse-controls.test.ts` verify this behavior.
- **A declaration receipt no longer repeats what the sender wrote.** Receipts are mailed to the submitted address, which may not belong to the sender. Previously, receipts mirrored the name (200 characters), contract reference (200), and reason (4000). For templates using `{{details}}` and the fallback template, populated fields now display "received, not repeated in this email" localized to the recipient's language. The sender's name is dropped entirely rather than sanitized, avoiding leaked phone numbers. The fallback receipt adds a closing instruction for non-senders to contact the business to dispute the declaration. The operator alert and database record preserve the full submitted text. Tested in `tests/unit/declaration-message.test.ts`, `tests/unit/declaration-receipt.test.ts`, `tests/unit/mailer.test.ts`, and `tests/integration/legal-declarations.test.ts`.
- **The free-tier backfill skips an account whose paid time has ended.** Migrations 0026 to 0028 leave out an account such as a Beta supporter who bought and then cancelled, so that account shows a free limit of 0 until the operator runs `pnpm sync-api accounts set-free-limit <id> <n>`. Production is not affected.
- **An address on an email alias or forwarding domain gets no scan trial on self sign-up.** The open sign-up door still makes the account, but its trial is 0 scans, the same state as a mailbox whose trial is used up, so the app shows the plan offer at the first scan and a payment lifts it. An invite an administrator minted by hand keeps its trial, because the operator chose that person, and so do member invitations. The list is in `src/lib/alias-domains.ts`: SimpleLogin, addy.io, Firefox Relay, Apple's relay, duck.com and common disposable inboxes. A listed domain matches its subdomains too. `icloud.com` is not listed. The rule needs no `TRIAL_ADDRESS_PEPPER`. The lapsed day trial grant skips these addresses as well. `tests/unit/alias-domains.test.ts` and `tests/integration/scan-trial.test.ts` check this.

## [0.29.0] - 2026-10-01

Bare-metal installs need Node 24 or newer.

### Changed

- **The image runs on Node 24.** Both stages move from `node:22-alpine` to `node:24-alpine`. Corepack now provides pnpm 11.5.1 via the new `packageManager` field in `package.json`, replacing `npm i -g pnpm@11`. `engines.node` is `>=24`, up from `>=20`. Container execution remains unchanged. Check: `scripts/check-image-boots.sh core` at the repository root. ([0b10348](https://github.com/LowCarbCheck/openplate/commit/0b10348), [c59a4bf](https://github.com/LowCarbCheck/openplate/commit/c59a4bf), [90f5657](https://github.com/LowCarbCheck/openplate/commit/90f5657))

## [0.28.0] - 2026-10-01

Upgrade in this order: openplate 0.58.0 first, then this release. This release refuses a data key rotation without the current passphrase, and an app older than 0.58.0 does not send it. Migrations 0025 to 0029 run at boot.

### Added

- **An account can hold a standing free AI grant.** `accounts.free_daily_ai_limit` is a second daily limit with no end date and no scan gate. It applies whenever no paid window runs, so a person whose paid period ends falls back to it instead of losing AI. The proxy decides in one order: a live paid window at `dailyAiLimit`, else the free grant at `freeDailyAiLimit`, else the scan trial. It reserves against the limit it picked. A `dailyAiLimit` with no end date and no scan trial grants nothing any more. Migrations 0026 to 0028 move every account of that shape to the free grant once, with the same number: 0026 adds the column as a stored generated column, 0027 drops the expression and keeps the values, 0028 sets the default to 0. All three are generated by drizzle-kit. The account view and the admin views carry `freeDailyAiLimit`. `PATCH /v1/admin/accounts/:id` takes `freeDailyAiLimit`, an integer from 0 to 10000, with `ADMIN_TOKEN` only. `pnpm sync-api accounts set-free-limit <id> <n>` sets it. An operator's invitation without a trial now redeems to a free grant with a paid `dailyAiLimit` of 0. A member's invitation is marked `source = 'member'` and never becomes one. `tests/unit/ai-allowance.test.ts`, `tests/integration/free-tier.test.ts` and `tests/integration/grant-weight.test.ts` check this. ([259f347](https://github.com/LowCarbCheck/openplate/commit/259f347), [74866c2](https://github.com/LowCarbCheck/openplate/commit/74866c2))
- **Administrators can read the AI budget.** `GET /v1/admin/ai/budget` answers the UTC day, the paid and trial instance counters in units against their ceilings, and the provider key budget: limit, remaining, reset period, and spend today, this week and this month. The key is read server side from OpenRouter's `GET <base>/key` with a 5 second timeout, cached 60 seconds (15 seconds after a failure), and never carries the key or its label into a body or a log. Another provider reports `upstream: null`. An instance with no AI answers `404`. `BILLING_TOKEN` cannot reach it. When less than `AI_BUDGET_ALERT_FRACTION` (default 0.2) of the key's limit is left, the service mails `MAIL_OPERATOR_EMAIL` once per reset period. Migration 0029 adds the `ai_budget_alerts` table that holds that claim, so a restart or a second replica does not mail again. A timer reads the key every 15 minutes, so the alert fires when nobody opens the console. `tests/unit/admin-ai-budget.test.ts`, `tests/unit/ai-budget-alert.test.ts` and `tests/integration/ai-budget.test.ts` check this. ([00f44ce](https://github.com/LowCarbCheck/openplate/commit/00f44ce))
- **The biller hears about an erased account before it goes.** Self-service delete and admin delete now send `POST <PLANS_UPSTREAM_URL>/erase` (the biller's `/plans/erase`) with `X-Plans-Secret` and `X-Account-Id` first. The call waits 5 seconds at most and never blocks the erasure. A failure is logged with the account id, and the biller's nightly reconciliation stays the backstop. `tests/integration/account-erase-notifies-biller.test.ts` checks this. ([ab8f316](https://github.com/LowCarbCheck/openplate/commit/ab8f316))

### Changed

- **A data key rotation requires the current passphrase and signs out every other device.** `POST /v1/sync/rotate-dek` now requires `currentAuthHash`, matched as `change-passphrase` matches it. Without it the answer is `400`, and a wrong one is `401 current passphrase is incorrect`. Before, a stolen bearer token could write a recovery verifier of its own and sign in with it for good. The server derives the recovery proof from `recoveryCode` and refuses a client proof that disagrees. The transaction checks that the passphrase verifier is still the one matched, and revokes every session of the account except the caller's own. openplate 0.58.0 sends the field; older apps get `400` on this route. `PUT /v1/sync/key-records/:kind` that overwrites a record (`expectedUpdatedAt` not null) also requires `currentAuthHash`; a create does not. PROTOCOL.md 4.2, 5.4, 5.5, 5.14, 5.15, 5.17 and 10 describe the rules. ([d0eef4d](https://github.com/LowCarbCheck/openplate/commit/d0eef4d))
- **Every passphrase check behind a token spends one per-account throttle bucket.** `rotate-dek`, a key record overwrite, `change-passphrase` and `POST /v1/auth/delete` share it, so a stolen token cannot buy fresh guesses per address. A locked account gets `429` with `Retry-After`. A locked delete never reaches the biller's erase notice. ([d0eef4d](https://github.com/LowCarbCheck/openplate/commit/d0eef4d), [74866c2](https://github.com/LowCarbCheck/openplate/commit/74866c2))
- **An AI request has an input bound and a weight.** The body policy is an allow list: unknown top-level fields are dropped and their names logged, a message keeps `role`, `content` and `name`, and a part is text or a `data:image/` `image_url`. More than `AI_MAX_IMAGE_PARTS` (default 1) images, `AI_MAX_TEXT_BYTES` (default 49152) of text including `response_format`, or `AI_MAX_MESSAGES` (default 4) messages is `400 ai-request-too-large` before anything is counted. The defaults are the app's largest real request, measured. A request now reserves `max(1, ceil(estimated input tokens / AI_UNIT_INPUT_TOKENS))` units (default 8192 tokens per unit, an image at `AI_IMAGE_INPUT_TOKENS`, default 1500) on the account and on the instance ceilings, so `AI_INSTANCE_DAILY_LIMIT` now counts units. A plate scan is one unit. `AI_MAX_REQUEST_BYTES` stays 8 MB, because the pantry photo path sends the raw camera file. `tests/unit/chat-input-bounds.test.ts` and `tests/unit/chat-body-policy.test.ts` check this. ([beb5d71](https://github.com/LowCarbCheck/openplate/commit/beb5d71))
- **Trial requests no longer count against `AI_INSTANCE_DAILY_LIMIT`.** With `AI_TRIAL_INSTANCE_DAILY_LIMIT` set, trial requests count against it alone, so trial traffic cannot use up capacity paying accounts need. ([beb5d71](https://github.com/LowCarbCheck/openplate/commit/beb5d71))
- **A second request on one scan waits its turn.** A request on an `X-Intake-Id` that is still in flight is `409 intake-in-flight` and spends nothing. Overlapping requests used to get two answers for one scan. An intake in flight for more than 30 minutes is taken over without a new scan, and a claim still open when the handler ends is given back. ([beb5d71](https://github.com/LowCarbCheck/openplate/commit/beb5d71))
- **A push subscription has bounds.** An endpoint must be `https`, on the default port, at a known push service: Google, Mozilla, Apple or Microsoft, plus any host in the new `PUSH_ENDPOINT_HOSTS` (comma separated, `*.` allowed as a prefix). Anything else is `400`, and the scheduler deletes stored rows that do not qualify. One account keeps at most 10 subscriptions; a new one past that deletes the oldest. A delivery gives up after 10 seconds, the tick sends to 8 endpoints at a time and never overlaps itself, and a failing row backs off from one minute to one day and is deleted after 15 failures in a row. Migration 0025 adds `failed_sends` and `retry_at` to `push_subscriptions`. `tests/unit/push-hardening.test.ts` checks this. ([bccd505](https://github.com/LowCarbCheck/openplate/commit/bccd505))
- **The billing token may only write bounded values.** `BILLING_TOKEN` may set `allowanceExpiresAt` only to a date, never clear it, and `dailyAiLimit` only up to the new `BILLING_MAX_DAILY_AI_LIMIT` (default 1000, at most 10000). Anything else is `403 service-scope-value` and writes nothing. It cannot write `freeDailyAiLimit`. `ADMIN_TOKEN` keeps all of these. Keep the new variable at or above your highest plan's limit. ([1f19844](https://github.com/LowCarbCheck/openplate/commit/1f19844), [259f347](https://github.com/LowCarbCheck/openplate/commit/259f347))
- **`move-accounts` writes the free grant.** The flag `--daily-ai-limit` is renamed `--free-daily-ai-limit` (default 10). A moved account gets that standing free grant, a paid limit of 0, no allowance end date and no scan trial. The first move on 2026-09-30 used the old flag; migrations 0026 to 0028 turn those accounts into free grants. ([259f347](https://github.com/LowCarbCheck/openplate/commit/259f347))
- **A member's invitation leaves other invitations alone.** A member minting an invitation for an address with a pending invitation from an operator, the open sign-up door or another member now leaves that letter in place and answers the same `202`. A member may still re-send their own. Deleting an account now revokes every unredeemed invitation it sent, on both delete paths, in the same transaction. ([b6d2634](https://github.com/LowCarbCheck/openplate/commit/b6d2634), [432f340](https://github.com/LowCarbCheck/openplate/commit/432f340))
- **Declaration receipts are capped at three per mailbox a day.** `POST /v1/legal/declarations` needs no sign-in, so anybody could make the service mail one address without limit. Past three receipts to one normalised address in 24 hours, the declaration is still stored, forwarded and sent to the operator, the `202` is unchanged, and only the receipt is skipped and logged. ([8b3e093](https://github.com/LowCarbCheck/openplate/commit/8b3e093))
- **The per-address limit counts an IPv6 caller by its /64.** An IPv4-mapped address counts as the IPv4 address it carries. This applies to the price list and the declaration form. ([7439f4f](https://github.com/LowCarbCheck/openplate/commit/7439f4f))
- **A password reset request answers before the known-address work.** `POST /v1/auth/reset/request` returned after a database write and a mail send only when the address had an account, so the timing told which addresses exist. The store write and the letter now run after the response. A failure there is logged with the account id. One live reset token per account still holds. ([dc0d2da](https://github.com/LowCarbCheck/openplate/commit/dc0d2da))

### Removed

- **`DELETE /v1/sync/key-records/:kind` is gone.** No client called it, and deleting the last key record made every stored blob undecryptable on a bearer token alone. The path now answers as any unknown path does. ([d0eef4d](https://github.com/LowCarbCheck/openplate/commit/d0eef4d))

### Fixed

- **The service refuses to boot when `BILLING_TOKEN` equals `ADMIN_TOKEN`.** The admin door tries `ADMIN_TOKEN` first, so one string in both admitted the biller as the operator. The error names both variables and neither value. ([d99963c](https://github.com/LowCarbCheck/openplate/commit/d99963c))
- **A reused refresh token cannot win a race.** Two concurrent refreshes with one token both minted a new pair. The spend and the new pair are now one transaction, and the loser answers as token reuse: the family is revoked and the answer is `401`. ([4f20dcc](https://github.com/LowCarbCheck/openplate/commit/4f20dcc), [334ad28](https://github.com/LowCarbCheck/openplate/commit/334ad28))
- **Throttle keys fold an address as the account lookup does, and a lock is never evicted.** A fullwidth spelling of an address reached the same account through a fresh throttle bucket. Keys now go through the same NFKC folding. Above 10,000 entries the store dropped its oldest, usually the locked ones; eviction now skips locked entries. ([ad36c07](https://github.com/LowCarbCheck/openplate/commit/ad36c07))
- **Each sync body parser applies only to its own routes.** The blob router's 2.8 MB JSON limit applied to the whole `/v1/sync` prefix, so sharing (8 KB) and research (512 KB) accepted 2.8 MB. ([ac3220f](https://github.com/LowCarbCheck/openplate/commit/ac3220f))
- **An anonymous feedback report is refused before its body is read.** The 8 MB parser ran before the token check. The AI proxy also checks the token before it parses the body now. ([fe7b877](https://github.com/LowCarbCheck/openplate/commit/fe7b877), [beb5d71](https://github.com/LowCarbCheck/openplate/commit/beb5d71))

## [0.27.0] - 2026-09-30

### Added

- **An operator can label an account.** Each account can carry a short note that only administrators see, such as "Beta supporter". `PATCH /v1/admin/accounts/:id` takes `label`. A string of at most 40 characters sets it. Passing `null` or a blank string clears it. The account list and the account detail include `label`. This field is `null` when there is none. A longer label, a line break, or a control character returns a `400`. Nothing is written. The account cannot see or set its own label. The billing token can neither read nor write it. `pnpm sync-api accounts set-label <id> "Beta supporter"` sets the label. `pnpm sync-api accounts clear-label <id>` clears it. The migration adds one nullable column with a check constraint on its length. It changes no existing rows. `tests/unit/admin-accounts.test.ts`, `tests/unit/account-label.test.ts` and `tests/integration/admin-account-label.test.ts` check this. ([c9f8608](https://github.com/LowCarbCheck/openplate/commit/c9f8608), [f4fbf28](https://github.com/LowCarbCheck/openplate/commit/f4fbf28))
- **Accounts can move to another instance with their passwords and diaries.** The image contains a second entrypoint, `node dist/move-accounts.js`. Run this command on the database host. Set `SOURCE_DATABASE_URL`, `TARGET_DATABASE_URL`, `SOURCE_SERVER_SECRET`, and `TARGET_OLD_SERVER_SECRET`. The tool runs a dry run unless you supply `--apply`. It keeps every account id. The app binds the id into the encryption of every blob. The tool rejects an account if the target already uses that id or address. Moved accounts get the daily AI limit from `--daily-ai-limit` (default 10). They get no allowance end date and no scan trial. They get the label from `--label` (default "Beta supporter"). The target must then run with the source `SERVER_SECRET`. A password verifier uses this secret, and the system cannot recalculate it. The tool re-seals the escrow of every existing target account under the new secret. It recalculates the recovery verifier for each target account. Each existing target account requires one mailed password reset after the switch. Each account moves in its own transaction. The tool compares data after the write. It checks row counts, row digests, and a SHA-256 of every blob. Postgres calculates these hashes on both sides. A second run writes nothing. The tool only reads from the source. Read `docs/operations/move-accounts.md` for the runbook. `tests/integration/move-accounts.test.ts` moves accounts made through real sign-up under two secrets. It signs them in after the switch. `tests/unit/recovery-auth.test.ts` pins the server copy of the app recovery derivation to vectors made by the app code. ([766d1de](https://github.com/LowCarbCheck/openplate/commit/766d1de), [20baafd](https://github.com/LowCarbCheck/openplate/commit/20baafd), [94e38de](https://github.com/LowCarbCheck/openplate/commit/94e38de))

## [0.26.1] - 2026-09-30

### Fixed

- **Withdrawal receipts now label the date the contract was made.** The withdrawal form asks for the date the contract was made, but the receipt listed that date as "Requested date", the cancellation label, in all six languages. The receipt and the operator alert for a withdrawal now use the withdrawal form's own label, for example "Date the contract was made" or "Datum des Vertragsschlusses". A cancellation keeps "Requested date". `tests/unit/declaration-message.test.ts` compares both labels with the app's form labels in every language. ([2f9438c](https://github.com/LowCarbCheck/openplate/commit/2f9438c))

## [0.26.0] - 2026-09-30

### Changed

- **The declaration receipt now goes out in all six languages.** `POST /v1/legal/declarations` accepts `language` as `en`, `de`, `fr`, `it`, `es` or `tr`. It previously accepted `de` and `en` only. Any other value returns a `400` naming `language`. The service reads `<lang>/mail/declaration-receipt-<kind>.md` from `CONTENT_DIR` in that language, then falls back to the German file, then to the English file. A folder that holds only German and English receipts still delivers a message to every recipient. A missing file previously fell back to English; it now falls back to German first. Field labels in the message, and the fallback text used when no file is usable, exist in all six languages. The operator alert remains English only. The database row keeps the language without a schema migration. `tests/unit/mailer.test.ts` and `tests/integration/legal-declarations.test.ts` check this flow. ([fa0c8b2](https://github.com/LowCarbCheck/openplate/commit/fa0c8b2))
- **Every setting now reaches openplate-core from your .env file.** `docker/compose.yml` and the sync service in openplate's `docker/topologies/compose.sync.yml` and `compose.full.yml` forward every variable this service reads. The two topology files previously forwarded a subset and required manual additions for the rest. Because of that, web push, open sign-up and its Turnstile pair, the scan trial, reported estimates, paid plans, the AI limits, `NUTRIENT_REFERENCE_BASIS`, `HEALTH_CONSENT_VERSION`, `DATABASE_SSL`, `CONTENT_DIR` and `HOST` never arrived from `.env`. `docker/compose.yml` also lacked `HOST` and `CONTENT_DIR`. Every file forwards `NODE_EXTRA_CA_CERTS`, empty by default, so SMTP can trust a server whose certificate comes from your own certificate authority. Mount the PEM file with the commented volume line and set its container path. With an empty `.env` nothing changes. Check your `.env` before you update: a line that was ignored until now takes effect. The refused names stay out of every file. `.env.example` now states where `INSTANCE_NAME` appears today: on the `/health` handshake and in the start-up log, not in the letters. `tests/unit/compose-env-surface.test.ts` and `tests/unit/compose-defaults-inert.test.ts` keep the files and `.env.example` complete, and keep every default equal to the parser's. ([fd225c3](https://github.com/LowCarbCheck/openplate/commit/fd225c3), [c4546c6](https://github.com/LowCarbCheck/openplate/commit/c4546c6))

### Fixed

- **`latest` now names the newest release.** The `latest` image tag moved with every change to the main branch. It now moves only when a release is cut. The new `main` tag follows the main branch. ([f047e1e](https://github.com/LowCarbCheck/openplate/commit/f047e1e))

### Docs

- **The README links the page of every environment variable.** It also says where `INSTANCE_NAME` appears: on the `/health` handshake and in the start-up log, not in the letters. ([4564174](https://github.com/LowCarbCheck/openplate/commit/4564174))

## [0.25.0] - 2026-09-29

### Added

- **Mail can go out over SMTP.** Set `SMTP_HOST`, `SMTP_FROM`, and `MAIL_OPERATOR_EMAIL`, with `SMTP_PORT` (587 when unset) and `SMTP_USER` with `SMTP_PASSWORD` as the server needs. The invitation, reset, and declaration letters go out through nodemailer. This reverses the earlier decision that SMTP was a non-goal. The HTTP mail API is unchanged. Setting both transports is a boot failure. Port 465 uses TLS from the first byte. Every other port must upgrade with STARTTLS. Only a loopback host such as a local Mailpit may take plain text. Certificates are always checked. Connect, greeting, and socket each time out after 10 seconds. A refused send gives the same answer as a refused HTTP send: `emailed: false` and the link. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD` are no longer refused. `SMTP_SECURE` is still refused, because the port decides TLS. The compose files pass the five new variables through, empty by default. ([67fe8be](https://github.com/LowCarbCheck/openplate/commit/67fe8be))
- **Free trials can now expire after a set number of days.** Set `TRIAL_DAYS` beside `TRIAL_SCANS` and `TRIAL_DAILY_AI_LIMIT`. A new trial ends after that many days, or after its last free scan, whichever comes first. The trial does not end a number of 24-hour periods after sign-up. It ends at midnight after `TRIAL_DAYS` days, and the day the account is created does not count, so 14 days from a sign-up on 2026-09-29, at 10:00 or at 23:30, end at 2026-10-14 00:00. A new optional setting `TRIAL_TIME_ZONE` names the zone of that midnight, an IANA name such as `Europe/Berlin`, `UTC` when unset. An unknown zone, or `TRIAL_TIME_ZONE` without `TRIAL_DAYS`, stops the boot. The AI proxy returns `403 trial-expired` with `"endedBy": "days"`, and `403 trial-scans-spent` now includes `"endedBy": "scans"`. When set, `/health` reports this limit as `instance.trial.days`, and the account view includes `trialEndsAt`. The trial start sets this end date. Accounts created before this setting, or hosted on an instance without it, keep a trial without an end date. Neither limit of the free trial (the scans or the days) ever refuses a paid account. The migration adds two nullable columns and modifies no existing rows. Setting `MEMBER_INVITE_TRIAL=true` beside the member day pair still halts boot, and the error directs you to `TRIAL_DAYS`. `tests/unit/scan-trial.test.ts`, `tests/unit/config.test.ts`, and `tests/integration/scan-trial.test.ts` verify the behavior. ([44bf1f8](https://github.com/LowCarbCheck/openplate/commit/44bf1f8), [8e1709f](https://github.com/LowCarbCheck/openplate/commit/8e1709f))

### Changed

- **Mail no longer starts with links nobody else can open.** With mail
  configured and `NODE_ENV=production`, which the image sets, the service
  refuses to boot when `CLIENT_BASE_URL` or `SERVER_PUBLIC_URL` is a plain
  `http://` address or names this machine (`localhost`, `127.0.0.0/8`, `::1`,
  a `*.localhost` name). The compose files fall back to localhost when
  `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL` are unset. Because of that fallback,
  an install that enabled mail without setting them sent invitations and
  resets with links that open only on the server. The error message names
  each variable, its value, and the target value to set. Without mail, and
  outside production, nothing changes. ([8bb9956](https://github.com/LowCarbCheck/openplate/commit/8bb9956))

## [0.24.0] - 2026-09-29

### Changed

- **An instance that asks for health-data consent now requires it on every data route.** When `HEALTH_CONSENT_VERSION` is set, accounts without that exact version receive `403 health-consent-required` on sync writes, sharing, research, the AI proxy, reported estimates, the pulse, web push, the plans proxy, `PATCH /v1/auth/account`, `POST /v1/auth/invites`, and `POST /v1/auth/change-passphrase`. The server stores, counts, and sends nothing for these requests. Previously, consent was checked only during registration and on the prompt route, so accounts that never agreed could still sync and scan. Accounts retain access to sign in, token refresh, sign out, `GET /v1/auth/account`, the consent endpoint, deletion, and reads of their own blob and key records, which a new device needs before prompting. Consent to an older wording is treated as missing, and the restriction clears on the next request after the user agrees. An instance without the variable refuses nothing. The push scheduler sends no notifications to such an account, even to a device subscribed before the instance asked. It marks nothing as sent, so a catch-up still due goes out once the person agrees. [PROTOCOL.md §5.15.1](./PROTOCOL.md#5151-post-v1authaccounthealth-consent-explicit-consent-to-health-data) lists every affected route, and `tests/integration/health-consent-required.test.ts` checks each one, and `tests/unit/push-consent.test.ts` checks the push scheduler. ([c300c29](https://github.com/LowCarbCheck/openplate/commit/c300c29))

## [0.23.2] - 2026-09-29

### Fixed

- **The image is published for both platforms again.** The `core-v0.23.1` tag
  published no image. Its arm64 build crashed under emulation on GitHub
  runners and hung until timeout. 0.23.2 carries the exact code of 0.23.1.
  Each platform now builds on a runner of its own architecture, so no build
  runs under emulation. ([fb1a0a8](https://github.com/LowCarbCheck/openplate/commit/fb1a0a8))

## [0.23.1] - 2026-09-29

### Fixed

- **The sign-up letter is written in the language the person asked in.**
  `POST /v1/auth/signup-request` already took a `locale`, but it reached only
  the mailed link's `&lang=`, so a German instance sent a German letter to a
  person who asked in English. The letter, and the note to an address that
  already holds an account, now use `locale` when it is valid, and
  `INSTANCE_LANGUAGE` when the request names none. The request and the
  answer are unchanged. ([831ed0e](https://github.com/LowCarbCheck/openplate/commit/831ed0e))
- **drizzle-orm updates past an identifier escaping advisory in the core.** drizzle-orm 0.45.3 carries the fix for GHSA-gpj5-g38j-94v9. A Postgres error that drizzle-orm now wraps is still read by its SQLSTATE, so a storage conflict answers exactly as before. `pnpm audit` reports one moderate advisory left, in a development tool that production never runs. ([ed7b8c5](https://github.com/LowCarbCheck/openplate/commit/ed7b8c5))

## [0.23.0] - 2026-09-28

### Added

- **A paid instance can state its price before sign-in.**
  `GET /v1/plans/prices` is the one anonymous route in the plans subtree: one
  path, one method. It goes to the plans service with `X-Plans-Secret` alone,
  never with an account header or the caller's token, and a token sent with it
  is ignored. A `200` is kept for five minutes and carries
  `Cache-Control: public, max-age=300`, and one source address may read it 60
  times a minute. Every other plans path still needs a token, and without
  `PLANS_UPSTREAM_URL` the path is the ordinary unknown-path 404.
- **The sign-up letter carries the plan a person picked.**
  `POST /v1/auth/signup-request` accepts an optional `plan` (`monthly` or
  `yearly`) and `locale`. When valid, the mailed join link carries
  `&plan=<key>` and `&lang=<code>`. Nothing is stored, and any other value is
  ignored without an error, so the answer is still the same `202`.
- **An instance can ask for explicit consent to health data.** The hosted
  privacy notice names Art. 9(2)(a) GDPR as the basis for the diary, because
  the operator holds a recovery key that can open it, and until now no consent
  was asked or recorded. Set `HEALTH_CONSENT_VERSION` (1 to 32 letters, digits,
  `.`, `_` or `-`, such as `2026-09-28`) and `/health` publishes it as
  `instance.healthConsent`. `POST /v1/auth/signup` then needs
  `"healthConsent": {"version": "<v>"}` and answers
  `400 health-consent-required` without it, spending nothing, so the invitation
  still works. The account row stores the version and the server's instant,
  two new nullable columns that existing accounts get as `null`. The account
  view carries them as `healthConsent`, and the admin view shows them read
  only. `POST /v1/auth/account/health-consent` records the consent for an
  existing account, keeps the first instant on a repeat, and takes a new
  version. Unset, the self-hosted default, changes nothing and the new route
  is the ordinary unknown-path 404. Withdrawal is account deletion.

### Changed

- **The Quadlet units read every setting from an env file you own.** The
  units carried each compose default as an `Environment=` line, most of them
  empty. Podman ranks those above `EnvironmentFile=`. An `ADMIN_TOKEN`, a
  mail key or a link address in `openplate-core.env` never reached the
  container, and Podman 4.9 reads no drop-in to change it. Each unit now
  reads `<unit>.defaults.env`, which ships beside it, and then `<unit>.env`,
  which is yours and wins. Before you copy the new units over an install,
  rename `openplate-core.env` to `sync.env`, move any drop-in setting into
  it, and create an empty `postgres.env`. The unit does not start without
  both files.

### Fixed

- **The security policy and the README no longer call the sync end-to-end encrypted.** The operator keeps a sealed copy of each recovery code (the escrow), so whoever holds the database and `SERVER_SECRET` can read the diary. `SECURITY.md` still described the 0.5 design, with handles, no email and no recovery by anyone. It now describes the current one, and the README's first line says what is true.
- **Finished invitations lose their address.** The hosted privacy notice
  promises that an invitation's address is deleted once it is redeemed,
  revoked or expired, and every finished row still held one. An hourly sweep
  now clears the address and name of every revoked or expired invitation, and
  of every redeemed one on an instance with `TRIAL_ADDRESS_PEPPER`, keeping
  only the keyed trial hash. A resend refuses an invitation whose address is
  gone.
- **On OpenRouter, photos only go to endpoints that keep nothing.** The proxy
  removed every `provider` field, so nothing asked OpenRouter to avoid
  endpoints that store requests or train on them. On an OpenRouter upstream
  the forwarded body now carries `provider: {"data_collection":"deny"}`.
- **An instance with an AI key but no named model looked configured and never
  scanned.** `AI_ADVERTISED_MODEL` was documented as optional, but the
  openplate app sends no model of its own on a managed instance and refuses
  to scan rather than pick one on the operator's bill. Boot now warns when
  `UPSTREAM_API_KEY` is set and `AI_ADVERTISED_MODEL` is not.
- **The compose healthcheck reported unhealthy forever under podman-compose
  1.0.6.** Its array-form `node -e "fetch(...)"` test translated into a
  broken shell line. It is now one `wget` line the image's busybox already
  carries (matching openplate's own compose files), and the generated
  quadlet unit picked up the same change via `scripts/quadlet.sh generate`.

## [0.22.0] - 2026-09-24

### Changed

- **The instance decides what one AI request costs, not the caller** (M256/01).
  The proxy used to forward the chat body unchanged, so with open sign-up any
  stranger could pick an expensive model or a huge answer on the operator's
  key and drain it for every account. Now, for every account:
  `AI_ADVERTISED_MODEL`, when set, replaces `model` in every forwarded body
  (unset still passes the caller's model, for a self-hosted instance that wants
  that); `max_tokens`, `max_completion_tokens` and `reasoning.max_tokens` are
  capped at the new `AI_MAX_OUTPUT_TOKENS` (default 8192), and a body with no
  cap gets `max_tokens` written in; `n` becomes 1; `models`, `route`,
  `provider`, `plugins`, `web_search_options` and `prediction` are removed.
  Nothing is refused for these fields. PROTOCOL.md §5.19 has the table.
- **One scan buys one delivered answer** (M256/02). An intake id whose request
  delivered an answer is no longer reused: the next request on it claims a new
  scan, or is refused with `403 trial-scans-spent` when none is left. A retry
  after an attempt that got no answer still costs nothing more. One id now
  carries at most two overlapping requests on one scan, not three: the app
  sends at most two per action, and its retry after a stale bearer never
  reaches the claim.
- **A late give-back cannot return a newer scan** (M256/02). Each intake row
  carries a claim number (migration `0021_petite_black_tarantula`, one new
  column `ai_trial_intakes.claim`), and a give-back or a delivery only acts on
  the claim it belongs to.
- **One mailbox gets one trial under a race** (M256/02). Redemption and the
  lapsed-trial grant take a transaction-scoped advisory lock on the mailbox
  hash before they ask whether the mailbox had a trial, so two spellings
  redeemed at the same moment grant one trial.

### Added

- **`AI_MAX_OUTPUT_TOKENS`**, the most output tokens one proxied request may ask
  for, default 8192. Forwarded by `docker/compose.yml` and the quadlet.

## [0.21.0] - 2026-09-23

### Changed

- **A scan trial nobody has paid for cannot invite anybody** (M253/11, owner
  decision 2026-09-23). Each member invitation on an instance with
  `MEMBER_INVITE_TRIAL` is a new ten-scan trial, so a free account that could
  invite would mint more free accounts. `POST /v1/auth/invites` now answers
  `403 invites-need-a-plan` for an account that carries `trialScans` and has
  no `allowanceExpiresAt` in the future. The date the biller writes on payment
  opens it, the same rule that lifts the scan gate. The lifetime cap is asked
  first and is unchanged; administrators and the admin mint are unaffected.

### Added

- **`AccountView.invitesNeedAPlan`**, `true` when `invitesLeft` is `0` only
  because the account has not paid yet, on the caller's own view and the
  operator's. Additive: an older client reads `invitesLeft: 0`, which is true.

## [0.20.0] - 2026-09-23

### Added

- **A person can ask an instance for an account.** With `OPEN_SIGNUP=true`,
  `POST /v1/auth/signup-request` takes an address, mints an ordinary addressed
  invite with the operator's own mint code and mails it there, so the letter
  is still the address check, in its own letter: "you, or someone using this
  address, asked to create an account", the link, its expiry, and that
  ignoring it changes nothing. The English is final; the other five languages
  carry the English until they are translated, listed in
  `SIGNUP_LETTERS_AWAITING_TRANSLATION`. It needs mail configured and refuses
  to boot without it. Every address gets the same `202`: an address with an
  account gets the door's own note with no link, and one that already holds a letter from
  the operator or a member gets nothing new. Five requests per source per hour,
  one letter per mailbox per day, and addresses at known throwaway mail
  services are refused with `400 email-domain-refused` (a vendored CC0 list,
  refreshed with `pnpm sync:disposable-domains`). An optional Cloudflare
  Turnstile captcha (`TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`) answers
  `400 captcha-failed` or `503 captcha-unavailable`. `/health` gains
  `instance.openSignup` and, with a captcha, `instance.signupCaptcha`.
  `GET /v1/admin/stats` gains `signup`, the invites this door minted today and
  in the last seven days. Migration `0019` adds `source` and `trial_key` to
  `signup_invites`. Every instance that does not set the variable stays
  invite-only and unchanged.
- **Ten free scans instead of a trial of days.** With `TRIAL_SCANS` and
  `TRIAL_DAILY_AI_LIMIT` (and `TRIAL_ADDRESS_PEPPER` beside them), a new
  account from open sign-up, an invite minted with `"trial": true`, or a member
  invitation under `MEMBER_INVITE_TRIAL=true` gets that many free AI scans with
  no end date. The proxy counts one scan per `X-Intake-Id` (a retry of the same
  action rides on it, a request without one is its own scan), gives it back when
  the person got no answer, including an upstream 5xx, and refuses the next
  action with `403 trial-scans-spent`. A future allowance date lifts the count.
  `AccountView.trialScans` is `{granted, left}` or `null`, every proxied
  response carries `X-Trial-Scans-Left`, and `/health` promises
  `instance.trial`. One mailbox gets one trial, also after a deletion: with the
  pepper, invite rows carry a keyed hash of the mailbox, and deleting an account
  scrubs its address from them and keeps only that hash.
  `AI_TRIAL_INSTANCE_DAILY_LIMIT` caps what trial accounts spend per day. The
  operator PATCH takes `trialScans`, the stats report trials granted and trial
  requests, and `POST /v1/admin/trials/grant-lapsed` (`pnpm sync-api trials
grant-lapsed`) gives the scans to day trials that ran out unpaid. CORS now
  allows `X-Intake-Id` and exposes `X-Trial-Scans-Left`, `X-Quota-Used` and
  `X-Quota-Limit`. Migration `0020` adds the counts, the intake table and the
  hash table. Running three day trials keep their date, and an instance that
  sets none of this behaves as before.

- **Statutory declarations are deleted after their retention period.** A row
  in `legal_declarations` is kept until the end of the third calendar year
  after the year it arrived, in Europe/Berlin time (received 2026-09-21,
  deleted from 2030-01-01 00:00 in Berlin), and the hourly usage sweep deletes
  it then and logs only the count. Deleting an account still does not delete
  its declarations earlier.

### Changed

- **PROTOCOL.md describes open sign-up and the scan trial.** §5.6 gains
  `openSignup`, `signupCaptcha` and `trial`, §5.8 no longer says an invite is
  the only door (it is still the only thing that creates an account), the new
  §5.8.3 specifies `POST /v1/auth/signup-request`, §5.15 gains `trialScans`
  and what a deletion keeps, §5.19 specifies `X-Intake-Id`,
  `X-Trial-Scans-Left`, `403 trial-scans-spent`, the order of the refusals and
  a give-back table for the scan beside the daily unit's, §5.20 the new admin
  fields and route, §5.21 the member door's scan trial, and §9.2 what the trial
  stores. Every change is additive, so `PROTOCOL_VERSION` stays 2. The §5.6 and
  §5.15 examples are now held against the running service by a test.

## [0.19.0] - 2026-09-23

### Changed

- **The declaration letters take their words from a mounted folder.** The
  receipt for a cancellation or a withdrawal, and the operator alert, now read
  their subject and body from `<CONTENT_DIR>/<lang>/mail/`, in a small markdown
  subset with `{{date}}`, `{{receiptId}}`, `{{details}}` and `{{matched}}`
  placeholders. The German and English letter text is gone from this repo.
  With `CONTENT_DIR` unset, or a file missing or refused, a neutral letter goes
  out that states the kind, the receipt number, the time of receipt and every
  field the person gave. The receipt now carries the receipt number in that
  case. See `docs/operations/declaration-mail-text.md`.

## [0.18.0] - 2026-09-21

### Added

- **The service now takes a cancellation or a withdrawal from anyone, with no
  login.** `POST /v1/legal/declarations` is always mounted, and it accepts the
  two declarations German law obliges a seller to accept, the cancellation of
  § 312k BGB and the withdrawal of § 356a BGB. The declaration is written to a
  new `legal_declarations` table before anything else runs, so nothing later
  can lose it, and a lookup by the typed address records the matching account
  when there is one. The forward to the billing service and the two letters, a
  receipt to the person and an alert to the operator, are all best effort. The
  answer is the same `202` whether or not an address matched an account, so it
  tells a caller nothing about who holds an account. Migration `0018` creates
  the table and a rate limit caps what one address and one address range can
  send. ([b673d1a](https://github.com/LowCarbCheck/openplate/commit/b673d1a))

### Changed

- **The mail block takes a fourth variable, `MAIL_OPERATOR_EMAIL`.** The block
  is all or nothing, so an instance that sends mail must now set this address
  as well, and it is where the alert for each declaration goes. An instance
  that sends no mail is unaffected. The shipped `docker/compose.yml` and the
  generated Quadlet unit both carry the
  line. ([b673d1a](https://github.com/LowCarbCheck/openplate/commit/b673d1a)) ([dcd060c](https://github.com/LowCarbCheck/openplate/commit/dcd060c))

## [0.17.1] - 2026-09-20

### Fixed

- **The compose file forwards every optional setting.**
  The service read thirteen variables that the shipped `docker/compose.yml`
  never passed on: `SYNC_FEEDBACK`, `FEEDBACK_DAILY_LIMIT`,
  `FEEDBACK_MAX_REQUEST_BYTES`, `AI_INSTANCE_DAILY_LIMIT`, the three
  `MEMBER_INVITE_*`, the three `VAPID_*`, `PLANS_UPSTREAM_URL`,
  `PLANS_UPSTREAM_SECRET` and `BILLING_TOKEN`. A value set for one of them in
  `.env` was ignored without a word. Each now has a line in the `sync`
  service's `environment:` block. Its default parses exactly like the
  unset variable. The generated Quadlet unit carries the same lines. ([706ecb6](https://github.com/LowCarbCheck/openplate/commit/706ecb6))
- **The Quadlet README said the wrong file wins.** It said a value in
  `openplate-core.env` overrides a unit's `Environment=` line. Podman does the
  opposite, so a setting put there had no effect. It now tells you to change a
  setting with a drop-in. ([706ecb6](https://github.com/LowCarbCheck/openplate/commit/706ecb6))
- **`PROTOCOL.md` documents reported estimates, and no longer says the server
  cannot decrypt.** §5.25 specifies `POST /v1/feedback`. §5.20 lists the four
  `/v1/admin/feedback` routes. §1, §5.23 and §9.1 said the server cannot
  decrypt a diary and never receives the recovery code. Since protocol 2 the
  server keeps that code sealed, and those sections now match §3.1 and §9.2.
  §9.2 also lists reported estimates among what the server knows. ([706ecb6](https://github.com/LowCarbCheck/openplate/commit/706ecb6))

## [0.17.0] - 2026-09-18

### Added

- **The instance chooses whose reference values it shows.**
  A new `instance_settings` row holds one setting, the micronutrient reference
  basis: `dge` (the German DGE, the default), `efsa` (the EU) or `us` (NASEM).
  `PATCH /v1/admin/settings` changes it, `pnpm sync-api settings set
nutrient-reference-basis efsa` is the operator's command for it, and every
  client reads it from `GET /health` as `instance.nutrientReferenceBasis` on
  its next connect. It is the first setting on this service an administrator
  can change without a redeploy; `NUTRIENT_REFERENCE_BASIS` in the environment
  is now only the boot default. `/health` serves a process-local copy of the
  value and never queries the row: that path is the container's own
  healthcheck, so a read there would turn a database hiccup into a restart.

## [0.16.0] - 2026-09-14

### Added

- **The letters exist in four more languages.**
  `INSTANCE_LANGUAGE` accepts `fr`, `it`, `es` and `tr` beside `en` and `de`,
  and a push subscription's `locale` accepts the same six. The invitation, the
  password reset and the account notice were bought in the four new languages
  from the English by the same model under the same style contract the
  website and the app use, addressing the reader informally as the German
  does, and they live in `src/mail/strings.<lang>.ts`, one generated module
  each, checked by the compiler with the hand-written two. The expiry date in
  an invitation now renders in the reader's own language for every one of the
  six; before this, every language but German got an English date. ([fdf147e](https://github.com/LowCarbCheck/openplate/commit/fdf147e))

## [0.15.0] - 2026-09-14

### Added

- **The member invite cap comes from the environment.**
  `MEMBER_INVITE_LIFETIME_CAP` sets how many invitations one member may cause
  in their whole life. It is optional, it takes an integer of 0 or more, and it
  defaults to 5, which is the number every instance has enforced since the
  feature shipped, so an upgrade changes nothing. Set it to 2 on a managed
  instance whose administrator pays for the provider key. Zero keeps
  `POST /v1/auth/invites` mounted and leaves every member with nothing to
  spend. Setting it while `MEMBER_INVITE_DAILY_AI_LIMIT` and
  `MEMBER_INVITE_ALLOWANCE_DAYS` are unset is a boot failure naming it, because
  members cannot invite anybody there and the cap would narrow a door that is
  not open. Administrators stay exempt, and `AI_INSTANCE_DAILY_LIMIT` still
  bounds what the whole instance may spend per day whatever the cap is. ([c7c4958](https://github.com/LowCarbCheck/openplate/commit/c7c4958))

## [0.14.0] - 2026-09-12

### Added

- **A shrinking blob is acknowledged, or it is refused.**
  A push whose ciphertext is under half the stored version's `size_bytes` is
  now answered `400` unless the request body carries
  `"shrinkAcknowledged": true`. Absent means false, so every deployed client
  says no and none of them can wipe an account. A person lost her whole diary
  on 2026-09-12 to a client that found its local store evicted, concluded she
  had deleted every entry, and pushed a tombstone for each one, 5310 bytes to
  1588 in one accepted write; a second device then pulled that blob and deleted
  its own rows. A client fix reaches nobody who has not updated, and an
  installed progressive web app cannot be made to update, so the refusal lives
  here. The guard reads `size_bytes`, which this service already stored and
  already reported, so it discloses nothing new. What it gives up is the claim
  to be a store with no opinion about what it holds. `400` and not `409`,
  because `409` already means "another device wrote first" on this route and
  obliges a client to push the same bytes again. A body field and not a header,
  because a new header must be named in the CORS allow list or browsers drop
  the request after a clean preflight.
  ADR 0009 states the trade: the false positives cost a field, the false
  negatives cost data. ([9fe93fd](https://github.com/LowCarbCheck/openplate/commit/9fe93fd))

- **Tiered blob retention, and a pin on the version before an acknowledged shrink.**
  `BLOB_VERSION_RETENTION` keeps its name and its five, and becomes one tier of
  three: the newest 5 versions, the newest version of each UTC calendar day for
  14 days, and up to 14 versions held for 14 days because an acknowledged large
  shrink replaced them. At most 33 versions and 66 MiB per account, and the
  daily tier is per calendar day rather than per count so two devices in a merge
  loop cannot burn through it. The flat five was the only reason the wiped diary
  above was recoverable at all, and by luck. ([9fe93fd](https://github.com/LowCarbCheck/openplate/commit/9fe93fd))

- **An operator can roll a blob back.**
  `GET /v1/admin/accounts/:id/blob/versions` lists every retained version with
  its byte count, its time and its pin, and never its bytes.
  `POST /v1/admin/accounts/:id/blob/rollback` makes an older version current
  again by deleting the versions above it, refusing an unknown version, the
  current version, an envelope format this build cannot accept and a zero-byte
  row. A rollback rather than a re-upload because the envelope binds
  `blobVersion` into its AAD: re-inserting old bytes as a new version yields
  something no client could ever decrypt.
  `pnpm sync-api accounts blob-versions <id>` and
  `pnpm sync-api accounts rollback <id> --to-version <n> --yes`.
  `docs/operations/restoring-a-wiped-diary.md` is the playbook, and its
  non-negotiable step is the one the rollback cannot do: every device the person
  signed into still holds the baseline that caused the loss, and has to have its
  local data erased before it syncs again. ([9fe93fd](https://github.com/LowCarbCheck/openplate/commit/9fe93fd))

### Changed

- `sync_blobs` gains a nullable `pinned_until`. Migration `0016`. ([9fe93fd](https://github.com/LowCarbCheck/openplate/commit/9fe93fd))

## [0.13.0] - 2026-09-12

### Added

- **Web push, carrying a kind and never a sentence.**
  Four member routes under `/v1/push` let a device register where to reach it,
  the minute of its own local day it wants a morning catch-up, and the instant
  a fast reaches its target. A minute tick sends at most two pushes per
  subscription per UTC day, pauses for anybody who has not opened the app in
  seven local days, and deletes a subscription the push service answers 404 or
  410 for. The payload is `{"kind":"catch-up"}` or `{"kind":"fast-target"}`:
  the device writes the words, because this server cannot read the diary they
  describe. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
  together, or none of them and the whole subtree answers the ordinary 404 and
  `/health` reports `push: false`. `pnpm sync-api push keygen` prints a pair.
  ADR 0008 names push scheduling as the fourth exception to zero knowledge and
  the `wake_at` correlation with the pulse's presence row.
  `GET /v1/admin/stats` gains `push: { subscriptions, sentToday }`.

- **An opt-in pulse: instance-wide counts for the day, and who is fasting right now.**
  Four member routes under `/v1/pulse` take small rounded deltas from devices
  whose owner turned the pulse on (a meal with its calories rounded to 50 and
  protein to 5 g, a photo, a "still fasting" heartbeat) and answer today's sums
  plus the live fasting count from a 5 minute cache. Day sums keep 30 days,
  presence rows expire 30 minutes after the last heartbeat, idempotency keys
  24 hours, all swept hourly. The routes log no account id. ADR 0007 names the
  pulse as the third exception to zero knowledge; `PROTOCOL.md` §5.23 has the
  wire shapes. `GET /v1/admin/stats` gains the same numbers.

### Fixed

- **Browsers could not send a pulse write, or read a Retry-After.**
  `Access-Control-Allow-Headers` never named `Idempotency-Key`, which every
  write under `/v1/pulse` carries, so a browser read the preflight and refused
  to send the request at all: no request arrived, no log line was written, and
  the app saw a write that never answered. The same response now also sends
  `Access-Control-Expose-Headers: Retry-After`, so a rate-limited client can
  read the wait this service computed instead of guessing one. Both were
  invisible to `curl` and to the test suite, because neither enforces CORS;
  operators need no configuration change, only the new image.

## [0.12.0] - 2026-09-09

### Added

- **A billing principal reaches two fields and nothing else.** `BILLING_TOKEN`
  authenticates a caller scoped to reading and writing only `dailyAiLimit` and
  `allowanceExpiresAt` on one account, off unless you set it.
- **`/v1/plans` passes an authenticated caller through to one upstream.**
  `PLANS_UPSTREAM_URL` and `PLANS_UPSTREAM_SECRET` turn it on; unset, the
  whole subtree answers the ordinary unknown-path 404.

## [0.11.0] - 2026-09-09

### Added

- **An account's AI allowance can carry an expiry date.** `allowanceExpiresAt` is
  nullable and stays off unless an admin sets one on an account; sync never
  gates on it, only the AI proxy does.
- **The instance can cap its own total AI spend.** `AI_INSTANCE_DAILY_LIMIT`
  bounds every account together in requests per UTC day, and it is off unless
  you set it.
- **A member can invite up to five people on the instance's own terms.**
  `MEMBER_INVITE_DAILY_AI_LIMIT` and `MEMBER_INVITE_ALLOWANCE_DAYS` set the
  allowance a member's invitation carries, and the whole feature is off unless
  both are configured.

## [0.10.0] - 2026-09-09

### Changed

- **The repo, the package and the published image are now `openplate-core`.**
  The hostname `sync.openplate.de`, the `/v1/sync` routes, the
  `SYNC_SERVER_URL` env var and the `pnpm sync-api` CLI are unchanged; only
  the project's own name moved. A self-hoster's only action is to repoint
  their image reference to `ghcr.io/lowcarbcheck/openplate-core`.

## [0.9.0] - 2026-09-08

### Added

- **One activity read for a whole page of accounts.** `GET /v1/admin/activity`
  returns the same daily photo counts as the single account endpoint, for every
  account on a page, in the order `GET /v1/admin/accounts` returns them. The
  console draws a strip beside every row of its people list, and the only way
  to do that before was one request per person. It pages exactly like the
  accounts list, same defaults, same bounds, same refusal, so a caller reads
  the two in lockstep. The store beneath it reads the whole page in one query
  rather than moving the N+1 down a layer.

  Every account on the page is in the answer, including one that has never made
  a request, whose strip is zeroes. Leaving it out would make "this person did
  nothing" and "this person was not in the answer" the same fact, which is the
  distinction the zero fill exists to keep.

### Changed

- The paging refusal that `GET /v1/admin/accounts`, `GET /v1/admin/activity`
  and the feedback list all answer with is now one sentence in one place. It
  also drops an en dash for a hyphen.

## [0.8.0] - 2026-09-08

### Added

- **An operator can see who is actually using the instance.** `last_seen_at`
  now reaches the admin account view, and `GET /v1/admin/accounts/:id/activity`
  returns a bounded, zero-filled strip of daily photo counts. Both facts were
  already in the database and read by nothing, so this is a read path and not a
  new collection: no migration, no new write, and nothing about a person that
  was not already recorded. The blobs stay end to end encrypted and no endpoint
  added here exposes any diary content.

  The window is zero filled on purpose. A day with no activity and a day
  outside the window must not look the same to whoever reads the strip, because
  "they stopped" is exactly the question the strip is for.

### Changed

- **`ai_usage_days` now expires at ninety days.** Nothing pruned it before, and
  the schema said so. A per-day activity log kept for the life of a deployment
  is health-revealing on its own, so the retention limit landed together with
  the screen that reads it rather than after it. `AI_USAGE_RETENTION_DAYS` is
  one definition, shared by the prune and by the longest activity window the API
  will draw, so a pruned row can never be served as a quiet day.

- **The usage sweep runs on every instance, not only where AI is configured.**
  It used to sit behind `config.ai`, which left exactly the wrong case
  unswept: an instance that had an upstream key once and none today kept those
  rows forever.

- `last_seen_at`'s comment no longer claims the AI proxy is its only writer.
  A login writes it too, and the comment had been wrong since login was added.

## [0.7.0] - 2026-09-07

### Added

- **A person can report a wrong estimate, and this service can hold what they
  send.** `POST /v1/feedback` takes an entry's figures, its consent record and
  optionally the photograph. `GET`/`DELETE /v1/admin/feedback` let an
  administrator read and remove one. A sweep deletes anything past the retention
  window without an operator remembering to.

  **This is the second place this service's zero-knowledge position does not
  hold, and it is not the same shape as the first.** The AI proxy sees a
  photograph and keeps nothing. This KEEPS what it is given, and an
  administrator can look at it. Read
  `docs/adr/0006-a-reported-photograph-is-the-second-hole-in-the-claim.md`
  before you turn it on.

- **`SYNC_FEEDBACK`, off by default.** Unset, the whole `/v1/feedback` and
  `/v1/admin/feedback` tree answers the ordinary 404 any unknown path answers,
  to everybody, with or without a valid token. An instance without it is
  indistinguishable from one built before the feature existed, which is the same
  bargain `SYNC_SHARING` and `SYNC_RESEARCH` make. `FEEDBACK_DAILY_LIMIT` and
  `FEEDBACK_MAX_REQUEST_BYTES` bound it.

- **The retention window is advertised on `GET /health`** (`instance.feedback.retentionDays`,
  PROTOCOL.md 5.6), so the client shows the window this server will actually
  apply rather than a number of its own. With the feature off the key is absent,
  not null. The window is one constant here; there is no second copy anywhere to
  drift from it.

- **Migration `0010`.** `feedback_reports` and `feedback_images`, both cascading
  from the account, so erasing an account removes its reports and its
  photographs. The idempotency key is unique PER ACCOUNT, so one account cannot
  burn a key value for another.

- The image is stored in this Postgres, behind a `FeedbackImageStore` interface
  with `put`, `get` and `delete`. There is no S3 client and no AWS dependency;
  the interface exists so a later move is one adapter and no caller change.

- Every read of a reported photograph is logged: which administrator, which
  report, when.

## [0.6.2] - 2026-09-07

- `PROTOCOL.md` now carries a sequence diagram of one session. It shows the
  version handshake, a sign-in, and a push, including the conflict path where
  the client fetches, merges and pushes again. The handshake is drawn failing
  closed.
- The README and the protocol were reworded to drop every em dash and en dash.
  No obligation changed, and every code span is byte for byte what it was.

## [0.6.1] - 2026-09-05

- The README now lists the published documentation (`PROTOCOL.md`) in a
  Documentation table, so the project site at openplate.de can quote it.
- A release now tells the site to re-quote the docs.

## [0.6.0] - 2026-09-04

One server. This service is now the whole backend an openplate deployment
needs: identity by email address, organization roles, an escrowed password
reset that restores the diary, and the AI proxy that used to live in a separate
gateway. The gateway is retired.

### BREAKING

- **`accounts.handle` is `accounts.email` again** (migration `0009`), unique per
  server, canonicalised with NFKC then trim then lowercase. `PROTOCOL.md` calls
  the field `email` everywhere, and the server rejects an address with no `@`.
  0.5.0's handles were a five-week detour; the reason for the return is that a
  password reset needs somewhere to send the letter.
- **PROTOCOL_VERSION is 2.** A 0.5.0 client sends a `handle` this server does
  not accept, and a 0.6.0 client sends an `email` a 0.5.0 server does not. The
  `/health` handshake (§6) turns that into a clear refusal rather than a
  partial failure. **The openplate client must be 0.10.0 or newer.**
- **Signup takes an ADDRESSED invite.** `POST /v1/auth/signup` reads the email
  from the invite row and ignores any address in the body, so the person who
  received the letter is the person who signs up. There is no confirmation
  link, because there is nothing left to confirm.
- **Signup writes both key records itself**, the passphrase-wrapped one and the
  recovery-wrapped one, in the same transaction as the account. A first
  `PUT /v1/sync/key-records` with `expectedUpdatedAt: null` is therefore a
  genuine `409` on any account created by this version: every put is a
  rotation now.
- **`SIGNUP_MODE` is removed and is a boot failure**, along with the older
  `SIGNUPS_OPEN`. Signup is invite-only, always; there is no mode to set and
  therefore no mode to get wrong. `EMAIL_FROM`, `SMTP_*`, `PIGEON_*` and
  `REQUIRE_EMAIL_VERIFICATION` remain boot failures, mail is `MAIL_API_*` now.
- **`POST /v1/sync/rotate-dek` requires `newRecoveryAuthHash` and
  `recoveryCode`.** The recovery verifier and the escrow are replaced in the
  same transaction as the wraps. Without that, a rotation left the old recovery
  code able to open the new data key, which is the opposite of what a rotation
  is for.
- **The openplate gateway is retired.** Its `/v1/chat/completions`, its family
  invites and its own account model are gone. Point the client's AI at this
  service instead; the request shape is unchanged, and the token is now the
  ordinary sync access token.

### Added

- **The AI proxy.** `POST /v1/chat/completions` forwards a signed-in account's
  completion request to the operator's provider, spending one unit of that
  account's daily allowance. The caller's token is replaced by the operator's
  key rather than merged with it, inbound headers are rebuilt rather than
  copied, responses stream, and **no body is ever logged**. Every string that
  came off the upstream wire passes through a scrubber before it reaches a log
  line or a response, because a provider that rejects a request routinely
  echoes the image back inside its error body. Configured with
  `UPSTREAM_BASE_URL` + `UPSTREAM_API_KEY`; unset, the route answers the
  ordinary unknown-path 404.
- **A per-account daily allowance** in `ai_usage_days`, reserved before the
  upstream call in one atomic statement and released only when the provider
  cannot have billed us. `X-Quota-Used` and `X-Quota-Limit` on every proxied
  answer; `429` with `Retry-After` to the next UTC midnight at the limit;
  `403 ai-not-allowed` for an allowance of zero, before anything leaves the
  host. Plus a per-account limiter of `AI_RATE_LIMIT_PER_MINUTE` (default 20),
  which is a different bound for a different failure: a stuck client retrying
  on every error.
- **A password reset that restores the diary.** The client's recovery code is
  sealed at signup into `accounts.recovery_code_escrow` under a subkey of
  `SERVER_SECRET`. `POST /v1/auth/reset/request` sends a link,
  `POST /v1/auth/reset/open` spends it once and returns the code, and the
  client then runs the ordinary recovery ceremony. **The reset endpoint writes
  nothing to the account.** The cost is stated in the README and argued in
  ADR-0005: the operator of a hosted instance can open any account on it.
- **Roles and standing.** `role` (`admin` | `member`), `daily_ai_limit`,
  `suspended_at` and `last_seen_at` on the account. An admin account reaches
  `/v1/admin` with its own access token, which is what puts the console in the
  app at `/admin` rather than in a shell; `ADMIN_TOKEN` remains as the
  break-glass credential and is still optional.
- **Mail.** `MAIL_API_URL` + `MAIL_API_KEY` + `MAIL_API_FROM`, all three or
  none, over pigeon's HTTP API. Two letters exist and no more: an invitation
  and a password reset, in English or German per `INSTANCE_LANGUAGE`. Unset,
  both come back to the operator as links to paste.
- **Admin writes.** `PATCH /v1/admin/accounts/:id` (role, allowance, display
  name, suspension), `POST /v1/admin/accounts/:id/reset-mail`,
  `POST /v1/admin/invites/:id/resend`, `total` on both lists, and
  `pendingInvites` / `admins` / `aiRequestsToday` on stats. Suspending revokes
  every session in the same act. An administrator cannot suspend, demote or
  delete **their own** account; the static token is exempt because it has no
  self and is the way back in.
- **CLI**: `accounts set-role`, `accounts set-limit`, `accounts suspend`,
  `accounts reactivate`, `accounts reset-mail`, `invites resend`, and
  `--daily-limit` on `invites create`.
- **`/health` reports `instance`**: the instance name, its language, whether it
  can send mail, and `ai`, `{ "model": … }` when an upstream is configured and
  `null` otherwise. Descriptive, never a grant: an account with an allowance of
  zero gets a 403 whatever it says.
- **`AI_MAX_REQUEST_BYTES`, default 8 MB**, the proxy route's body limit,
  sized for a camera photograph after base64 rather than for a stored blob. In
  the same change, every router's `express.json()` was scoped to its own path
  prefix: they are all mounted at the root, so an unscoped parser applied to
  the whole service and whichever ran first silently capped every other route.
  The visible effects were a `413` on every plate photograph and on any blob
  push over 64 KB.
- **`undici` as a runtime dependency**, the fourth after express, pg and
  dotenv. Node's global `fetch` applies a 300-second header timeout that an
  `AbortSignal` can only tighten, so an operator setting
  `UPSTREAM_TIMEOUT_MS=600000` would be cut off at 300 with an error naming no
  knob. It is external to the bundle.

### Removed

- `POST /v1/auth/verify-email` stays gone, and the 0.5.0 handle endpoints are
  replaced rather than renumbered. `SIGNUP_MODE` and `SIGNUPS_OPEN` are gone
  from the code and are boot failures if set.
- `signup_invites.note` is gone; the row carries `email`, `display_name`,
  `role`, `daily_ai_limit` and `revoked_at` instead. An invitation is addressed
  now, so an operator's private note has no place to be.

### Upgrading

1. **Back up the database and `SERVER_SECRET` together.** Migration `0009`
   renames a column and adds two tables. Neither half restores anything usable
   without the other, and this release makes that more true rather than less:
   the escrow is sealed under a subkey of that secret.
2. **Every account needs an email address.** The rename carries the handle over
   as-is, so any handle that is not an address must be corrected before the
   person can be sent a reset. `pnpm sync-api accounts list` shows what you
   have.
3. **Upgrade the client to 0.10.0 or newer, at the same time.** The protocol
   version moved, so a mixed pair refuses to talk rather than half-working.
4. **Set `MAIL_API_*` if you want the letters posted.** Unset, invitations and
   resets are returned to you as links, which is a complete and supported way
   to run this.
5. **Retire the gateway.** Move `UPSTREAM_BASE_URL` and `UPSTREAM_API_KEY` onto
   this service, give each account an allowance
   (`pnpm sync-api accounts set-limit <id> <n>`, it defaults to 0), and stop
   the gateway container. Its family invites have no equivalent here: a person
   gets a signup invitation instead, and one account covers both sync and AI.
6. **If you run your own Compose file**, add the new variables to its
   `environment:` block. Compose forwards only what that block names, so a
   variable set in `.env` alone never reaches the container.

## [0.5.0] - 2026-09-02

Identity without email. An account is a **handle** plus a passphrase, and a lost
passphrase is recovered with the recovery code the client showed the user at
signup. The service sends no mail and stores no email address.

### BREAKING

- **`accounts.email` is now `accounts.handle`** (migration `0007`), and
  `email_verified_at` is dropped. The server rejects any handle containing `@`,
  canonicalises with NFKC then trim then lowercase, and keeps it unique per
  server.
- **Removed endpoints**: `POST /v1/auth/verify-email`,
  `POST /v1/auth/request-reset`, `POST /v1/auth/reset`. They answer `404`.
  `PROTOCOL.md` §5.12 and §5.13 are marked REMOVED rather than renumbered, so
  section references in both repos still resolve.
- **Removed env vars, and each is a boot failure rather than a no-op**:
  `REQUIRE_EMAIL_VERIFICATION`, `CLIENT_BASE_URL`, `EMAIL_FROM`, `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `PIGEON_API_KEY`,
  `PIGEON_BASE_URL`. A container that refuses to start costs one deploy; a
  variable that is quietly ignored lets an operator believe mail is configured
  on a service that has no mailer.
- **A pre-0.5.0 client cannot talk to a 0.5.0 server.** It sends an `email`
  field that no longer exists and calls endpoints that are gone. The `/health`
  handshake (`PROTOCOL.md` §6) is what turns that into a clear refusal instead
  of a partial failure.
- **Signup invites now carry an `si_` prefix.** A token of the wrong shape is
  refused by a shape gate before any lookup, with the same answer an unknown or
  spent invite gets. A gateway `gi_` token can no longer be posted here.

### Added

- **The recovery code is the second authenticator.** `POST /v1/auth/recover`
  and `POST /v1/auth/recover-rotate` let a user who holds their recovery code
  set a new passphrase. The client derives its proof under a new frozen HKDF
  label, `openplate-sync:recovery-auth:v1`, which is deliberately never the
  recovery-KEK label. Both endpoints are throttled per IP and handle, and both
  answer every failure identically.
- `accounts.recovery_verifier` (migration `0008`), stored with the same peppered
  `computeVerifier` the passphrase uses.
- **The operator notice.** `SYNC_NOTICE` and the optional `SYNC_NOTICE_URL` are
  published on the `/health` handshake and shown by the client. It is pull, not
  push: the service still has no way to contact anyone. A notice over 280
  characters, or a URL whose scheme is not http(s), or a URL without a notice,
  is a boot failure.

### Removed

- `src/mail/` and all three transports (pigeon, SMTP, console), the
  email-verification and auth-reset token kinds, and the reset-link plumbing.
  The mailed reset was an account-takeover path that returned no recovery: the
  DEK is wrapped under keys the server never sees, so whoever redeemed a link
  got a login to a diary they still could not read.

### Changed

- Anti-enumeration is unchanged. The signup `409` stays the one accepted oracle,
  and it now leaks an opaque per-server handle rather than a person's address,
  which is strictly less.
- `docker/compose.yml` forwards `SYNC_NOTICE` and `SYNC_NOTICE_URL`, which the
  README and `.env.example` already documented as operator settings.
- Docs: `PROTOCOL.md`, `SECURITY.md`, `README.md` and `.env.example` match the
  service. `docs/adr/0004-identity-without-email.md` records the decision.

### Upgrading

Losing both the passphrase and the recovery code ends an account. There is no
third path, because a reset the server could perform would mean a server that
can open your data. Say this to your users before you upgrade.

## [0.4.1] and earlier

Not recorded here. See the git history.
