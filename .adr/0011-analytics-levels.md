# 0011, analytics levels, and the research tier that ADR-0010 refused

- **Status:** Accepted
- **Date:** 2026-09-07
- **Deciders:** Altan
- **Amends:** [ADR-0010](0010-hosted-analytics.md), items 3 and 4

## Context

ADR-0010 turned analytics on for the hosted instance and off everywhere else. It
also drew a line: events carry a fixed label or nothing, never a number measured
off the person. Two drafted events were cut at architecture review on 2026-08-31
for crossing it, a scan item count and a fasting duration.

That line held, and the event set stayed small. Ten events shipped. Whole
surfaces counted nothing: the diary, meals, custom foods, fasting, goals,
preferences, the AI provider setup, sync accounts, clinician sharing, research
contributions. ADR-0010's own consequences claimed "which input path logs food"
was answerable. It was not. `matomo-events.ts` carried four empty section
headings where those events were meant to go.

Two problems, therefore, and they pull in opposite directions.

1. **The vocabulary was too small to answer product questions.** A survey of
   every route found 54 distinct user actions worth counting.
2. **Some of those actions cannot be counted safely on a general instance.** A
   fast started and a fast ended are two labels with no values, but the two
   timestamps subtract into the duration architecture review cut. A clinician
   share says the person has a clinician. Study enrolment is special-category
   data under Art. 9 GDPR.

ADR-0010 answered the second problem by omission. That answer has a cost it did
not name: openplate is built to be self-hosted, and a researcher running a study
on their own instance needs exactly the measurements that were cut. They have a
lawful basis we do not, the participants' consent, and they are the data
controller for their own deployment. Cutting the events from the software denies
them a capability in order to protect users of a different instance entirely.

## Decision

**Ship every event, and make how much is counted an operator setting rather than
a property of the code.**

1. **Three levels, in `MATOMO_EVENT_LEVEL`.** `pageviews` counts pages only.
   `product` adds software-feature events and IS THE DEFAULT. `research` adds
   events about health behaviour and study participation. The variable applies
   only where `MATOMO_URL` and `MATOMO_SITE_ID` are already set; setting a level
   without them throws at boot, for the reason a half-configured pair throws.

2. **The default is what ADR-0010 shipped, widened.** An instance that does not
   set the variable gets `product`, which contains no event about health
   behaviour. Nobody arrives at the research tier by upgrading.

3. **The gate lives in `matomo-events.ts`, not at the call sites.** Every event
   declares its tier where it is defined, and the module drops the ones the
   level does not permit. A call site cannot escape its tier by accident, and
   the feature flag stays out of forty components. The tracker hook is the only
   caller of `setAnalyticsEventLevel`; before it runs the level is `pageviews`,
   so nothing fires early.

4. **ADR-0010 item 4 is amended, not overturned.** No event carries a numeric
   value, and that rule is unchanged and still enforced by the types. What
   changes is the admission that a timestamp is itself a measurement: two
   research-tier events subtract into a duration. Rather than pretend otherwise,
   the tier is named for what it is and the operator has to ask for it.

5. **Every surface that states the tracking claim is keyed on the level.** The
   landing page's feature card and the privacy policy's §9a were both boolean.
   Both are now four-way, by an exhaustive lookup rather than a ternary chain,
   so a fourth level added later fails to compile instead of rendering a false
   claim. A policy that describes feature tracking on an instance that does none
   is a false legal disclosure, not stale copy.

6. **The capability is documented and advertised, not buried.** `.env.example`
   and `docs/configuration.md` list every event in both tiers and say plainly
   what the research tier reveals. openplate.de's front page carries a section
   naming the three levels. An operator who turns on `research` is told, in the
   file where they turn it on, that they must say so in their own privacy policy.

## Consequences

- 48 events across 15 categories, 36 at `product` and 12 at `research`, against
  the 10 that shipped with ADR-0010. Every one has a live call site; the
  dead-export assertion in `tests/unit/no-telemetry-wiring.test.ts` enforces it.
- The hosted instances stay at `product`. Nothing about anyone's fasting,
  weight, clinician or study participation reaches SPRQVNTRS's Matomo, and §9a
  continues to describe them correctly.
- **A researcher can now collect health-behaviour telemetry from their own
  participants.** That is the point of the change, and it is a capability
  openplate did not have.
- **An operator can also switch it on carelessly.** The default, the boot-time
  throw, the documentation and the policy copy are the mitigations. There is no
  technical way to stop somebody misconfiguring software they run themselves,
  and pretending otherwise by shipping less code protects nobody.
- The Admin and StudyConsole categories were considered and cut. Their events
  describe an administrator acting on a third party rather than a person's own
  use, and no product question justified them. Sign-in and sign-out were cut for
  a related reason: on an instance the size of one household, a repeated
  timestamped visit is close to an identifier.
- ADR-0010's warning still stands and is inherited here. The Matomo side carries
  configuration this repository cannot enforce, IP anonymisation, honouring Do
  Not Track, visitor profiles off, and 90-day raw-log retention. **If those
  settings drift, the privacy policy becomes false and nothing in this codebase
  will notice.** The research tier raises what that drift would cost.
