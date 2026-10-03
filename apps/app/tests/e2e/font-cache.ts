/**
 * Wipes and recreates this tier's fontconfig cache before anything else runs.
 *
 * WHY. Chromium writes fontconfig's cache to disk as it resolves the first
 * page's fonts. Twice, the harness killed a gate run for low memory WHILE
 * Chromium was mid-write, and left a truncated cache entry behind (112 and
 * 256 bytes seen). Fontconfig trusts a cache file it can open, so the next
 * run read the truncated entry, failed to initialise, and every spec died
 * with `FATAL:...SkFontMgr_FontConfigInterface.cpp:163 Not implemented.` -- a
 * crash with no connection to whatever the next run actually changed. A
 * killed run must not poison the one after it, so this deletes the directory
 * and recreates it empty before the first page opens. See `fonts.conf` for
 * the measured cost of rebuilding it.
 *
 * THE NAME IS HELD HERE, in ONE place. `fonts.conf`'s own
 * `<cachedir prefix="xdg">` element cannot import a TypeScript constant --
 * the two have to be kept in sync by hand, and this is the only other file
 * allowed to know the string.
 *
 * ── One directory per shard ──────────────────────────────────────────────
 *
 * A sharded run (`scripts/e2e-sharded.sh`) starts several Playwright
 * processes of one checkout, and EACH of them runs `resetFontconfigCache` in
 * its own `globalSetup`. With one shared directory the second shard to start
 * deleted the cache the first was already writing into, which is the
 * truncated-cache crash above produced on purpose, by a sibling, in the
 * middle of a run.
 *
 * So a shard takes a directory name of its own and a fonts.conf that names
 * it. `fonts.conf` stays the committed file and the one that is READ, but its
 * `<cachedir>` line cannot depend on an environment variable, so a shard gets
 * a COPY with that one element rewritten, written to the temp directory under
 * a name made from the copy's own bytes (`writeFontsConfFor`). The rewrite
 * REFUSES a template that no longer holds the element, so renaming the
 * directory in `fonts.conf` alone, without this file, fails the first sharded
 * run instead of quietly sharing a cache.
 *
 * The directory name also carries a hash of the checkout's path, because the
 * name was never unique across checkouts either: two trees running this tier
 * at once wiped each other's cache the same way. ADR-0017 called that safe
 * because a cache rebuilds itself when it is missing; it does, but not while
 * somebody is writing into it. A run that is not sharded keeps the old name,
 * so nothing changes for it.
 *
 * ── Extra font directories (NixOS) ───────────────────────────────────────
 *
 * On NixOS none of the directories `fonts.conf` lists hold fonts, so Chromium
 * has none and every text box is 0 px tall. The flake's dev shell therefore
 * exports `OPENPLATE_E2E_FONT_DIRS`, a colon-separated list of directories,
 * and when it is set the config a run reads is a generated COPY of
 * `fonts.conf` with one `<dir>` per entry added (`addFontDirs`). This holds
 * for a run that is not sharded too. When the variable is unset or empty, the
 * committed file is read unchanged, so Fedora behaves as before.
 *
 * `XDG_CACHE_HOME` is deliberately NOT how the directory is separated: a
 * Playwright on Linux finds its browsers under `$XDG_CACHE_HOME/ms-playwright`,
 * so moving that variable per shard would send every shard looking for
 * Chromium in an empty folder.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalRepoRoot } from './env';
import { E2E_SHARD_VAR, parseShardNumber } from './shard';

/** Must match the literal inside `<cachedir prefix="xdg">` in `fonts.conf`. */
const CACHE_DIR_NAME = 'openplate-e2e-fontconfig';

/** The one element in `fonts.conf` that names the cache, spelled the way that file spells it. */
const CACHE_ELEMENT = `<cachedir prefix="xdg">${CACHE_DIR_NAME}</cachedir>`;

/** The environment variable that carries extra font directories, colon separated. The flake sets it. */
export const FONT_DIRS_VAR = 'OPENPLATE_E2E_FONT_DIRS';

/** The closing tag the extra `<dir>` elements are placed in front of. */
const FONTCONFIG_CLOSE = '</fontconfig>';

/** This tier's own fontconfig, the one `playwright.config.ts` points at. */
const FONTS_CONF_PATH = fileURLToPath(new URL('./fonts.conf', import.meta.url));

/** The temp folder the per-shard copies of `fonts.conf` are written to. */
const SHARD_CONF_DIR = join(tmpdir(), CACHE_DIR_NAME);

/** How many hex characters of a digest a file or directory name carries. */
const NAME_HASH_LENGTH = 10;

/** The first characters of a sha256 of `text`, for a name that has to be stable and short. */
function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, NAME_HASH_LENGTH);
}

/**
 * The cache directory's name for one run.
 *
 * Not sharded: the name `fonts.conf` carries. Sharded: that name, a hash of the checkout's real
 * path, and the shard's number, so no two shards and no two checkouts share a directory.
 *
 * @param options.shard - the shard's number, or `null` when the run is not sharded.
 * @param options.repoRoot - the checkout's root. Hashed as written, so a caller passes the
 *   `realpath` one (`canonicalRepoRoot`), like the port derivation hashes it.
 */
export function fontconfigCacheDirName(options: { shard: number | null; repoRoot: string }): string {
  if (options.shard === null) return CACHE_DIR_NAME;
  return `${CACHE_DIR_NAME}-${shortHash(resolve(options.repoRoot))}-s${options.shard}`;
}

/**
 * `fonts.conf` with its cache directory renamed. Pure: the template goes in, the copy comes out.
 *
 * @param options.template - the text of `fonts.conf`.
 * @param options.cacheDirName - the directory name the copy should name.
 * @throws when the template does not hold the cache element exactly once, which means this file
 *   and `fonts.conf` have drifted apart.
 */
export function renameFontsConfCache(options: { template: string; cacheDirName: string }): string {
  const parts = options.template.split(CACHE_ELEMENT);
  if (parts.length !== 2) {
    throw new Error(
      `fonts.conf does not hold exactly one ${CACHE_ELEMENT}: font-cache.ts and fonts.conf have to name the ` +
        'same directory, and a shard cannot get a cache of its own until they do.',
    );
  }
  return parts.join(`<cachedir prefix="xdg">${options.cacheDirName}</cachedir>`);
}

/**
 * The directories a colon-separated list names. Empty entries are dropped, so a trailing colon or
 * an unset variable adds nothing.
 *
 * @param value - the raw variable, or `undefined`.
 */
export function parseFontDirs(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(':').filter((entry) => entry.trim() !== '');
}

/** The text of an XML attribute-free element body, with the characters XML reserves escaped. */
function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * `fonts.conf` with one `<dir>` element per directory, placed before the closing tag. Pure. With no
 * directories the template comes back byte for byte.
 *
 * @param options.template - the text of `fonts.conf`.
 * @param options.dirs - the directories to add.
 * @throws when there are directories to add and the template does not hold the closing
 *   `</fontconfig>` exactly once.
 */
export function addFontDirs(options: { template: string; dirs: readonly string[] }): string {
  if (options.dirs.length === 0) return options.template;
  const parts = options.template.split(FONTCONFIG_CLOSE);
  if (parts.length !== 2) {
    throw new Error(
      `fonts.conf does not hold exactly one ${FONTCONFIG_CLOSE}, so ${FONT_DIRS_VAR} cannot be added to it.`,
    );
  }
  const elements = options.dirs.map((dir) => `  <dir>${escapeXml(dir)}</dir>\n`).join('');
  return `${parts[0]}${elements}${FONTCONFIG_CLOSE}${parts[1]}`;
}

/** The root this file belongs to, symlinks resolved: `tests/e2e/` sits two directories below it. */
function repoRootOfThisCheckout(): string {
  return canonicalRepoRoot(fileURLToPath(new URL('../../', import.meta.url)));
}

/** The text of the `fonts.conf` a run reads, when it is not the committed file as it is. */
function generatedFontsConfText(shard: number | null): string {
  const template = readFileSync(FONTS_CONF_PATH, 'utf8');
  const named =
    shard === null ? template : (
      renameFontsConfCache({
        template,
        cacheDirName: fontconfigCacheDirName({ shard, repoRoot: repoRootOfThisCheckout() }),
      })
    );
  return addFontDirs({ template: named, dirs: parseFontDirs(process.env[FONT_DIRS_VAR]) });
}

/** Whether a run reads the committed file itself: not sharded and no extra font directories. */
function readsCommittedFile(shard: number | null): boolean {
  return shard === null && parseFontDirs(process.env[FONT_DIRS_VAR]).length === 0;
}

/**
 * Where the fonts.conf for a run lives, WITHOUT writing it: this tier's own file when the run is
 * not sharded and `OPENPLATE_E2E_FONT_DIRS` is unset, a copy named after its own bytes otherwise.
 *
 * @param shard - the shard's number, or `null`.
 */
export function fontsConfPathFor(shard: number | null): string {
  if (readsCommittedFile(shard)) return FONTS_CONF_PATH;
  return join(SHARD_CONF_DIR, `fonts-${shortHash(generatedFontsConfText(shard))}.conf`);
}

/**
 * Makes sure the fonts.conf for a run exists and returns its path.
 *
 * Called at `playwright.config.ts` module load, which the runner AND every worker evaluate, so
 * several processes of one shard may write at once. They all write the same bytes to the same
 * name, and each writes to a name of its own first and renames it into place, so a reader never
 * sees half a file.
 *
 * @param shard - the shard's number, or `null`.
 */
export function writeFontsConfFor(shard: number | null): string {
  if (readsCommittedFile(shard)) return FONTS_CONF_PATH;
  const target = fontsConfPathFor(shard);
  mkdirSync(SHARD_CONF_DIR, { recursive: true });
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, generatedFontsConfText(shard));
  renameSync(staging, target);
  return target;
}

/**
 * Resolves the cache directory the same way fontconfig's
 * `<cachedir prefix="xdg">` does: `$XDG_CACHE_HOME` if set, else `~/.cache`,
 * joined with the run's own directory name.
 */
function resolveFontconfigCacheDir(shard: number | null): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(base, fontconfigCacheDirName({ shard, repoRoot: repoRootOfThisCheckout() }));
}

/**
 * Deletes and recreates this run's fontconfig cache, empty.
 *
 * Only acts when `FONTCONFIG_FILE` still points at THIS run's config.
 * `playwright.config.ts` sets it with `??=`, so a person who exported their
 * own value before running kept the last word there, and this function
 * leaves their cache untouched too. It never touches the host's own
 * `~/.cache/fontconfig`, which belongs to a different config entirely.
 *
 * The run is sharded when `OPENPLATE_E2E_SHARD` names a shard, and then both
 * the config it expects and the directory it wipes are that shard's own.
 */
export async function resetFontconfigCache(): Promise<void> {
  const shard = parseShardNumber(process.env[E2E_SHARD_VAR]);
  if (process.env.FONTCONFIG_FILE !== fontsConfPathFor(shard)) return;

  const dir = resolveFontconfigCacheDir(shard);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}
