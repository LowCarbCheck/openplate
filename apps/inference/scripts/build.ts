/**
 * Build script — bundles `src/main.ts` into a single ESM `dist/server.js` via
 * esbuild. That file is what `pnpm start` and the container image run.
 *
 * WHY BUNDLE: the runtime image carries one file plus two externals rather than a
 * `node_modules` tree a self-hoster has to trust and scan, and the artifact is
 * reproducible from one command.
 *
 * WHY THESE THREE ARE EXTERNAL:
 *  - `sharp` loads a native libvips binary at runtime. Bundling it cannot work.
 *  - `express` relies on `instanceof` in a few internals, so a second bundled
 *    copy misbehaves in ways that are extremely unfun to debug.
 *  - `undici` is CommonJS and `require()`s its node builtins lazily. Inlined into
 *    an ESM bundle it produces exactly the dynamic-require shim asserted against
 *    below — VERIFIED 2026-08-16: the bundled copy throws
 *    `Dynamic require of "node:assert" is not supported` on its first line.
 *
 * WHY `undici` IS PINNED EXACT (`"8.10.0"`, no caret, unlike every other dep):
 * we do not merely call it, we depend on the SEMANTICS of two of its timeouts —
 * that `headersTimeout: 0` disables the timer rather than expiring immediately,
 * that `bodyTimeout` surfaces in body consumption rather than at the `fetch`
 * call, and that the timer wheel has ~1 s granularity. All three were measured
 * on 8.10.0 (see `src/pipeline/runtime-client.ts`), none is a documented API
 * guarantee, and a caret range would let a patch bump change any of them
 * silently. package.json cannot carry a comment, so the reason lives here:
 * KEEP THE PIN, and re-measure before raising it.
 *
 * `zod` is pure ESM and is bundled.
 */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/**
 * esbuild's shim for a CommonJS `require()` it could not resolve at build time.
 * Its presence means some inlined dependency throws on its first line at runtime
 * — a build that succeeds and an artifact that cannot start.
 *
 * This check exists because that failure is invisible to everything else:
 * typecheck passes, the test suites pass (they run TypeScript sources, never
 * `dist/`), and esbuild reports success. It cost openplate-sync a debugging
 * session — an inlined CJS `dotenv` calling `require('fs')` at load time — and
 * the grep costs a millisecond.
 *
 * If it fires, add the offending package to `external` below.
 */
const DYNAMIC_REQUIRE_SHIM = 'Dynamic require of';

async function assertBundleHasNoDynamicRequire(outfile: string): Promise<void> {
  const bundle = await readFile(outfile, 'utf8');
  if (!bundle.includes(DYNAMIC_REQUIRE_SHIM)) return;
  throw new Error(
    `dist/server.js contains esbuild's dynamic-require shim, so it will throw on startup. ` +
      `A CommonJS dependency was inlined into the ESM bundle — add it to \`external\` in scripts/build.ts.`,
  );
}

async function main(): Promise<void> {
  const outfile = resolve(repoRoot, 'dist/server.js');
  await build({
    entryPoints: [resolve(repoRoot, 'src/main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['express', 'sharp', 'undici'],
    sourcemap: true,
    logLevel: 'info',
  });
  await assertBundleHasNoDynamicRequire(outfile);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
