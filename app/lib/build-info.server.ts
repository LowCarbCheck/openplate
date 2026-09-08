/**
 * What build the SERVER is, resolved once at boot.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * `build-info.ts` reads a constant that Vite's `define` substitutes into the
 * bundles. `pnpm start` runs `tsx ./server.ts`, which Vite never touches, so in
 * the entrypoint that constant is simply absent, and the entrypoint is what
 * stamps the `X-Openplate-Build` header the browser compares against.
 *
 * ── THE SOURCE DEPENDS ON THE ENVIRONMENT, AND IT HAS TO ────────────────────
 *
 * THE FAILURE THIS PREVENTS: under `pnpm dev`, the browser gets its stamp from
 * Vite, which computes it live at dev-server start, while an earlier `pnpm
 * build` may have left a `build/build-info.json` from a different commit. Read
 * the file in dev and the two disagree permanently. `bundle-freshness.ts` sees
 * two known, unequal shas on every poll and the ribbon says "A newer version of
 * this page is ready" for the rest of the session, on a page that is already the
 * newest there is. Reload cannot clear it, because there is nothing to reload
 * onto. Every developer would see it, and it is not visible in production at
 * all, where the file is written by the build that produced the bundle.
 *
 * So:
 *
 * - **development** derives it LIVE, from the same two inputs `vite.config.ts`
 *   uses: `package.json`'s version and `git rev-parse --short HEAD`. The file is
 *   not read, not even as a fallback, because a stale answer is exactly the bug.
 * - **production** reads `build/build-info.json`, which the build wrote beside
 *   the bundle it describes, and falls back to the live derivation only when
 *   that file is missing (an image with no `build/` has no server bundle to run
 *   either, so this is defensive rather than expected).
 *
 * `selectServerBuild` is the rule, on its own, with both readers injected, so
 * `tests/unit/build-info-source.test.ts` can pin it without a filesystem.
 *
 * The stamp path is resolved against the working directory, matching the way
 * `server.ts` already reaches `build/client` and `build/server`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import { CONFIG } from '#app/config';
import type { BuildInfo } from '#app/lib/build-info';

const buildInfoFileSchema = z.object({
  version: z.string(),
  sha: z.string(),
  builtAt: z.string(),
});

const manifestSchema = z.object({ version: z.string() });

/** Where the two readers come from. Injected so the rule below can be tested. */
export interface BuildInfoSources {
  /** The stamp `pnpm build` wrote, or null when there is no readable one. */
  stampFile: () => BuildInfo | null;
  /** The live answer, derived the same way the Vite config derives it. */
  live: () => BuildInfo;
}

/**
 * Which source answers, given the environment.
 *
 * Development never touches the stamp file. That is the whole point: see this
 * module's header for the false ribbon a stale read produces.
 */
export function selectServerBuild({
  isProduction,
  sources,
}: {
  isProduction: boolean;
  sources: BuildInfoSources;
}): BuildInfo {
  if (!isProduction) return sources.live();
  return sources.stampFile() ?? sources.live();
}

/** Reads a file, or null if it is absent or unreadable. */
function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch {
    return null;
  }
}

function readStampFile(): BuildInfo | null {
  const contents = readFileOrNull('build/build-info.json');
  if (contents === null) return null;
  const parsed = buildInfoFileSchema.safeParse(JSON.parse(contents));
  return parsed.success ? parsed.data : null;
}

/**
 * The short commit of the working tree, or null when git cannot answer.
 *
 * Identical to `vite.config.ts`'s `gitShortSha`, deliberately duplicated rather
 * than shared: the config runs in the build toolchain and this runs in the app,
 * and an import across that line would pull the Vite config into the server's
 * module graph to read seven characters.
 */
function gitShortSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // No git binary, or not a repository. Both are ordinary inside an image.
    return null;
  }
}

/**
 * The live derivation: the manifest's version and the working tree's commit.
 *
 * `builtAt` is the moment this process started, which is the only honest answer
 * in dev: nothing was built, the modules are compiled on demand.
 *
 * The `OPENPLATE_BUILD_SHA` override is consulted FIRST, and must be, because
 * `vite.config.ts` consults it first too. A developer who sets it would
 * otherwise get a Vite-stamped bundle and a git-stamped server, which is the
 * same two-known-shas mismatch this file exists to prevent.
 */
function liveBuild(): BuildInfo {
  const contents = readFileOrNull('package.json');
  const manifest = contents === null ? null : manifestSchema.safeParse(JSON.parse(contents));
  const override = CONFIG.build.shaOverride;
  return {
    version: manifest?.success === true ? manifest.data.version : '0.0.0-unstamped',
    sha: override === null ? (gitShortSha() ?? 'unknown') : override,
    builtAt: new Date().toISOString(),
  };
}

/** This server's version, commit and build time. Resolved once, at import. */
export const SERVER_BUILD: BuildInfo = selectServerBuild({
  isProduction: CONFIG.app.isProduction,
  sources: { stampFile: readStampFile, live: liveBuild },
});
