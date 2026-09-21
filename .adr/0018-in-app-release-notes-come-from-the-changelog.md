# 0018, in-app release notes come from the changelog

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** Altan Sarisin (operator)

## Context

openplate ships as a container image, and a person opening the app after their
operator pulled a new one simply finds it different from yesterday. Nothing in
the product tells them what changed. ADR-0012 gave the OPERATOR a line on the
About screen saying the instance is behind, which is a different question: it
names a version, not a change.

The material already exists and is already written for the right reader.
`CHANGELOG.md` opens every bullet with a short bold lead sentence, present
tense, about ten words, written for the person running the instance rather than
for the person reading the diff, and `AGENTS.md` has required that since 0.20.0.
`scripts/release-notes.ts` already reads those leads into the GitHub Release
page. So the question here is not what to say. It is how the sentence reaches
the app.

Three constraints bound every answer.

1. **The production `connect-src` is a closed allowlist**
   (`app/config/content-security-policy.ts`). It is what stops an injected
   script exfiltrating a BYOK key that lives in the page, and ADR-0012 already
   refused to widen it with `api.github.com` so that a version check could run
   in the browser. A release notes card is a weaker reason than that one was.
2. **The app is a PWA that works offline, in six languages, with every catalog
   inline.** `app/i18n/i18n.ts` imports each bundle as ESM on purpose: no
   runtime fetch, no loading state, no separate cache entry per language.
   Anything shown to a person has to survive an aeroplane.
3. **English is the only hand-written language.** The other five are bought
   through `scripts/translate-ui.ts` and recorded in `app/i18n/memory/`, keyed
   by catalog path and by the English string. Anything the app says in German
   has to be a catalog key, or it is silently English for five of six readers.

## Decision

**The app ships the bold leads of the newest three releases that changed the
application, translated into all six languages, in a `releases` i18n namespace
generated from `CHANGELOG.md` at release time. The person is told once after an
update, and nothing is ever fetched to tell them.**

Five parts are worth defending separately.

1. **Generated, not fetched.** `pnpm release-catalog`
   (`scripts/sync-release-catalog.ts`) writes
   `app/i18n/locales/en/releases.json` out of `CHANGELOG.md`, through the same
   parser `scripts/release-notes.ts` uses for the GitHub Release page. The
   result is an ordinary committed catalog: part of the bundle, readable
   offline, and translated by the run every other string goes through. The CSP
   is untouched, which is the whole point.
2. **Three releases.** Enough for somebody who skipped an update or two, and
   bounded so the bundle does not grow by one paragraph per release for ever.
   A release with nothing under Added, Changed or Fixed is skipped and does not
   spend one of the three.
3. **The lead only, and no markup in it.** The lead is the sentence; the detail
   stays in the changelog and on the release page, where the reader is an
   operator. A lead may not carry a backtick, a square bracket, a markdown
   link, an angle bracket, a `{{name}}` placeholder, an em dash or an en dash.
   The generator refuses and names the version and the lead, because the app
   renders a lead as plain text and the translator must hand a placeholder back
   unchanged.
4. **Added, Changed and Fixed, never Docs.** `Docs` records a change to a
   document. Telling somebody holding the app about a corrected sentence in
   `docs/sync.md` spends their attention on work they cannot see.
5. **A device with no acknowledgement is told this build's notes, or
   nothing (M242/10).** A device that finished setup before this build but has
   no stored acknowledgement has no baseline. It may be new to this update, or
   it may have read every note already, after a browser reset for example. So
   it is shown the notes of the build it runs and no older ones. When that
   build has no entry, because it changed only docs, the device is recorded
   silently and told nothing. Showing the newest older entry instead was
   weighed and rejected: it spends the reader's attention on the least certain
   guess, a release they may have read months ago. A device that does hold an
   older acknowledgement is not affected and is shown every entry after it.
   Decided on 2026-09-21, when the follow-up was closed.

## Alternatives Considered

**Fetch the GitHub releases API from the browser.** One `fetch` to
`api.github.com`, no generation step, always current. Rejected on the first
constraint: it needs `api.github.com` in `connect-src` on every instance,
permanently, which is exactly the widening ADR-0012 refused for a feature with
a better claim to it. It is also English only, and it fails on a device with no
network, which is the device this app is built for.

**A server route that proxies GitHub.** Keeps the CSP closed, the way
ADR-0012's own check does. Rejected because that check answers one cheap
question on a six-hour timer, while this one is a body of prose fetched per
view: an outbound call for every person who opens the card, on a server whose
whole promise is that it holds nothing and talks to nobody on a visitor's
behalf. It still fails offline, and it still arrives in English.

**Parse `CHANGELOG.md` during the build.** No committed catalog, no staleness,
one fewer file in the release commit. Rejected because it is English only.
There is nowhere in a Vite build to put a German sentence and no budget in it
to buy one, so five of six readers would get an English card in an app that is
otherwise fully translated.

**Ship the full bullet text rather than the lead.** More detail, no extra
writing. Rejected three times over. The bullets are long, and three releases of
them is a sizeable addition to a bundle that is downloaded on every visit. The
translation memory is keyed by path and by the English string, so every
re-worded bullet buys a whole paragraph again, on every release, in five
languages. And the detail is written for an operator deciding whether to pull an
image, which is not the person reading it here.

**Include the `Docs` group.** One more group, no new machinery. Rejected: see
the fourth part of the decision.

## Consequences

**Good**

- A person who updated is told what changed, in their own language, with no
  request leaving the device and no change to the CSP.
- One parser, one set of sentences. The release page and the app cannot
  describe a version differently, because both read `parseReleases` in
  `scripts/release-notes.ts`.
- Nothing new is written at release time. The leads were already there, and
  already reviewed, because the release page has printed them since 0.20.0.

**Costs and constraints**

- **Every release carries one extra generate step and five translate runs.**
  They cost cents, and they are step 5 of _Cutting a release_ in `AGENTS.md`.
  The release commit grows by six `releases.json` files and five
  `app/i18n/memory/*.json` files.
- **A forgotten step fails the push.** `tests/unit/release-catalog.test.ts`
  compares the committed English catalog against `CHANGELOG.md`, so a changelog
  that moved on without the catalog is red on the commit that moved it.
  `pnpm release-catalog --check` asks the same question without writing.
- **English leads are the source of truth, and a lead cannot use markup.** That
  is a real constraint on a writer who wants to name a command or a file in the
  first sentence of a bullet. Name it in the detail instead.
- **Only the newest three releases are in the app.** Anything older is on the
  GitHub release page, which the About screen already links.
- **There is now a third i18n namespace.** `app/i18n/i18n.ts` registers
  `common`, `legal` and `releases`. Nothing else needed an edit:
  `scripts/lib/translate-ui.ts` discovers namespaces by listing
  `app/i18n/locales/en/*.json` rather than from a list, and a `releases`
  namespace is bought in the informal `common` register, which is the one the
  app's own voice uses.

## References

- `scripts/sync-release-catalog.ts`, the generator, the three groups and the
  refusals.
- `scripts/release-notes.ts`, `parseReleases`, the one parser both readers use.
- `tests/unit/release-catalog.test.ts`, the staleness check and its control.
- `AGENTS.md`, _Versioning and changelog_, step 5 of cutting a release.
- ADR-0012, the closed `connect-src` this decision had to leave standing, and
  the version check that answers the operator's question rather than the
  reader's.
