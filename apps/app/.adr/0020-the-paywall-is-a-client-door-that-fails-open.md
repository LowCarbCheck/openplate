# 0020, the paywall is a client door that fails open

- **Status:** Superseded by [0024](0024-a-feature-gate-is-a-door-and-the-proxy-is-the-only-lock.md). The whole-app lock described here is unchanged, and 0024 restates it beside the per feature gates.
- **Date:** 2026-09-28
- **Deciders:** Altan Sarisin (owner), with an architecture brief from Fable

## Context

The managed, paid instance (app.openplate.de) gives a new account ten free AI
scans and no card (`TRIAL_SCANS=10` on its openplate-core). Until now the only
gate was the core's AI proxy: an account with no plan and no scans left could no
longer scan, but it kept the diary, the charts and every other screen for ever.
The owner decided on 2026-09-28 that the app locks instead: when the free scans
are used up, a day trial has ended, the account never had an allowance, or a paid
plan has lapsed, every feature screen sends the person to the plan page until
they pay.

Three constraints shape how. The diary lives on the device, not on this server
(ADR-0006), so the server has nothing to lock. GDPR does not let a payment stand
between a person and their own data: the export, the account deletion and the
withdrawal of a consent must stay open. And beta and self-hosted instances sell
nothing and must never be locked.

## Decision

The paywall is a door in the client, decided by a pure function and enforced by
the `_personal` layout.

- `resolvePlanGate` (`app/lib/plans/plan-gate.ts`) answers `open` or `paywall`
  from three facts: whether the instance sells plans (the handshake's `plans`),
  where the person stands (`planStanding`, with administrators never locked), and
  the path. Only `trial-ended` and `lapsed` lock, and only off an exempt path.
- The exempt paths are the plan page, the settings hub, the export, the account
  page (and its old address), preferences (the visit counting objection),
  research studies, clinician sharing, notifications, and `/admin` below. Every
  route outside `_personal` never meets the gate.
- The facts that live on the server are read once per account per tab and held
  in memory (`plan-gate-facts.ts`), so a navigation never waits on the network
  after the first read, which waits at most 2.5 seconds. The account facts come
  live from the session snapshot, so a last free scan locks the next page.
- **It fails open.** A read that fails, times out or cannot be made (no session
  yet) answers `open`, and a failed read is never remembered. A device that says
  it is offline answers `open` even over fresh facts that lock, because the plan
  page needs the network to draw and there is nothing to pay offline. The core's
  AI proxy stays the server side limit on what costs money.
- It is enforced in three places, because the layout's loader does not run on a
  plain navigation: the loader itself, `shouldRevalidate` (from the facts held,
  synchronously), and `PlanGateWatcher`, which asks again once the first facts
  for an account arrive after a cold boot.
- **It decides navigations, never the page already on screen**
  (`shouldCheckPlanGate`), except that one time the watcher asks. The last
  free scan's own answer brings the count to zero, and the scan's action
  revalidates the layout on the same address; deciding then replaced the review
  of the plate just scanned with the plan page. The page on screen is the one
  the layout rendered, not `window.location`, which a Back gesture moves before
  the loaders run.

## Alternatives Considered

- **A server side gate in this app.** This server holds no accounts and reads no
  session (ADR-0006); gating here would mean the server learning who is signed
  in, which is the promise that ADR exists to keep.
- **Fail closed on an unknown standing.** A person on a train would lose their
  own diary because a request timed out. The data is theirs and already on the
  device, and the AI proxy already refuses what they have not paid for, so
  closing on doubt protects nothing that costs money and hurts the person.
- **Lock on every change of standing at once.** The last free scan is spent on
  the review screen; sending the person away from the plate they just scanned
  would lose it. A change is picked up at the next navigation instead, and
  `tests/e2e/paywall-last-scan.spec.ts` holds that line.
- **Waiting for the session on every cold boot before drawing the app.** It
  would put a loading screen in front of every paying person on every launch to
  spare a locked person a short look at their own diary. The cold boot draws the
  app and the watcher redirects once the facts arrive.

## Consequences

- A locked person can see their diary for the moment a cold boot takes to
  reopen the session and read the plan. That is accepted: it is their data.
- The gate is a door, not a lock: a person who edits the client can get past it.
  What costs money stays behind the AI proxy, on the server.
- A new exempt page is a decision, and `tests/unit/plan-gate.test.ts` fails until
  the list and the test agree.
- The browser tier's fixture account has no allowance, so any spec that stubs
  `plans: true` without one signs in to a locked account; `signInFixtureAccount`
  lands on the plan page for it.

## References

- `app/lib/plans/plan-gate.ts`, `app/lib/plans/plan-gate-facts.ts`,
  `app/routes/_personal.tsx`, `app/routes/settings.plan.tsx`.
- `tests/e2e/paywall.spec.ts`, `tests/e2e/paywall-plan-page.spec.ts`.
- ADR-0006, the app server holds no accounts.
