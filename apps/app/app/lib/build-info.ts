/**
 * What build this page is. One module, read by the browser and by the SSR
 * render alike.
 *
 * `BUILD` is the object Vite's `define` substitutes at build time (see
 * `vite.config.ts` for how it is computed and `types/build-info.d.ts` for why
 * it is a bare identifier). It replaced a hand-copied `APP_VERSION` literal in
 * `brand.ts`, which needed a unit test to stop it drifting from
 * `package.json`. The build reads the manifest now, so there is nothing left
 * to drift and nothing left to pin.
 *
 * NOT `.server.ts`, deliberately: the version is on `/settings/about` and in
 * the sidebar, both of which are client surfaces. The Express entrypoint has
 * its own reader, `build-info.server.ts`, because it runs outside Vite.
 */

/** Version, commit and timestamp of the bundle this page is running. */
export type BuildInfo = OpenplateBuildInfo;

/**
 * What a module reads when nothing defined the constant.
 *
 * That is exactly one situation: a unit test importing this module under plain
 * node, where `__OPENPLATE_BUILD__` was never substituted. Every build the app
 * ships in defines it. The version is deliberately not `package.json`'s: a
 * plausible-looking version here would be worse than an obviously fake one,
 * because it would let a broken `define` reach production wearing the right
 * number.
 */
const UNSTAMPED: BuildInfo = {
  version: '0.0.0-unstamped',
  sha: 'unknown',
  builtAt: '1970-01-01T00:00:00.000Z',
};

/**
 * The injected stamp, or null outside a Vite build.
 *
 * A `try` rather than a presence check: an identifier that was never declared
 * throws `ReferenceError` on read, and that throw is the only signal available.
 * Testing `globalThis.__OPENPLATE_BUILD__` instead would report null in the
 * browser too, because esbuild substitutes the identifier and not the property
 * access.
 */
function injectedBuild(): BuildInfo | null {
  try {
    return __OPENPLATE_BUILD__;
  } catch {
    return null;
  }
}

/** This bundle's version, commit and build time. */
export const BUILD: BuildInfo = injectedBuild() ?? UNSTAMPED;

/**
 * The one-line stamp shown in the app chrome and on `/settings/about`:
 * `v0.18.3 · 586caeb`.
 *
 * The separator is a middle dot, the same one `settings.rows.about.status`
 * already uses, and never a dash of any width. A build with no sha (a local
 * `pnpm build` on a machine with no git, see `vite.config.ts`) drops the
 * second half rather than printing the word "unknown" at a person.
 */
export function formatBuildLabel(build: BuildInfo): string {
  const version = `v${build.version}`;
  return build.sha === 'unknown' || build.sha === '' ? version : `${version} · ${build.sha}`;
}
