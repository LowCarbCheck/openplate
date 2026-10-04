# Changelog

All notable user-facing changes to openplate are recorded here, newest version first. From 0.20.0
on, a version's changes are grouped under `### Added`, `### Changed`, `### Fixed` and `### Docs`,
in that order and only where there is content, and every bullet opens with a short bold lead
sentence. That lead is the line the GitHub Release page prints, so it is written as the sentence an
operator reads there. Older versions carry a single flat list. Every entry links the commit it came
from. The `## [Unreleased]` section holds merged work waiting for a release. The release commit
renames that heading to `## [x.y.z] - YYYY-MM-DD`, appends the commit links, and re-creates an empty
`## [Unreleased]` above it. See [`AGENTS.md`](./AGENTS.md), _Versioning and changelog_.

## [Unreleased]

### Added

- **The plan page now lists the tiers a plan service sells, and a subscriber can switch between them.** When the plan service sends tiers, the page lists each one with the name, description, daily AI scans, included features and prices exactly as the service sent them, and marks your own tier. A first order picks a tier, then its interval, and the order carries the tier beside the plan key it always sent. A subscriber gets a switch button on every other tier, and on their own tier when it can move from monthly to yearly. Before the order the page says when the change takes effect: now with the price settled pro rata for a higher tier, at the end of the paid period for a lower tier or the yearly plan. After the order it shows what the service answered. The same two consent boxes apply as for a first order. A service that sends no tiers draws the page it drew before. The words are in `plan.tiers.*` and `plan.move.*`.
- **The order page now says what happens to your data above the payment boxes.** When the plan service sends its privacy lines, a plain box above the two consent boxes shows them, with a link to the privacy notice on an instance that publishes one. The box is drawn in the same moment as the rest of the order, so nothing moves when it arrives. The words are the service's own, and the link label is in `plan.order.privacyLink`.
- **A plan can now leave out a feature, and the app shows it the same way everywhere.** The fasting timer and the pantry scan draw a short note with a lock mark and a link to the plan page when the plan does not include them. Past fasts, the stats, the stored pantry list and a fast that is already running stay. A self-hosted instance, an instance with no plans and a person on their own AI key never see the note. The words are in `featureGate.*`, and the decision is `ADR-0024`.

### Changed

- **A spent day of AI scans now points at the plans where there are any.** When the daily scans are used up and no paid period is running, the scan screen says so and shows the plan page. An instance with no plans, and a person whose paid period is running, still read the plain sentence to try again tomorrow. The new sentence is `scan.errors.provider.allowanceSpentPlans`.
- **A refused feature now shows the same note instead of an error.** When the server answers that the plan does not include the pantry, the screen shows the plan note in the place of the error box. The request for a pantry photo, a typed list or a recipe now names its feature in a header, and only on the instance's own AI, never on a key you brought.

## [0.63.0] - 2026-10-05

### Added

- **The sign-up page now says what happens to your data.** On an instance that runs its own AI and publishes a privacy notice, a plain box under the sign-up form says that the server passes a photo on and does not save it, who receives it, that a reported photo is kept for up to 37 days, that the operator holds a recovery key and can read the diary, and what deletion removes. It links the privacy notice and the public source of the photo proxy. The box is drawn in the same moment as the form, so nothing moves when it arrives. Self-hosted instances and instances with no legal pages do not show it. The sentences are in `signUp.whatHappens.*`. ([6d54991](https://github.com/LowCarbCheck/openplate/commit/6d54991))

### Changed

- **The What's new card is hidden until you switch it on.** The card on the diary and the dashboard, and the release notes row in About, now show by default only for administrators. Everyone else turns them on with a new switch in Preferences, and an administrator can turn them off there. The choice is kept on the device, and the notes page still opens at `/settings/whats-new`. ([932d98c](https://github.com/LowCarbCheck/openplate/commit/932d98c))
- **The sign-out dialog now loads when it is needed, not with every page.** The public front page used to download the whole sign-out dialog and the sync code behind it, about 48 KB gzip, for visitors who never sign in. The dialog is now a separate chunk. Once you are signed in the app fetches it in the background when the browser is idle, so Sign out still opens at once on a poor connection or in a tab that was left open across an update. ([be5d3ce](https://github.com/LowCarbCheck/openplate/commit/be5d3ce))
- **The push gate now runs a scoped browser tier, and the full tier runs on a release tag and every night.** A push runs the smoke set, the specs for the touched area and the specs the push changed, so it stays under about 3 minutes. Shared code still runs everything. Pushing a tag `v*`, `core-v*` or `inference-v*` runs the full tier first, and a nightly run on origin/main reports to `~/.local/state/openplate/nightly-e2e/latest.txt`. The reasons are in `ADR-0022`. ([35f70c1](https://github.com/LowCarbCheck/openplate/commit/35f70c1), [e68337d](https://github.com/LowCarbCheck/openplate/commit/e68337d))
- **The What's new card now sits at the end of the diary and the dashboard.** It used to appear at the top a moment after the page opened, and it pushed the whole page down when it did. Now it arrives under the last block, so nothing on the page moves when it shows or when you dismiss it. On a long day you scroll to the bottom to find it. ([5ff3790](https://github.com/LowCarbCheck/openplate/commit/5ff3790))
- **The health consent text now says the operator can read your diary.** The box on the consent screen used to describe the processing without saying who can open the diary. It now says that a photo or text sent for analysis goes through this server to the AI service it uses, that on app.openplate.de this is OpenRouter in the USA and then Google, that the operator holds a recovery key and can read the diary, and that deleting the account withdraws the consent. The consent version is unchanged, so nobody is asked again by this edit alone; raise `HEALTH_CONSENT_VERSION` on the instance to ask everyone again. ([7f8113f](https://github.com/LowCarbCheck/openplate/commit/7f8113f))

### Fixed

- **A browser-tier shard whose app server dies now stops and says so.** Before, the shard ran its remaining specs against a closed port and the gate listed about a hundred `ERR_CONNECTION_REFUSED` failures. Now one line names the shard, the port and the time, the server's last output is printed, and the shard keeps its server output in `test-results/shard-<i>/server.log`. ([45ee287](https://github.com/LowCarbCheck/openplate/commit/45ee287))
- **Signed-in people can now reach the legal pages from Settings.** The About screen lists Privacy, Terms, Imprint, the cancellation page and the withdrawal page under a Legal heading, in the footer's order. Before, only the logged-out footer drew them, so a person using the app had no link to the imprint. The group is drawn only when `CONTENT_DIR` holds the legal pages, as the footer is, so an instance without the folder shows no Legal heading and no dead links. ([422a808](https://github.com/LowCarbCheck/openplate/commit/422a808))
- **A failed erase on sign-out now says so, and Escape no longer closes a running sign-out.** The sign-out dialog used to disappear the moment the session closed, so when the erase failed (a second tab held the diary) the person saw a signed-out app, the diary still on the device and no message. The dialog now stays on screen until the sign-out finishes, shows the error inside itself and lets the person try again. While the sign-out runs, Escape and a click outside no longer close it. ([22c0b94](https://github.com/LowCarbCheck/openplate/commit/22c0b94))
- **The sign-out dialog shows its erase warnings only after you tick the erase box.** A plain sign-out deletes nothing, but the dialog used to open with how many changes have not reached the server and a pointer to the backup, which read as if signing out removed data. The warnings now appear when you tick "Also erase the diary from this device", and they stay as they were when you ticked. The box waits until the dialog has checked the device, and nothing in the dialog moves when you tick it or when an erase fails. The error for a blocked erase now says that you are signed out and the diary is still on the device. ([16b120f](https://github.com/LowCarbCheck/openplate/commit/16b120f))
- **The Settings sign-out button no longer claims it signs you out everywhere.** Signing out ends the session on this device only, and other devices keep theirs; only deleting the account ends them all. The button now reads "Sign out", and the note under it says the diary stays on this device, or, on a managed instance where the device hides the diary until you sign in again, that it stays in your account. ([90d9d32](https://github.com/LowCarbCheck/openplate/commit/90d9d32))
- **Signing out lands on the right page instead of flashing the front page.** On an open instance a sign-out used to load the front page for a moment and then jump back to the dashboard. It now goes straight to the dashboard, because the diary is still there. When the diary is hidden or erased, on a managed instance or after you tick the erase box, it goes to the welcome screen. That is the same screen you reach when the server ends your session, so a sign-out you chose and one the server made now look the same. ([d775a99](https://github.com/LowCarbCheck/openplate/commit/d775a99))
- **Signing out now releases this device's push subscription.** A plain sign-out used to leave the browser subscribed and the server row in place, so a shared device kept getting notifications, and their text is built from the last numbers on the device. Signing out now deletes the server row while the session is still valid, drops the browser subscription and forgets the endpoint, waiting at most three seconds when the network is down. Your notification choices stay, and the switch simply reads off until you turn it on again with one tap. A sign-out on a device with no open session drops only the browser subscription, and the server removes the dead endpoint on its next send. ([599776d](https://github.com/LowCarbCheck/openplate/commit/599776d))
- **A sign-out no longer hangs when the server never answers.** A running sign-out cannot be closed, so it has to end, and the logout request had no time limit: a captive portal or a half-open connection left the dialog spinning for as long as the browser cared to wait. The app now stops waiting four seconds after it sends the logout, signs this device out anyway and leaves. An unrevoked access token expires on its own within minutes, and a late answer changes nothing. ([c6a2e06](https://github.com/LowCarbCheck/openplate/commit/c6a2e06))
- **A suspended account is told it is suspended, not asked to sign in again.** When an administrator suspended an account, the welcome screen said the session had ended and to sign in again, and that sign-in cannot work. It now says the account is suspended and to ask the administrator. A session that ended for any other reason keeps the sign-in line, and on an instance that hides the diary at sign-out it now also says this device hid the diary and that nothing has been lost. ([d08bd25](https://github.com/LowCarbCheck/openplate/commit/d08bd25))
- **A second open tab now leaves the diary when another tab signs out.** The other tab used to carry on showing the diary until its access token failed, about 15 minutes later, and then said the session ended as if the server had ended it. After an erase it could also write the sync baseline, the outbox and the photo database back onto the cleaned device. A tab that shows the diary now listens for the device lock and for the erase of its own account, and leaves by a full page load, to the welcome screen when the device is locked and to the dashboard otherwise. On an open instance a plain sign-out sets neither, so a second tab stays on the diary, which is still readable there. ([7f02194](https://github.com/LowCarbCheck/openplate/commit/7f02194))
- **Cancel after a failed erase now takes you out of the diary.** When the erase on sign-out failed because another tab held the diary, the sign-out had already ended the session, but Cancel left you on a diary page you were no longer signed in to. Cancel and Escape now leave for the page a sign-out lands on. The message says to close the other tab and press Sign out again. ([be5d3ce](https://github.com/LowCarbCheck/openplate/commit/be5d3ce), [99fa7fc](https://github.com/LowCarbCheck/openplate/commit/99fa7fc))
- **The erase box no longer stays disabled when another tab hangs the check.** The dialog counts what an erase would lose by reading the diary under a lock that every open tab shares, and a tab stuck in a sync could hold it for good, which left the box disabled for as long as the dialog was open. After five seconds the dialog now stops waiting and says it could not check, and the box works. A screen reader is told why the box is disabled while it waits. ([be5d3ce](https://github.com/LowCarbCheck/openplate/commit/be5d3ce))
- **The sign-out dialog now announces a failed erase and gives focus back when it closes.** The error sentence is read out by a screen reader when it arrives, instead of sitting hidden in the page. Closing the dialog returns the keyboard to the button or the avatar menu that opened it, where it used to fall back to the top of the page. ([be5d3ce](https://github.com/LowCarbCheck/openplate/commit/be5d3ce))
- **Another account can no longer open a diary left on a managed device.** On a managed instance, signing out without erasing hides the diary behind a lock, and until now any account that signed in, accepted an invitation or reset a password on that device opened that diary and synced it into its own account. The lock now names the account that signed out, and only that account can open the diary again. Any other account first sees a step that names whose diary is on the device, says what erasing it would lose, and offers to erase it and continue. Nothing about the other account is sent to the server before that step: a sign-in stops before the login, an invitation is not used up, and a reset stops before the password changes, so the old password still works and a new reset link is needed. A lock written by an older version that cannot tell whose diary it holds asks every account to erase first. Erasing the diary when you sign out now also removes the lock. ([f4ffccc](https://github.com/LowCarbCheck/openplate/commit/f4ffccc), [212df60](https://github.com/LowCarbCheck/openplate/commit/212df60))
- **A second press of Sign out while another tab holds the diary now reports the failure instead of hanging.** The erase waits at most eight seconds for the diary to be deleted, counted from the request, so a press that queues behind an earlier one ends in the same error message as the first. ([e12d1cb](https://github.com/LowCarbCheck/openplate/commit/e12d1cb))
- **An erase now leaves no empty photo database behind.** An erase in one tab could leave an empty photo database behind, because the store's background poll reopened it after the delete. The erase now stops every store first. A second tab that leaves because another tab signed out stops its stores before it navigates, for the same reason. ([f3186e4](https://github.com/LowCarbCheck/openplate/commit/f3186e4))
- **The way-to-log cards on desktop onboarding hold their text.** On the last onboarding step, the three cards "Photograph it", "Write it" and "Say it" were 36 px tall from a 768 px wide window up, so the title and the description of one card ran over the next. They now grow to fit their text. The three wrapping calls to action on the open landing page had the same cap and now grow with a label that wraps. ([50bf983](https://github.com/LowCarbCheck/openplate/commit/50bf983))
- **The desktop sidebar no longer jumps when an administrator's role loads.** The Administration row moved from the foot of the sidebar to just under the main list, into space that was already empty, so the Plan and Settings rows stay where they were when the row appears. ([1f64e60](https://github.com/LowCarbCheck/openplate/commit/1f64e60))
- **The What's new card no longer jumps when the pulse tile loads.** On the Overview of an instance that shares a community pulse, the tile arrived after the card and pushed it down. The card now waits until the tile is in or known to be absent, for three seconds at most, and then stays where it is. ([1f1cb71](https://github.com/LowCarbCheck/openplate/commit/1f1cb71))
- **The delete-account dialog now says what stays.** It used to say everything stored for you is removed, which is not true on a hosted instance: backups, copies of mails already sent to you and records the operator must keep by law can stay for a time. The dialog now says that, links the privacy notice when the instance has legal pages, and on an instance that sells plans says a paid subscription ends now with no refund for the time left. The account and the copy of your diary on the server are still deleted at once. All six languages now say this. ([2f13614](https://github.com/LowCarbCheck/openplate/commit/2f13614))
- **The page description and the invite hint no longer say the instance is invitation only.** On a hosted instance anybody can sign up, so the description search engines and link previews quote now says the instance needs an account, and the hint under the invite box says only to paste the code you were sent or open the invite link. All six languages now say this. ([bd91bf7](https://github.com/LowCarbCheck/openplate/commit/bd91bf7))
- **A photo that cannot be re-encoded is no longer sent as it is.** When the browser could not re-encode a picked photo (a HEIC outside Safari, a decoder that gave up), the photo screen sent the original file, which carries the GPS position, the camera and the time. It now stops, says the photo could not be prepared on this device, and asks for a JPEG or another photo. The error uses the box that already holds the status line, so the page does not move. The pantry screen sent the original photo every time and now re-encodes it first, so no photo leaves the device with its EXIF data. ([366aff5](https://github.com/LowCarbCheck/openplate/commit/366aff5))
- **A photo shared into the app now expires after 24 hours.** A picture shared from the gallery waits in the browser cache as the original file until the photo screen opens. If the screen never opened, the file stayed there. The cache entry now carries a timestamp, and entries older than a day are deleted when the service worker activates and when the app starts. ([be29bef](https://github.com/LowCarbCheck/openplate/commit/be29bef))

## [0.62.0] - 2026-10-02

### Changed

- **The release check now asks openplate.de instead of GitHub.** The request carries only the app version, the platform and the architecture, in its User-Agent, and nothing else. The project counts how many addresses asked per day and keeps only the daily totals. `UPDATE_CHECK=off` stops both the request and the count. The reasons are in `ADR-0021`. ([86fdc2f](https://github.com/LowCarbCheck/openplate/commit/86fdc2fd))

## [0.61.0] - 2026-10-01

### Changed

- **Docs and prose call the server core, not sync.** READMEs, docs, code comments and screen text name openplate-core as the core server. This prose change renames no variable; the next entry covers `SYNC_SERVER_URL`. ([56e14f4](https://github.com/LowCarbCheck/openplate/commit/56e14f4))
- **The core server address is now set with CORE_URL; the old name still works with a warning until a later release.** `CORE_URL` replaces `SYNC_SERVER_URL`. The app reads the address of openplate-core from `CORE_URL`. When only `SYNC_SERVER_URL` is set, the app logs one warning at boot and uses it. When both are set to different addresses, the old name wins for this release, and the app logs one warning that names both values and says to remove the old line before the release that drops the old name. The public config field `coreUrl` replaces `syncServerUrl`, and `syncServerUrl` carries the same value for one release, so a copy of the app cached on a phone keeps finding its server. Every compose file, quadlet unit, `.env.example` and the environment variables page now name `CORE_URL`. On the quadlet core and full units, whose defaults file sets `CORE_URL`, a `SYNC_SERVER_URL` line in `app.env` keeps working and wins; rename it to `CORE_URL`. The old name stops working in the first release after 2026-11-01. ([7ed973a](https://github.com/LowCarbCheck/openplate/commit/7ed973a), [184c523](https://github.com/LowCarbCheck/openplate/commit/184c523))
- **Macro breakdowns show the calorie share by default.** A small kcal/g control next to each bar switches to the gram share, and the choice is kept on the device. ([a91ed35](https://github.com/LowCarbCheck/openplate/commit/a91ed35))
- **The self-host files call the service core and run Postgres 18.** Self-host files: `compose.sync.yml` is `compose.core.yml`, the compose service `sync` is `core`, the quadlet folder `sync/` is `core/`, and Postgres is 18 with a new `pg-data-18` volume. The old compose file still starts the stack until the first release after 2026-11-01. Upgrade notes are in docker/topologies/README.md. ([80fae0d](https://github.com/LowCarbCheck/openplate/commit/80fae0d), [240c0d2](https://github.com/LowCarbCheck/openplate/commit/240c0d2))

## [0.60.0] - 2026-10-01

### Added

- **The app shows when a self-hosted AI server cannot perform a task.** An openplate-inference server now reports its capabilities. If it cannot parse typed meals, pantry lists, or recipes, the Describe, Pantry, and Recipes screens state this before you tap. Settings, AI shows a summary of these limits. Cloud providers and older servers do not change: a missing report means full support. ([c29c99b](https://github.com/LowCarbCheck/openplate/commit/c29c99b))
- **Scan reviews warn when allergy and pregnancy checks are incomplete.** If your profile lists an allergy or a pregnancy, and a scan returns no flags or partial flags from a self-hosted server, a message tells you to read the labels. A fully checked scan shows no warning. The layout reserves space for this box on the first paint to prevent shifting. ([c29c99b](https://github.com/LowCarbCheck/openplate/commit/c29c99b))

### Changed

- **Self-hosted AI servers receive your app language.** The OpenAI-compatible provider now sends an `Accept-Language` header. Servers that translate food names can then reply in your language. No other provider receives this header. ([c29c99b](https://github.com/LowCarbCheck/openplate/commit/c29c99b))

### Fixed

- **Scans unchecked for allergens no longer show as clear.** When a provider sent no flags for a food, the app read that as three empty lists, which meant "checked, nothing found". It now marks the food as not assessed. A self-hosted server that skips checks, or a model that ignores the field, will not show a false all-clear. ([c29c99b](https://github.com/LowCarbCheck/openplate/commit/c29c99b))

## [0.59.1] - 2026-10-01

### Fixed

- **The confirm text for replacing your data key says that every other device is signed out.** Replacing the key already signed out every other device you were signed in on, since core 0.28.0, but the dialog did not say so, so a person on a second device found themselves signed out with no warning. The text now adds one sentence: every other device where you are signed in is signed out, and you must sign in again on it. It is translated in all six languages. ([46317c7](https://github.com/LowCarbCheck/openplate/commit/46317c7))

## [0.59.0] - 2026-10-01

### Changed

- **The image runs on Node 24.** The base image moves from `node:22-alpine` to `node:24-alpine`. Corepack now provides pnpm 11.5.1 by reading the `packageManager` field of `package.json`, instead of a global `npm i -g pnpm@11.1.1`. `engines.node` is `>=24`. How you run the container does not change. Check: `scripts/check-image-boots.sh app` at the repository root. ([0b10348](https://github.com/LowCarbCheck/openplate/commit/0b10348), [c59a4bf](https://github.com/LowCarbCheck/openplate/commit/c59a4bf))

## [0.58.1] - 2026-10-01

### Fixed

- **Nothing on the onboarding form moves when you pick an answer.** The form previously shifted during entry. The main goal, carb limit, and calorie target appeared only after selecting a style. Pregnancy questions vanished on "male", and the install note loaded late on the final step. The main goal now renders on the first paint. The carb limit and calorie target occupy fixed slots below it, in that order. Each renders once and displays only when the selected style requires it. Styles without them leave empty slots. Pregnancy questions now sit after allergies. They retain their layout space on "male" but submit no data. The two date blocks share one reserved cell. The install note reserves the maximum height it needs. A calorie target entered under one style persists across style changes. Submitted form payloads remain identical. Tests: `tests/e2e/onboarding-no-shift.spec.ts` at 390 x 844 and 1280 x 800, `tests/unit/onboarding-style-step.test.ts`, `tests/unit/reproductive-status-fields.test.ts`, `tests/unit/first-food-install.test.ts`. ([9bc07ab](https://github.com/LowCarbCheck/openplate/commit/9bc07ab), [7322a89](https://github.com/LowCarbCheck/openplate/commit/7322a89), [e01e425](https://github.com/LowCarbCheck/openplate/commit/e01e425))
- **The source link in the pregnancy caution note shows its words again.** The link wrapped text in a `<source>` tag. The translation parser treated this as a void HTML element, leaving the link untappable with zero width. The tag is now `<sourceLink>` across all six languages in both onboarding and settings. Copy remains unchanged. Tests: `tests/unit/onboarding-style-step.test.ts`, `tests/unit/settings-eating-style.test.ts`. ([2a4aca9](https://github.com/LowCarbCheck/openplate/commit/2a4aca9))

## [0.58.0] - 2026-10-01

### Added

- **Administrators can view the remaining AI budget and today's AI use.** The /admin overview now shows an AI budget card beside the people list. It reads `GET /v1/admin/ai/budget` (openplate-core 0.28.0) on its own. The card shows what the provider key has left of its limit, with a bar, when the limit resets, and the spend today and this month. It also shows today's paid and trial units against their ceilings. The card keeps its size while it loads, when the read fails, on an instance with no AI, on a provider that is not OpenRouter and on a key with no limit, so the list below never moves. A failed read is a sentence in the card, not the retry card of the whole tab. A core older than 0.28.0 answers `404` there, which the card reads as an instance with no AI. Tests: `tests/unit/admin-ai-budget.test.tsx`. ([c2e4d24](https://github.com/LowCarbCheck/openplate/commit/c2e4d24), [a74e80e](https://github.com/LowCarbCheck/openplate/commit/a74e80e))
- **Administrators can assign daily free photos that do not expire.** The Change form on a person's page has a new field, Free photos per day. It writes `freeDailyAiLimit`, the standing free grant of openplate-core 0.28.0: photos that apply whenever no paid plan runs, with no end date and no scan count. It is sent only when it changed. The hint under Photos per day now says that limit applies while a paid plan or free AI scans run, because 0 there no longer turns AI off for a person with a free grant. Tests: `tests/unit/admin-route.test.ts`. ([5e1a5f7](https://github.com/LowCarbCheck/openplate/commit/5e1a5f7), [a74e80e](https://github.com/LowCarbCheck/openplate/commit/a74e80e))

### Changed

- **Accounts with free AI keep it after a paid plan ends.** A Beta supporter who bought a plan and cancelled it read as lapsed, and the whole app locked, although the service still answered them from their free grant. The plan standing now has a `free` state, checked before lapsed and before any trial whenever no subscription is live, and the plan gate never locks it. The plan page calls it the free part of openplate and still offers the plans. The account page, the account strip in the avatar menu and the admin lists show the limit the service holds the person to today: the free one once no paid window runs. A free grant also lifts the scan count and switches managed AI on, even with a paid limit of 0. The field comes from openplate-core 0.28.0; against an older core nothing changes. Tests: `tests/unit/free-grant.test.ts`, `tests/unit/plan-standing.test.ts`, `tests/unit/plan-gate.test.ts`, `tests/unit/plan-page.test.ts`, `tests/unit/managed-ai-settings.test.ts`. ([5e1a5f7](https://github.com/LowCarbCheck/openplate/commit/5e1a5f7))
- **Food search on the hosted service now requires signing in.** On a managed instance, `POST /api/food-matches` and `POST /api/food-proposals` answered anybody, and every new name cost a LowCarbCheck call under the operator's `FOOD_DB_API_KEY`. Both routes now need the account session the page already sends to openplate-core. The app server asks core's `GET /v1/auth/account` at `SYNC_SERVER_URL` whether it is live, so the app server must reach that address too. The answer is cached by a hash of the token, five minutes when live and one minute when not. Without a live session the routes answer `401`, and `503` when core cannot be asked, before any upstream call. The page refreshes the session once after a `401`. An open instance answers every lookup, as before. A new setting, `FOOD_DB_DAILY_CALL_LIMIT` (default 3200, the free key's 100,000 a month over 31 days), caps upstream calls per UTC day in memory. Past it the routes answer `429`, the app shows a pause instead of "no matches", and scans complete with the AI's own numbers. The per-address limiter now counts an IPv6 caller by its /64, and an IPv4-mapped address as the IPv4 address it carries. Every compose file and quadlet default forwards the new variable. Tests: `tests/unit/api-food-matches-managed.test.ts`, `tests/unit/account-token-verifier.test.ts`, `tests/unit/food-db-daily-budget.test.ts`, `tests/unit/food-matches-client.test.ts`, `tests/unit/client-ip.test.ts`. ([91fe324](https://github.com/LowCarbCheck/openplate/commit/91fe324))
- **Replacing your data key requires your password and signs out other devices.** openplate-core 0.28.0 refuses `POST /v1/sync/rotate-dek` without `currentAuthHash`, because a rotation writes the recovery verifier that signs people in, and it revokes every other session of the account. The app already asked for the password on this screen and now sends its auth hash. A refusal from the service because the password changed on another device during the rotation reads as the same wrong-password message. The unused client call to delete a key record is gone, because core removes that route. Older cores ignore the new field, so deploy this app before core 0.28.0. Tests: `tests/integration/share-actions.test.ts`. ([19df93a](https://github.com/LowCarbCheck/openplate/commit/19df93a))

## [0.57.1] - 2026-09-30

### Changed

- **The avatar button in the header shows the account name.** When a user signs in, the button at the top right and the top line of its menu show the display name entered at sign-up, instead of "This device". An email address used as a name shows only the part before the @, because the account strip at the bottom of the menu already prints the full address. Without an active session, or with an empty name, the button shows "This device". The name sits to the left of the circle in a box 160 px wide from the first paint. Header elements do not shift when the session loads after a refresh. Long names truncate with an ellipsis inside that box. Below 640 px, the button displays only the circle. The screen reader label also includes the name, such as "Maria, open menu". Tests: `tests/unit/avatar-name.test.ts`, `tests/e2e/avatar-shows-name.spec.ts`. ([ca30760](https://github.com/LowCarbCheck/openplate/commit/ca30760), [1f24306](https://github.com/LowCarbCheck/openplate/commit/1f24306))

## [0.57.0] - 2026-09-30

### Added

- **The free trial now says how many days are left.** On an instance that sells plans, a new account is free until it has used 10 photo scans or 14 days have passed, whichever comes first. The account page and the account strip in the avatar menu already said how many free scans are left. They now also say how many days are left, on the line after it, for example "6 days left in your free trial". The count is in whole days, rounded down but never below 1 while the trial runs: right after sign-up it reads 14 days, 30 hours left reads 1 day, and the last minute reads 1 day. The line keeps its place on screen before the date arrives, so nothing moves when it does. It is read from `trialEndsAt` on the account (openplate-core 0.25.0). The line is not shown for an account with no free trial, for a paid plan, after the scans are spent, or after the end date. German is hand-written, Turkish comes from the wordsmith pass, and French, Italian and Spanish are machine-translated. Tests: `tests/unit/trial-days-left.test.ts`, `tests/unit/trial-scans.test.ts`, `tests/e2e/trial-days-left.spec.ts`. ([1efb4e4](https://github.com/LowCarbCheck/openplate/commit/1efb4e4), [189f37f](https://github.com/LowCarbCheck/openplate/commit/189f37f))

## [0.56.0] - 2026-09-30

### Added

- **Administrators can see and set a label on each person.** In /admin, a person's row and their page show the account label as a small chip, such as "Beta supporter". The Change form on a person's page sets the label. It takes at most 40 characters. An empty field removes the label. The person never sees their own label. The card that tells them what an administrator can see now names it. Against an openplate-core without labels, the console shows no chip and works as before. The chip never makes a row taller. `tests/unit/admin-route.test.ts` and `tests/e2e/admin-account-label.spec.ts` check this. ([36a079a](https://github.com/LowCarbCheck/openplate/commit/36a079a))
- **A closed instance can send its people to a new address.** Set `MOVED_TO_URL` to an `https://` address, for example `https://app.openplate.de`. Every route then serves a notice in the user's language: where openplate is now, a button to sign in there, and instructions for replacing the home-screen icon. `/sw.js` serves a worker that clears old caches, unregisters itself, and reloads the page, so an installed app learns about the move instead of opening its saved copy. The API returns 410 with the new address, while `/healthcheck` and the web app manifest stay as they were. If unset, nothing changes. A plain `http://` address, an address with credentials, or this instance's own `APP_URL` stops the boot. `tests/e2e/moved-instance.spec.ts` verifies this flow against an app that installed its worker before the move. ([ec13fff](https://github.com/LowCarbCheck/openplate/commit/ec13fff))

## [0.55.0] - 2026-09-30

### Changed

- **Languages outside the six now fall back to English in checkout and legal forms.** The plan page requests its order texts in English, the payment portal opens in English, and the cancellation and withdrawal forms send the declaration in English, where all three previously used German. Against an openplate-core that accepts only German and English, a French, Italian, Spanish, or Turkish declaration is sent again in English, no longer in German. `tests/unit/plans-door.test.ts`, `tests/unit/declaration-submit.test.ts`, and `tests/e2e/statutory-buttons.spec.ts` check this. ([4ef15ca](https://github.com/LowCarbCheck/openplate/commit/4ef15ca))

## [0.54.0] - 2026-09-30

### Changed

- **The cancellation and withdrawal forms send the reader's language.** Declarations submitted from `/kuendigung` or `/widerrufen` in French, Italian, Spanish or Turkish now carry that language instead of German, so openplate-core mails the receipt in that language. Against an openplate-core instance that accepts only German and English, the form resends the declaration in German, so the button continues to work. `tests/e2e/statutory-buttons.spec.ts` checks both cases. ([ec58d32](https://github.com/LowCarbCheck/openplate/commit/ec58d32))
- **Every app setting now reaches the container from your .env file.** The four compose files, `docker/compose.yml` and the three in `docker/topologies/`, now forward every variable the app reads. Previously, an unlisted `.env` variable never reached the app, and the system gave no warning. Across all compose files, this affected `CONTENT_DIR`, `HOST`, `NUTRIENT_REFERENCE_BASIS`, the three `MATOMO_*` variables, and the two `NEWSLETTER_*` variables. Smaller compose files omitted more. With an empty `.env`, nothing changes. Every default matches the value the app already used. Check your `.env` before you update, because previously ignored lines now take effect. Each compose file adds a commented volume line for a `CONTENT_DIR` folder. The Quadlet `*.defaults.env` files list the new names too. `HMR_PORT` and `DEBUG_MODE` were removed because nothing read them. The development server's host list is empty when `VITE_ALLOWED_HOSTS` is unset, instead of naming two of the maintainer's hosts. `tests/unit/compose-env-surface.test.ts` fails when a variable the app reads is missing from a compose file or from `.env.example`. `tests/unit/compose-defaults-inert.test.ts` checks every compose default against the app's own parser. ([fd225c3](https://github.com/LowCarbCheck/openplate/commit/fd225c3), [c4546c6](https://github.com/LowCarbCheck/openplate/commit/c4546c6))

### Fixed

- **The payment portal now opens in the page's language.** The Manage button on the plan page passes the current page language, matching the order language. The customer portal for cancelling, updating a card and downloading invoices opens in that language. Older billing services ignore this parameter and open the portal as before. `tests/e2e/plan-portal-language.spec.ts` checks this behavior. ([ec58d32](https://github.com/LowCarbCheck/openplate/commit/ec58d32))
- **The "latest" image tag now names the newest release.** The `latest` tag moved with every change to the main branch. `docker compose pull` with the shipped compose files could install code that was not released. The tag now moves only when a release is cut. The new `main` tag follows the main branch. ([f047e1e](https://github.com/LowCarbCheck/openplate/commit/f047e1e))

### Docs

- **One page lists every environment variable.** `docs/environment-variables.md` lists each variable of the app, the sync service, and the inference service. It gives the default, what the variable does, and which values stop the boot. It also explains the Turnstile check on sign-up. `tests/unit/environment-variables-doc.test.ts` fails when the code reads a variable the page does not list, or when the page lists one that nothing reads. ([4564174](https://github.com/LowCarbCheck/openplate/commit/4564174), [9c8e0a9](https://github.com/LowCarbCheck/openplate/commit/9c8e0a9), [1b8b562](https://github.com/LowCarbCheck/openplate/commit/1b8b562))
- **The self-hosting guide covers HTTPS on a home network with no domain name.** `docs/self-hosting.md` shows Caddy with its own local certificate on the server's network address. It gives the steps to make an iPhone or an Android phone trust it. It adds a Mailpit sidecar to test mail, and a private certificate authority for a mail relay. It adds notes on backups, the firewall, the port each admin command uses, and what each image tag means. `docs/topologies.md` no longer tells you to leave `UPSTREAM_API_KEY` empty in front of the inference service, which stopped the sync service from starting. Its rung 2 and rung 3 commands now set `TRUST_PROXY`. ([4564174](https://github.com/LowCarbCheck/openplate/commit/4564174), [88abecd](https://github.com/LowCarbCheck/openplate/commit/88abecd), [771d1fe](https://github.com/LowCarbCheck/openplate/commit/771d1fe))

## [0.53.0] - 2026-09-29

### Changed

- **The free trial now ends after its free scans or its set days, whichever comes first.** Where openplate-core publishes a day limit (`instance.trial.days`), the sign-up form and account door display "10 free AI scans or 14 days, whichever comes first", reading both values from core. The price line states what follows the free tier. When the days elapse, the app locks as it does for used scans. The plan page states the reason, showing that free days ended or free scans ran out. When a scan is refused with `403 trial-expired`, the app explains that free days ended and presents the plans, rather than prompting for an API key. Accounts created before the day limit, and instances without one, keep current copy and lock only on scans. `tests/e2e/paywall-trial-days.spec.ts` tests the lock and its heading. ([b58ddcb](https://github.com/LowCarbCheck/openplate/commit/b58ddcb), [9646dc9](https://github.com/LowCarbCheck/openplate/commit/9646dc9))

### Fixed

- **Copied links now state when they point to another address.** On an instance without mail, a new invitation link and a person's password reset link appear for you to copy. openplate-core builds them from `CLIENT_BASE_URL` and `SERVER_PUBLIC_URL`. The docker compose files set those to `http://localhost:3000` and `http://localhost:3001` when `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL` are unset. Such a link opens only on the server. When the link address differs from the one you are using, a line under it now names that address and tells you to set `PUBLIC_APP_URL` and `PUBLIC_SYNC_URL`. The line appears together with the link, so nothing on screen moves. The invite form also checks what the instance reports to say whether they get mail or you get the link, instead of always promising mail. `tests/e2e/admin-link-names-another-address.spec.ts` checks it. ([bc81cfd](https://github.com/LowCarbCheck/openplate/commit/bc81cfd))
- **Resending an invitation shows the new link without mail.** A resend creates a new link, and the old one stops working. Without mail, the invitations tab previously discarded the new link and reloaded the list, leaving the invited person with a dead link. The tab now displays the new link to copy in the same card used for new invitations, includes the address warning, and Back to the list returns to the list. On servers with mail, it confirms the letter went. `tests/e2e/admin-resend-shows-the-new-link.spec.ts` checks both. ([40df25d](https://github.com/LowCarbCheck/openplate/commit/40df25d))
- **The link warning now checks the sync server address.** A copied link can load the right page while still pointing the app to a sync server at `localhost` or a plain `http://` address, which another device cannot reach. The line under the link now identifies that server and instructs you to set `PUBLIC_SYNC_URL`. On this machine, where both the page and server run locally, it says nothing. ([40df25d](https://github.com/LowCarbCheck/openplate/commit/40df25d))
- **A reset link no longer pushes the page down.** Without mail, the card with the reset link appeared above the person's details, causing the page and the button you just pressed to jump down. The card now appears below the details and scrolls into view, leaving everything already on screen in place. `tests/e2e/admin-reset-card-moves-nothing.spec.ts` checks it. ([40df25d](https://github.com/LowCarbCheck/openplate/commit/40df25d))

### Docs

- **The self-hosting guide now covers a family server's addresses and mail.** `docs/self-hosting.md` adds a Mail section covering setups with no mail where links are shared by hand, SMTP using Gmail or Amazon SES, and a Resend-compatible HTTP mail API. It explains why mail needs public `https://` addresses and how to verify that a message was sent. The guide adds a checklist for other reverse proxies, rewrites the Tailscale Serve recipe and marks it untested, and instructs the SSH tunnel path to leave mail unset. `docs/family-setup.md` adds a section on family accounts. ([467d144](https://github.com/LowCarbCheck/openplate/commit/467d144))

## [0.52.0] - 2026-09-29

### Changed

- **A refused sync or scan now opens the consent screen.** When openplate-core rejects a data route with `403 health-consent-required` because an account lacks current consent, the app routes the user to `/consent`. A rejected sync, scan, or pantry photo triggers this redirect. After the user agrees, the app returns to the previous view and uploads any queued changes. Previously, the app treated the response as a generic error: sync showed "Sync failed" with the protocol code, and scanning prompted for an API key check. Logging in on a new device still pulls diary data first, so returning users see the consent prompt instead of the onboarding questionnaire. Data export, the account page, and Preferences remain accessible without consent. The study console shows the consent checkbox from `/join` and sends it with a new study account, and `pnpm seed:test-account` submits the required version. A password reset by such an account displays the consent prompt before making changes, so the account's private keys for sharing and research move to the new password. The sign-in of an account whose first setup never finished asks for consent first, and setup then completes. On the account page, renaming the account, inviting someone, or changing the password links to the consent screen instead of failing. `tests/e2e/health-consent-refusal.spec.ts` and `tests/e2e/health-consent-refusal-scan.spec.ts` check the sync and the scan, `tests/e2e/settings-account-consent-owed.spec.ts` the account page, `tests/e2e/unfinished-setup-consent.spec.ts` the unfinished setup, and `tests/integration/sync-e2ee-roundtrip.test.ts` the reset. ([0fe1e9e](https://github.com/LowCarbCheck/openplate/commit/0fe1e9e))
- **A managed instance's front page is the door to an account.** For a visitor with no session, `/` on a managed instance now shows the openplate mark, one sentence about the instance, and the doors the instance allows: Sign up and Sign in where anybody may sign up, Sign in and "I have an invite link" where an invitation is needed. Under them are the free scans and the prices where a plan is sold, or "Invitation only" on an invite-only instance, and one line that links openplate.de in the reader's language. The screenshots, the step-by-step sections and the newsletter form left that page, because openplate.de explains and prices openplate. The header draws no doors there, so no door appears twice, and nothing on the page moves while the instance and the prices load. A self-hosted open instance keeps its full landing. `tests/e2e/account-door-page.spec.ts` checks it in six languages at 320, 390 and 412 px wide. ([c373b5b](https://github.com/LowCarbCheck/openplate/commit/c373b5b))
- **Public pages on a managed instance link back to openplate.de.** The footer of every public page, the legal pages included, now opens its links with openplate.de, in the reader's language: German at the site's root, every other language under its own prefix. A self-hosted open instance shows no such link. `tests/e2e/managed-way-back.spec.ts` checks it. ([d7f30ec](https://github.com/LowCarbCheck/openplate/commit/d7f30ec))
- **The HTTPS and YAZIO guides open in the reader's language.** The notice on the account pages over plain http and the import section on Data & backup linked the English guide for every reader. They now link the guide in the language the app is shown in. ([d7f30ec](https://github.com/LowCarbCheck/openplate/commit/d7f30ec))

### Fixed

- **Legal links from openplate.de open in the visitor's language.** The site's imprint, privacy, terms and cancellation links carried no language, so a reader of the English site could land on a German page. They now carry `?lang=<code>`, which the app reads before its own cookie, so the page is correct on the first paint, with or without JavaScript. The choice becomes the device's cookie once JavaScript runs. `/widerrufen` and `/kuendigung` keep their German statutory heading and button in every language. `tests/e2e/legal-link-language.spec.ts` checks it. ([1a170de](https://github.com/LowCarbCheck/openplate/commit/1a170de))
- **The landing's screenshots match the page's language.** The self-hosted landing showed the English app on a German page. A German page now shows the German screenshots, and a language without its own screenshots keeps the English ones. `tests/e2e/account-door-page.spec.ts` checks German, English and French. ([c373b5b](https://github.com/LowCarbCheck/openplate/commit/c373b5b))
- **The footer links no longer run off a tablet screen.** Between about 640 and 1000 px wide, the footer's row of links did not wrap, and the page cut off the imprint and both statutory buttons. The row now wraps onto a second line. `tests/e2e/managed-way-back.spec.ts` checks 640, 768 and 1024 px. ([d7f30ec](https://github.com/LowCarbCheck/openplate/commit/d7f30ec))

## [0.51.0] - 2026-09-29

### Fixed

- **Locked accounts no longer see the diary before the plan page.** On instances that sell plans, a person with exhausted free scans or an expired plan saw the diary for about a second during a cold start to `/` or a diary URL, before the plan page loaded. The client now remembers the paywall lock. A subsequent cold start keeps the boot screen visible until the session reopens and the gate answers with the plan page, or with a consent screen if one is pending. Users with an active plan load the diary as quickly as before. A day trial and a non-renewing plan hold from their scheduled end date. An offline device, the export tool, and other pages that remain open are never held. Free scans spent on another device are recognized only after the session reopens. `tests/e2e/locked-account-cold-boot.spec.ts` samples every frame to verify this behavior. ([9d9b717](https://github.com/LowCarbCheck/openplate/commit/9d9b717))
- **The order page links to the online withdrawal page.** The withdrawal notice on the order page names the page "Vertrag widerrufen" and prints its address. The address was plain text. It is now a link to `/widerrufen` that opens beside the order. The notice still reads exactly as openplate-core serves it. `tests/e2e/order-page-links-widerrufen.spec.ts` checks it. ([cc0200e](https://github.com/LowCarbCheck/openplate/commit/cc0200e))
- **The withdrawal and cancellation pages explain what their German headings mean.** The law fixes the headings "Vertrag widerrufen" and "Verträge hier kündigen" in German, so they stay German in every language. On an English, French, Spanish, Italian or Turkish page, one line under the heading now says what the page does. German pages are unchanged. `tests/e2e/legal-page-english-subtitle.spec.ts` checks it. ([6a48e25](https://github.com/LowCarbCheck/openplate/commit/6a48e25))
- **A buyer who picks a plan first sets up the diary after paying.** Someone who came from the pricing page pays before onboarding, and the payment return used to send them straight to a diary without calorie or protein targets. The return now offers "Set up your diary" and opens onboarding, and the diary comes after it. A buyer who leaves the payment page without paying meets onboarding on the next page they open, like any new account. An account that finished onboarding before it bought a plan still goes to the diary. Accounts left in that state by an earlier version no longer see "We can't find your diary" on their next visit. Every account's first sync stores its private keys, and the app read that as a lost diary. `tests/e2e/onboarding-after-payment.spec.ts` checks all four. ([e39ace8](https://github.com/LowCarbCheck/openplate/commit/e39ace8))
- **Signed-in people are no longer told their diary stays on this device.** The first onboarding screen, the onboarding profile step, the AI connection note, and the About you card in profile settings said the diary or profile stays on this device. That is false once an account keeps an encrypted copy on the sync server, and every account on a managed instance does. These screens now say that the account keeps an encrypted copy, and that whoever runs the server keeps a backup key that can read it. People with no account still read that the diary stays on the device. `tests/e2e/synced-diary-location-copy.spec.ts` checks it. ([926c49a](https://github.com/LowCarbCheck/openplate/commit/926c49a))
- **The trial countdown and its recap line fit a phone in every language.** Near the end of a trial, the header adds a second line that counts meals logged with AI. At 390 px wide, that line ended in an ellipsis in every language, including English. The day sentence above it was cut off in German, French, Spanish, Italian, and Turkish. The second line now wraps onto two lines. All four lines use a tighter line height inside the same 64 px header, and the header boxes keep their height, so nothing in the header moves when the four lines appear. The day sentences are now shorter in those five languages. At 360 px wide, the German, French, Italian, and Turkish day sentences and the German and Italian recap lines are shorter still. `tests/e2e/trial-recap-line-fits.spec.ts` checks every day sentence and recap line in all six languages at 390 and 360 px wide. ([f547cb5](https://github.com/LowCarbCheck/openplate/commit/f547cb5))
- **Every Undo in the header is a button again, now with an icon and no text.** Since 0.50.0, every header status action appeared as underlined words at the end of the sentence. Undo after you delete a diary entry, log a quick-add chip, or copy from yesterday is now a 44 px square button beside the sentence. It displays an undo arrow without text, and screen readers read it as Undo. The status has no close button, because it clears after 4 seconds. Beside Undo, the second line after a quick-add chip drops the meal and shows only the net carbs and the day. The See plans action beside the trial countdown keeps its underlined words, because a button left the German countdown too little room. The header keeps its 64 px, so the status moves nothing in the header or below it. `tests/e2e/undo-control-look.spec.ts` checks all three in all six languages. ([74d0688](https://github.com/LowCarbCheck/openplate/commit/74d0688))
- **A long food name ends in an ellipsis in the header status.** The header names the item when you log, copy, or delete a food. Long names previously cut off the status sentence on phones. Past 25 characters, the name now ends in "…", keeping the sentence visible at 360 px wide. `tests/e2e/undo-control-look.spec.ts` checks a 40 character German name. ([8105597](https://github.com/LowCarbCheck/openplate/commit/8105597))
- **The German line for a food logged on a past day ends on one period.** The header read "Netto-KH am Mo., 28. Sept.." with two periods, because the German date already ends in one. It now ends on one. `tests/unit/food-added-toast.test.ts` checks the German date, and an English date that keeps its period. ([67bf7a8](https://github.com/LowCarbCheck/openplate/commit/67bf7a8))
- **The sign-in page opens in the language of the link.** openplate.de links to `/sign-in?lang=<code>`. The page previously ignored the parameter. A visitor whose browser was set to German read the page in German after they chose English on the site. `/sign-in` now reads `lang` the way `/sign-up` does. ([c346878](https://github.com/LowCarbCheck/openplate/commit/c346878))
- **The forgot-password and sign-up forms no longer flash their button.** When the answer replaced the form, the old submit button stayed on screen for about 150 ms below the new sentence. The hidden form now disappears in the same frame. `tests/e2e/invisible-button-flash.spec.ts` checks every frame. ([dc08ac6](https://github.com/LowCarbCheck/openplate/commit/dc08ac6))
- **Dependencies update past several known security advisories in the app.** react-router, express and the development tools move to versions that carry the published fixes. `pnpm audit` reports no advisory for the app. ([415a8cd](https://github.com/LowCarbCheck/openplate/commit/415a8cd))

## [0.50.0] - 2026-09-28

### Added

- **An instance that sells plans locks the app once the free trial is over.** When the free AI scans are used up, a day trial has ended, the account never had an allowance, or a paid plan lapsed, every screen of the diary sends the person to the plan page until they pay. The plan page says why above the plans, and links the export and the account deletion. Export (`/settings/data`), the account page, Preferences, research studies, clinician sharing, notifications, the settings hub and `/admin` stay open, and so does everything outside the app: the legal pages, sign-in, join, and the cancellation and withdrawal pages. An instance with no biller (`plans: false`) is never locked, an administrator is never locked, and a plan read that fails or times out opens the app; the AI proxy on openplate-core stays the server side limit. The last free scan keeps its review on screen, and the plan page comes with the next page opened. A new account can open the plan page before onboarding. A person with free scans left is offered "Use your free AI scans first". A return from payment now checks the plan every two seconds and offers "Open your diary" once it is active. `tests/e2e/paywall.spec.ts` and `tests/e2e/paywall-plan-page.spec.ts` check every standing. ([7cb9fd1](https://github.com/LowCarbCheck/openplate/commit/7cb9fd1))
- **Sign-up on a paid instance states the price and keeps the chosen plan.** A pricing-page link such as `/sign-up?plan=yearly&lang=fr` opens the form in that language and sends the plan and the language with the request, so the mailed join link carries both. Under the free scans the form says what openplate costs once they are used up, read from openplate-core's anonymous `GET /v1/plans/prices` and formatted for the reader, or that a paid plan is needed when the prices cannot be read. After the account is created, `/join` opens the plan page with that plan picked, and the plan page picks a plan chosen before sign-in too. The logged-out landing leads with Sign up and states the same offer on an instance that takes sign-ups and sells plans, and `/welcome` leads with Create an account where anybody may sign up. Invite-only and self-hosted instances keep their landing. An openplate-core without the prices route shows the sentence without a price. `tests/e2e/signup-plan-intent.spec.ts` checks it. ([4efaacf](https://github.com/LowCarbCheck/openplate/commit/4efaacf))
- **Sign-up and a one-time screen ask for consent to health data.** On an instance whose openplate-core sets `HEALTH_CONSENT_VERSION`, `/join` shows an unticked box with the consent wording and a link to the privacy notice. Creating the account with the box unticked says so under the box and sends nothing; a ticked box sends the version with the sign-up, and a wording changed while the page was open brings the box back. An account that never agreed, or agreed to an older wording, is sent once to the new `/consent` screen from every page of the app, administrators included, and before the plan page on an instance that sells plans. "Agree and continue" records the consent with openplate-core (`POST /v1/auth/account/health-consent`) and returns to the page. The export (`/settings/data`), the account page with delete and sign out, and Preferences with the visit-counting switch stay open without it. An instance without the setting, an older openplate-core, or a handshake that cannot be read asks nothing. `tests/e2e/health-consent-join.spec.ts` and `tests/e2e/health-consent-gate.spec.ts` check it. ([053bbd0](https://github.com/LowCarbCheck/openplate/commit/053bbd0))

### Changed

- **The protein reference follows the instance's reference values.** On an instance set to DGE, the default, the diary now uses DGE values. That means 0.8 g per kilogram for adults, 1.0 g from 65, 0.9 g for boys and 0.8 g for girls from 15 to 18, and 0.9 g at 14. When height is known, anyone above a BMI of 25 uses the weight at a BMI of 25. Pregnancy adds 7 g in the second trimester and 21 g in the third, and breastfeeding adds 23 g. Instances set to EFSA or US keep EFSA's 0.83 g per kilogram. The app reads the setting from the sync server, falls back to its own server, and waits at most 1.5 seconds. The admin setting description also names the protein reference. `tests/unit/health-calculator-parity.test.ts` pins the figures to the openplate.de protein calculator. ([ea99a31](https://github.com/LowCarbCheck/openplate/commit/ea99a31))
- **Every compose file reads its settings from the env file.** The app service now passes on `DEFAULT_UI_LANGUAGE`, `UPDATE_CHECK`, `FOOD_DB_API_KEY`, `FOOD_DB_BACKFILL` and `CSP_CONNECT_EXTRA`, which the docs told people to set in `.env` but which never reached the container. `compose.inference.yml` and `compose.full.yml` take `INFERENCE_API_KEY`, `PUBLIC_APP_URL`, `PUBLIC_INFERENCE_URL` and `LLAMA_THREADS` from `.env` instead of values edited inside the file; the defaults are the old placeholders, so a Quadlet unit generated from them is unchanged there. ([6b8c85e](https://github.com/LowCarbCheck/openplate/commit/6b8c85e))
- **Quadlet units read every setting from an env file you own.** A unit used to write its compose defaults as `Environment=` lines. Podman ranks those above `EnvironmentFile=`, so a value such as `CLIENT_BASE_URL`, `TRUST_PROXY` or `ADMIN_TOKEN` in the env file never reached the container, and Podman 4.9 reads no drop-in to change it. Each unit now reads `<unit>.defaults.env`, which ships beside it, and then `<unit>.env`, which is yours and overrides defaults. Your file must exist, even empty, or the unit does not start. Before you copy the new units over an install: rename `openplate-with-sync.env` or `openplate-full.env` to `sync.env`, move an inference key you wrote into the units into `inference.env` (`API_KEYS`) and `app.env` or `openplate.env` (`DEFAULT_INFERENCE_API_KEY`), and create the remaining `<unit>.env` files empty. Each set's README lists them. ([c280736](https://github.com/LowCarbCheck/openplate/commit/c280736))

### Fixed

- **The plan page shows one answer after a slow payment.** When the check after a payment took more than a minute and you pressed Check again, Check again stayed drawn over Open your diary once the plan was active. Now only the active line and its button show in that space, and nothing on the page moves. `tests/e2e/paywall-plan-page.spec.ts` checks it. ([34a1ec9](https://github.com/LowCarbCheck/openplate/commit/34a1ec9))
- **The diary stops offering plans once you have paid.** After the plan page showed an active plan, Open your diary still showed the free scans line and See plans in the header until a reload. The header now uses the plan found by the payment check, and the app reads your account again. `tests/e2e/paywall-plan-page.spec.ts` checks it. ([34a1ec9](https://github.com/LowCarbCheck/openplate/commit/34a1ec9))
- **The free scans line fits a phone in every language.** At 390 px wide, the See plans button and the close button left the header sentence about 40 px, and German showed "Noch 10 kost…". The action text now follows the sentence. Tapping anywhere on the sentence takes the action, so Undo after a deletion works the same way. `tests/e2e/trial-countdown.spec.ts` checks German, French and Turkish. ([4562094](https://github.com/LowCarbCheck/openplate/commit/4562094))
- **Account pages say that accounts need HTTPS.** On a plain-http address that is not localhost, the browser turns off the Web Crypto that signing in, creating an account and setting a password all need. `/sign-in`, `/sign-up`, `/join`, `/forgot` and `/reset` now say so, with a link to the HTTPS section of the self-hosting guide, instead of offering a form that failed with the browser's own TypeError. The page decides this from the address it was opened on, so the sentence is there from the first paint. `tests/e2e/accounts-need-https.spec.ts` checks every page on a real plain-http origin. ([ff45e7f](https://github.com/LowCarbCheck/openplate/commit/ff45e7f))
- **Forgot password sends its request again.** The page checked its one address field with the sign-in form's rules, which also ask for a password, so the button did nothing on every instance. It now sends the request and says the link is on its way. On an instance whose sync server cannot send mail it sends nothing and says to ask the administrator, who can make a reset link in Administration, under People. A request that cannot reach the server is said instead of hidden. `tests/e2e/forgot-password.spec.ts` checks all three answers. ([ff45e7f](https://github.com/LowCarbCheck/openplate/commit/ff45e7f))
- **A second join link in the same tab replaces the first.** A link opened in a tab already on `/join` changes only the part after `#`, which does not reload the page, and the first link's card stayed on screen. The page now reads every new link. `tests/e2e/join-link-hash.spec.ts` checks it. ([ff45e7f](https://github.com/LowCarbCheck/openplate/commit/ff45e7f))
- **A managed instance no longer sends members to AI settings.** With `AI_ADVERTISED_MODEL` unset on openplate-core, a photo scan said to connect an AI provider in settings, a page a managed instance does not have. It now says the instance names no AI model. When the provider behind the instance refuses its key, the scan says that instead of asking the member to check a key of their own. `tests/e2e/managed-scan-says-what-is-true.spec.ts` checks both. ([ff45e7f](https://github.com/LowCarbCheck/openplate/commit/ff45e7f))
- **Connect with OpenRouter says it needs HTTPS on a plain-http page.** The connection hashes a code with the browser's Web Crypto, which a plain-http address that is not localhost does not have, so Continue failed and blamed your network. On such a page, AI settings and the scan screen now show a notice with a link to the HTTPS section of the self-hosting guide in place of the button, and pasting an API key still works. `tests/e2e/openrouter-connect-on-plain-http.spec.ts` checks both screens and walks a pasted key to the end. ([ec085ad](https://github.com/LowCarbCheck/openplate/commit/ec085ad))
- **The sync compose files pass the admin token and the link addresses on.** `compose.sync.yml` and `compose.full.yml` now forward `ADMIN_TOKEN`, `INSTANCE_MODE`, the mail block, the AI proxy (`UPSTREAM_BASE_URL`, `UPSTREAM_API_KEY`, `AI_ADVERTISED_MODEL`, `AI_INSTANCE_DAILY_LIMIT`), the member-invite limits, `SYNC_SHARING` and `SYNC_RESEARCH`, and set `SERVER_PUBLIC_URL` and `CLIENT_BASE_URL` from `PUBLIC_SYNC_URL` and `PUBLIC_APP_URL`. Before, a fresh instance could not mint its first invitation, a minted one had no link, and managed mode stayed off whatever `.env` said. `docs/self-hosting.md` has the first-account steps. ([6b8c85e](https://github.com/LowCarbCheck/openplate/commit/6b8c85e))
- **Healthchecks report healthy under podman-compose.** Every compose file and Quadlet unit checks health with one plain `wget` line. podman-compose 1.0.6 turned the old `node -e` line into broken shell, so `podman ps` said unhealthy forever while the app answered. ([6b8c85e](https://github.com/LowCarbCheck/openplate/commit/6b8c85e))
- **The join page notices when another user is signed in.** An invitation opened from a link went straight to registration, even if someone else was signed in on that device. The app previously restored saved sessions only inside the diary view. The join page now checks the local session, names both account addresses, and gives you a button to sign out and reload the invitation. That button previously did nothing on a fresh page load. Stored sessions for an old server no longer block an invitation, and the page clears them. If an invite belongs to a different server, the page names both servers instead of telling you to open a sync address there. ([5d1a9ca](https://github.com/LowCarbCheck/openplate/commit/5d1a9ca))
- **The OpenRouter callback explains that it needs an HTTPS connection.** The button to try again starts a new connection that requires the browser's Web Crypto features, and a plain-http address that is not localhost does not have them. Clicking previously failed without an error message, while the card stated the next try would succeed. The button now shows the same HTTPS notice found on the connect screen, and the link to paste a key instead stays. ([ec4f69b](https://github.com/LowCarbCheck/openplate/commit/ec4f69b))
- **The app opens offline after one visit without loading forever.** The service worker saved shell pages without their scripts, stylesheet, and logo. A device that visited once and lost connection showed only the name and a broken image. The service worker now saves each page together with those files. It serves a cached page only when all assets are present, and displays the offline page otherwise. The loading screen also explains, in the user's language, when the app cannot load. `tests/e2e/offline-after-one-visit.spec.ts` checks all three. ([dd2d345](https://github.com/LowCarbCheck/openplate/commit/dd2d345))
- **The add sheet stays open when the screen changes underneath.** On slow devices, tapping the plus icon right after Add to diary opened the sheet and then dismissed it as the diary appeared. The sheet now remains open until you choose an action or tap Back. `tests/e2e/add-sheet-outlives-a-pending-navigation.spec.ts` checks it. ([b271e2f](https://github.com/LowCarbCheck/openplate/commit/b271e2f))
- **The More panel stays open when the screen changes underneath.** On slow devices, tapping More right after tapping a link opened the panel and then dismissed it as the new page appeared. The panel now stays open until you tap a page in it, tap its close button, tap outside it, or tap Back. `tests/e2e/more-sheet-outlives-a-pending-navigation.spec.ts` checks it. ([5570c1b](https://github.com/LowCarbCheck/openplate/commit/5570c1b))
- **A logged food no longer reopens on the search screen.** Tapping Search immediately after Add to diary kept the previous item open at the portion step, which made accidental duplicate logs easy. The search screen now opens empty. `tests/e2e/add-search-after-an-overtaken-log.spec.ts` checks it. ([b271e2f](https://github.com/LowCarbCheck/openplate/commit/b271e2f))
- **A server started from source with only its .env file serves pages again.** `server.ts` loaded `.env` after React had already chosen its build. A `NODE_ENV=production` value that lived only in `.env` came too late. Every page answered 500 with `dispatcher.getOwner is not a function`. The documented systemd unit runs `node --import tsx ./server.ts` and hit this issue. `pnpm start` and the Docker image set `NODE_ENV` themselves and never did. `.env` now loads first. `tests/e2e/node-env-from-dotenv.spec.ts` checks it. ([bc04b6c](https://github.com/LowCarbCheck/openplate/commit/bc04b6c))
- **A managed instance says plainly that its operator can read your diary.** The page title and the footer said "a food tracker only you can read", which was false: the operator keeps a backup key so a forgotten password restores your diary, and that key also lets them read it. The title and footer now say the diary is encrypted on your device. Onboarding, the join screen, the account page and the sync description now say what the backup key means, without "technically". ([5bfb944](https://github.com/LowCarbCheck/openplate/commit/5bfb944))
- **Visit counting honours Do Not Track, and you can switch it off.** The privacy notice promised that this instance's Matomo honours Do Not Track, and a browser sending it was counted anyway. With Do Not Track or Global Privacy Control on, no tracker loads now. Preferences has a switch that stops the counting on this device at once. `tests/e2e/analytics-opt-out.spec.ts` checks all three. ([5bfb944](https://github.com/LowCarbCheck/openplate/commit/5bfb944))
- **The scan screen says where a photo goes on a managed instance.** It said the photo is "read once", and not by whom. It now says the photo goes to this openplate's server, which passes it to the operator's AI provider, and names the model that reads it. ([5bfb944](https://github.com/LowCarbCheck/openplate/commit/5bfb944))
- **The key repair after sign-in no longer promises a recovery code.** An account whose keys were never finished was told the repair ends with a recovery code, and no code is ever shown. It now says that you sign in with your password on every device. The unused `sync.passwordNote` string, which said a password cannot be reset, is gone from all six languages. ([d3d6907](https://github.com/LowCarbCheck/openplate/commit/d3d6907))

### Docs

- **The install guides now name three steps that people missed.** The systemd unit in `docs/self-hosting.md` sets `Environment=NODE_ENV=production`, as `pnpm start` does. Each Quadlet README in `docker/quadlet/` now tells you to put `TRUST_PROXY=0` in the app's own env file when no reverse proxy stands in front. "Create the first account" now notes that a phone or second device can sign in only after HTTPS is set up. ([aa726d3](https://github.com/LowCarbCheck/openplate/commit/aa726d3))
- **The self-hosting guide covers the full stack's env recipe.** `docs/self-hosting.md` gets a new section for `compose.full.yml`, with the same `TRUST_PROXY` explanation and localhost-trial note the sync and inference sections already had; `compose.full.yml`'s own header comment now carries that `TRUST_PROXY` line too. ([7a3696f](https://github.com/LowCarbCheck/openplate/commit/7a3696f))

## [0.49.1] - 2026-09-26

### Changed

- **The More panel drops the grey bar at its top.** The bar looked like something to pull, but the panel cannot be dragged. It closes with its close button, a tap outside it, or a tap on a page. The close button still sits on the same line as the title. `tests/e2e/three-tab-bar.spec.ts` checks it. ([b419144](https://github.com/LowCarbCheck/openplate/commit/b419144))

### Fixed

- **The close button no longer shows a ring after a tap.** A panel that opens with only links in it puts the focus on its close button, and a tap on More drew a teal square around it. The ring now shows only when you use the keyboard, like every other button in the app. `tests/e2e/three-tab-bar.spec.ts` checks both cases. ([b419144](https://github.com/LowCarbCheck/openplate/commit/b419144))
- **The German notes for 0.49.0 read as one list.** The line about the photo button named two pages bare and one with an article. It now names all three the same way. ([9817afb](https://github.com/LowCarbCheck/openplate/commit/9817afb))

## [0.49.0] - 2026-09-26

### Changed

- **The diary, Overview and Pantry lead with a large photo button.** The row to type or speak a meal used to end in a small camera key. It now sits under the same full-width photo button the add panel opens with, in the brand colour and named in words: "Plate photo" on the diary and Overview, "Photo" on the Pantry, which photographs a shelf. The small key is gone, so each row has one camera, at every screen width. `tests/e2e/strip-photo-button.spec.ts` checks it, with the label in six languages at 360 px. ([9f44b62](https://github.com/LowCarbCheck/openplate/commit/9f44b62))
- **The logo at the top left shows that it opens a menu.** A small round badge with the three dots of the More button sits on the logo's lower right corner, in grey, not in the brand colour. The header does not move for it. `tests/e2e/mark-opens-more.spec.ts` checks it. ([9f44b62](https://github.com/LowCarbCheck/openplate/commit/9f44b62))

## [0.48.0] - 2026-09-25

### Changed

- **The logo at the top left opens the More menu.** On a phone, tapping the logo opens the same panel as the More button in the bottom bar. It slides up from the bottom either way, and closing it puts you back on the button you tapped. The header does not move to make room. The title and the openplate name stay where they were, and the logo stays the same size. `tests/e2e/mark-opens-more.spec.ts` checks it. ([9c82669](https://github.com/LowCarbCheck/openplate/commit/9c82669))
- **More now holds Settings.** The More panel has a Settings row at the top, above the page tiles and away from your thumb. It opens the same Settings page as the menu behind your avatar, which keeps its own Settings row. More stays lit while you are in Settings, except on the Plan page. Plan and Administration stay in the avatar menu only. `tests/e2e/three-tab-bar.spec.ts` and `tests/e2e/menu-is-found.spec.ts` check it in six languages at 360 and 390 px. ([9c82669](https://github.com/LowCarbCheck/openplate/commit/9c82669))
- **The add panel leads with a large photo button.** A tap on the plus shows "Plate photo" first, as a full-width button in the brand colour, taller than anything else in the panel. It does what the small camera key did. Search foods comes next, then the row to type or speak a meal, which no longer has its own small camera key. The diary and Overview keep theirs. `tests/e2e/three-tab-bar.spec.ts` checks it. ([9c82669](https://github.com/LowCarbCheck/openplate/commit/9c82669))

### Fixed

- **A closed More menu stays closed.** In 0.47.0, you could close the More menu with Back, then press Forward, and the menu opened again by itself. Now it stays closed. It also closes when the window gets wide enough to show the sidebar, so no dark cover is left behind. `tests/e2e/mark-opens-more.spec.ts` checks both. ([c64be45](https://github.com/LowCarbCheck/openplate/commit/c64be45))

## [0.47.0] - 2026-09-24

### Changed

- **The phone bottom bar now has three tabs.** The bar holds Diary, a round plus button in the centre, and More. A tap on the plus button lets you search for a food, type a meal, speak it, or take a photo. More slides up a panel from the bottom with a tile for each other page: Overview, Insights, Pantry, Fasting, Nutrients and Goals, with Overview nearest the thumb. The open page is marked, and More stays lit while you view one of them. Settings, and Plan and Administration where your account has them, are in the menu behind your avatar at the top right. The logo at the top left is now only a logo, and the side menu is gone, so the other pages are in one place. Install app stays on the Settings page. `tests/e2e/three-tab-bar.spec.ts` walks the bar, and `tests/e2e/menu-is-found.spec.ts` checks every label and tile in six languages at 360 and 390 px and that neither panel moves the page. ([44c71e5](https://github.com/LowCarbCheck/openplate/commit/44c71e5))

## [0.46.0] - 2026-09-24

### Added

- **The add screens share one switcher and keep what you started.** Search, Describe and Photo now sit in one row at the top of all three add screens, in place of the three "instead" links that each led to one other screen. Each screen keeps its draft while the app stays open: the words in the composer, the food and portion opened from a search, and the chosen photo with a finished analysis and your changes to its review. Switching away and back, or leaving by the bottom bar, no longer throws that away, so an analysis is never paid for twice. Logging an entry clears its draft, and a reload starts clean. The row is inert while an analysis runs, and the pantry's `/add/describe?to=` composer has no row. ([742eac1](https://github.com/LowCarbCheck/openplate/commit/742eac1))
- **A YAZIO diary can be imported on Data & backup.** "Import from YAZIO" reads the `days.json` and `products.json` that the open-source `yazio-exporter` tool writes, shows how many entries and days will land, from which first to which last day, and what it skips and why, and writes nothing until the person confirms. When some of those days already hold entries the person logged in openplate, the preview says how many, because those days then show both sets; nothing is merged or replaced. Foods are scaled to the amount eaten, recipe portions to the portions eaten, and a nutrient YAZIO does not carry stays unknown instead of zero. Every entry keeps its day and meal. Its carbs are read the European way, with fibre already left out: whether YAZIO counts fibre in is unknown, and this reading errs toward more net carbs, not fewer. Importing the same files twice updates the same entries instead of adding them again. Quick entries, and foods or recipes missing from `products.json`, are skipped and counted. The guide it links, `docs/import-from-yazio.md`, arrives with M254/03. `tests/e2e/yazio-import.spec.ts` checks it. ([f0e0cbf](https://github.com/LowCarbCheck/openplate/commit/f0e0cbf))
- **YAZIO weigh-ins come across with the diary.** The exporter's `weight.json` can be picked with the other two files. It repeats the last weigh-in on every later day, so a day counts as a weigh-in only when its value differs from the day before. Values are read as kilograms, the exporter's own reading, and the preview shows how many weigh-ins will land and the first and last weight, so a file in pounds is visible before anything is written. A value outside 20 to 350 kg is skipped and counted, and a day that already holds a weigh-in logged in openplate keeps it and is counted too. Each imported weigh-in's id is derived from its day, so importing the same file twice writes the same rows. `tests/e2e/yazio-import.spec.ts` checks it. ([9935a5c](https://github.com/LowCarbCheck/openplate/commit/9935a5c))
- **A YAZIO import can be removed in one step.** While imported rows exist, Data & backup ends with "Entries imported from YAZIO", which counts the diary entries and weigh-ins the import wrote and removes them after a confirm. Entries and weigh-ins logged in openplate stay, including a weigh-in logged on a day that held an imported one: it replaces the imported row under an id of its own. The removal goes through the delete journal, so sync removes the same rows on the person's other devices. The section sits last on the page, so its arrival after the store read moves nothing. `tests/e2e/yazio-import.spec.ts` checks it, with a layout-shift total of 0. ([9935a5c](https://github.com/LowCarbCheck/openplate/commit/9935a5c))

### Changed

- **The phone's bottom bar has a Menu tab.** Users did not realize that tapping the logo at the top left opened the full app menu. The bar now includes five tabs: Diary, Insights, Scan, Add and Menu. Menu opens the same screen as the logo and slides it in from the right, while the logo still opens it from the left. Insights is back in the bar, and Scan stays in the exact centre. The small arrow beside Scan is gone, because in a five-tab bar it would cover the camera button. A long press on Scan still opens the same choices, which also remain available on the Add page and the diary. Tab labels are one pixel smaller so German "Hinzufügen" fits a 360 px phone. `tests/e2e/menu-is-found.spec.ts` opens the menu from both entry points and checks every label in six languages at 360 and 390 px. ([eceb1a8](https://github.com/LowCarbCheck/openplate/commit/eceb1a8))
- **The account menu drops the language picker.** The overlay under the avatar carried six language buttons beside the theme choice, which made it tall on a phone. Language now switches only in Settings, under "Appearance and language" (`/settings/preferences`), which already offered it. `tests/e2e/menu-has-no-language.spec.ts` opens the menu and checks it, then switches the language on that page and checks it took effect. ([a280768](https://github.com/LowCarbCheck/openplate/commit/a280768))

### Fixed

- **The administration page fits a phone.** Its five tabs sat in one row that did not wrap. On a 390 px phone, that row needed 456 px and pushed the page sideways, worse in German and French. Tabs now wrap onto a second row on narrow screens. Each tab is a 44 px tap target, and all of them stay visible. From 672 px of room, they return to the underlined row. Three other areas that ran past the edge now wrap: the activity squares, the "last sign-in" cells in Spanish, and report dates in Italian, Spanish and Turkish. The counts and the Reports tab no longer push the page down when they arrive. `tests/e2e/admin-console-fits-a-phone.spec.ts` walks every console page in six languages at 360, 390, 768 and 1280 px. ([093129c](https://github.com/LowCarbCheck/openplate/commit/093129c))
- **The app shell holds its own width beside the desktop sidebar.** `main` had no set width limit. It grew to match the widest unbreakable line on a page, including truncated text. A long address, food name, or identifier could push the layout wider than the screen beside the 256 px sidebar. `main` now fits the room left by the sidebar on every page, not only the administration console. `tests/e2e/shell-main-holds-its-width.spec.ts` checks a phone width and both widths that carry the desktop sidebar. ([b3dcc1e](https://github.com/LowCarbCheck/openplate/commit/b3dcc1e))
- **The first key in the describe box no longer moves the box.** On a phone the example meal in the empty box wraps to three lines, and the first key hid it and dropped the box to one line, so the box jumped under the thumb. The box now keeps the height of its example and grows only when the words need more room, in every language and in the pantry's box too. `tests/e2e/describe-first-key.spec.ts` types the first key in six languages at 390 px and requires a layout-shift total of 0. ([959c37b](https://github.com/LowCarbCheck/openplate/commit/959c37b))
- **A page no longer moves when its font arrives late.** On a first visit, or on a slow connection, a page could appear before the Victor Mono font file arrived. It then showed in a narrower face and moved when Victor Mono replaced it. On the invite page, the card's text went from one line to two and pushed the rest of the card down 20 px. Until Victor Mono arrives, the app now uses a fixed-width font that is already on the device, such as Courier New or Liberation Mono. That font is adjusted to Victor Mono's letter width and line height, so the change moves nothing. The page also asks for the font file earlier. This also fixes the two browser checks that failed on every GitHub run, so the Translate UI workflow can finish again. `tests/e2e/font-swap-moves-nothing.spec.ts` delays the font file and requires a layout-shift total of 0 on /join, on the header's zero-scans line and on the diary. ([b477a99](https://github.com/LowCarbCheck/openplate/commit/b477a99))

## [0.45.0] - 2026-09-23

### Added

- **The header says when the free AI scans are used.** On a scan trial the header counted down to one scan left and then showed nothing, so a person learned the trial was over only when the next scan was refused. At zero the same line now says "Free AI scans used." with the "See plans" button, on every page but the plan page, and it can be closed for the day like the countdown. It sits in the header's status slot, so it moves nothing on the page; a subscriber and an account with a standing allowance never see it. `tests/e2e/scans-used-line.spec.ts` checks it. ([b51e247](https://github.com/LowCarbCheck/openplate/commit/b51e247))
- **A free trial is told that invitations open with a plan.** A scan-trial account read "Invitations you have left: 2", and every invitation it sent created another free trial. The core now refuses invitations from an unpaid trial (`403 invites-need-a-plan`) and says so on the account view with `invitesNeedAPlan`. The account page reads that field and shows a sentence with a link to the plans instead of the count and the address field. A paid member keeps the invite form, and an older core without the field keeps today's card. `tests/e2e/invites-need-a-plan.spec.ts` checks all three. ([836b2bd](https://github.com/LowCarbCheck/openplate/commit/836b2bd))

### Fixed

- **An account made in the browser no longer logs a storage loss on every page load.** Each page load of such an account logged "SyncStorageHeal: a sync cycle withheld deletes" and asked the browser for persistent storage again, 13 times in the live test. Nothing was lost: before its first pull a new page has not opened the account's sealed private data yet, so the cycle holds back that entry's delete, as it should. The report now leaves out that entry while it is unread and still reports every diary row and every real shrink of the private data. `tests/e2e/fresh-account-console.spec.ts` creates an account through `/join` and counts the warnings. ([74a3ba2](https://github.com/LowCarbCheck/openplate/commit/74a3ba2))
- **The scan screen states the account's free AI scans on a scan trial.** After ten trial scans the screen said "AI usage this month: 2 scans · cost unknown for your model": the line counts a log kept in this browser, which misses every scan made on another device or before the browser's storage was cleared, and it priced a scan the instance pays for as if the person had set up the model. On a managed instance during a scan trial the line now reads the account's own count, for example "10 of 10 free AI scans used", and follows each scan. A paid account and a person's own AI key keep the per-device line. `tests/e2e/scan-usage-line.spec.ts` checks both. ([3dfadf9](https://github.com/LowCarbCheck/openplate/commit/3dfadf9))
- **The invitation and account pages no longer jump while they load.** On `/join` the card was centred, so when the invitation was read it grew both ways and its top jumped up; it now starts at the top of the page. On `/settings/account` the invite card appeared between two sections when the server's `/health` answer arrived and pushed the rest of the page down; everything under the identity card now waits for that answer and arrives at once. Both measured a layout shift of 0.107 on a phone and now measure 0 in `tests/e2e/no-shift-on-load.spec.ts`. ([36629d9](https://github.com/LowCarbCheck/openplate/commit/36629d9))
- **A page load no longer reports a blocked eval.** Zod tested whether it could compile its parsers with `new Function`, the content security policy refused it as intended, and every page load reported that refusal as a violation. The app now switches zod's compiler off before any schema is built, so the browser reports nothing, and a real violation stands out. `tests/e2e/csp-quiet.spec.ts` loads four pages and requires zero violations. ([cce1a12](https://github.com/LowCarbCheck/openplate/commit/cce1a12))
- **The "today" shortcut on a past day fits the date bar again.** On a phone about 400 px wide or wider, the shortcut spelled out "Jump to today" and ran over the next-day arrow, worst in German. It now says only "Today", in smaller type. Screen readers and the tooltip still say the full sentence. ([ab0d5b4](https://github.com/LowCarbCheck/openplate/commit/ab0d5b4))

## [0.44.0] - 2026-09-23

### Added

- **An instance with open sign-up offers a sign-up form.** When the core's `/health` says `instance.openSignup`, the signed-out header, the landing and `/welcome` offer "Sign up" instead of the invite-only wording, and `/sign-up` takes an email address and posts it to `POST /v1/auth/signup-request`; the core mails the letter whose link creates the account. The form states the instance's free AI scans when `instance.trial` names a number, shows the wait from `Retry-After` on a `429`, says which of `email-invalid`, `email-domain-refused`, `captcha-failed` and `503 captcha-unavailable` the core answered, and carries a Cloudflare Turnstile challenge when `instance.signupCaptcha` names a site key. On a managed instance the CSP now allows `challenges.cloudflare.com` in `script-src` and `frame-src` for that challenge; the script loads only on `/sign-up`. An older core reads as invite-only, and nothing changes there. ([c383e67](https://github.com/LowCarbCheck/openplate/commit/c383e67))
- **The app counts free AI scans down during a scan trial.** An account whose core sends `trialScans` and no end date sees "N free AI scans left" in the header, the account menu and the account page, and the count follows each scan from the proxy's `X-Trial-Scans-Left` header without a refetch. The recap says "so far", and `403 trial-scans-spent` shows the plan offer headed with the number given instead of a key error. Every AI action on a managed instance sends one `X-Intake-Id`, reused by the adapter's retries and never sent to a provider the person configured. Administrators pick "Free trial" or "Standing allowance" when inviting on an instance with `instance.trial`, and see and change a person's free scans. Day trials keep working as before. ([9ebb7bf](https://github.com/LowCarbCheck/openplate/commit/9ebb7bf))
- **The sidebar and the phone menu carry an entry to the plan page.** On an instance that sells plans, a signed-in person finds Plan directly above Settings: at the foot of the list in the desktop sidebar, and in the menu behind the logo on a phone. It shows only while the sync server's `/health` answer, read fresh when the app loads and again whenever the plan page checks it, says plans are sold, so an instance that stops selling plans loses the entry instead of keeping a link to a missing page. It arrives without moving the rest of the menu, and a phone menu that is already open keeps its rows until the next time it opens. ([38692a5](https://github.com/LowCarbCheck/openplate/commit/38692a5))
- **The plan choice starts with a free card for running openplate yourself.** A person without a plan now sees, above the paid plans, that openplate is free with every feature on a server they run, with a link to the self-hosting guide on openplate.de. It is information only: it is not a plan to pick, pressing it picks nothing, and the two boxes and the order button apply to the paid plans alone. A subscriber moving to the yearly plan does not see it. ([d05f445](https://github.com/LowCarbCheck/openplate/commit/d05f445))

### Fixed

- **The signed-out header fits a phone on a managed instance.** With sign in and the access button in the header, the row needed up to 468 px, so on a 360 or 390 px phone the openplate word ran over the access button. Below the small breakpoint the header now shows the mark alone when it carries both controls, and the word stays the link's name for screen readers. `tests/e2e/landing-fits-a-phone.spec.ts` checks all six languages at 360, 390 and 412 px on a managed build. ([4fcaa5b](https://github.com/LowCarbCheck/openplate/commit/4fcaa5b))
- **Recipes on a managed instance are proposed when the screen opens.** The recipes screen asked before the instance's model had been read, failed without sending a request and did not ask again; it now waits for the model, and says so when the instance names none. ([9ebb7bf](https://github.com/LowCarbCheck/openplate/commit/9ebb7bf))
- **A cancelled plan no longer says it is paid and running.** A subscriber whose plan was set to stop read "Your plan is paid and running" right above "You cancelled". The status line on the plan card now says the plan is paid until its end date and does not renew, and a plan the billing service sends no end date for says it is paid and does not renew. ([2ab248d](https://github.com/LowCarbCheck/openplate/commit/2ab248d))

## [0.43.0] - 2026-09-23

### Added

- **Food names follow the app language.** A food logged from a photo, a typed meal, or a pantry reading now keeps its name in all six app languages. The diary, the entry page, your foods, saved meals, the quick-add chips, and the pantry show the name in the language the app is set to. Switch from German to French, and yesterday's "Apfel" reads "Pomme". A name you type or edit yourself is kept as you wrote it in every language. Foods logged before this version keep the one name they have. The names travel in your backup and in sync. An older openplate on another device keeps syncing, and a food it saves again loses its other names and shows the one it was logged with. ([f726cd9](https://github.com/LowCarbCheck/openplate/commit/f726cd9))
- **Servers can propose saved foods to LowCarbCheck.** Set `FOOD_DB_BACKFILL=true` and `FOOD_DB_API_KEY` to forward foods that users save from photos or typed meals. For matched rows, the server sends the food names in every app language. For unmatched foods, it sends names and macros per 100 g. The server never sends user data or names typed or edited by users. This feature is off by default, and users can disable it on their devices under Settings, AI. Foods published from proposals are stored and shown as estimates, never as curated sources. ([a94be3f](https://github.com/LowCarbCheck/openplate/commit/a94be3f))

### Changed

- **Photo, typed and pantry scans name each food in the app language.** The photo prompt named no language, so answers came back mostly in English, and a typed meal or shopping list came back in whatever language it was typed in. Every scan now asks for the names in the language the app shows, and for a `translations` object with the same food named in all six app languages. An answer without translations, from a model that ignores the request, still opens the review as before. ([4cf92f2](https://github.com/LowCarbCheck/openplate/commit/4cf92f2))

### Fixed

- **The date picker and every printed date follow the app language.** The diary's date picker drew English weekdays and an English month on every screen, and the admin pages, the account and plan pages, the research and sharing pages and the scan's allowance notice printed dates in the browser's own format, `9/23/2026` on a German screen. They now use the app language, `23.9.2026` in German. In English the picker's week now starts on Monday, like every other week in the app, and dates read `23/09/2026`. ([473c08a](https://github.com/LowCarbCheck/openplate/commit/473c08a))

## [0.42.0] - 2026-09-23

### Added

- **The plan page shows both plans with their prices before you start.** On an instance that sells plans, a person without a plan now sees the plans the billing service offers as cards, each with its price, the service's own sentence about how the plan runs, and for a yearly plan what it works out at per month and how much it saves against twelve monthly payments, rounded down. Nothing is picked for you: the start button waits until you pick a plan, and a link that names a plan (`/settings/plan?plan=yearly`) arrives with that one picked. Every price and every sentence about the order comes from the billing service; the app holds none. ([23155f9](https://github.com/LowCarbCheck/openplate/commit/23155f9))
- **Analytics count the four steps from a plan offer to a payment.** On an instance with Matomo configured at the default `product` level, four events join the `Plans` category: `offer-seen` with where the offer was shown (`plan-page` today; `countdown`, `ai-limit` and `account` are reserved for the placements that follow), `plan-picked` and `order-sent` with the plan key (`monthly` or `yearly`), and `payment-returned` with `paid` or `cancelled`. An offer counts as seen once per page view, when it is actually on screen. No event carries an account, an address, a price or a date, and an instance at `pageviews` sends none of them. ([b447b3c](https://github.com/LowCarbCheck/openplate/commit/b447b3c))
- **The header counts down the days of AI scans left in a trial.** On an instance that sells plans, a person in a trial sees how many days of AI scans are left in the header's status line, with a button to the plan page. The last day says so in its own words. Closing the line keeps it closed on this device until the next day. It never replaces another message, it does not show on the plan page itself, and nobody who pays, whose trial ended or whose instance sells nothing sees it. It sits in the header's own box, so nothing on the page moves when it appears or closes. The funnel counts it once per page load as an offer seen at `countdown`. ([2ba062f](https://github.com/LowCarbCheck/openplate/commit/2ba062f))
- **The trial's last days say how many meals you logged with AI.** In the last three days of a trial the countdown carries a second line, and the plan page carries the same line above the plans while the trial runs and after it ended: how many meals were logged with AI during the trial. It is counted on the device from the diary it already holds, and nothing is sent to count it. One photographed plate is one meal however many foods were on it, a food typed by hand does not count, and the trial is taken to start when the account was created. With no AI meal there is no line. ([476375d](https://github.com/LowCarbCheck/openplate/commit/476375d))

### Changed

- **A subscriber's plan page shows the plan they hold, not an order.** Somebody the billing service holds a live subscription for now sees a card naming their plan (monthly or yearly), whether it is paid or a payment is being retried, one date, and the button to manage it. The date reads as the renewal for a monthly plan, as the end of the paid year for a yearly plan with a note that it then continues monthly and can be cancelled every month, and as the day access stops for a cancelled plan. The start button and the plan cards are no longer drawn for a subscriber, and the page does not ask for the offer at all. The thank-you after a payment now shows once: the marker leaves the address, so a reload does not repeat it. ([03ddbba](https://github.com/LowCarbCheck/openplate/commit/03ddbba))
- **The plan page is now the order page, and Stripe only takes the payment.** A person without a plan picks a plan, reads the billing service's summary and withdrawal notice, ticks two boxes that always start unticked, and presses the service's own order button, which stays disabled until a plan is picked and both boxes are ticked. The page sends `POST /v1/plans/order` with the plan key, the version of the page the person read and both consents, and follows the address it answers. `POST /v1/plans/checkout` is no longer called. A page that changed in the meantime is read again, both boxes are cleared, and the page says so. A monthly subscriber finds a link on their plan card to order the yearly plan on the same page; the move is booked for the end of the paid month and shown on the card. When the billing service sends no readable offer, the page says the order could not be loaded instead of drawing a button. ([749f4ac](https://github.com/LowCarbCheck/openplate/commit/749f4ac))
- **An ended AI allowance now shows a plan offer, not a dead end.** On an instance that sells plans, a scan refused because the allowance ended, the notice under the AI entry on `/add/search` and `/add/describe`, and the scan screen's card for an account without AI now show a small offer: the lowest a plan costs per month (the yearly plan's monthly figure when that is lower) and one button to the plan page. The price is the billing service's, read when the card appears; until it arrives, or if the service sends no offer, the card keeps its size and the button still leads to the plan page. An organization's instance, where an administrator switches AI on, and an instance that sells nothing keep their sentences exactly as before. The funnel counts the offer once, at `ai-limit`, when it is on screen. ([817f293](https://github.com/LowCarbCheck/openplate/commit/817f293))

### Fixed

- **The plan page asks the sync server before it opens.** The page used to trust the answer the tab read first, so a tab that once saw plans on offer kept opening it after the operator switched the billing service off. The page now reads the server's `/health` again each time it opens, and answers 404 when plans are gone. ([5689cb3](https://github.com/LowCarbCheck/openplate/commit/5689cb3))

## [0.41.0] - 2026-09-23

### Added

- **A new page carries the website's own privacy text.** The page at `/privacy/website` is read from the same mounted folder as the other legal pages, so openplate.de can link to it and keep no legal text of its own. ([7656051](https://github.com/LowCarbCheck/openplate/commit/7656051))

### Changed

- **The release page credits the people a changelog entry thanks.** The GitHub release page previously showed only the bold first sentence of each entry. Any `Thanks @name` or `Reported by @name` later in the entry was omitted, and GitHub showed no contributors. Each line on the release page now ends with that credit. Only a handle directly after a credit phrase counts, so names inside code or running text are never included. ([7160b89](https://github.com/LowCarbCheck/openplate/commit/7160b89))

- **The legal pages come from a folder you mount, and openplate ships none of its own.** The terms, the privacy policy, the imprint, the withdrawal page and the two pages to cancel or withdraw from a contract are now markdown files in the folder `CONTENT_DIR` names, one file per page and language, with English as the fallback. Without the variable these pages answer "not found" and the footer shows no legal links. A file that breaks the format is refused and logged with its line numbers, and its page shows an error instead of part of the text. The two statutory forms work as before; only their text moved into the files. `PLAN_PRICE_EUR` and `PLAN_TRIAL_DAYS` are no longer read. ([7656051](https://github.com/LowCarbCheck/openplate/commit/7656051))

### Docs

- **A guide to the content folder.** [docs/content.md](docs/content.md) describes the folder layout, the file format, what the app refuses and the named sections of the two statutory pages, for anyone who runs their own instance. ([7656051](https://github.com/LowCarbCheck/openplate/commit/7656051))

## [0.40.0] - 2026-09-23

### Added

- **You can pick a main goal, the number the diary shows first.** Eating and targets in settings has a new Main goal card with three choices: net carbs, calories or protein. The first-run questions ask the same thing once a style is picked, already set to the one your style suggests. The choice only decides which figure leads the diary's day card; the dashboard, the trends and the day's verdict stay as they are. Picking calories without a calorie target is allowed: the card says so, and the diary shows the day's calories with a link to set a target. The choice is stored in your profile and travels in your backup and in sync. An older openplate on another device ignores it and may drop it, and the diary then goes back to following your eating style. ([9f8557f](https://github.com/LowCarbCheck/openplate/commit/9f8557f)) ([71442d1](https://github.com/LowCarbCheck/openplate/commit/71442d1))

### Changed

- **The page title on a phone is larger and sits closer to the brand name.** The title in the phone header is now 18 px instead of 14 px, with 4 px between it and the openplate wordmark above it instead of 6 px. The size is fixed: a title that does not fit is shortened in its translation, not shrunk. The thirteen titles in German, English, Spanish, French and Italian that first ended in an ellipsis at the new size are now shortened, and the research page's own title, "Research contributions", is now "Research studies" to match what the page is about. ([c6771ff](https://github.com/LowCarbCheck/openplate/commit/c6771ff)) ([e3cbcff](https://github.com/LowCarbCheck/openplate/commit/e3cbcff))
- **Every corner in the app is square now, except a real circle.** Cards, buttons, inputs, selects, dialogs, sheets, menus, badges, chips, images, progress bars and the header and bottom bar all lost their rounded corners. An avatar, a status dot, a round icon button, a switch and a spinner stay round, because they are circles by design and not because of where they sit. ([65812ef](https://github.com/LowCarbCheck/openplate/commit/65812ef))
- **The diary day card leads with one large figure.** The top of the card now shows one number large, what you ate against its target, for example "25.1 / 50 g", with a thick bar under it and a quiet line saying what is left. The other figures follow as a quiet list, each with its amount against its target and a thin bar. Which figure leads is your main goal, and until you pick one it follows your eating style: net carbs for the carb styles and for just tracking, calories for the calorie style, protein for the high-protein style. A lead with no target shows the day's total, no bar, and a link to set a target, and a protein lead on the reference intake says that it is a reference. The dashboard and the catch-up screen keep their rows as they were. ([bd0d0a5](https://github.com/LowCarbCheck/openplate/commit/bd0d0a5))
- **The loading screen shows the openplate name instead of three dots.** The app icon now stands still, and under it the word openplate is written the way the header writes it. "open" stays teal, and the teal runs through "plate" one letter at a time and back while the app starts. With reduced motion turned on in the system settings, the word does not move. Screen readers still hear only the loading label, not the letters. ([a28cd4e](https://github.com/LowCarbCheck/openplate/commit/a28cd4e))

### Fixed

- **Nothing moves on the first-run questions when you pick or type.** Picking a carb limit showed its description line only after the pick, so the Continue button dropped 24 px; the line now holds its space from the start. A picked chip was 8 px wider than the others, which pushed the kg and lb toggle and the sex and allergy chips sideways; every chip now keeps one width. Typing the week of a pregnancy turned a two-line note into one line and lifted everything under it by 16 px; the note now keeps its height. The same note on the Life phase settings page keeps its height too. ([71442d1](https://github.com/LowCarbCheck/openplate/commit/71442d1))

## [0.39.0] - 2026-09-22

### Added

- **A usual meal now asks you to confirm the portion before logging it.** Tapping a chip under "Your usual breakfast" (or lunch, dinner, snack) on Add or Scan opens a dialog naming the food, and for a saved meal, how many items, with a stepper to scale the portion from 50% to 200% before it is added, rather than logging the exact recorded amount straight away. Cancel closes the dialog with no write, and the confirmation that appears once you add it is unchanged. ([6cc400c](https://github.com/LowCarbCheck/openplate/commit/6cc400c))
- **You can list your food allergies, on day one or later in settings.** The About you page and the body step of the first-run questionnaire carry the same fourteen chips, one for each allergen an EU food label must declare: gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin and molluscs. The list is stored on this device beside the rest of your profile, travels in your backup file and in encrypted sync like every other profile field, and is never sent to an AI provider or anywhere else. A sentence under the chips says what the list is not: openplate checks only foods it recognised from a photo or a description, it can miss hidden ingredients, and it is not a safety check. The chips themselves become visible notes on foods in a later release. The backup format moves to version 24; an older openplate refuses a backup taken by this one, as before. ([07631cb](https://github.com/LowCarbCheck/openplate/commit/07631cb))
- **Foods you photograph or describe now carry small notes for pregnancy, breastfeeding and your allergies.** When the AI reads a plate or a sentence, it also says which foods fall into the categories the NHS, the BfR and the ACOG agree on for pregnancy, such as raw milk, soft cheese, raw egg or fish, raw or cured meat, cold-smoked fish, high-mercury fish, liver, alcohol, caffeine and raw sprouts, and which of the fourteen EU allergens a food contains or may contain. Nothing about you is sent with the photo: the app on your device compares those answers with your life phase and your allergy list and draws a small chip beside the food, in the review before you confirm, on the diary card and on the entry page. Pregnant shows every category, breastfeeding shows alcohol, caffeine and high-mercury fish, and an allergy chip shows for anyone who listed that allergen. The chip is a note, not a block: it opens nothing and stops nothing, caffeine reads as a reminder that it counts toward 200 mg a day, and a doubt is worded as a doubt, may be unpasteurised, may contain milk. The raw answers are kept on the entry, so changing your life phase or your allergy list re-evaluates every old entry at once, and they travel in your backup and in sync. Foods added from the search carry no such note yet. The Life phase settings page says where the hints come from and that they do not replace advice from your midwife or doctor. The backup format stays at version 24. ([2d206f9](https://github.com/LowCarbCheck/openplate/commit/2d206f9)) ([a8f3b48](https://github.com/LowCarbCheck/openplate/commit/a8f3b48))

### Changed

- **Add, Scan and Describe now nest under one address, /add.** /add is now the database search, at /add/search. /scan, the camera and the photo review, is now /add/photo. /describe, the message composer, is now /add/describe. The old addresses still work, each one redirects to its new home, so a bookmark, a home screen shortcut, or an installed app's stale link all keep working. ([16db3e2](https://github.com/LowCarbCheck/openplate/commit/16db3e2))
- **"What you ate" on the diary now states each macro as a share of the day, not a second gram figure.** The rows at the top of the day card already say how much protein, fat and fiber you ate and how that sits against your goal. The block under them repeated those same grams a second time with nothing beside them, so the card read as two blocks saying almost the same thing. Those four cells now give each macro's share of the day, the same percentages the coloured bar directly above them draws, so the rows answer how much and the block answers what shape the day had. No figure was lost: every gram count still has its own row. ([7e514c6](https://github.com/LowCarbCheck/openplate/commit/7e514c6))
- **Trends now uses a two-column layout on wide screens.** Charts show grid lines and axis numbers, and tapping or hovering a bar, slot or macro segment displays its exact value. Metric and meal filters now sit as dropdowns in a single row beside the time range switch, instead of three rows of chips. ([d844919](https://github.com/LowCarbCheck/openplate/commit/d844919))

### Fixed

- **The name openplate no longer sits on top of the page title on a phone.** The small brand name and the name of the page you are on were less than two pixels apart in the bar at the top of every screen, so the two lines read as one block and you could not tell them apart at a glance. They now stand six pixels apart. The bar is the same height, the page title is the same size, and nothing else on the bar moved. ([5c86ca1](https://github.com/LowCarbCheck/openplate/commit/5c86ca1))
- **The AI settings page keeps its explanations folded away until you ask for them.** The page ended with about ten paragraphs of grey text, all open, which pushed the Save button off the bottom of a phone. The two reference blocks, what this is for and what to try when a scan fails, are now closed panels that open when you tap their heading. Nothing was removed, and the setup steps, the provider choice, the models and the key field are all still where they were. ([cdc2992](https://github.com/LowCarbCheck/openplate/commit/cdc2992))
- **Your usual meals now stand out from the list of recently logged foods.** The chips under "Your usual breakfast" were drawn in the same card surface as the rows under them, so the one tap that saves you a search looked lighter than the list it sits above. Those chips are now filled, and a food's calories moved onto the same line as its badges, so a recent food is two lines instead of three and the whole list is shorter. How often you logged a food now reads as a small filled figure instead of the quietest grey on the row. ([cdc2992](https://github.com/LowCarbCheck/openplate/commit/cdc2992))
- **Your record tells a three day streak from a hundred day one at a glance.** Every row on the record page looked the same whatever it stood for. The two streak families are ladders, so each of their rows now prints the number of days it asks for, down the left of the title. The badges for trying a function have no day count and print none. ([cdc2992](https://github.com/LowCarbCheck/openplate/commit/cdc2992))
- **The first screen now carries the openplate mark and name.** The screen a new device opens on, the one that offers to start a diary or sign in, was a card with a headline and two buttons on an otherwise blank background, and nothing on it said which app you had opened. It now carries the app mark and the name above the card, the same pair the questionnaire on the very next screen has always shown, and the two are centred together. ([7b49fdf](https://github.com/LowCarbCheck/openplate/commit/7b49fdf))
- **Saved meals now tells you where the next one comes from.** The page explained how to save a meal only when you had none, which is the one moment you cannot act on it. The sentence now sits at the foot of the page whenever you have saved meals too, so a list of three no longer ends halfway down the screen with nothing under it. ([7b49fdf](https://github.com/LowCarbCheck/openplate/commit/7b49fdf))
- **Describe now puts the message box at the bottom of the page.** The box was pinned to a fixed share of the window rather than to the room the page was given, so on a phone it stopped short and left a band of empty space beneath it. It now reaches the bottom of the page above the navigation bar, on a tall screen and on the short one a raised keyboard leaves. ([7b49fdf](https://github.com/LowCarbCheck/openplate/commit/7b49fdf))
- **Notifications now shows tomorrow's message even when you cannot turn notifications on.** The page exists so that nobody agrees to a notification without reading one first, and the preview was shown only to people who had already agreed. If your browser blocks notifications, your phone needs openplate on the home screen first, or you simply have not turned them on, you now see what the morning message would say. The promise that at most two arrive a day is now the page's closing line in every state, instead of appearing only once notifications were on. ([7b49fdf](https://github.com/LowCarbCheck/openplate/commit/7b49fdf))

## [0.38.0] - 2026-09-21

### Added

- **openplate now carries a cancellation page and a withdrawal page that need no login.** German law obliges a seller to accept a cancellation under § 312k BGB and a withdrawal under § 356a BGB through a function on the site itself, so `/kuendigung` and `/widerrufen` are now two public pages, each with its own confirmation step, and both are linked in the footer of every page. A page asks for an email address and nothing else. It carries no retention offer, no pause, no discount, no survey and no support link, because the statute allows none of them. The openplate server writes the declaration down before anything else and sends a confirmation by mail at once. The four button labels are the words the statute names, so they read in German in every language. The withdrawal instruction now names the function as well. This needs openplate-core 0.18.0 or newer, which is where the two pages post to. ([86a5bb9](https://github.com/LowCarbCheck/openplate/commit/86a5bb9)) ([2165150](https://github.com/LowCarbCheck/openplate/commit/2165150)) ([ff76a8c](https://github.com/LowCarbCheck/openplate/commit/ff76a8c))

### Changed

- **Cards on Insights, the dashboard and Fasting now read in a clear order.** Every card title is the same size, 18 px, where half of them were 16 px and half 18 px over the same body text, so a title now stands clear of the line under it. The small labels above a figure, such as "Latest" and "To target" on the weight card, are grey capitals, so they no longer look like the sentences around them. The weight card and the summary of your last 7 days draw a tile only for a figure, and the reason a figure is missing is one line under the row instead of a sentence inside a tile. The three filter groups on the Nutrition tab, Metric, Time span and Meal, are named above their buttons. ([4ed94e7](https://github.com/LowCarbCheck/openplate/commit/4ed94e7))
- **The name openplate is now set thin, with the first half in teal, and centred on the mark.** The word beside the mark in the sidebar, the phone menu, the public header and the first screen used to be set in a heavy serif. It is now set in the same monospace face as the rest of the app, at its thinnest weight, with "open" in the brand teal and "plate" in the page ink, and lifted so the middle of its letters sits on the middle of the mark. The big name on the front page and the small name above the page title on a phone follow the same recipe. The serif font file is gone, so the app downloads 67 KB less. ([41433f3](https://github.com/LowCarbCheck/openplate/commit/41433f3))

## [0.37.0] - 2026-09-21

### Changed

- **openplate takes on the look of lowcarbcheck.org.** The app is set in the same monospace face as lowcarbcheck.org, on every screen but the long ones: the privacy policy, the terms and the other legal pages keep the old face, because a monospace paragraph in a phone column runs to about 35 characters a line. The panel at the top of Diary, Overview and Insights is a plain card carrying faint graph paper now, instead of a teal wash, and the same paper sits behind the landing page. Cards are flat with a thin edge, and a corner tells you what a thing is: a small corner for a row of figures, a card corner for a card, a wide one for the single panel at the top of a screen. The small uppercase labels above a group are grey, and so are the chips that state a number, which leaves the teal for the tab you are on, the one main button and the links. The word openplate keeps its own face and nothing else uses it. Settings rows kept their icon and lost its tinted tile. Nothing moved, nothing was removed, and no setting changed. ([badd1f2](https://github.com/LowCarbCheck/openplate/commit/badd1f2)) ([b751650](https://github.com/LowCarbCheck/openplate/commit/b751650)) ([1f2a259](https://github.com/LowCarbCheck/openplate/commit/1f2a259))

### Fixed

- **The backup reminder is quiet when a server holds your diary.** The amber reminder on your diary says your diary lives on this device only, and it said so whether or not a copy existed anywhere else. It appeared on a hosted instance, where your account always keeps an encrypted copy, and it appeared on a self-hosted one after you signed this device in to sync. Only an export ever cleared it, so signing in never did. It now stays quiet whenever a server holds a copy, including the moment after a reload while the app is still reopening your session, so it is never shown and then taken away. On a device with no account and no sync, nothing changed. ([9987153](https://github.com/LowCarbCheck/openplate/commit/9987153))
- **The update notice wraps instead of cutting off the version.** The row that appears above the header when a newer openplate exists was one line that trimmed itself to fit, so on a phone it read "openplate 0.35.1 is ava..." and hid the very thing it was telling you. It now takes a second line when the sentence and the buttons do not fit side by side, in all six languages. Reload and the dismiss key are 44 px tall, up from 28 px and a bare line of text, and they stay together so the dismiss key never ends up alone on a line. ([e52ea21](https://github.com/LowCarbCheck/openplate/commit/e52ea21))

## [0.36.0] - 2026-09-20

### Added

- **The app now shows you what changed after an update.** The first time you open openplate on a newer version, a card on your diary and your home screen lists the main changes and links to a new What's new page under About. That page keeps the notes of the last three releases, in your language. The card stays until you dismiss it or open the notes, on each device, and only for people who used openplate before the update: a device that is new to openplate is never told what changed. The notes travel inside the app, so nothing is fetched and the page works offline. ([657ac9f](https://github.com/LowCarbCheck/openplate/commit/657ac9f))

### Changed

- **Your fasts now follow you to your other devices.** A fast used to live on the one device it was started on, so erasing that device, losing it, or opening openplate on a tablet left the fasting history behind. Starting a fast, ending it, writing a mood or a note, and removing a fast all reach your account now and land on your other devices. If two devices both started a fast while they were offline, you will see two open fasts on both of them: the newest is the one that counts as running, and the other sits in your history marked still open, with a Remove button. Nothing is ever closed at a time you did not choose. Update every device you use: one still on an older version does not pass on a deleted fast, so a fast you removed can come back. ([822d2bf](https://github.com/LowCarbCheck/openplate/commit/822d2bf))
- **Your pantry now follows you too.** What is in the fridge used to stay on the device that photographed the shelf, so the list you wrote on a tablet was not there when you stood in the shop with your phone. A photographed shelf, a corrected line and a removed row all reach your other devices now. Two devices that each photographed a fridge show one combined list you can edit down, the same way a second photograph on one device already works. The photograph itself is still never stored and never sent anywhere but your own AI provider. Update every device you use: one still on an older version does not pass on a removed pantry row, so a row you took off the list can come back. ([822d2bf](https://github.com/LowCarbCheck/openplate/commit/822d2bf))
- **The sign-out dialog now notices a saved meal you renamed.** It compared your saved meals by name and count only, so renaming one and signing out before the next sync read as nothing waiting, above the box that erases your diary. It compares the contents now, so an edit you have not sent yet is named. A device that has not synced since this change warns about its saved meals once, then settles. ([10da2df](https://github.com/LowCarbCheck/openplate/commit/10da2df))
- **The sign-out dialog counts your fasts and your pantry, and warns only about what it cannot check.** It used to end with one sentence naming fasts, saved meals, the pantry and your keys together, on every sign-out, whether or not anything was actually waiting. Fasts and pantry rows are counted with the rest of your diary now. Saved meals get a sentence only when this device is holding meals your account has not been told about. Your sharing and research keys get a sentence of their own, because they are sealed and this check cannot open them. ([822d2bf](https://github.com/LowCarbCheck/openplate/commit/822d2bf))
- **The About screen now says when the server is behind, and who can update it.** When a newer release exists, the Updates card opens with a plain line naming the version the server runs and the newest one. Below it, one sentence fits the reader. On a self-hosted instance it says to pull the new image and restart the server, and that the app has no update button. On a hosted instance it says only the person who runs the server can update it, so there is nothing for you to do. A server on the newest release says Up to date. With update checks turned off, the card is unchanged. ([edd9ab0](https://github.com/LowCarbCheck/openplate/commit/edd9ab0))

### Fixed

- **An end you recorded is never undone by another device.** If you ended a fast on your phone and then adjusted that same fast's start time on a device that had not synced yet, the two changes could tie, and which one won came down to which device happened to sort first. Half the time the fast reopened and the end you recorded was gone. The end now always survives, together with the mood and note you wrote with it, while the other device's start-time change is kept as well. Nothing is ever ended for you. ([540bcec](https://github.com/LowCarbCheck/openplate/commit/540bcec))
- **The fast alert now follows the fast, on every device.** The one-off notification for a fast reaching its target was set by the screen you started the fast on. Now that fasts travel, a fast started on your phone left your tablet silent, and worse, a fast you ended on one device left the other one set to buzz for a fast that was already over. Every device now works out what is running after each sync and when the app starts, and switches the notification off when nothing is. ([c45ec5d](https://github.com/LowCarbCheck/openplate/commit/c45ec5d))
- **The privacy policy and terms now name your sharing and research keys too.** The lists of what lives on your device and what your account holds an encrypted copy of were completed for fasts, the pantry and the rest, and still left out the keys behind clinician sharing and study contributions. Those travel in a sealed part of the same encrypted copy, and both documents now say so. A test fails from now on if a new kind of thing starts syncing before somebody decides what to call it in the policy. ([eff28cf](https://github.com/LowCarbCheck/openplate/commit/eff28cf))
- **The sign-out dialog says what to do about your keys, not just what it cannot check.** The line about sharing and research keys warned you that an erase may lose them and stopped there. It now tells you a backup file includes them, so there is something to do before you confirm. ([eff28cf](https://github.com/LowCarbCheck/openplate/commit/eff28cf))
- **Adding a food by hand now says what is missing in your language.** Leaving the Name field empty answered with the words the form validator uses among themselves, in English, whatever language you read the app in. It now asks for a name in your language, and a name made only of spaces is refused too instead of saving a food with a blank name. ([edb5abb](https://github.com/LowCarbCheck/openplate/commit/edb5abb))
- **The controls on the add form and on Your foods are thumb sized.** The meal picker beside the grams field was two thirds the height of the field next to it, and the Add entry button under it was the same size. Edit and Remove on Your foods were 32 px squares four pixels apart, with Remove deleting a food for good. All of them are at least 44 px on a phone now, with room between the two keys, and unchanged on a desktop. ([edb5abb](https://github.com/LowCarbCheck/openplate/commit/edb5abb))
- **Overview's week card and its two tiles fit a phone.** The sentence offering the Insights tour was squeezed into a column about 80 px wide beside its two buttons and ran to five lines; it now has the width of the card, with the buttons under it. The last-7-days tile and the weight tile drew side by side at every width, which left the week chart 122 px for a seven-column weekday row: the names ran past the card edge in English and in Turkish, in 10 px type. The two tiles take the full width on a phone and sit side by side again from a tablet, the weekday names are readable, and the two tiles draw the same height when they share a row. ([3ae54cc](https://github.com/LowCarbCheck/openplate/commit/3ae54cc))
- **A saved meal shows the whole name you gave it.** The name was cut off mid-word on one line, so "Porridge with blueberries" read as "Porridge with blue...". It wraps to a second line now. Log now and Remove beside it are thumb sized on a phone, with room between them. ([8a60a9a](https://github.com/LowCarbCheck/openplate/commit/8a60a9a))
- **The describe screen names itself once, and the first-run headings keep their last word company.** A screen reader met two identical page titles on the describe screen and had no single name for it. The Yesterday in numbers heading on your daily catch-up sat flush on the first row it labels. Headings on the landing page, in the first-run questions and on the recovery screen used to break with one word alone on the last line; they balance their lines now. The links on those screens, and the Send key on the describe screen, are thumb sized on a phone. ([9550e4a](https://github.com/LowCarbCheck/openplate/commit/9550e4a))
- **The privacy policy and terms now list everything that syncs.** Both documents listed your foods, food logs, weight entries and goals, and stopped there. Your fasts, your fasting routine, your saved meals, your pantry and your streaks and awards are in the same encrypted copy and were never named. All four lists now say so, in the same sentences, with nothing else changed. The pages carry today's date. ([f1f85df](https://github.com/LowCarbCheck/openplate/commit/f1f85df))
- **Buttons, switches and the date picker are thumb sized on a phone.** Buttons, icon buttons, the drawer close button, the switches and the date picker cells were 28 to 36 px tall, under the 44 px a thumb needs. They are 44 px on a phone now, a switch that is off is easier to see, and a two line card title no longer runs its lines together. Desktop sizes did not change. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **The diary no longer scrolls sideways, and the next day arrow stays on screen.** A long quick add food made the page wider than a phone, and on a 360 px phone the arrow to the next day sat past the edge. Both fit now, in German and Turkish too. The meter bars are one length on every row, the header message no longer leaves one word alone on a line, and an entry no longer breaks a fact across two lines. A group whose entries have no carb figure says so instead of showing 0 g. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **The fasting history, the Insights charts and their filters fit a phone.** In Turkish the fasting history ran past its card and start dates were cut off. Chart labels were drawn at 4 to 5 px and tab names were cut. They wrap and resize now, filter chips are 44 px tall, and the 3 months choice is translated in every language. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **Settings pages have thumb sized controls and even spacing.** Labels sit clear above their fields, and weigh in delete buttons, toggles and links reach 44 px. The model choice on the AI page uses the app's own style instead of the browser's. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **German legal headings fit a phone.** Long words such as Nutzungsbedingungen ran past the right edge and lost their last letters. Headings now wrap, and the opening paragraph of each legal page is smaller on a phone. ([8bcb52f](https://github.com/LowCarbCheck/openplate/commit/8bcb52f))
- **The app's own frame is thumb sized, and the bottom bar steps aside for the keyboard.** The menu mark in the top corner, the Back link on every settings page, and the six links in the footer of the public pages were 20 to 36 px tall, under the 44 px a thumb needs. All of them are 44 px on a phone now, drawn exactly as before, and unchanged on a desktop. On a short screen, a keyboard left the header and the bottom bar covering more than a quarter of what was visible, with the bar over the field you were typing into. The bar now steps aside while a field has your attention and comes back when you leave it, without moving the page under you. ([af67d61](https://github.com/LowCarbCheck/openplate/commit/af67d61))
- **The diary's day bar sits against the header, and the lists match the rest of the app.** A strip of page background showed between the header and the date bar at the top of the diary. Search results on Add food and the rows on Your foods drew tighter corners and less padding than every other list. The box that asks whether to delete something was the only sharp cornered panel in the app. They all draw the same shape now. On the About screen, the licence and source links are a whole row to tap. On a narrow phone in Turkish, a row no longer puts its value on top of its label. ([af67d61](https://github.com/LowCarbCheck/openplate/commit/af67d61))

### Docs

- **The sync guide says what travels between your devices and what never does.** A new section lists what a sync carries, names your saved meals as the one part that still travels as a whole list, and states the three things that stay put: plate photos, your AI provider key, and the record of what you deleted. ([822d2bf](https://github.com/LowCarbCheck/openplate/commit/822d2bf))

## [0.35.1] - 2026-09-20

### Docs

- **The topologies and sync documents no longer say the server cannot read entries.** The topologies guide said the sync service cannot read a single entry, and the sync guide described the diary as ciphertext the service cannot read. The service keeps each account's recovery code, sealed under a secret of its own, so the operator of an instance can in principle open a diary. Both documents now say so. A new test fails if either claim comes back. ([72cc810](https://github.com/LowCarbCheck/openplate/commit/72cc810))

## [0.35.0] - 2026-09-20

### Added

- **Insights can now show the last 90 days.** A new 3 months choice sits beside Week, 2 weeks and Month. At Month and 3 months, the chart draws one bar per week, showing the average of the days you logged that week, so the bars still fit a phone. A week you logged nothing stays empty rather than showing zero. Insights now reads only the days it shows, so a long diary no longer slows the screen down. ([416001a](https://github.com/LowCarbCheck/openplate/commit/416001a))

- **Progress is renamed to Insights, and now opens on four tabs.** The menu item and the page title say Insights, and the page still lives at the same address. Overview shows your streak, this week's recap and your weight. Nutrition shows the carbs and calories chart, with a link to Nutrients. Meals filters that same chart to one meal. Goals shows your 13-week goal grid. Switching tabs keeps the time span and the meal filter you had chosen. ([3975809](https://github.com/LowCarbCheck/openplate/commit/3975809))

- **The Nutrition tab charts protein, fat and fiber too.** Every metric marks a day with missing macros the same way, as a minimum. Protein draws your protein goal as a floor and names a day below it, without a warning colour. Net carbs show your total carbs as an outline behind each bar, so fiber and sugar alcohols are the gap. Daily bars get a 7-day average line. At Month and 3 months, the chart title says each bar is a week's daily average. A new card shows where your calories come from, split into carbs, protein and fat. The chosen metric is now part of the address. ([90030ed](https://github.com/LowCarbCheck/openplate/commit/90030ed))

- **The Meals tab now shows your averages and your usual foods.** With no meal chosen, it shows your average log for each meal and how many days that covers. It shows how your calories or net carbs split across breakfast, lunch, dinner and snacks each day, adds a line for anything logged with no meal chosen at all, and tracks how much of your week's calories came from snacks over time. Choosing one meal keeps the existing chart and adds that meal's average and your five most-logged foods there. Nothing here shows a goal or says a meal was missed. ([aa26b36](https://github.com/LowCarbCheck/openplate/commit/aa26b36))

- **The Goals tab now shows how often you met each goal.** Each goal you set gets a card over the last 13 weeks. It shows on how many finished days you met it, how far under or over it you were on average, and, unless streaks and awards are hidden, your current and longest run of met days. A day without enough detail to check a goal is left out and counted apart, never counted as missed. A card for fasting shows how many finished fasts reached their own target. Everything is measured against your current goals. With no goal set, the tab invites you to set one instead. ([a016c9a](https://github.com/LowCarbCheck/openplate/commit/a016c9a))

- **Overview now opens with a summary of your chosen time span.** It shows how many days you logged, your average calories, net carbs and protein, and how each compares with the same span before it. Three cards follow, jumping straight to Nutrition, Meals and Goals. Your last 7 days on the home screen, your goal grid there, and today's summary in the diary now link straight into the matching tab. A one-time card on the home screen points at Insights once you have logged a few days, and stays gone once you dismiss it. ([e771527](https://github.com/LowCarbCheck/openplate/commit/e771527))

- **The data screen says what is inside the JSON download.** The download holds the private key used when someone shares their diary with you, and the seed for your research pseudonym. A note beside the download buttons now states this. It is present in all six languages. ([66f03d3](https://github.com/LowCarbCheck/openplate/commit/66f03d3))

### Changed

- **The app no longer mentions openplate-gateway.** That service merged into openplate-core and was archived, so no server can send the refusal the app still had an error screen for. The error text, translations in five languages, the analytics reason, and a retired table in the local database are gone. The refusals a managed instance sends are unchanged. ([0a4a18c](https://github.com/LowCarbCheck/openplate/commit/0a4a18c))

### Fixed

- **A saved meal now reaches the server by itself.** The check that decides whether this device has anything to send previously ignored saved meals. Creating, renaming, or deleting one registered nothing the device could see. The meal uploaded later, carried along by an unrelated change to a food log. A device erased before that happened lost the meal. A saved meal now counts as a change on its own. Fasts and the pantry still do not, and both omissions are deliberate. A fast is never synced, and the pantry is a working list of what is in one device's kitchen. ([460bce9](https://github.com/LowCarbCheck/openplate/commit/460bce9))

- **Signing out no longer says everything reached the server when it has not.** The sign-out dialog counted a queue that nothing has written to since the diary moved onto the device. So it always said "Everything on this device has reached the server." above the box that erases the diary. It now counts the changes the sync has not sent yet and any estimate reports still waiting. It says so when it could not check. It also names what the check does not cover: fasts, saved meals, the pantry, and your sharing and research keys. Rows left in that retired queue are deleted, because nothing could ever send them. ([9f93ff0](https://github.com/LowCarbCheck/openplate/commit/9f93ff0))

- **The app no longer says the server cannot read your diary.** The sync server keeps each account's recovery key, sealed, so that a password reset gives the diary back, and so the operator of an instance can technically open it. The data settings, the offline page, the recovery screen, the landing page, and the sharing screen still said the server could not read the copy it holds. So did the estimate report consent and the terms of service. They now say what is true. The terms described a forgotten passphrase as a permanent loss, and now describe the reset by email. The privacy policy already named the recovery key; its backup paragraph now also lists the recovery keys and estimate reports. The legal pages carry today's date. The consent step before you send a report about a wrong estimate was one of those strings, so its wording version moves with it, and a stored report still names the words the person read. ([1bccf3f](https://github.com/LowCarbCheck/openplate/commit/1bccf3f))

### Docs

- **The architecture docs describe what each server holds today.** They cover the one optional secret the app server can hold, and the food names it forwards to LowCarbCheck. They also cover the recovery key the sync server keeps, and the optional features of openplate-core. openplate-gateway is listed as archived. ([544dc77](https://github.com/LowCarbCheck/openplate/commit/544dc77))

- **The self-hosting and sync documents name the key material in a backup.** They previously described the download only as your diary. It also holds your sharing private key and your research pseudonym seed, so a copy of that file requires the same protection as the diary itself. The menu path in both documents is corrected. ([66f03d3](https://github.com/LowCarbCheck/openplate/commit/66f03d3))

## [0.34.1] - 2026-09-19

### Changed

- **The server now runs as one process in the container.** The image previously started the server through `pnpm exec tsx`. That kept pnpm and the tsx command line running as idle parent processes, using about 70 MB per instance. It now starts `node --import tsx ./server.ts` directly. You do not need to change anything. The entry point is still `scripts/start.sh`, and stopping the container still lets open connections finish. ([0a9271b](https://github.com/LowCarbCheck/openplate/commit/0a9271b))

## [0.34.0] - 2026-09-19

### Added

- **The streak on the home screen and on Progress is now the number of days you used the app.** You see one number in both places, and it counts any day you used openplate. A day over your carb goal no longer sets it to zero. Staying at or under your carb goal is now a separate badge, earned at a week, a fortnight, a month and a hundred days. When a streak changes, the app makes no announcement, and the count simply reads lower the next time you look. ([bf92980](https://github.com/LowCarbCheck/openplate/commit/bf92980))

- **A new screen lists what you have done with the app.** The streak card on Progress opens Your record, showing the functions you have tried, the days in a row you used the app, and the days in a row you stayed under your carb goal. The screen contains no scores, no levels and no comparisons with other people. When you earn a badge, a single line names it, once. You can use a switch in Preferences to hide the streak and the entire record screen, while the app continues keeping track in the background so turning it back on shows your full history. ([bf92980](https://github.com/LowCarbCheck/openplate/commit/bf92980))

- **Your past counts: the app rebuilds the record from the diary you already have.** When you first start this version, openplate checks your food logs, weigh-ins and fasts, then marks every day that shows you used the app. If you tracked for two years, your record shows two years instead of one day. Badges earned in the past are dated to the day you earned them and arrive already marked as seen, so nothing is announced for previous months. Repeating a meal, editing the pantry and exporting a backup leave no trace in a diary, so you earn those three badges the next time you complete the action. ([24e073e](https://github.com/LowCarbCheck/openplate/commit/24e073e))

- **What counts as using the app, and what the record survives.** Logging food, confirming a scan, running a fast, weighing in, repeating a meal, editing the pantry and exporting a backup each count for the day you did them. Receiving a sync from another device does not count, so a day you never opened the app is never marked as active. If you use a phone and a tablet on the same day, both are kept, and a device that loses its stored data cannot erase the record from your other devices. A day you used the app stays counted, and an earned badge is never removed. ([af4eb45](https://github.com/LowCarbCheck/openplate/commit/af4eb45))

- **Your backup file moves to version 23.** Your record travels inside your backup and inside the encrypted sync. Backups written by an older version still import, and a badge from a newer version is kept rather than dropped. A backup written by this version cannot be read by an older version of openplate. ([8029888](https://github.com/LowCarbCheck/openplate/commit/8029888))

- **The instance can hold a food database key, and says so when the database refuses.** A new `FOOD_DB_API_KEY` setting lets whoever runs the instance authenticate the food lookups openplate already makes. Leaving it unset keeps the free anonymous tier, which is what every instance used until now. If the food database refuses the instance, because the key is wrong or the allowance is spent, the scan review shows one quiet line saying the numbers are estimates, and the server log carries a warning instead of nothing. A scan still completes, still shows numbers and can still be logged. ([59e9fe1](https://github.com/LowCarbCheck/openplate/commit/59e9fe1))

## [0.33.0] - 2026-09-18

### Changed

- **Micronutrient reference values now come from the German DGE.** The Nutrients screen previously displayed EU EFSA targets published by LowCarbCheck. It now displays DGE figures. Several targets change: vitamin D moves from 15 to 20 micrograms a day, potassium from 3500 to 4000 milligrams, and iron for women after menopause from 16 to 14 milligrams. Your age band and sex still decide which figure you see. Beta-carotene has no DGE figure, so the screen shows none rather than borrowing one. An administrator can switch the instance back to EFSA or to US NASEM figures. The footnote under each nutrient names the source document for that figure. ([cd96c4e](https://github.com/LowCarbCheck/openplate/commit/cd96c4e))

### Added

- **The imprint and the withdrawal instruction carry a telephone number.** German law has required a telephone number inside the Widerrufsbelehrung since 2022, and the field was empty. It now renders on both pages, in every language. ([5bac555](https://github.com/LowCarbCheck/openplate/commit/5bac555))

- **An administrator chooses whose reference values the instance shows.** A new Settings tab in the administration console picks between the German DGE, the EU's EFSA and the US NASEM figures, and every device on the instance follows it on the Nutrients screen, in every language. The footnote under each nutrient still names the document the number came from, so the change is visible where the number is. A device that already has the app open keeps showing the old values until the page is reloaded, and the form says so. An instance running no openplate-core, or one older than this setting, is unaffected and keeps whatever its own server was configured with. ([d8d53a7](https://github.com/LowCarbCheck/openplate/commit/d8d53a7))

## [0.32.0] - 2026-09-17

### Added

- **The app keeps a pantry, and cooks the rest of your day out of it.** Photograph a shelf or a fridge, or write what you have, and openplate turns it into a list of ingredients on the new Pantry screen, which you can correct line by line. The list stays on your device. From it, Suggest a meal proposes two or three recipes for the next meal, sized to the calories, protein, carbs and fat still open in your day, so a protein-heavy breakfast is not followed by a protein-heavy lunch. Each recipe shows what one serving costs against what is left and about what it weighs, you say how many servings you ate, and one tap writes them into the meal at that weight. ([1326c77](https://github.com/LowCarbCheck/openplate/commit/1326c77)) ([7b609ac](https://github.com/LowCarbCheck/openplate/commit/7b609ac)) ([a21545f](https://github.com/LowCarbCheck/openplate/commit/a21545f)) ([69b3d7f](https://github.com/LowCarbCheck/openplate/commit/69b3d7f)) ([d7b0605](https://github.com/LowCarbCheck/openplate/commit/d7b0605)) ([745574e](https://github.com/LowCarbCheck/openplate/commit/745574e))

### Fixed

- **A second photograph of your shelf no longer empties the pantry.** Confirming a reading only ever kept the lines that reading named, so photographing the fridge on Monday and the cupboard on Tuesday left you with the cupboard alone, and nothing said the rest had gone. A photograph or a written list now adds to the pantry, and removing a line in the list is still the way to take something off it. Two smaller repairs went with it: a list that fails to save says so and stays on screen instead of looking saved, and an amount typed as 1,5 is read as one and a half rather than as one. ([196b907](https://github.com/LowCarbCheck/openplate/commit/196b907))

## [0.31.0] - 2026-09-14

### Added

- **Generated Podman Quadlet units ship for every openplate deployment shape.** The directory `docker/quadlet/<scenario>/` holds the `.container`, `.volume`, and `.network` files that Podman needs to run openplate as a systemd service. These units are generated directly from existing compose files instead of written by hand. A push gate check regenerates and verifies them, so a stale unit never reaches you. ([6dea296](https://github.com/LowCarbCheck/openplate/commit/6dea296))
- **openplate now speaks French, Italian, Spanish and Turkish too.** The whole app, the legal pages included, is available in six languages. A language strip sits in the device menu at the top right, right under the theme choice, so you can switch without opening Settings; Settings keeps its own list. Picking a language reloads the page in it, exactly as before. ([b725b06](https://github.com/LowCarbCheck/openplate/commit/b725b06))

### Changed

- **The diary adds food through the same one-line composer as the home screen.** The three separate photo, type and speak buttons are now a single field: the wide part opens the composer for writing, and a microphone and a camera sit inside the same frame to the right of it. All four places the diary offered them use it, the three empty days and the bar under a day that already has entries. Every one still carries the day you are looking at, so a back-dated photo or sentence lands on that day, not on today. The copy-from-yesterday chips are unchanged. ([22746f6](https://github.com/LowCarbCheck/openplate/commit/22746f6))
- **The compose files name the Postgres image with its registry.** `postgres:17-alpine` is now `docker.io/library/postgres:17-alpine` in `compose.sync.yml` and `compose.full.yml`, because rootless Podman refuses to guess a registry for a short name without a terminal. The same files stop forwarding `SIGNUP_MODE`, which openplate-core rejects at boot, and declare the sync service's `/health` check, which Podman otherwise drops on pull. The generated Quadlet units gain `TimeoutStartSec=300` beside `Notify=healthy` and each service name as a network alias; both came out of starting every scenario rootless on a Fedora host, recorded in each `docker/quadlet/<scenario>/README.md`. ([50ed073](https://github.com/LowCarbCheck/openplate/commit/50ed073))
- **The add sheet in the bottom bar shows the same composer as the rest of the app.** Its three rows are gone. In their place is the one-line field you already use on the home screen and in the diary: write on the wide part, dictate with the microphone, photograph with the camera. The sheet still carries the day you are looking at, and its camera is the same one the raised button opens, so a photo taken from the sheet still reaches the camera on iPhone. ([22746f6](https://github.com/LowCarbCheck/openplate/commit/22746f6))
- **The camera in the add sheet is drawn as an outline, not a filled key.** The raised round button in the bottom bar sits a few pixels below that sheet and is already a filled camera, so two filled cameras were competing for the same tap. Only the sheet changes. On the home screen and in the diary the camera keeps its filled look, because there it is the one camera on the page, and on a desktop or a tablet there is no round button at all. ([5798d29](https://github.com/LowCarbCheck/openplate/commit/5798d29))
- **The home screen's Like yesterday button is now a preview card.** It shows the day it repeats, with dashed rows sketching the entries it would copy and a caption underneath for the count. Tapping the card still copies the same whole day as before. The pill button on the write screen is unchanged. ([423dde9](https://github.com/LowCarbCheck/openplate/commit/423dde9))

### Fixed

- **The add button in the bottom bar logs to the day you are looking at.** Its camera, its Type row and its Speak row always went to today, even while you were reading an earlier day in the diary, so a photo or a typed meal quietly landed on the wrong date and nothing said so. All three now carry the day on screen. ([4a3b065](https://github.com/LowCarbCheck/openplate/commit/4a3b065))

## [0.30.0] - 2026-09-14

### Added

- **The progress chart can now show a single meal over time.** A new filter sits beside the net carbs and calories toggle on the progress screen. You can pick all meals, breakfast, lunch, dinner, or snacks. When you select one meal, the chart bars display only the food logged to that slot across the days. The daily goal line disappears in this view, since goals apply to the whole day. The page URL saves your filter choice, so it stays active when you refresh. ([cbf1966](https://github.com/LowCarbCheck/openplate/commit/cbf1966))
- **The app now suggests frequent foods based on the time of day.** You will see your regular items under the add search box and below the scan camera. The list uses your past diary entries. Foods you log most often at that hour appear first, along with saved meals you usually eat then. One tap adds the item to your log, and the undo button clears it in one step. If you do not have logged habits for that specific hour, the row stays empty. ([a3e4faa](https://github.com/LowCarbCheck/openplate/commit/a3e4faa))
- **The diary now offers to save meals you log three days in a row.** When a meal group has the same foods and portions as the two days before it, a line under the header asks to save it. Saving uses the existing header button, and the meal goes into your saved meals. You can dismiss the prompt per meal. It stays dismissed on that device. ([a4c5159](https://github.com/LowCarbCheck/openplate/commit/a4c5159))

### Fixed

- **The photo review card now shows the right net carbs for a food read from a nutrition label.** European labels already leave out fibre from total carbohydrates. The review step previously subtracted fibre a second time, which could show 0 g net carbs while the saved entry was correct. The review card now handles these labels the same way the saved entry does, so the two figures match. ([bad5acd](https://github.com/LowCarbCheck/openplate/commit/bad5acd))
- **The notification badge is now the openplate glyph instead of a white circle.** Android generates status bar icons from the app icon silhouette. Because the main icon is a solid disc, the badge appeared as a plain dot. The notification now uses a cut-out version of the mark. ([39e92b0](https://github.com/LowCarbCheck/openplate/commit/39e92b0))
- **The review step no longer flags an error when fibre exceeds carbohydrates on European nutrition labels.** European labels list carbohydrates with fibre already subtracted. Foods high in fibre often show a higher fibre count than carbohydrate count. The review step used to treat this as an impossible calculation and asked you to verify the entry. It now applies the regional label convention used for net carbs. Standard European labels will not trigger a false warning, but impossible numbers still will. ([cee1409](https://github.com/LowCarbCheck/openplate/commit/cee1409))

## [0.29.7] - 2026-09-13

### Changed

- **Every settings page now uses the same grouped layout as the settings list.** Each section on a settings page is a labelled inset panel, like the rows on the settings screen, instead of a desktop-style card with its own large heading. Nothing behind the sections changed: the same fields, switches and links, in the same order. ([20b5936](https://github.com/LowCarbCheck/openplate/commit/20b5936))

## [0.29.6] - 2026-09-13

### Changed

- **The settings page now reads as one grouped list, not a stack of cards.** Each section under Settings is a single inset list with a hairline between rows, matching how phone settings screens are usually laid out, instead of every row sitting in its own bordered box. ([152cfd1](https://github.com/LowCarbCheck/openplate/commit/152cfd1))

### Fixed

- **Turning notifications on now reports what actually happened.** A permission question you closed without answering was reported as blocked and took the switch off the page, so there was no way to ask again; it now says the question went unanswered and leaves the switch there, and if a second tap goes unanswered too, because some browsers quietly stop asking, it points you at your browser's site settings instead. A session that ended on this device reads as signed out rather than as an instance that sends nothing, and a subscription left over from another notification key is dropped instead of registered to an address the instance can never reach. The page re-reads the browser permission when you come back to it, so allowing notifications in your browser settings takes effect without a reload. ([a4d7990](https://github.com/LowCarbCheck/openplate/commit/a4d7990))
- **A long status message no longer pushes the page wider than the screen.** An error banner in the header, such as a blocked-notifications warning, could stretch past the edge of a phone screen instead of wrapping. It now wraps to up to three lines at a smaller size, and the header keeps its fixed height. ([2110bb8](https://github.com/LowCarbCheck/openplate/commit/2110bb8))

## [0.29.5] - 2026-09-13

### Fixed

- **Losing local data no longer removes your account sharing keys.** Your sharing key pair, in-person verified clinicians, and joined studies travel in a sealed part of your sync data. The app previously sent whatever it found. If a browser wiped local data while the app ran, the app found nothing, sent an empty copy, and replaced your account data. No error showed, because this section does not store deletion records. The app now records removals as you make them, just as it does for diary entries and fasts. It sends a reduced set only if every missing item was removed on purpose. Otherwise, it returns your account copy unchanged, restores the items to the device, and marks that no local changes were published. Unpinning a clinician or leaving a study still syncs to your account on the next run. ([90728fb](https://github.com/LowCarbCheck/openplate/commit/90728fb))
- **Deleting an entry during an active sync now stays deleted.** Removing an entry while a sync ran previously allowed that sync to restore the entry, with no notice on screen. The sync now checks the local deletion record right before writing, and the deletion syncs to your account on the next run. ([ef8d1b9](https://github.com/LowCarbCheck/openplate/commit/ef8d1b9))
- **Pending delete records no longer stay in storage forever.** Four types of entries were logged in that record and never cleared, including items created and deleted between syncs. Every entry processed by a sync is now removed once the sync matches with the account. An entry whose deletion the account did not accept in that sync is kept for the next one. ([0b542ee](https://github.com/LowCarbCheck/openplate/commit/0b542ee))
- **Data restore notices now appear only for the matching account.** The notice explaining that your device lost local data and your account restored it stays visible after the sync finishes. Switching accounts on that device previously showed the new user that notice, along with the previous user's entry count. The notice now tracks its specific account, and the app clears it when another user signs in. ([1b360a0](https://github.com/LowCarbCheck/openplate/commit/1b360a0))
- **Restored entry counts now match the actual rows written back.** Two cases were counted incorrectly. When account fasts or saved meals replaced local lists, the app reported zero restored items, because neither list stores deletion records. A sync that held back sealed data also counted as a restored entry, even though nothing was written to the device. The count now reflects only diary rows written to storage, and held sealed data is noted in the log only. ([1b360a0](https://github.com/LowCarbCheck/openplate/commit/1b360a0))

## [0.29.4] - 2026-09-12

### Fixed

- **The app now records deleted fasts and saved meals before syncing.** These two lists do not merge across devices yet. Whichever device syncs next sends its whole list. Until now, that happened whenever a device thought its local storage looked fine. A device that lost its data looked fine, because the app created an empty store before reading it, letting an emptied list overwrite your account copy. The app now writes down each fast and saved meal you delete at the moment you remove it, matching how diary entries work. It only uploads a shorter list if every missing item was removed on purpose. If items are missing without a deletion record, your account keeps its list and sends it back to the device. Clearing a long list still works, because each removal is recorded as you go, showing your account that the reduction was intentional. A device whose record predates this change syncs once to your account, then returns to normal on the next sync. ([129fa9f](https://github.com/LowCarbCheck/openplate/commit/129fa9f))

## [0.29.3] - 2026-09-12

### Fixed

- **Your app now writes a deletion down instead of guessing at one.** Yesterday's fix compared what is stored against what was loaded, and that comparison cannot see the difference between a diary somebody emptied and one a browser threw away: both read as zero. On the order the app really starts in, it also creates an empty store before it looks, so an emptied device looked perfectly healthy and its entries were still reported to your account as deleted. From now on the app records each entry you delete, at the moment you delete it, alongside the entry itself. Only a deletion it has written down is ever sent. Lose your local data and there is nothing written down, so nothing is deleted and your account puts the entries back. Delete eighty per cent of your diary on purpose and every one of those is written down, so all of them are sent. Three more things were put right with it: a device that had ever deleted one entry no longer waves through every later shrink of its data, a push your account turns back now applies what it just fetched instead of leaving the device empty and repeating itself, and the message you see when it happens no longer claims the app is out of date. The notice that says your entries were restored is now only shown when they actually were. ([e8ac79a](https://github.com/LowCarbCheck/openplate/commit/e8ac79a))

## [0.29.2] - 2026-09-12

### Fixed

- **A device that lost its local data no longer empties your fasts and saved meals.** Your fasts and your saved meals are not merged between devices yet, so whichever device syncs next hands over its whole list. If a browser had thrown that device's data away, or if the app had only half read it, the list it handed over was empty or short, and your account's copy was replaced by it. Neither one is a deletion anybody made, so neither is accepted any more: when a device cannot show what it holds, the copy already on your account is kept instead. A device that can show it holds none still means it, so a fast or a saved meal you really deleted stays deleted. ([794ba1a](https://github.com/LowCarbCheck/openplate/commit/794ba1a))

## [0.29.1] - 2026-09-12

### Fixed

- **A device that lost its local data no longer empties your diary.** A browser may throw away an app's local data when it needs the space. When that happened here, openplate compared what was left against its record of the last sync, concluded you had deleted every entry, and told your account to delete them too. A second device then pulled that result and emptied itself. This is how a real account lost its whole diary on 12 September. A deletion is now only ever sent when the device can show it happened, by checking what is stored against what it loaded; where the two disagree nothing is deleted, your account's copy is pulled back down, and the app says so on screen instead of showing a silent green tick. It also asks the browser again to keep your data, which is the setting that would have prevented it. ([02c86c8](https://github.com/LowCarbCheck/openplate/commit/02c86c8))
- **Coming back to the app no longer drops your sharing and research keys.** Every time a session resumed, openplate read your private key compartment before it had fetched it, got no answer, and reported those keys to your account as deleted. A device that already held them kept working, so nothing ever looked wrong, but a new device signing in received none of them and sharing quietly did not work there. "I have not read it yet" and "there is none" are now two different answers, and only the second one can delete anything. ([02c86c8](https://github.com/LowCarbCheck/openplate/commit/02c86c8))
- **A device whose data was cleared is no longer offered the setup wizard.** After a browser cleared the app's storage, openplate saw a device with nothing on it and started onboarding, and the answers given there outranked the real profile on your account. It now recognises a device that has synced before and offers to restore it instead. ([02c86c8](https://github.com/LowCarbCheck/openplate/commit/02c86c8))

## [0.29.0] - 2026-09-12

### Added

- **Your fast is visible on every page.** While a fast is scheduled or running, a small pill in the header on every page shows how long you have been fasting, with the current stage on wider screens, and opens the timer with one tap. On an installed app the home screen icon carries the whole hours as a badge where the device supports it. Overtime looks like any other minute, never amber. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))
- **The timer names the stage you are in.** Under the elapsed time the fasting page now says which stage your body is likely in (digesting, early fasting, low liver stores, rising ketones, ketosis, extended) and when the next one begins, and for the first hour of a new stage it says when you entered it. Every stage carries the same one line reminder that these are averages and not a measurement of you, and that on low carb you move through the early stages sooner. A collapsed "What happens when" list explains all six in one plain sentence each, with no claim the evidence does not support. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))
- **One usual fast, one tap to start.** Presets now run from 16:8 to 72 hours. A new Fasting page in settings holds your usual fast and an optional usual start time; the timer preselects that fast and offers "Start at 20:00" beside "Start now", and after a fast ends it offers to schedule the next one. The end button reads "Complete" once you reached your target and "End" before it, and ending lets you say how it went and keep a short note, both shown in your history. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))
- **Fasting figures that never grade you.** Above the history: fasts completed, your longest, your day streak (a day counts when you fasted at least an hour of it, so a 72 hour fast counts three days) and the hours you fasted this week. A streak of zero shows nothing at all. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))
- **A note of care before a long fast, and a calm notice while pregnant.** Starting a fast of 24 hours or more shows, once, who should not fast, what means stop and eat, and a reminder to drink water with a little salt; it never appears again unless you ask for it in settings. If your life phase says pregnant or breastfeeding, the fasting page shows a quiet notice that fasting is not advised and offers only the shorter presets. Nothing is ever blocked. ([d798266](https://github.com/LowCarbCheck/openplate/commit/d798266))

- **Today, everyone here: an opt-in pulse of what other people logged.** A new switch on the Sharing page, off by default, sends small rounded counts from your device: one meal with its calories rounded to 50 and protein to 5 g, one photo parsed, and a short "still fasting" signal while a fast runs. Never the food, the time, the photo or your goals. With it on, Overview shows a tile with today's meals logged, photos parsed, calories and protein tracked across everyone on your instance, and the fasting page says how many others are fasting right now. Both appear only once at least three people took part today; below that they show nothing rather than a lonely number. ([d4be8b1](https://github.com/LowCarbCheck/openplate/commit/d4be8b1))

- **Notifications, with a morning catch-up that states facts and stops.** A new Notifications page in settings turns on push notifications where the browser and the instance support them (on iPhone the app must be on the home screen first). Two kinds, both preselected once you turn the switch on and each with its own checkbox: a daily catch-up at a time you pick, 08:00 by default, and a word when a fast reaches its target. At most two a day. The catch-up is written on your device, never on the server: yesterday in one sentence against your ceiling and floor, what lies ahead (a running, scheduled or usual fast), and at most one nudge when protein or fiber came in under on two of the last three days, naming three foods you have logged before. It never says should, must, only, again or missed, and never mentions weight. A yesterday with no entries reads "Yesterday had no entries. Today starts fresh." The notification opens a catch-up page with the same lines and yesterday's rows. The server only learns that your account wants a wake-up at that time in your time zone, and when a fast reaches its target; the payload carries no text. ([5fb3508](https://github.com/LowCarbCheck/openplate/commit/5fb3508))

### Changed

- **The day's budget rows read plainer, and fat now has a figure.** Protein is orange and fat is plum, so a protein row no longer looks like a red warning and a fat row no longer looks like an amber one. The second line of each row now says which way it means: a ceiling reads "up to 24.9 g more" and a floor reads "12 g still needed", where both used to read as a bare remainder you had to work out. Fat gets a meter of its own when your calorie target, your net carb ceiling and your protein floor are all set, because those three already say what is left for fat; the row is tagged "from your targets" so it is clear nobody set that number for you. Past that figure the fat row says "12 g over" and fills its meter, but it stays plain rather than turning amber, because going over there is the same thing as going over your calories and the calorie row already says so. Set fewer than three targets and the fat row shows the day's grams as before. ([b500d73](https://github.com/LowCarbCheck/openplate/commit/b500d73))
- **The diary calendar now colours every day by your goals.** Opening the date picker in your diary used to show a plain month. Each day is now filled the same way the 13-week grid on Overview and on the progress page fills it, darker the more of your goals you met, with the same legend under it, so one day looks the same wherever you meet it. A screen reader now reads a coloured day as the date plus which step of the four it reached, where it used to read the date alone. The progress page grades its squares against the same targets the other two screens use, so if you are pregnant or breastfeeding the energy your phase adds is counted there too, and a day can no longer be met on one screen and missed on another. ([b500d73](https://github.com/LowCarbCheck/openplate/commit/b500d73))

### Fixed

- **The week tile's bars are no longer links inside the tile link.** Each of the seven bars on Overview's last-7-days tile opened its own day in the diary, a link nested inside the whole tile's own link to your progress, which browsers do not support and could silently break a tap. Tapping a bar no longer opens anything by itself; tapping anywhere on the tile still opens your progress, exactly as before. ([b500d73](https://github.com/LowCarbCheck/openplate/commit/b500d73))
- **The morning catch-up's fat row shows yesterday's real figure.** Yesterday's rows on the catch-up page always read "0 g" for fat, whatever you actually ate, because the page never carried that figure at all. It now reads the same total the diary shows for that day. ([96ded64](https://github.com/LowCarbCheck/openplate/commit/96ded64))
- **Erasing this device now forgets the pulse and push settings too.** Signing out with erase turned on used to leave the pulse opt-in switch and the remembered push subscription behind, so the next account on that device found sharing already on and a stale notification target. Both are now cleared along with the diary. ([96ded64](https://github.com/LowCarbCheck/openplate/commit/96ded64))
- **The pulse tile and the fasting line now appear on a plain reload.** With sharing on, Overview showed no "Today, everyone here" tile and the fasting page said nothing about other fasters, unless you happened to start a fast: the figures were asked for a moment before your account had finished opening, and nothing asked again. They are now read as soon as your account is there, and again the first time you come back to a page you left open for more than five minutes. A device with sharing off asks for nothing at all. ([d4be8b1](https://github.com/LowCarbCheck/openplate/commit/d4be8b1))

## [0.28.0] - 2026-09-11

### Added

- **"Like yesterday" is now a button on the Overview card and on the composer.** Copying a whole day from the day before it only existed in your diary, on the day you were looking at, and a person who eats the same thing most days never went there to look for it. The Overview card and the meal composer now each carry one "Like yesterday" button that copies everything you logged yesterday onto today, with the same Undo the diary offers. It only appears when yesterday has entries and today has fewer, so a day that is already logged looks exactly as it did. The diary section is unchanged and is now called the same thing. ([11b58f7](https://github.com/LowCarbCheck/openplate/commit/11b58f7))
- **Life phase now has its own page, always shown on the hub.** Pregnancy and breastfeeding used to hide inside the goals page, behind the biological sex answer. They now live on their own "Life phase" page, with a row on the settings hub for every account that shows your current phase or "Not active". The dashboard's reminder for a due date links there too. ([1b9ddf5](https://github.com/LowCarbCheck/openplate/commit/1b9ddf5))

### Changed

- **Overview now shows your last 13 weeks and your streak.** The grid of squares, one per day, only lived on the progress page. It is now the second thing on Overview, right under today, with your streak on the line above it. It is the same grid, drawn from the same days, so the two screens can never disagree about a day. Tapping anywhere on it opens the progress page, where the squares stay tappable one by one. Overview scrolls a little further because of it. The two tiles below it, your last 7 days and your weight, open the progress page the same way: tap anywhere on the tile. ([694ef8b](https://github.com/LowCarbCheck/openplate/commit/694ef8b))
- **The Overview week tile draws your last seven days as bars.** The tile showed seven dots, the same dots the diary shows. It now draws one bar per day, as tall as that day stands against your one goal, with a hairline where the goal sits. A day over a ceiling pokes above the line in amber; a day that reached a floor crosses it in teal; a day with nothing logged is a small stub. With no goal set the bars count what you logged and no line is drawn. Every bar still opens that day in your diary, and says its own figure, its goal and the verdict out loud. The link to your progress is now the arrow beside the tile title. ([7cdbd07](https://github.com/LowCarbCheck/openplate/commit/7cdbd07))
- **The goals page splits into "About you" and "Eating and targets".** One page asked how tall you are and how many carbs a day you want, under a single title called Goals. Your height, your birth year, the sex answer and the weigh-in log are now on "About you", with a row to the life phase page, and the eating style and the four targets are on "Eating and targets". The old address still works and sends you to the targets. The card that only linked to the AI settings is gone, the settings hub already lists them. ([bba6ff6](https://github.com/LowCarbCheck/openplate/commit/bba6ff6))
- **The settings hub is grouped around you, and your plan has a row.** The hub had four headings, one of which held your account, sharing, research, the admin page and two lists of your own foods and meals. It now has seven: About you, Eating and targets, Scanning and AI, Appearance and language, Account and plan, My lists and data, and About openplate. On an instance that sells a plan, the plan page is a row on the hub instead of something you find only at the moment a refusal names it. A heading whose rows are all switched off for your instance is no longer drawn over nothing. ([052828f](https://github.com/LowCarbCheck/openplate/commit/052828f))
- **The top bar stays on screen while you scroll.** The bar with the page title and your device menu used to scroll away with the page, so getting back to it meant scrolling all the way up. It now stays at the top of the screen. In your diary the day you are looking at stays too, in a second bar just below it, with the arrows to step a day back or forward, so a long day never leaves you wondering which day you are reading. ([ca9016f](https://github.com/LowCarbCheck/openplate/commit/ca9016f))
- **Messages now appear in the top bar, not in a floating box.** A saved entry, a failed import or a warning used to pop up in a small box over the page, which covered the buttons underneath it and sat on the tab bar on a phone. Those boxes are gone. The message now takes the place of the page title in the top bar, which is always on screen, and it steps aside again after a few seconds. A warning stays a little longer and a failure stays until you close it with the cross beside it. Where a message offers you an Undo, the button sits right there in the bar. On the pages that have no top bar, such as the sign in and welcome screens, the message shows in a bar of its own at the top of the screen. ([7cd2aa7](https://github.com/LowCarbCheck/openplate/commit/7cd2aa7), [a0fba17](https://github.com/LowCarbCheck/openplate/commit/a0fba17))
- **Back now goes up one level, instead of replaying every step.** In the installed app the back gesture, the back key and the edge swipe walked backwards through every tap you had made, so leaving a page you had wandered around in took ten of them. Back now goes up one level: out of a settings page to the settings list, out of an entry to its day. Moving between the tabs at the bottom, stepping through the days in your diary and saving a food no longer add a step to go back through, and going back to a page you were on already returns you to it rather than opening a second copy. Middle click and ctrl or command click still open a link in a new tab. Nothing changes in a browser tab beyond a shorter history. ([bae028e](https://github.com/LowCarbCheck/openplate/commit/bae028e))
- **The terms page now prints your instance's real price and trial length.** The two payment sentences used to show a fixed price and trial length regardless of what the instance actually charges. They now read the deployment's own settings, in your language, and stay hidden if the instance has not set a price at all. ([18fe89d](https://github.com/LowCarbCheck/openplate/commit/18fe89d))
- **The avatar menu now has one settings door and an account strip.** The menu used to show a sync row, a create account row and a settings row at the same weight, so on a phone the account and the settings looked like the same place. Those middle rows are gone. A strip at the foot now shows your email or name, your sync status and your allowance, and is the one place that opens your account page. Signed out, it reads "Signed out" and opens sign in instead. ([058c868](https://github.com/LowCarbCheck/openplate/commit/058c868))

### Fixed

- **A long label beside a reference tag no longer gets clipped.** On a narrow phone or with larger text turned on, a German word like "Ballaststoffe" lost its tail to an ellipsis, or vanished altogether. The label now wraps onto its own line, with the reference tag dropping underneath it, so the full word is always readable. ([7b0528d](https://github.com/LowCarbCheck/openplate/commit/7b0528d))

## [0.27.0] - 2026-09-10

### Added

- **The withdrawal instruction and the model form now have a page.** `/withdrawal` carries the statutory Widerrufsbelehrung and the Muster-Widerrufsformular, which the terms already linked to. The German text is the binding one and follows the model in the EGBGB word for word; the English beside it is a translation, and the page says so. The operator's telephone number is still missing from it, and the page leaves no gap where it belongs. ([72025da](https://github.com/LowCarbCheck/openplate/commit/72025da))

### Changed

- **The scan screen drops a notice nobody could read.** On an instance an organization runs, the camera card told a signed out visitor to sign in before it would take a photo. Signing out closes that screen on that kind of instance, so the sentence was written for a card that never opened. It is gone, and signing out still sends you to the welcome screen as before. ([e2bc608](https://github.com/LowCarbCheck/openplate/commit/e2bc608))
- **The settings pages a visitor may open drop the app shell.** Preferences, Account and About are reachable without an account on an instance an organization runs, so that a visitor can set the language and find the sign in door. They used to arrive wrapped in the full sidebar, the device chip and a back arrow, which read as an app the visitor had never entered. They now wear the public header and footer, with one sentence saying why and links to the start page, the sign in page, the imprint and the privacy page. Anyone with a diary on the device sees the app as before, and on a cold start the page shows the loading screen until it knows which of the two you are, instead of the sidebar. ([3d29c02](https://github.com/LowCarbCheck/openplate/commit/3d29c02), [f901139](https://github.com/LowCarbCheck/openplate/commit/f901139))

## [0.26.0] - 2026-09-09

### Added

- **An instance that sells a plan now has a plan page.** `/settings/plan` shows what your account pays for, when the paid period ends, whether it renews, and gives you the two buttons that start a plan and open the payment portal, where cancelling, changing a card and downloading an invoice live. It is reachable from the photo estimates card on your account page. On an instance with no biller behind it the address is not a page at all, which is what the server itself answers. ([a2d0cbf](https://github.com/LowCarbCheck/openplate/commit/a2d0cbf))
- **A refusal that a plan would fix now points at the plan page.** When photo estimates stop because a trial ended, the notice under the composer and the message on the scan screen offer the plans, instead of naming an administrator who does not exist. An instance an organization runs is unchanged, and so is an instance that sells nothing. ([a2d0cbf](https://github.com/LowCarbCheck/openplate/commit/a2d0cbf))
- **The terms and the privacy policy describe the payment.** Where an instance takes a card, the terms gain a section on what is sold, how it renews, how it is cancelled, what happens when a payment fails, and your right of withdrawal, and the privacy policy gains a section naming the payment processor, what it receives, and why an invoice is kept for ten years after an account is erased. Neither section appears on an instance with no biller. ([a2d0cbf](https://github.com/LowCarbCheck/openplate/commit/a2d0cbf))

### Fixed

- **The German privacy policy's account section now speaks Sie, like the rest of the page.** Six sentences under "Your account and your devices" shipped in the du register on a page that otherwise addresses you formally. ([2747bef](https://github.com/LowCarbCheck/openplate/commit/2747bef))

## [0.25.0] - 2026-09-09

### Added

- **Your account page now shows when your photo estimates end.** An account whose allowance carries an end date sees that date beside the daily count, in your own date format. An account with no end date, which is what a self-hosted instance keeps, sees nothing new. ([6978b5b](https://github.com/LowCarbCheck/openplate/commit/6978b5b))
- **An account can invite people, where the instance offers it.** A card on the account page takes an email address and says how many invitations you have left. The reply is the same sentence whatever is true about the address, on purpose: nobody can use it to find out who already has an account here. The instance decides whether the card appears at all, and the count you see is drawn, never trusted. ([6978b5b](https://github.com/LowCarbCheck/openplate/commit/6978b5b))
- **The terms and the privacy policy now describe an instance that runs the AI for you.** Five sentences and two headings still promised that your plate photo goes to a provider you chose and never passes through our servers, which has been false on an instance run for you since it launched. Each one now has a version written for that instance. The terms state that the allowance ends on a date, and the privacy policy states that an address you type into an invitation reaches us and is kept until the invitation is redeemed, revoked or expires. Section 6 also names the two new things an administrator can see: when your allowance ends, and how many invitations you have left. ([386a84f](https://github.com/LowCarbCheck/openplate/commit/386a84f))

### Fixed

- **A refused photo estimate now says which of two things happened.** An allowance that ended on a date and an instance that has read all the photos it can today used to arrive as "the provider is temporarily unavailable, try again in a moment". The first was never temporary, and the second comes back tomorrow rather than in a moment. Each now has its own sentence, and the one about an ended allowance names the date. ([6978b5b](https://github.com/LowCarbCheck/openplate/commit/6978b5b))
- **No screen tells you to ask an administrator who does not exist.** On an instance where accounts invite each other there is nobody to ask, so the three sentences that sent you to one now say what is true of your account instead: the date your allowance ended, or simply that photo estimates are not switched on for it. An instance an organization runs still names the administrator, who is a real person there. ([6978b5b](https://github.com/LowCarbCheck/openplate/commit/6978b5b))

## [0.24.0] - 2026-09-09

### Added

- **The app now opens by asking how you eat, and every goal follows from that answer.** The first setup step lists five eating styles: low carb, low carb and calories, calories, high protein, and just track. Nothing is picked for you, and there is no Skip, because "just track" is the answer for anyone who wants no goal at all. A carb style then asks for a daily limit of 20, 50 or 100 g and a calorie style asks for a target, both required, so no goal is ever invented from a blank field. High protein sets your protein goal from your weight, and says so if there is no weight on file yet. If a pregnancy or a breastfeeding period is already recorded on the device, a note with a source link appears under the list for the three styles that restrict carbs or calories. The profile stores your pick from now on, so a backup taken from now on needs this version or newer to import; a profile written earlier keeps its numbers untouched and the app reads a style back out of them. ([a7e65e9](https://github.com/LowCarbCheck/openplate/commit/a7e65e9), [c772c8b](https://github.com/LowCarbCheck/openplate/commit/c772c8b))
- **Goals in Settings lets you change your eating style later.** The page opens with a style card listing the same five styles. Saving keeps the numbers your style uses and clears the ones it does not, and the goal numbers below stay yours to fine tune afterwards. Re-saving the style you already have leaves your own numbers alone. The pregnancy and breastfeeding note appears here too, with no number changed. ([2c368af](https://github.com/LowCarbCheck/openplate/commit/2c368af))
- **A search that finds nothing now offers each part of it as a button.** Typing "Kaffee mit Hafermilch" searched the whole phrase, which no food database holds, and left you with nothing. When a search joins two foods with a word like mit, und, with or and, and finds no good match, the screen now offers "Kaffee" and "Hafermilch" as buttons that search each one on their own. A search that says what you did not eat, such as "Salat ohne Hähnchen", is never split. ([e46020c](https://github.com/LowCarbCheck/openplate/commit/e46020c))

### Changed

- **The day now gets one grade, the one your eating style asks for.** A low carb style still gets the carb verdict, a calorie style gets a calorie one, a high protein style gets its floor, and "just track" gets no grade at all. A day with no carb goal used to be graded against a hidden 50 gram line that was never shown to you. That line is gone. ([d22ccc0](https://github.com/LowCarbCheck/openplate/commit/d22ccc0))
- **The meal composer drops a notice nobody could read.** On an instance an organization runs, "Describe a meal" and "Add food" told a signed out visitor to sign in before the AI could read their words. Signing out closes both screens on that kind of instance, so the sentence was written for a screen that never opened. It is gone, and signing out still sends you to the welcome screen as before. ([5d1940c](https://github.com/LowCarbCheck/openplate/commit/5d1940c))

### Fixed

- **Goals in Settings shows the numbers a style save just wrote.** Saving an eating style cleared the goals it does not use, but the goal card underneath kept printing the old daily carb limit until you left the page and came back. Both cards now redraw from what is stored, in either direction: changing your goals also re-ticks the style card. Your eating style follows those numbers too. Setting a daily carb limit while your style was calories left the style card saying calories and the day graded on calories alone; the style now moves to the one your numbers describe. A high protein style stays as it is while its protein goal is still set, because a carb limit typed beside it is extra information, not a new goal. ([725d689](https://github.com/LowCarbCheck/openplate/commit/725d689), [cd91545](https://github.com/LowCarbCheck/openplate/commit/cd91545))

## [0.23.3] - 2026-09-09

### Changed

- **The Today so far card lays every nutrient row out as a two column grid.** The value and its caption share one right edge, a hairline separates the rows, and a row with no target says so in words instead of drawing an empty meter. ([441f36e](https://github.com/LowCarbCheck/openplate/commit/441f36e))

## [0.23.2] - 2026-09-09

### Changed

- **A sentence with a drink and a named milk logs two foods.** "Kaffee mit Hafermilch" used to become one item that no food database holds, so the lookup showed a cow-milk coffee or nothing. The sentence path now lists the coffee and the oat milk as two items, each with its own lookup. A named single product such as a cappuccino stays one item. ([ee51b60](https://github.com/LowCarbCheck/openplate/commit/ee51b60))

## [0.23.1] - 2026-09-09

### Fixed

- **The scan review screen now shows a grams box you can type into.** After a label scan the portion chips only reached twice the estimate, and the free grams field was hidden inside the fine-tune panel, so there was no visible way to log 300 g. The grams box now sits under the chips with a minus and a plus button that move it 10 g at a time, and typing your own amount clears the chips. ([c1ae807](https://github.com/LowCarbCheck/openplate/commit/c1ae807))
- **The arm64 image builds again.** The Docker build installed the newest pnpm, which then downloaded the version the repo pins as a separate binary, and that binary has no arm64 alpine build. The build now installs the pinned version directly. ([360f6c0](https://github.com/LowCarbCheck/openplate/commit/360f6c0))

## [0.23.0] - 2026-09-09

### Added

- **You can record a due date or a birth date, and anyone can be asked.** Choosing Pregnant on your goals page now reveals a due-date field, with a "weeks along" box that fills it in for you, and choosing Breastfeeding reveals the birth date. Under the field, one line says which trimester and week, or how many months of breastfeeding, that date means today. Both are optional, both can be cleared, and the question is now put to everyone who did not answer Male, including anyone who preferred not to say. The onboarding step asks the same way. ([9615f29](https://github.com/LowCarbCheck/openplate/commit/9615f29))

### Changed

- **Pregnancy and breastfeeding targets now follow your stage.** The protein reference used to add the third trimester figure to every pregnancy. With a due date or a birth date on file, it now adds the figure for the trimester or the month you are in, and it adds the matching energy figure to a calorie target you set yourself. Your stored target is untouched. Without a date, the app still uses the largest figure, and the day view says so with a link to your goals. ([e350876](https://github.com/LowCarbCheck/openplate/commit/e350876))

## [0.22.2] - 2026-09-09

### Fixed

- **A release now publishes the amd64 image even when arm64 fails.** The two architectures build separately, and until now one broken build left the whole version untagged in the registry, so an x86_64 host had nothing to pull. The run says in its log which platforms the published tag carries. ([a28ea2e](https://github.com/LowCarbCheck/openplate/commit/a28ea2e))

## [0.22.1] - 2026-09-09

### Fixed

- **Releases no longer hang building the arm64 image.** The arm64 half was emulated on an x86 runner, and when that emulator crashed the whole release published no image for either architecture, so each architecture now builds on a machine of its own. ([7948355](https://github.com/LowCarbCheck/openplate/commit/7948355))

## [0.22.0] - 2026-09-09

### Added

- **The protein row shows a reference floor when you set no goal.** It appears on the dashboard and in the diary, with the same small "reference" tag as the fiber row. The figure is EFSA's population reference intake. It uses 0.83 g of protein per kilogram of body weight from your latest weigh-in. Without a weigh-in, it uses your height and sex. It falls back to 50 g when the app knows neither. Pregnancy adds 28 g, and breastfeeding adds 19 g. A goal you set yourself always wins. ([3f3c66f](https://github.com/LowCarbCheck/openplate/commit/3f3c66f))

### Changed

- **Food suggestions for an open gap change from day to day.** The suggestions for an open protein or fiber gap now vary with the date. A food you already logged today is not suggested again. ([1881eaf](https://github.com/LowCarbCheck/openplate/commit/1881eaf))

## [0.21.0] - 2026-09-09

### Added

- **Today's budget rows show fat, in grams.** On the dashboard and in the diary, fat sits between protein and fiber. Fat has no target. ([89324a5](https://github.com/LowCarbCheck/openplate/commit/89324a5))

### Changed

- **The message box at /describe looks like a chat.** One rounded box that grows as you write, with a round Send button inside it. Enter still sends, and Shift and Enter still start a new line. ([ff80af4](https://github.com/LowCarbCheck/openplate/commit/ff80af4))
- **The app's own microphone button is gone.** On a phone it did nothing, and it sent your voice to Google or Apple through the browser. Speak now opens the message box with the field focused. Tap the microphone key on your keyboard to dictate, then send. ([ff80af4](https://github.com/LowCarbCheck/openplate/commit/ff80af4))

## [0.20.1] - 2026-09-08

### Added

- **The review screen shows the words you sent.** After a typed or spoken meal, the words sit above the food list so you can check the estimate against them. ([860ae43](https://github.com/LowCarbCheck/openplate/commit/860ae43))

### Fixed

- **A managed instance can describe a meal with AI.** The message box at /describe and the "Log with AI" button on the search page were always disabled there, because both only looked for an AI key stored on the device, and a managed instance keeps none. Both now ask the same question the scan screen asks: signed in, with an AI allowance. The notice for a person without AI names the right door: sign in on a managed instance, connect a provider on an open one, or ask the administrator when the account has no allowance. ([860ae43](https://github.com/LowCarbCheck/openplate/commit/860ae43))

## [0.20.0] - 2026-09-08

### Added

- **Type and Speak open a message box at /describe.** Write or say what you ate, send it, and the AI works out the food from your words the same way it does from a photo, on the same review screen, into the same diary. The launcher sheet, the dashboard, the diary's empty states and the first-run lesson all lead there. The food database search stays at /add for one exact item. ([d021dc9](https://github.com/LowCarbCheck/openplate/commit/d021dc9))
- **Administrators get a Reports tab.** It lists every reported estimate, when it arrived and when it deletes itself, and opens one report with the model's figures and the photo, if there was one. A report can be deleted now instead of at the end of the window. ([e6cf401](https://github.com/LowCarbCheck/openplate/commit/e6cf401))

### Changed

- **The scan messages name a description, not a photo.** When you described the meal in words, the waiting text, the "nothing found" text and the failure text each have a version for a description. ([d021dc9](https://github.com/LowCarbCheck/openplate/commit/d021dc9))
- **A managed instance no longer says the diary is only on this device.** The offline page and the data settings say instead that the server holds an encrypted copy it cannot read. ([660e83a](https://github.com/LowCarbCheck/openplate/commit/660e83a))

### Fixed

- **A scanned plate photo is saved on this device when you confirm.** It never was: the save waited for a page state that a local save never produces. The device copy the AI settings promise is now kept, and a report of a bad estimate can carry the picture. ([83da248](https://github.com/LowCarbCheck/openplate/commit/83da248))

## [0.19.1] - 2026-09-08

- On a managed instance the page title, the footer, the front page and the
  recovery screen no longer say the diary stays only on this device. The
  account keeps an encrypted copy on the operator's server, so the copy now
  says what is still true there: only you can read it. The recovery screen
  offers a sign-in link, because on such an instance signing in is what
  brings the diary back. Nothing changes on an open instance.

## [0.19.0] - 2026-09-08

- The diary and the overview show the day as budget rows for net carbs,
  calories, protein and fiber instead of ring charts. The day's details sit
  inline, and suggestions fold into one line you can open.
- One way in for a meal. A photo is one task, and the model decides whether
  it is looking at a plate or a nutrition label, so the separate label mode is
  gone. A typed or spoken meal goes through the same AI review screen as a
  photo. For speech, the browser's own engine transcribes; only the text
  reaches openplate and the provider, and the consent copy says so. The first
  run lessons were rewritten to match.
- The app knows which build it is running. The About page has an Updates
  section, the sidebar shows the build, and the server checks GitHub for a
  newer tag every six hours (set UPDATE_CHECK=off to stop that). When one
  exists a ribbon says so, and the service worker adopts the newest bundle.
- The sign-in hint from 0.18.4 is unchanged; the version shown in the app now
  comes from the build itself rather than a hand-copied constant.

## [0.18.4] - 2026-09-08

- The sign-in form now says plainly that you sign in with the email address
  your account was created with, and that capital letters in it do not
  matter. The error after a rejected sign-in said "sign-in name", a leftover
  from a version where accounts had a chosen name. There is no username; the
  address is the only identifier.

## [0.18.3] - 2026-09-08

- A sign-in form submitted before the page had finished loading was sent as
  a plain page request, so the password could land in the address bar and in
  the browser history. The sign-in, reset and study forms now keep their
  submit button disabled until the page is ready.

## [0.18.2] - 2026-09-08

- The device menu in the header now offers a way to sign in when you are
  signed out. On an instance where anybody can make an account it offered only
  "Create account", so somebody who already had one, and had been signed out,
  had no way back in from that menu. It now shows both, sign in first. This
  never affected the hosted instance, where the menu already said "Sign in".

## [0.18.1] - 2026-09-08

- Punctuation only. The terms, the privacy policy and the age range labels used
  long dashes, which the project's own writing rules ban. They are now full
  stops, commas, colons or brackets. No wording changed, so nothing either
  document says has changed.

## [0.18.0] - 2026-09-08

- The lesson after the first run now tells you that openplate installs on a
  phone, where it opens like any other app. Previously, desktop browsers said
  nothing, and only browsers that supported one-tap install showed the notice.
  You now learn that the app installs, whichever browser you use, and you still
  get the install button or the iPhone steps where those work.

- For administrators, the console at /admin now divides into three tabs:
  People, Invitations and Activity. The People list includes a search box and a
  filter for active, suspended and administrators. Each row is compact, shows
  the last seven days of photo reads, and opens a page for that person. The
  buttons that change an allowance, send a reset link, suspend or delete now
  live on this person page, which keeps the main list clean. The new Activity
  tab lists everybody by who was here last, over seven, thirty or ninety days.

## [0.17.0] - 2026-09-08

- A meal you photograph now goes into breakfast, lunch, dinner or snack, the
  same as one you type in. The meal is chosen from the time the photo was
  taken, not the time you get around to confirming it, and you can change it
  before you log. Every food on the plate goes into the same meal. Photographed
  meals used to land outside the meal groups in your diary, and the only way to
  fix that was to open each entry afterwards.

## [0.16.0] - 2026-09-08

- Fixed a bug that signed people out without warning. The app renews your
  sign-in in the background, but it failed to save the renewed one, so the next
  time you opened the app it presented a sign-in the server had already
  retired. That triggered a security check that signed you out on all your
  devices. If this happened to you, you will need to sign in once more after
  updating, and then the sign-outs stop.

- When you are signed out of an account you were invited to, the photo scan
  screen now says you are signed out and lets you sign back in. It used to
  claim that photo estimates were turned off and told you to contact an
  administrator, which was incorrect. If your account actually does not have
  photo estimates, it still displays that notice.

- If you get signed out while using the app, openplate now tells you right
  away, instead of leaving your food diary on the screen as if you were still
  signed in.

- The setup screen on your first visit now shows you how to install openplate
  on your phone, alongside the three ways to log a food. This instruction was
  only in settings before.

## [0.15.0] - 2026-09-08

This release is about instances that an organization runs and invites people
to. If you self-host openplate for yourself, nothing here changes for you.

- Signing out is now one tap from the menu at the top right, instead of being
  the last button in the danger zone of the account screen, next to "delete
  account". After you sign out, this device no longer shows the diary, and
  reloading the page no longer puts you back in it as though you were still
  signed in.

- You can also erase the diary from the device as you sign out. It is a
  checkbox, off unless you tick it, and it tells you first how many entries
  have not reached the server yet, because erasing loses those.

- On an instance you need an invitation for, the front page now says so. There
  is a "sign in" button where there used to be only a link to the source code,
  and a "request access" button that explains an administrator issues the
  invitations. The rest of that page no longer offers a free trial, an account
  you can create yourself, or an AI key you bring, because none of those exist
  on an instance like that.

- Administrators can open a person in the admin console and see when they last
  signed in and how many photos were read for them on each of the last ninety
  days. Daily counts older than ninety days are deleted.

- If you use an instance somebody else runs, your account screen now lists
  exactly what its administrator can see about you, and what they cannot. Your
  diary is encrypted on this device before any copy of it leaves, so it is not
  on those pages.

## [0.14.0] - 2026-09-07

- If a photo estimate comes out wrong, you can now tell us. There is a button at
  the bottom of a logged entry. It asks you to agree first, in a separate step
  that says exactly what is sent, who can look at it, and how long it is kept,
  and it has a plain "no, do not send" beside the agree button. If the entry has
  no photo, it says so and sends only the figures. If you never report an entry,
  we never receive a photo.
- The privacy policy now says all of that, in both languages. It used to say
  your on-device photo copy "is never uploaded anywhere", in five places. That
  is no longer true once you can report an entry, so every one of those
  sentences was rewritten to say what actually happens rather than deleted.
- A report waits if you are offline and sends when you are back. Reporting the
  same entry twice creates one report, not two.
- How long a report is kept is set by whoever runs the sync server you use, and
  the app now asks that server and shows its real answer. If the server does not
  say, the app does not offer to report at all rather than promise you a number
  nobody is keeping.

## [0.13.0] - 2026-09-07

- The first run now teaches. The last step of setup shows the three ways to get
  food into your diary, one card each, and every card starts the real thing
  rather than showing you a demo of it. It is still skippable, and setup did not
  get any longer. The drawings hold still if your system asks for reduced
  motion.
- You can track net carbs and calories at the same time. Setup used to make you
  pick one. Now each goal you set draws its own ring on the overview and in the
  diary, and if you set only one it looks exactly as it did before. "Just the
  habit" is still there for anybody who wants a streak and no daily number.
- The suggested daily protein amount is now worked out from your height and sex
  instead of your body weight. A target scaled by total weight climbs as your
  weight does, which is the opposite of what that number is for. The screen says
  which method produced the figure and calls it an estimate. If you have not
  entered a height or a sex, it says so and falls back to the old suggestion
  rather than inventing one.
- The two camera buttons now say what they photograph. One reads "Photograph
  your plate", the other "Photograph a nutrition panel". Reading the printed
  panel on a package has worked for a long time, but the button said "Label
  photo", which never said what it was for, so people did not know the feature
  was there. The same button in the add-food sheet said the same thing and has
  been fixed too.
- The app records which features get used, behind a level the operator of your
  instance sets. It never records anything from your diary. See the privacy
  page for what is counted and what is not.
- The openplate mark is now installed from the brand repository rather than
  being kept by hand, and a local check re-hashes it, so a hand-edited icon
  cannot ship by accident.

## [0.12.0] - 2026-09-07

- The sidebar and the mobile drawer now link to the administrator area for the
  accounts that have one. The page existed before, but only somebody who
  already knew the address could reach it.
- The drawing at the top of the architecture guide is simpler. It was five
  boxes, a box inside a box and seven arrows, three of them dotted exceptions.
  It is now the app server, your device, and the two things that leave your
  device: the diary, encrypted, and the plate photo. The cases that used to be
  dotted arrows, a cloud provider, your own inference box, and a managed
  instance, are named in the paragraph under the drawing, and the topology
  guide draws each of them on its own.

## [0.11.1] - 2026-09-07

- Clarified in the architecture and topology guides that the food source is
  configurable. The bundled USDA FoodData Central extract is the default, not
  the only option. Updated the label inside the rung 3 diagram to match.
- Updated the architecture guide to clarify numeric output rules. The language
  model generates gram estimates, but it never authors macro numbers. The
  documentation now states this rule directly.

## [0.11.0] - 2026-09-07

- Adding food inside the app now opens the camera directly on tap, matching the
  tab bar button. Typing and speaking sit beside it as dedicated buttons
  instead of a small link. On a device without an AI provider connected, the
  tap still opens the scan screen to explain what to connect, so it never asks
  for a camera permission the device cannot use. A photo taken while viewing an
  earlier day logs to that day, not to today.
- Changed the final onboarding step to lead with "Photograph food", and moved
  the search button beside it. Ending the first run on "Find a food"
  contradicted what every add-food screen does later. The button now uses the
  same label shown in the diary and the dashboard.
- The architecture and topology guides now include diagrams. The topology
  drawing shows which arrows leaving your device carry a photo and which carry
  ciphertext, so the claim the project rests on is visible without reading six
  sections first.
- The architecture guide no longer contradicts itself about accounts. One
  section previously stated the sync server was the only component that needed
  an account, while the same section stated the study console keeps its own.
- The published guides were reworded to remove every em dash and en dash. No
  claim changed.
- A script now captures the product screenshots on the landing page in German
  and in English, so they can be regenerated when a screen changes.

## [0.10.3] - 2026-09-06

- On an instance run for you by an organization, the app now says what that
  operator can see. A plate photo passes through the operator's server on its
  way to the AI, the AI key is the operator's, every user has an invited
  account, and the operator holds a recovery key. The landing page, the first
  onboarding screen, the terms and the privacy policy said the opposite; they
  described an instance you run alone. An instance you run yourself keeps the
  old wording, which is true there.
- The AI provider settings page is closed on such an instance. It described a
  key nobody brings there.

## [0.10.2] - 2026-09-05

- Search engines no longer index the app. The project site at openplate.de
  describes openplate instead, and it is the page a search should lead to. An
  instance you run yourself is your own tool, so it stays out of results too.
- The sign-in screen no longer claims you are asked for your password again
  after every reload. You have stayed signed in until you sign out since
  0.10.0; only the text still said otherwise.

## [0.10.1] - 2026-09-04

- You stay signed in when you open the app again. After following an
  invitation, opening any page in a new tab showed the sign-in screen and
  offered to sign you in to the account you were already using. The app now
  waits for your session to open before it decides where to send you.
- An invitation now lands you in the app. It used to finish on the public
  home page, which describes the app to somebody who does not have it yet.
- The invitation screen no longer shows the code from your link. It asked you
  to look at a long string you did not type, could not check and should not
  change. It now asks for a password and nothing else. If the link turns out
  to be dead, the field appears so you can paste another one.
- A photo estimate that fails now says why, in one sentence. It used to fail
  in silence: nothing on screen, and the same photo sent twice. A photo that
  is too large, a used up daily allowance, an account with no allowance and a
  suspended account each say what they are and what to do.
- Your account page shows how many photo estimates you have used today, and
  how many you have.
- After a password reset you land in your diary, with your entries already
  there. The reset used to finish on the public home page before your diary had
  been downloaded, so an account with months of entries was shown the first run
  questionnaire.
- Administrators can reach the administration pages again after resetting
  their password. The page used to say they were not an administrator,
  without checking their role.
- Fixed an issue where opening the app in two places right after a password
  reset could sign you out again.

## [0.10.0] - 2026-09-04

- You sign in with your email address and a password. The made up sign-in
  name is gone. An address is something you already know, and it is what a
  reset link is sent to.
- An invitation link asks for a password and nothing else. There is no
  recovery code to write down any more, and none is shown. The instance
  keeps the key that recovers your diary, which is what makes a password
  reset give your entries back instead of an empty account.
- A forgotten password is reset from the sign-in page. Ask for a link, open
  the mail, set a new password, and your diary is still there.
- You stay signed in after a reload. Closing the tab or restarting the
  browser no longer asks for your password again. It is still asked when
  you sign in, when you change your password, and when you delete your
  account.
- On an instance run for you by an organization, the photo estimate works
  as soon as you are signed in. There is no AI setup, no key to paste, and
  no separate connection step. Your daily allowance is shown on the account
  page.
- Administrators manage people at /admin: invite by email, see everyone
  with their allowance and what they have used today, change an allowance
  or a role, suspend and bring back, send a reset link, and delete an
  account.
- The account page moved from Settings, Sync to Settings, Account. The old
  address still works and sends you to the new one.

### Upgrading

- This version needs a server running openplate-sync 0.6.0 or later. Older
  servers do not have the new sign-in.
- The separate gateway is no longer used. Set INSTANCE_MODE=managed instead
  of GATEWAY_URL. Leaving GATEWAY_URL set now stops the app from starting,
  on purpose, so that a half migrated instance cannot run.
- Accounts from 0.9.x cannot be carried over. The identity model changed
  from a sign-in name to an email address, so people need a fresh
  invitation. Export a backup from each device before upgrading, and import
  it after signing in to the new account.

## [0.9.3] - 2026-09-04

- Invite links that create an account and connect the AI now run as one
  flow. Before, the app left the account screen too early. It never showed
  the recovery code, and the next screen asked you to sign in to the
  account you just created. The app now shows the account card with the
  sign-in name and recovery code. The AI connection follows once you
  confirm you saved the code.
- If the AI connection cannot be reached while the link is used, the link
  is kept and offered again. Before, a network error spent the link.

## [0.9.2] - 2026-09-04

- A failed save on the device no longer consumes the invite link. If
  saving the AI connection fails after the link is accepted, a retry card
  appears. Retrying saves the connection without using the link a second
  time, and reloading picks up where it left off.
- The AI connection now reaches the account even if the device saved it
  before the account did. The next sync carries it over.
- On a managed instance, a device without an AI connection no longer offers
  "Connect with OpenRouter". The scan card now says the invitation did not
  include photo recognition, and offers adding food without a photo.
- The sign-in step after an invite link now says the link belongs to an
  existing account, and that the rest is set up after signing in.

## [0.9.1] - 2026-09-03

- The camera opens on one tap from the tab bar. A chevron beside it opens a
  sheet with four ways in: plate photo, label photo, speak, and type.
- Speak on the add page turns your voice into search text. The first time
  you use it, a note tells you the browser sends the audio to Google or
  Apple.
- The scan setup card and the AI settings card are shorter now, and the
  connect card names who actually receives the photo.
- On a managed instance, the AI connection now travels inside the encrypted
  account data. Signing in on a new device brings the connection with it,
  and it is never included in a backup file.
- A gateway invite that gets refused is dropped from the tab, and the error
  card leads back into the app instead of a dead end.
- Managed instances (where the operator sets GATEWAY_URL) now offer one
  door in. The welcome screen offers only sign in or an invite link, there
  is no diary without an account, and the join link runs one uninterrupted
  ceremony with no skip. Settings no longer offer account creation.
  GATEWAY_URL also allow lists the gateway origin, so operators no longer
  need CSP_CONNECT_EXTRA for it. Open instances are unchanged.

## [0.9.0] - 2026-09-03

- One account instead of a "sync" passphrase. The app now speaks in terms of
  an account and a password, not a technical sync passphrase.
- A blank device now opens on a welcome screen, not the onboarding
  questionnaire. Returning users get a clear way in before the app assumes
  they are new.
- A dedicated sign-in route. Signing in now happens on its own page, and it
  waits for the first data pull to finish before handing control back to the
  app, so a returning user never lands on an empty screen.
- Signing out remembers the last name used on this device and shows a
  "Not you?" link to clear it, instead of forgetting who was signed in.
- Skipping a join link now leads to sign-in, so someone who already has an
  account is not pushed into creating a new one.

## 0.8.3 and earlier

See the annotated git tags (`git tag -l -n1`) for the release notes of each
earlier version.
