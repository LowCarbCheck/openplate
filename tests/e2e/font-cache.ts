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
 */
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Must match the literal inside `<cachedir prefix="xdg">` in `fonts.conf`. */
const CACHE_DIR_NAME = 'openplate-e2e-fontconfig';

/** This tier's own fontconfig, the one `playwright.config.ts` points at. */
const FONTS_CONF_PATH = fileURLToPath(new URL('./fonts.conf', import.meta.url));

/**
 * Resolves the cache directory the same way fontconfig's
 * `<cachedir prefix="xdg">` does: `$XDG_CACHE_HOME` if set, else `~/.cache`,
 * joined with the tier's own directory name.
 */
function resolveFontconfigCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(base, CACHE_DIR_NAME);
}

/**
 * Deletes and recreates this tier's fontconfig cache, empty.
 *
 * Only acts when `FONTCONFIG_FILE` still points at THIS tier's config.
 * `playwright.config.ts` sets it with `??=`, so a person who exported their
 * own value before running kept the last word there, and this function
 * leaves their cache untouched too. It never touches the host's own
 * `~/.cache/fontconfig`, which belongs to a different config entirely.
 */
export async function resetFontconfigCache(): Promise<void> {
  if (process.env.FONTCONFIG_FILE !== FONTS_CONF_PATH) return;

  const dir = resolveFontconfigCacheDir();
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}
