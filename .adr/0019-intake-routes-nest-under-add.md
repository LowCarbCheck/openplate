# 0019, intake routes nest under `/add`, and voice is a query flag, not a route

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** Altan Sarisin (operator), with an architecture review from Fable

## Context

A food reaches the diary through three real, distinct intake mechanisms today,
each at its own top-level address: `/add` (the database search form, plus a
manual-entry fallback and a "Log with AI" button that hands typed text to the
AI pipeline), `/describe` (a message composer, "2 fried eggs and a slice of
toast", nothing else), and `/scan` (camera, photo library, the OS share sheet,
or AI-drafted text from `/describe`; owns the single review-and-confirm
screen every one of those paths ends on). `/pantry/recipes` is a fourth way
food gets logged, but it starts from a photographed pantry inventory and
writes the diary directly, bypassing the shared review screen entirely.

Three flat addresses for what is really one decision, "how do I want to tell
the app what I ate", makes the relationship between them invisible in the URL
and in the route tree. The operator asked to restructure this into a hub: one
`/add` that the other mechanisms nest under, naming the proposal
`/add/photo`, `/add/text`, `/add/voice`.

That naming does not survive contact with what is already built. Two things
the code already says, on purpose, shaped the decision below instead:

1. **Voice is not a fourth mechanism.** `app/lib/ways-to-log.ts` records this
   explicitly: openplate has no microphone of its own. A "Speak" affordance
   used to wrap the Web Speech API and was removed in M203, because it failed
   silently on a phone and routed audio through Google or Apple either way.
   What replaced it is `/describe?speak=1`, which focuses the composer's
   field and shows one line naming the phone keyboard's own dictation key.
   Whatever a person dictates arrives as ordinary typed text, through the
   same composer and the same AI pipeline typing already uses. A route named
   `/add/voice` would claim a mechanism this product does not have.
2. **Search and the composer were split apart on purpose, in M203, for a
   stated reason.** `/describe`'s own header comment: "a search box and a
   message box teach opposite things: one wants one noun, the other wants a
   sentence." Before M203, both cards in the onboarding lesson landed on
   `/add`, a search field, for someone who had just been told to write a
   whole meal. Any restructure that renames `/add` to mean "the composer" or
   folds the two back into one screen reverses that decision silently. This
   ADR does not reverse it.

The operator confirmed, once this was surfaced: the product is in beta,
breaking a URL is an accepted cost as long as the client recovers, and the
one edge case worth real engineering care is a shared photo silently
vanishing on an installed device running a stale service worker, not because
it must never happen, but because it fails with no visible error at all.

## Decision

**Search, the composer, and the photo pipeline become three sibling routes
nested under `/add`. Voice stays a query flag on the composer, not a route.
Pantry recipes stay outside the hub.**

```
/add                index route. Redirects to /add/search, forwarding the query.
/add/search         today's /add: database search, the portion step, manual entry.
/add/describe       today's /describe: the message composer. ?speak=1 unchanged.
/add/photo          today's /scan: camera, library, share sheet, AI review, confirm.

/scan, /describe    permanent redirects to /add/photo and /add/describe, query forwarded.
/log/plate          retargeted directly to /add/photo (was /scan, avoids a double hop).
/share-target       unchanged address; its redirect target becomes /add/photo.
/pantry/recipes     unchanged.
```

Four parts are worth stating separately.

1. **`/add/describe`, not `/add/text`.** Search is also typed text; naming the
   composer "text" reopens the exact ambiguity M203 closed. The route, the
   tests, the changelog and the i18n keys already say "describe" throughout
   the codebase; the address should say the same word.
2. **`/add/search` gets its own address rather than living at bare `/add`.**
   The operator's proposal had no slot for search at all, and search is the
   single most used intake mechanism. An index that means "one of three
   siblings" but has no name of its own makes the tree asymmetric: two
   methods are named, the third is "the parent." Naming it removes that
   asymmetry, at the cost of one redirect for anyone who still holds a bare
   `/add` link.
3. **No hub page.** A screen that asks "how do you want to log?" before
   routing onward adds one tap to an action performed several times a day.
   The raised launcher button and its long-press sheet (Photo, Type, Speak)
   already are that hub, one gesture away from every route above. The three
   sibling screens share a Search / Describe / Photo switcher drawn by the
   `/add` layout (M255), and each screen keeps its draft in memory
   (`app/lib/add-drafts.ts`), so a person can change their mind mid-entry
   without losing it; still no hub page.
4. **Pantry recipes stay outside the hub.** They begin from an inventory,
   not from "I want to log a food right now," and they write the diary
   directly rather than passing through the shared review-and-confirm
   contract the three siblings above share. Folding them in would blur a
   real difference in what the screen is for.

Old addresses become permanent redirects rather than a second live entry
point layered on top of the new ones, the same shape the `/log` → `/diary`
rename already used. `/scan?shared=1` in particular must keep forwarding its
query string indefinitely: an installed PWA keeps its old service worker
until it next updates, and that worker sends a shared photo to `/scan?shared=1`
regardless of what this release ships. The operator's stated risk tolerance
(beta, breaking changes expected, "as long as the client recovers") sets how
much engineering this edge case gets: the redirect must exist and must
forward the query, and a person who lands on a working `/add/photo` because
the redirect did its job has recovered; the app does not owe a service-worker
migration strategy beyond that.

## Alternatives Considered

**`/add/text` and `/add/voice` as literal sibling routes, per the original
proposal.** Rejected: voice is not a real second mechanism (see Context), so
a route for it either duplicates `/add/describe` outright or reintroduces a
microphone affordance this product deliberately removed. "Text" was rejected
for colliding with what search already is.

**Keep search at bare `/add` as the layout's implicit index, name only the
other two.** Saves one route file. Rejected: it leaves the tree asymmetric
(two named siblings, one anonymous parent) for no real saving, since the
index route is one line either way.

**A hub page that asks the person to choose a method before routing on.**
Rejected: the launcher sheet already serves this purpose in one gesture, and
a hub page would add a screen to the app's single most frequent action.

**Fold `/pantry/recipes` under `/add`.** Rejected: it does not share the
review-and-confirm contract the other three routes share, and it is reached
from a different starting point (the pantry, not "log a food now").

**Layer the new addresses on top of the old ones, both live indefinitely.**
Rejected: two live addresses for one screen is the exact state the `/log` →
`/diary` rename existed to clean up, and repeating it here recreates the
same drift for a different set of routes.

## Consequences

**Good**

- The URL tree now says what the product already believes: three ways in,
  one shared review contract, reachable from one hub gesture.
- Voice is honestly represented as what it is, typing with a different key
  pressed, rather than implied to be a fourth mechanism the app does not
  have.
- The M203 split between search and the composer is preserved and made more
  legible, not undone.

**Costs and constraints**

- **A real route-file move, not a rename.** `add.tsx`, `describe.tsx`, and
  `scan.tsx` move under `app/routes/add.*`, with their `./+types/<route>`
  imports following. `app/routes.ts`'s own comments that describe `/add` as
  "the database search" and `/scan` as the photo route need rewriting, not
  just their addresses.
- **The onboarding allowlist is a closed, compile-time list.** The three
  cards in `app/lib/ways-to-log.ts` are typed against
  `OnboardingExitDestination` in `app/lib/onboarding.ts`; every literal that
  changes needs the allowlist updated, or the build fails at `tsc`, which is
  the safety net this decision relies on rather than a cost to work around.
- **Roughly 194 literal references to the three old addresses**, across
  `app/`, `tests/`, and `types/`, 23 of them in 13 `tests/e2e/` files. Every
  in-app navigation is expected to use the new address directly; nothing
  inside the app should depend on the redirects firing.
- **`/scan?shared=1` cannot be retired.** As long as any installed device
  might be running a pre-update service worker, that redirect stays, with
  its query forwarded.
- **Matomo's page-view history for these three routes splits at the release
  date.** A reporting artefact, not a code concern.

## References

- `app/lib/ways-to-log.ts`, the PHOTO / TYPE / SPEAK model and its header
  comment on why voice was removed as its own affordance.
- `app/routes/describe.tsx`, the M203 header comment this decision leaves
  standing.
- `app/lib/onboarding.ts`, `ONBOARDING_EXIT_DESTINATIONS` and
  `resolveExitDestination`, the compile-time allowlist a route rename must
  update.
- `app/routes/redirects/legacy-log-plate.tsx`, the existing `/log` → `/diary`
  precedent this decision's redirects follow.
- ADR-0005 (amended), the label-scan merge into the one photo path that
  `/add/photo` inherits unchanged.
