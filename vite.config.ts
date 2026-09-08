import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { z } from 'zod';

/**
 * ── THE BUILD STAMP (M203) ────────────────────────────────────────────────
 *
 * One object, computed once here, delivered two ways:
 *
 *  1. `define` replaces `__OPENPLATE_BUILD__` in the browser and SSR bundles,
 *     so `app/lib/build-info.ts` reads a literal with no runtime lookup. See
 *     `types/build-info.d.ts` for why it is a bare identifier.
 *  2. `build/build-info.json`, written once when a bundle closes, so the Express
 *     entrypoint can read the SAME numbers. `pnpm start` runs `tsx ./server.ts`
 *     directly, outside Vite, so no `define` ever reaches it; a file on disk
 *     next to the bundle it describes is the smallest thing that works for
 *     `pnpm build` then `pnpm start`, and it needs no git in the image.
 *
 * "The same object" is load-bearing and was not free. `react-router build` runs
 * a client pass and an SSR pass and re-evaluates this file for each, in one
 * process, so computing the stamp here gave the bundles one `builtAt` and the
 * JSON another 300 ms later. `buildStamp` parks the first pass's answer on
 * `globalThis` and the second pass reuses it. The same object carries the
 * write-once flag, since `closeBundle` also fires per pass.
 *
 * The sha is the one value that is not free. `.git` is excluded by
 * `.dockerignore` and the alpine images carry no git binary, so inside a
 * container `git rev-parse` cannot answer. `OPENPLATE_BUILD_SHA` is the
 * override the Dockerfiles take as a build argument and the release workflow
 * fills from `github.sha`. Local builds fall back to git, and a build with
 * neither says `unknown` rather than guessing.
 */

/** The one field of `package.json` this file needs. */
const manifestSchema = z.object({ version: z.string() });

/** `package.json`'s `version`, parsed rather than asserted. */
function packageVersion(): string {
  const manifest = manifestSchema.safeParse(
    JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')),
  );
  return manifest.success ? manifest.data.version : '0.0.0';
}

/** The short commit sha of the working tree, or null when git cannot answer. */
function gitShortSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // No git binary, or not a repository. Both are ordinary inside an image.
    return null;
  }
}

/**
 * The one stamp this build uses, computed on the first pass and reused by the
 * second. See `types/build-info.d.ts` for why it lives on `globalThis`.
 */
function buildStamp(buildShaOverride: string | undefined): OpenplateBuildStamp {
  const existing = globalThis.__openplateBuildStamp;
  if (existing !== undefined) return existing;

  const override = buildShaOverride?.trim();
  const stamp: OpenplateBuildStamp = {
    build: {
      version: packageVersion(),
      sha: override === undefined || override === '' ? (gitShortSha() ?? 'unknown') : override.slice(0, 7),
      builtAt: new Date().toISOString(),
    },
    hasWrittenFile: false,
  };
  globalThis.__openplateBuildStamp = stamp;
  return stamp;
}

/** Writes the stamp beside the bundle, once per build, for the Express entrypoint to read. */
function buildInfoFilePlugin(stamp: OpenplateBuildStamp): Plugin {
  return {
    name: 'openplate-build-info-file',
    // `closeBundle` fires for the client pass and again for the SSR pass. Both
    // would write identical bytes now that the stamp is shared, but writing once
    // says so: a second write would be the only place left that could disagree.
    closeBundle() {
      if (stamp.hasWrittenFile) return;
      stamp.hasWrittenFile = true;
      const directory = resolve(import.meta.dirname, 'build');
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, 'build-info.json'), `${JSON.stringify(stamp.build, null, 2)}\n`, 'utf8');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = env.PORT ? parseInt(env.PORT, 10) : 3000;

  // `loadEnv` with an empty prefix already merges `process.env`, so the
  // Dockerfiles' build argument arrives here without a second env read.
  const stamp = buildStamp(env.OPENPLATE_BUILD_SHA);

  return {
    plugins: [tailwindcss(), reactRouter(), buildInfoFilePlugin(stamp)],
    define: {
      __OPENPLATE_BUILD__: JSON.stringify(stamp.build),
    },
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      port: serverPort,
      // Dev-only: allow access via the machine hostname / tailnet MagicDNS name
      // (Vite blocks non-IP hosts by default). Override with VITE_ALLOWED_HOSTS
      // (comma-separated) for other setups.
      allowedHosts:
        env.VITE_ALLOWED_HOSTS ? env.VITE_ALLOWED_HOSTS.split(',') : ['bluefin', '.sprqvntrs.tailnet.internal'],
    },
    optimizeDeps: {
      // Dev-only QoL fix: the first navigation to a route using a
      // not-yet-discovered Radix primitive (e.g. Select, AlertDialog — not on
      // the app's first-loaded routes) triggers Vite's dependency optimizer to
      // discover it lazily mid-session, re-bundle, and reload — which can land
      // React with "more than one copy" errors if that reload races a render
      // in flight. Pre-bundling every Radix primitive this app actually uses
      // (see `app/components/ui/*.tsx`) up front avoids the lazy-discovery
      // reload entirely. Keep this list in sync with new `@radix-ui/react-*`
      // imports as they're added.
      include: [
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-avatar',
        '@radix-ui/react-collapsible',
        '@radix-ui/react-dialog',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-label',
        '@radix-ui/react-select',
        '@radix-ui/react-separator',
        '@radix-ui/react-slot',
        '@radix-ui/react-switch',
        '@radix-ui/react-tooltip',
        // Same lazy-discovery hazard as the Radix primitives above, but for the
        // local-first primary store (M117/01): `tinybase` and its IndexedDB
        // persister aren't on every first-loaded route (e.g. a cold landing on
        // the marketing page), so the optimizer can discover them mid-session on
        // the first navigation into a local-store-backed route and trigger the
        // same re-bundle-and-reload race.
        'tinybase',
        'tinybase/persisters/persister-indexed-db',
        // Same lazy-discovery hazard again, for the i18n stack (M129/05):
        // `react-i18next` pulls in React, so a mid-session re-bundle of it is
        // exactly the "more than one copy of React" crash this list exists to
        // prevent.
        'i18next',
        'react-i18next',
        'i18next-browser-languagedetector',
        // Same hazard once more, for the sync engine's Argon2id (M128 spec
        // 04). `hash-wasm` is reached only from `/settings/sync` and from the
        // Argon2id Worker — never on a first load — so without this entry the
        // optimizer discovers it mid-session on the first navigation into
        // sync and triggers the re-bundle-and-reload race. The Worker makes it
        // worse than the others: a reload mid-derivation drops the derivation.
        // (`engine/crypto/argon2.ts`'s header records this requirement.)
        'hash-wasm',
      ],
    },
  };
});
