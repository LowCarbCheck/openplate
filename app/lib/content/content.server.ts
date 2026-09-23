/**
 * The mounted content folder: `<CONTENT_DIR>/<lang>/<slug>.md` (M246 spec 01).
 *
 * The legal pages of an instance are not in this repository. An operator
 * mounts a folder of markdown files, read-only, and this module reads a page
 * from it on the server, in the route's loader. `docs/content.md` is the
 * self-hoster's guide to the folder; `markdown.ts` beside this file is the
 * parser that holds each file to the format.
 *
 * ── UNSET MEANS NONE ──
 * With `CONTENT_DIR` unset every page is absent: each content route answers
 * 404 and the root loader reports `hasLegalPages: false`, so no footer or
 * notice links to a page that is not there. That is the right default for a
 * self-hoster who sells nothing and runs the app for their household.
 *
 * ── A PATH IS NEVER BUILT FROM A REQUEST ──
 * The slug comes from an allow list and the language from the app's own list,
 * and both are checked here at run time as well as in the types, so no value a
 * URL carries can name a file. The resolved path is also checked to sit inside
 * the folder, which is the second lock on the same door.
 *
 * ── CACHED, AND AN EDIT SHOWS WITHOUT A RESTART ──
 * Each read stats the file and reuses the parsed page while its modification
 * time and size are unchanged. A changed file is parsed again on the next
 * request. A refused file is cached with its stat too, so its error is logged
 * once per version of the file rather than on every request.
 */
import { stat, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isLanguageCode, type LanguageCode } from '#app/i18n/language-prefs';
import { createComponentLogger, type Logger } from '#app/lib/logger';
import { ContentRefusedError, parseContentDocument, type ContentDocument } from './markdown';

/** Every page the app routes (CONTRACT.md section 5). A slug not listed here is never read. */
export const CONTENT_SLUGS = [
  'terms',
  'privacy',
  'imprint',
  'withdrawal',
  'kuendigung',
  'kuendigung-bestaetigt',
  'widerrufen',
  'widerrufen-bestaetigt',
  'privacy-website',
] as const;

export type ContentSlug = (typeof CONTENT_SLUGS)[number];

/** The named sections each slug must carry (CONTRACT.md section 4). A slug not listed carries none. */
const SECTIONS_BY_SLUG = {
  terms: [],
  privacy: [],
  imprint: [],
  withdrawal: [],
  kuendigung: ['unavailable'],
  'kuendigung-bestaetigt': ['mail-notice'],
  widerrufen: ['unavailable'],
  'widerrufen-bestaetigt': ['mail-notice'],
  'privacy-website': [],
} as const satisfies Record<ContentSlug, readonly string[]>;

/** One allow-listed read: a slug of this app and a language of this app. */
interface ContentRequest {
  slug: ContentSlug;
  language: LanguageCode;
}

/** A page as a route receives it: the parsed file, and the language of the file that was actually served. */
export interface ContentPage extends ContentDocument {
  slug: ContentSlug;
  /** The file's language, which is English when the reader's language had no file. */
  language: LanguageCode;
}

export interface ContentReader {
  /**
   * The page in `language`, else in English, else `null`.
   *
   * @throws `ContentRefusedError` when the file that would be served breaks the
   * contract. It is not replaced by the English file: a broken legal page is a
   * failure to report, not a gap to paper over.
   * @throws an `Error` for a slug or a language that is not on the allow list.
   */
  loadPage: (input: { slug: string; language: string }) => Promise<ContentPage | null>;
  /** Whether a file for the page exists in `language` or in English. Reads no content. */
  hasPage: (input: { slug: string; language: string }) => Promise<boolean>;
}

type CachedOutcome = { isRefused: false; document: ContentDocument } | { isRefused: true; error: ContentRefusedError };

interface CacheEntry {
  mtimeMs: number;
  size: number;
  outcome: CachedOutcome;
}

function isContentSlug(value: string): value is ContentSlug {
  return CONTENT_SLUGS.some((slug) => slug === value);
}

/** The allow-listed pair, or a thrown `Error` naming the value that is not on the list. */
function checkedRequest(input: { slug: string; language: string }): ContentRequest {
  if (!isContentSlug(input.slug)) throw new Error(`"${input.slug}" is not a content page slug`);
  if (!isLanguageCode(input.language)) {
    throw new Error(`"${input.language}" is not one of ${SUPPORTED_LANGUAGES.join('/')}`);
  }
  return { slug: input.slug, language: input.language };
}

/** The languages to try, in order: the reader's own, then English. */
function candidateLanguages(language: LanguageCode): LanguageCode[] {
  return language === DEFAULT_LANGUAGE ? [language] : [language, DEFAULT_LANGUAGE];
}

/** A file's stat, or `null` when it is not there. Any other failure is thrown. */
async function statIfPresent(path: string): Promise<{ mtimeMs: number; size: number; isFile: boolean } | null> {
  try {
    const found = await stat(path);
    return { mtimeMs: found.mtimeMs, size: found.size, isFile: found.isFile() };
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
}

/** The path of one candidate file, proven to sit inside the folder. */
function pathOf(root: string, request: ContentRequest): string {
  const path = resolve(root, request.language, `${request.slug}.md`);
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot) || !path.startsWith(`${root}${sep}`)) {
    throw new Error(`the content path for "${request.slug}" left the content folder`);
  }
  return path;
}

/**
 * A reader over one folder, or over none.
 *
 * @param input.directory - an absolute folder, or `null` for "no content on this instance".
 * @param input.log - where a refused file is reported. Tests pass a recorder.
 */
export function createContentReader(input: { directory: string | null; log?: Logger }): ContentReader {
  const { directory } = input;
  const log = input.log ?? createComponentLogger('content');
  const cache = new Map<string, CacheEntry>();

  const readDocument = async (
    path: string,
    request: ContentRequest,
  ): Promise<ContentDocument | null> => {
    const found = await statIfPresent(path);
    if (found === null || !found.isFile) return null;
    const cached = cache.get(path);
    const isFresh = cached !== undefined && cached.mtimeMs === found.mtimeMs && cached.size === found.size;
    const outcome = isFresh ? cached.outcome : await parseFile(path, request.slug);
    if (!isFresh) {
      cache.set(path, { mtimeMs: found.mtimeMs, size: found.size, outcome });
      if (outcome.isRefused) {
        log.error('a content file breaks the contract and is not served', {
          file: `${request.language}/${request.slug}.md`,
          problems: outcome.error.problems.map((problem) =>
            problem.line === null ? problem.message : `line ${problem.line}: ${problem.message}`,
          ),
        });
      }
    }
    if (outcome.isRefused) throw outcome.error;
    return outcome.document;
  };

  return {
    async loadPage(raw) {
      const request = checkedRequest(raw);
      if (directory === null) return null;
      for (const language of candidateLanguages(request.language)) {
        const document = await readDocument(pathOf(directory, { slug: request.slug, language }), {
          slug: request.slug,
          language,
        });
        if (document !== null) return { ...document, slug: request.slug, language };
      }
      return null;
    },

    async hasPage(raw) {
      const request = checkedRequest(raw);
      if (directory === null) return false;
      for (const language of candidateLanguages(request.language)) {
        const found = await statIfPresent(pathOf(directory, { slug: request.slug, language }));
        if (found?.isFile === true) return true;
      }
      return false;
    },
  };
}

/** Reads and parses one file into a cacheable outcome; only a contract refusal is caught. */
async function parseFile(path: string, slug: ContentSlug): Promise<CachedOutcome> {
  const bytes = await readFile(path);
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { isRefused: false, document: parseContentDocument({ source, sections: SECTIONS_BY_SLUG[slug] }) };
  } catch (error) {
    if (error instanceof ContentRefusedError) return { isRefused: true, error };
    if (error instanceof TypeError) {
      return { isRefused: true, error: new ContentRefusedError([{ line: null, message: 'the file is not valid UTF-8' }]) };
    }
    throw error;
  }
}

/**
 * `CONTENT_DIR`, as an absolute folder, or `null` when unset.
 *
 * @throws an `Error` at boot when the value is set and names no folder. A
 * mount that failed, or a typo, must not look like an instance that simply
 * has no legal pages, because that instance would then serve none.
 */
export function parseContentDirectory(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return null;
  const directory = resolve(trimmed);
  let isDirectory = false;
  try {
    isDirectory = statSync(directory).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new Error(`CONTENT_DIR is set to ${JSON.stringify(raw)}, which is not a folder. Unset it for an instance with no content pages.`);
  }
  return directory;
}

/** The instance's reader, over `CONTENT_DIR`. Parsed once, at boot, like every other setting. */
export const CONTENT_READER: ContentReader = createContentReader({
  directory: parseContentDirectory(process.env.CONTENT_DIR),
});
