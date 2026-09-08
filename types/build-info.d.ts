/**
 * The build stamp Vite injects, declared once so every module that reads it is
 * typed rather than asserted.
 *
 * AMBIENT ON PURPOSE. This file carries no top-level `import` or `export`, so
 * both declarations below are global. `app/lib/build-info.ts` is the only
 * module that reads the constant; everything else reads `BUILD` from there.
 *
 * The constant is replaced TEXTUALLY by Vite's `define` (see `vite.config.ts`),
 * which is why it is a bare identifier rather than a property of `globalThis`:
 * esbuild substitutes the identifier, never `globalThis.__OPENPLATE_BUILD__`.
 * Outside a Vite build (the unit tests run modules under plain node) the
 * identifier is simply not defined, and reading it throws a `ReferenceError`,
 * which `build-info.ts` catches and falls back from. It is declared here as always
 * present because that is what it is in every build the app actually ships in.
 */

/** Version, commit and timestamp of the bundle the browser is running. */
interface OpenplateBuildInfo {
  /** `package.json`'s `version` at build time, e.g. `0.18.3`. */
  readonly version: string;
  /** Short commit sha, or `unknown` when the build had no git and no override. */
  readonly sha: string;
  /** ISO 8601 instant the bundle was built. */
  readonly builtAt: string;
}

declare const __OPENPLATE_BUILD__: OpenplateBuildInfo;
