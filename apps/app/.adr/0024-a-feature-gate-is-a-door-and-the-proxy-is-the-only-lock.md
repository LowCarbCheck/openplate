# 0024, a feature gate is a door, and the AI proxy is the only lock

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** Altan Sarisin (owner), with an architecture brief from Fable
- **Supersedes:** [0020](0020-the-paywall-is-a-client-door-that-fails-open.md)

## Context

ADR-0020 put one gate in front of the whole app: when the free scans are used
up or a plan has lapsed, every feature screen sends the person to the plan page.
That is still true. What changed is that the paid offer is no longer one plan.
The biller now sells tiers, and a tier is a set of features and a daily scan
limit. Some features are not AI at all (the fasting timer), and some are AI that
costs money (the pantry shelf scan). A whole-app lock cannot say "this tier has
no pantry scan", and a person on a lower tier must still reach the diary.

The repository is public. The names and prices of the tiers are a commercial
decision that belongs to the private billing service, so the app may name a
FEATURE (`fasting`, `pantry`, `voice`, `chat`) and never a tier.

## Decision

**The whole-app lock from ADR-0020 stays exactly as it is.** Its facts, its
exempt paths, its fail-open reads and its three enforcement points are
unchanged. This record adds a second, finer thing beside it.

**A feature gate is a door, not a lock.**

- `canUseFeature` (`app/lib/plans/capabilities.ts`) is one pure function. The
  core sends each account an effective list of feature labels
  (`AccountView.capabilities`, `null` meaning everything), and a feature is open
  only when that list names it.
- **It fails open, in this order.** A person on their own AI key is never gated.
  An instance that sells no plans (`hasPlansDoor` false: every self-hosted and
  beta instance) is never gated. A list that is `null`, absent, or not a list of
  strings is open. Only a list that is present and does not name the feature
  closes it.
- **The only lock is the core's AI proxy.** A request carries the feature it is
  made for in `X-Openplate-Feature`, on the managed credential only, and the
  proxy answers `403 capability-required` with a `capability` field for an
  account whose plan lacks it. A person who edits this client gets past a door
  and not past the proxy. A feature that costs nothing (the fasting timer) is
  therefore only ever a door, and is gated for the sake of the plan's promise,
  not for protection.
- **One pattern draws a closed feature** (`FeatureGate`, `ClosedFeatureNote`).
  The entry point that would START the feature is replaced by a short note with
  a lock mark that names the feature and links to the plan page. It never
  navigates into the feature's create flow, and the feature stays findable. The
  proxy's refusal draws the same note in the existing error slot.
- **The answer is held from the first paint** (`useFeatureGate`), so an entry
  point never flips after it has painted. A screen that opens before the account
  view has landed draws the open form and keeps it for that visit; the next
  navigation reads what is held by then. The proxy refuses what must be refused
  either way.
- **What a person keeps when a feature is closed, or lapses.** Everything
  already recorded stays readable and exportable. Fasting: past fasts, history
  and stats stay, a fast that is running can be ended and is never lost, and
  starting a fast, the live fast chip and the fast target reminder are closed.
  Pantry: the stored list stays readable and editable by hand, and the shelf
  scan, the word scan and the recipes screen are closed.
- **Self-hosted and BYOK are never gated.** With the plans door off, or with the
  capability list absent, every gate site draws its open form.

**Tiers are data.** The offer lists `tiers`: the free entry first, then every
tier on sale, lowest first. Each entry carries a name, a description, a daily
limit, capabilities, whether it is sold, and its plans with prices. The account's
own tier is `tier` on the plan view. The array order is the rank. The plan page
draws the entries as served and marks the one that is the account's own. An offer
with no tiers draws the page it drew before. A test fails the build if a tier name
appears in a string literal under `app/`.

**A move between tiers is an order.** A subscriber orders another tier through the
same order endpoint, with the same two consents as a first order. A higher rank
takes effect now with the price settled pro rata. A lower rank, and the monthly to
yearly move of one tier, take effect at the end of the paid period.
`moveEffectOf` is that rule as a pure function of two ranks. The page says the
effect before the order from the ranks, and after the order from the `effect` the
biller answers. A person with an overdue payment is offered no move, and neither
is anyone on a tier the offer does not list, because the biller refuses the first
and the app has no rank for the second.

## Alternatives Considered

- **Gate only in the client.** Nothing a person pays for would be protected. The
  proxy already sits in front of the only thing that costs money, so it is made
  to read the feature.
- **Gate only in the proxy.** A person would press a button and be refused after
  the fact, with no way to see what the plan includes. The door says it first.
- **Fail closed on an unknown list.** A person on a train would lose a feature
  they pay for because a read was late. The same argument as ADR-0020.
- **Hide a closed feature.** Nobody could find what a plan would give them.
- **Read the feature set from the instance descriptor.** `defaultCapabilities`
  on the descriptor is the instance's default for a new account, not the
  account's own list. The app reads the account view, which is already
  effective, and does not gate on the default.

## Consequences

- A person can see the open form of a gated screen for the moment a cold boot
  takes to read the account. That is accepted, for the reason ADR-0020 accepts
  the same for the paywall. The proxy is still the limit.
- A new gated feature is a new word in `FEATURE_LABELS`, a name in the catalog,
  and a `FeatureGate` at its entry point. The `Record` of names fails to compile
  until the three agree.
- The fast target reminder reads the gate through a registration
  (`registerFastingGate`), because `push.ts` cannot import the reader without
  closing an import loop through the sync actions.


## References

- `app/lib/plans/capabilities.ts`, `app/lib/plans/feature-gate-now.ts`,
  `app/hooks/use-feature-gate.ts`, `app/components/plans/feature-gate.tsx`,
  `app/lib/plans/tier-view.ts`, `app/components/plans/tier-list.tsx`.
- `tests/unit/capabilities.test.ts`, `tests/unit/plan-tiers.test.ts`,
  `tests/unit/no-tier-names.test.ts`, `tests/e2e/fasting-gate.spec.ts`, `tests/e2e/pantry-gate.spec.ts`, `tests/e2e/plan-tiers.spec.ts`.
- ADR-0020, which this record supersedes.
