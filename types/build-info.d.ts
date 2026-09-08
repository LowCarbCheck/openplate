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

/**
 * The build stamp for ONE `pnpm build`, cached across the two passes.
 *
 * `react-router build` runs a client pass and an SSR pass, and it RE-EVALUATES
 * `vite.config.ts` for each one in the same process (verified: same pid, two
 * evaluations). A module-level constant therefore produces two different
 * `builtAt` values, and the bundles ended up stamped 300 ms before the
 * `build/build-info.json` that is supposed to describe them. The two stamps have
 * to be one object, so the first pass parks it here and the second finds it.
 *
 * `hasWrittenFile` rides along for the same reason: `closeBundle` fires once per
 * pass, and the file only needs writing once.
 *
 * Build-time only. Nothing in `app/` may read this, and nothing does.
 */
interface OpenplateBuildStamp {
  build: OpenplateBuildInfo;
  hasWrittenFile: boolean;
}

declare var __openplateBuildStamp: OpenplateBuildStamp | undefined;
