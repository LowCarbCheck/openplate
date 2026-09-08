/**
 * What build the SERVER is, read from disk at boot.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * `build-info.ts` reads a constant that Vite's `define` substitutes into the
 * bundles. `pnpm start` runs `tsx ./server.ts`, which Vite never touches, so in
 * the entrypoint that constant is simply absent. Three ways out were on the
 * table:
 *
 *  1. `import pkg from '../../package.json'` in the entrypoint. Gives a version
 *     and no commit at all, and the commit is the whole point of the
 *     `X-Openplate-Build` header.
 *  2. Shell out to git at boot. There is no git binary in the alpine image and
 *     no `.git` in the build context (`.dockerignore`), so it answers
 *     `unknown` in production, which is where the answer matters.
 *  3. Have the build write the stamp beside the bundle it describes, and read
 *     the file here.
 *
 * The third is the one that works for `pnpm build` then `pnpm start`, needs no
 * new tooling, and cannot disagree with the browser because the same object
 * produced both. `vite.config.ts` writes `build/build-info.json`.
 *
 * The path is resolved against the working directory, matching the way
 * `server.ts` already reaches `build/client` and `build/server`.
 *
 * A missing file means `pnpm dev` (no build has run), and the fallback answers
 * with the manifest version and no commit. It is never the production case: an
 * image without `build/` has no server bundle to run either.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import type { BuildInfo } from '#app/lib/build-info';

const buildInfoFileSchema = z.object({
  version: z.string(),
  sha: z.string(),
  builtAt: z.string(),
});

const manifestSchema = z.object({ version: z.string() });

/** Reads and parses a JSON file, or null if it is absent or unreadable. */
function readJsonFile(path: string): string | null {
  try {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch {
    return null;
  }
}

function readStampFile(): BuildInfo | null {
  const contents = readJsonFile('build/build-info.json');
  if (contents === null) return null;
  const parsed = buildInfoFileSchema.safeParse(JSON.parse(contents));
  return parsed.success ? parsed.data : null;
}

function readManifestFallback(): BuildInfo {
  const contents = readJsonFile('package.json');
  const parsed = contents === null ? null : manifestSchema.safeParse(JSON.parse(contents));
  return {
    version: parsed?.success === true ? parsed.data.version : '0.0.0-unstamped',
    sha: 'unknown',
    builtAt: new Date(0).toISOString(),
  };
}

/** This server's version, commit and build time. Resolved once, at import. */
export const SERVER_BUILD: BuildInfo = readStampFile() ?? readManifestFallback();
