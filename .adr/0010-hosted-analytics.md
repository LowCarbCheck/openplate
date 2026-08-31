# 0010 — Analytics on the hosted instance, off everywhere else

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Altan, with architecture review

## Context

Until today openplate told every visitor, on its own front page in two languages:

> "There is no analytics, no advertising and no tracking pixel in openplate. Nothing you do in the app is counted, and nothing about it is sent anywhere."

The same claim appeared twice in the privacy policy, and `tests/unit/no-telemetry-wiring.test.ts` enforced it against the code — its doc block called it "a product promise on the same footing as 'the key never reaches the server'".

That promise cost us the ability to answer basic questions. Nobody could say whether anyone finished onboarding, whether plate scans succeed or fail, or whether the backup nudge works. openplate.de launched as the canonical domain (M165) with no way to tell whether it is used at all.

Three prior constraints bounded any answer:

1. **The landing and privacy claims** above — three surfaces, one of them legally binding.
2. **M117 design spec D9** (`app/lib/sync/telemetry.ts`): sync telemetry events must be content-free — "no dimensions, no values, no user id" — and any addition "re-enters D8's legal review scope; it does not ship as a quiet addition."
3. **`content-security-policy.ts`**: "openplate loads no third-party script at all on an unconfigured instance, and that is a product claim rather than an accident." openplate is MIT-licensed and self-hosted by people who are not us.

## Decision

**The hosted instance runs our own cookie-free Matomo. Every other instance counts nothing, by default and without configuration.**

1. **Env-gated, both variables or neither.** `MATOMO_URL` + `MATOMO_SITE_ID`. Unset — the self-host default — means no script tag, no request, and a CSP header byte-for-byte identical to what it was before analytics existed. A half-configured pair throws at boot rather than degrading, because a silently-disabled tracker is worse than a loud failure.

2. **The tracking claim became conditional, not deleted.** `landing.features.noTracking` now has two variants in both locales, chosen by whether the instance has analytics on. A single string cannot be honest on both a hosted instance that counts visits and a self-hosted one that counts nothing. The privacy policy gained a full Art. 13 section (§9a) and its two old claims were rewritten.

3. **No diary content, enforced by types.** `app/lib/matomo-events.ts` exposes functions that take either nothing or a literal-union label. A food name, weight, goal, photo or study id cannot be passed without a type error. This is stricter than the sibling SelfHostedWorld implementation, which tracks software slugs — those name rows in a public catalogue; openplate has no such thing.

4. **No numeric values.** Two drafted events carried them — a scan item count and a fasting duration — and both were cut at review. Each is a number measured off the person rather than off the software, and D9 bars values outright. A literal-union `name` was read as a finite family of distinct event names, which carries no content and satisfies D9; numeric values remain barred and go to M120's legal review if ever wanted.

5. **The URL is scrubbed before it is reported.** `app/lib/matomo-url.ts` drops the query string and fragment wholesale and replaces id path segments. This is not defensive tidiness: openplate puts single-use tokens in query strings (`/verify-email?token=`, `/reset-passphrase?token=`, `/oauth/openrouter/callback?code=`) and a per-person account id in `/shared/:grantorAccountId` for clinician health-data shares. A straight port of the SelfHostedWorld hook, which reports `window.location.href`, would have written live credentials into Matomo's visitor log. The referrer is scrubbed the same way.

6. **No consent banner.** The tracker loads with cookies disabled and stores nothing on the device, so §25 TTDSG is not engaged; the legal basis is Art. 6(1)(f). **This reasoning dies the moment anyone re-enables cookies in `use-matomo-tracker.ts`** — that change makes a banner mandatory and must not be made casually.

7. **The guard test was rewritten, not deleted**, in the order its own doc prescribed: copy first, policy second, test third, wiring fourth. It now pins four narrower invariants, including that no Matomo host or site id may be hardcoded in `app/` — the invariant that protects self-hosters, and precisely what a copy-paste of the SelfHostedWorld hook's defaults would break.

## Consequences

- We can measure the product. Onboarding completion, scan success rate, which input path logs food, and whether backups happen are all answerable without touching anyone's diary.
- **We reversed a public promise.** Anyone who read the old card and self-hosts is unaffected; anyone who read it and uses openplate.de is now counted. The new copy says so plainly rather than burying it in the policy.
- Campaign attribution is lost. `utm_*` parameters are dropped with the rest of the query string. That is a real cost and the right trade for a health app.
- The Matomo side carries load-bearing configuration that this repository cannot enforce: IP anonymisation, honouring Do Not Track, visitor profiles off, and raw-log retention capped at 90 days. The privacy policy promises all four. **If the Matomo settings drift, the policy becomes false and nothing in this codebase will notice.**
- M120's legal packet must carry an Art. 30 processing-record entry for this. No DPIA is required for this configuration; that assessment is recorded here.
