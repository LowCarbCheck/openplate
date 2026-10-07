# Oxlint plugins

`pnpm lint` runs oxlint with two JS plugins, both registered in `.oxlintrc.json` under `jsPlugins`.
Both folders are in `ignorePatterns`, so the lint does not read them. `tsconfig.json` leaves `anti-slop` out of the
typecheck, and `openplate` is typechecked.

| Plugin      | Folder                    | Whose it is                                                                     |
| ----------- | ------------------------- | ------------------------------------------------------------------------------- |
| `anti-slop` | `tools/oxlint/anti-slop/` | Vendored verbatim from upstream. Do not edit it, and put no rule of ours in it. |
| `openplate` | `tools/oxlint/openplate/` | Ours. Every rule that only makes sense in openplate goes here.                  |

A rule is written with `defineRule` from `@oxlint/plugins` and `createOnce`, registered in the plugin's
`index.ts`, and switched on in `.oxlintrc.json` under `rules` as `error`.

## `openplate/no-trailing-slash-link`

**What.** It rejects a trailing slash in the path of a link to our own sites.

**Why.** openplate.de names the page address without a trailing slash (canonical link, hreflang, sitemap)
and nginx answers a slash address with a 301. A link with a slash works, but it costs a redirect hop and
names an address that is not canonical. The one exception is the German home page, `https://openplate.de/`.
A prefixed home page is the bare prefix, `https://openplate.de/en`. The workspace rule is "No trailing slash
in a link to our own sites" in the workspace `CLAUDE.md`.

**Where it looks.** It reads these four places only, and nothing else:

1. Any string or template literal that is an absolute URL on one of our hosts.
2. A JSX attribute `to` or `href` whose value is a root-relative path.
3. The path argument of `projectSiteUrl` (second) and `useProjectSiteUrl` (first).
4. A `const` or `let` named `*_PATH`, `*_URL` or `*_HREF` that holds such a URL or path.

A bare `/` is always fine. A slash after a `?` or `#` is not part of the path and is fine. File system
paths, regular expressions, import specifiers, `//` URLs and URLs that end in a file name are not links.
A template with an expression counts only when its last piece ends in a slash that follows a real
character (`` `${PROJECT_SITE_URL}/docs/x/` `` is flagged, `` `${origin}/` `` is not). In positions 2 to 4 a
template that begins with an expression counts only when the expression is named for the site
(`PROJECT_SITE_URL`, `siteUrl`), because any other origin, a loopback test stub for example, is not ours.
`as`, `satisfies` and `!` around the string are looked through.

**Fix.** Drop the slash: `/en/docs/app/x/#a` becomes `/en/docs/app/x#a`. The message prints the fixed form.

**How to add a host.** Add it to `OWN_SITE_HOSTS` in `tools/oxlint/openplate/shared/own-site-url.ts`, then add
a `bad` and a `fine` case for it to `tests/unit/oxlint-no-trailing-slash-link.test.ts`.

**Tests.** `tests/unit/oxlint-no-trailing-slash-link.test.ts` writes fixtures to a temp directory and runs the
real oxlint CLI over them with the real plugin. Every case is one fixture line, and the lines oxlint flags must
be exactly the lines marked `bad`.
