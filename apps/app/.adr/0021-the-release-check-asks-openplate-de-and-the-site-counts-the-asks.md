# 0021. The release check asks openplate.de, and the site counts the asks

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Altan, with counsel and architecture review
- **Supersedes:** ADR-0012
- **Relates to:** ADR-0010

## Context

openplate is MIT and self-hosted by people who are not us. We know how many
people pull the image, because GHCR counts pulls. We do not know how many
instances actually run. A pull is not an install, and an install is not a
running server. The question "how many instances are running" has no answer
today.

We considered a usage telemetry module, opt-out, with an instance ID and event
counts. Counsel weighed it. The gain was one number we care about and a few we
would rarely read. The loss was ADR-0010's promise that a self-hosted instance
sends nothing it did not send before, a new privacy obligation, a new switch to
document, and the trust of the people who chose openplate because it keeps
quiet. We rejected it.

ADR-0012 already makes every default instance send one request every six hours:
the release check, to `api.github.com`. GitHub sees the server's IP and a
default user agent, and we see nothing. That request is the only thing a
default instance sends, and it exists for the operator's benefit, not ours.
Pointing it at a file we serve gives us the count from a request that already
leaves the box, with no new switch, no instance ID and no body.

## Decision

**The release check asks `https://openplate.de/latest.json` instead of GitHub.
The request carries the version and arch in its User-Agent. The website counts
distinct addresses per day from its own access log and keeps only the totals.**

1. **The URL is derived from `PROJECT_SITE_URL` in `app/lib/brand.ts`.** There
   is no environment variable to override it and no GitHub fallback. A fork that
   keeps its own site changes one constant and gets its own count. A fork that
   does not wants to be counted with us, or sets `UPDATE_CHECK=off`.

2. **The request is a GET with no body and no instance identifier.** The only
   non-default header is the User-Agent, `openplate/<version> (<platform>;
   <arch>)`. A guard test in `tests/unit/` asserts exactly that: no other
   header, no body, no query string. The schedule, the manual re-check, the
   60 second cooldown and the fail-soft behaviour of ADR-0012 are unchanged.

3. **`UPDATE_CHECK=off` stops the request and therefore the count.** There is
   no second switch. An operator who does not want to be counted turns off the
   release check, and the docs say so in one sentence next to the variable.

4. **The file is `{ "app": { "version": "x.y.z" } }`, stable releases only.**
   The website builds it from `src/generated/SOURCE.json` as a prerendered
   resource route, the same mechanism as `sitemap.xml`. The build fails if the
   quoted ref is not `vX.Y.Z`. A prerelease never reaches the file, so a
   prerelease never produces a banner on anybody's instance.

5. **The count is a daily job on the EU host, run as a Bay service.** It reads
   the previous day of the Traefik access log, keeps lines for this route with
   verb GET, status 200 and a User-Agent starting with `openplate/`, counts
   distinct client addresses per version and arch in memory, and discards the
   addresses. It writes one row per day and version and arch to a file on the
   host and sends the same totals to Matomo as one event per row, on a Matomo
   site of its own. No client address is sent to Matomo and no per-request hit
   is recorded there.

6. **The number is "at least N addresses asked for a release on day D".** We
   quote a 7-day median. We never call it "installs" or "users". Several
   instances behind one NAT count as one. An instance that restarts counts
   once. An instance with the check off counts zero. Old versions keep asking
   GitHub, so the number ramps up over months, not days.

7. **The CrowdSec whitelist for this route is a precondition.** The
   `datacenter-asn-flood` scenario bans a cloud address that makes more than
   two requests in ten minutes, for 24 hours, on every site we run. A restart
   loop or two instances behind one address would trigger it. A parser
   whitelist keyed on the router, the verb and the path exempts this route,
   like the existing `deploy-pin-probe-openplate`. An nginx `limit_req` on the
   same path, in the website image, caps a flood of a whitelisted route. The
   whitelist ships before the app change.

## What leaves the instance

One HTTPS GET every six hours, the first 90 seconds after boot, and one more
when an administrator presses "check now", at most once a minute.

| Item | Sent | Where it lands |
| --- | --- | --- |
| Client address | Yes, as every HTTPS request does | Traefik access log, 15 days |
| Version, platform, arch | Yes, in the User-Agent | Traefik access log, 15 days; daily totals, kept |
| Instance ID, hostname, account, diary data | No | Nowhere |
| Body, cookie, query string | No | Nowhere |

## What we keep, and for how long

| Store | Contains | Retention | Why |
| --- | --- | --- | --- |
| Traefik access log | address, time, path, User-Agent | at most 15 days (logrotate, 14 rotations) | the same log as any visit; CrowdSec reads it |
| Website container log | the same line, nginx format | until redeploy, or the 50m x 3 size cap | docker default, not read by anybody |
| Daily count file | day, version, arch, count | kept | the whole point |
| Matomo, separate site | one event per day, version and arch | kept, as aggregate reports | so the number sits next to the site's other numbers |

The honest sentence is: **we keep daily totals; the proxy log keeps addresses for
up to 15 days, exactly as it does for a visit to the website.** We do not claim
"no IP is kept", because that is false for 15 days.

## Legal basis

Art. 6(1)(f) GDPR, legitimate interest, the basis the website's own log clause
already claims for the same log.

- **Interest.** Knowing whether the project is used, to decide where to spend
  unpaid work.
- **Necessity.** The request already exists for the operator's benefit. We add
  one header and move the destination. No lighter way gives a running count.
- **Balancing.** The data is a server address and a version string, not a
  person's data in any meaningful sense. The operator controls the switch. No
  address is stored beyond the proxy log that any website visit writes.
- **Expectation.** A server that checks for updates contacts the project. The
  docs and the privacy text say it in plain words, so the expectation is set.
- **Safeguard.** No identifier, no body, aggregation within a day, a switch
  that stops it entirely.

## Alternatives Considered

- **A heartbeat module with an instance ID, opt-out.** Rejected by counsel; see
  Context.
- **Keep GitHub and add a fallback to it.** Rejected: a fallback means a second
  party learns the address when our site is down, and a second URL to document.
  The check fails soft already; a stale banner for a few hours is acceptable.
- **An env var to override the URL.** Rejected: a fork edits one constant; an
  env var invites pointing a fleet at a stranger's server.
- **Query string instead of User-Agent.** Rejected: both land in the same log
  line next to the address; the User-Agent is one header, needs no URL parsing
  and keeps the path stable for the CrowdSec and nginx rules.
- **Import the access log into Matomo.** Rejected: that would put addresses into
  a store with longer retention. Matomo gets totals only.
- **Count GHCR pulls instead.** Kept as a trend, rejected as a count: a pull is
  not a running server.
- **A manual cron instead of a Bay service.** Rejected: a host rebuild loses it,
  and nobody notices a count that stopped.

## Consequences

**Good**

- One number we never had, from a request that already existed.
- No new switch, no new module, no instance ID, no body. ADR-0010's "nothing
  by default" stands in substance: a default instance still sends only its
  release check.
- No GitHub rate limit by address any more; our file is static and cached.

**Costs and constraints**

- ADR-0012's claims "no version number in the query" and "GitHub learns the
  server's IP" are no longer true. That ADR is superseded, and its
  documentation lines in `README.md`, `docs/configuration.md`,
  `docs/environment-variables.md`, `.env.example` and the compose comments
  are rewritten to name openplate.de and the User-Agent.
- The landing copy `features.noTracking.body` says nothing about the app is
  sent anywhere. It must stop saying that in all six locales. The diary claim
  stays; the absolute goes.
- The website privacy text gains one sentence: self-hosted instances ask
  openplate.de for the newest version, and we count how many addresses asked
  per day.
- The file lags a release by about an hour: the docs bot re-quotes at the tag,
  then Bay rebuilds the site. The website file must be live before any app
  version that asks for it ships, or every instance on that version sees a 404
  and keeps a stale banner until the file exists.
- The count is a Bay service with a read-only mount of the Traefik log. A
  service that reads the proxy log is a new kind of service in the inventory
  and needs the same care as the log itself.
- Review in six months, 2027-04-01. If nobody has read the number by then, the
  service and the Matomo site are deleted and this ADR is superseded.

## References

- `app/lib/update-check.server.ts`, the check, now asking `latest.json`.
- `app/lib/brand.ts`, `PROJECT_SITE_URL` and the feed URL derived from it.
- `apps/website/app/routes/latest.json.ts`, the file, and `sitemap.xml.ts`,
  its precedent.
- Bay `security.yml`, the `deploy-pin-probe-openplate` whitelist this one
  copies; `services.yml`, the counting service.
- ADR-0010, hosted analytics; ADR-0012, the GitHub check this replaces.
