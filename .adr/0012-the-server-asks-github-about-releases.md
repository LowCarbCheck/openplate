# 0012. The server asks GitHub about releases, and it asks by default

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Altan, with architecture review

## Context

openplate ships as a container image. An operator pulls a new one; nothing in the
running system knows a newer one exists. In practice that means a self-hosted
instance runs whatever version it was installed with, indefinitely, and the person
who set it up is usually the only one who could ever notice. The version was
readable only at `/settings/about`, and even there it was a literal hand-copied
into `app/lib/brand.ts`.

Three existing constraints bounded any answer.

1. **The production `connect-src` is a closed allowlist**
   (`app/config/content-security-policy.ts`). It is what stops an injected script
   exfiltrating a BYOK key that lives in the page, and ADR-0007 makes widening it
   a decision rather than an edit.
2. **ADR-0010's contract:** an unconfigured instance loads no third-party script
   and its CSP header is byte-for-byte what it was before the feature existed.
   openplate is MIT and self-hosted by people who are not us.
3. **ADR-0006:** this server holds no personal data and boots with zero secrets.
   Anything added has to keep both true.

## Decision

**The server asks the public GitHub tags endpoint for the newest `vX.Y.Z`, once
every six hours, and it does so unless the operator sets `UPDATE_CHECK=off`.**

Three parts are worth defending separately.

1. **The server asks, not the browser.** Doing it client side would have meant
   adding `api.github.com` to `connect-src` on every instance, permanently,
   widening the one list the key promise rests on so a banner could render. Asking
   from `server.ts` leaves that header untouched and means no visitor's browser
   ever contacts GitHub. The whole check lives in `app/lib/update-check.server.ts`
   and is mounted as two plain Express routes, so it is provably outside the client
   module graph.

2. **It is on by default.** This is the part that reverses a default rather than
   adding an option, so it is the part recorded here. An instance that never says a
   newer version exists is an instance quietly running an old one, and for a health
   app that is a security posture, not a preference. What actually leaves the box is
   one anonymous GET to a public endpoint of a public repository: no token, no
   instance identifier, no version number in the query, nothing about any person.
   GitHub learns the server's IP address and a default user agent, which is what it
   learns from anyone who runs `docker pull` against a public registry anyway. That
   is a materially smaller disclosure than a third-party script in a visitor's
   browser, which is what ADR-0010 was arguing about, so the same reasoning does not
   carry over unchanged. `UPDATE_CHECK=off` stops it completely: no timer is
   started and no request is made by any path.

3. **A newer release is information, never a button.** The server cannot replace
   its own image, and no code in the browser can either. So a newer GitHub release
   is reported with a link and nothing more. The one action the app does offer,
   "Reload to update", adopts a bundle the server is ALREADY serving, decided by
   comparing the `X-Openplate-Build` response header against the commit compiled
   into the running bundle. That distinction is load-bearing: a button that appears
   to upgrade a server and does not would be worse than no button.

## Alternatives Considered

- **Check from the browser.** Rejected: it buys nothing and costs a permanent
  widening of `connect-src` on every instance including ones with no interest in
  the feature.
- **Off by default, opt in.** Rejected: the operators most likely to be running a
  stale build are exactly the ones who will never find the variable. The disclosure
  is a server IP hitting a public endpoint, which is not worth a silence that
  defeats the feature.
- **Fail loudly on a failed check**, as the analytics pair fails at boot. Rejected:
  a half-configured tracker is a lie about what is being measured, while an
  unanswered version question is just an unanswered question. Every failure keeps
  the previous answer and logs at warn.
- **A `latest` image tag and no check at all.** Rejected: it tells the operator
  nothing, and pinning a semver is what Bay does deliberately.

## Consequences

**Good**

- An operator can see, in the app, that they are behind, and which commit they are
  on when they file a report.
- The CSP is unchanged, so ADR-0010's "no third-party script on an unconfigured
  instance" claim and the BYOK allowlist argument both survive intact.
- The hand-copied `APP_VERSION` literal and the unit test pinning it to
  `package.json` are both gone. The build reads the manifest, so there is no second
  copy left to drift.

**Costs and constraints**

- **A default self-hosted instance now makes an outbound request it did not make
  before.** That is a real change in behaviour for existing installs and is why this
  ADR exists. It is documented in `README.md`, `docs/configuration.md` and
  `.env.example`, in each case naming what the request contains.
- GitHub rate limits anonymous calls by IP. A NAT shared by many instances can be
  refused; the check fails soft and the banner simply stays stale.
- The commit in the stamp has to be passed into the image as
  `OPENPLATE_BUILD_SHA`, because `.dockerignore` excludes `.git` and the alpine
  base has no git. A build without it stamps `unknown`, and the app then never
  claims a newer bundle is ready. That is the safe direction, but it means a
  hand-built image loses the reload prompt.

## References

- `app/lib/update-check.server.ts`, the check, the cache, the throttle.
- `app/lib/bundle-freshness.ts`, the `X-Openplate-Build` comparison and why it
  needs two consecutive mismatches.
- ADR-0006, the server holds no accounts and no personal data.
- ADR-0010, analytics on the hosted instance, and the CSP claim this decision
  had to leave standing.
