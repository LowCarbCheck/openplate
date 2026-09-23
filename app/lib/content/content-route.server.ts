/**
 * What every content route's loader does, in one place: read the page for
 * this request's language, and turn the two ways it can be missing into the
 * two statuses a reader and an operator can tell apart.
 *
 * - No file (or no `CONTENT_DIR` at all): 404, the ordinary "not here".
 * - A file that breaks the contract: 503. The file was logged with every
 *   problem and its line when it was read (`content.server.ts`); the reader
 *   sees the app's neutral error page and never a half-rendered legal text.
 *   503 rather than 500 because the app is fine and the mounted file is what
 *   an operator has to fix.
 */
import { data } from 'react-router';

import { CONFIG } from '#app/config';
import { resolveRequestLanguage } from '#app/i18n/language-prefs';
import { CONTENT_READER, type ContentPage, type ContentReader, type ContentSlug } from './content.server';
import { ContentRefusedError } from './markdown';

/** The status a refused content file answers with. */
export const REFUSED_CONTENT_STATUS = 503;

/**
 * The page for this request, or a thrown 404 or 503 response.
 *
 * @param input.request - the loader's request; its language cookie picks the file.
 * @param input.slug - the page, always a literal from the route.
 * @param input.reader - the folder to read, the instance's own unless a test passes one.
 */
export async function loadContentPageOrThrow(input: {
  request: Request;
  slug: ContentSlug;
  reader?: ContentReader;
}): Promise<ContentPage> {
  const reader = input.reader ?? CONTENT_READER;
  const language = resolveRequestLanguage(input.request.headers.get('cookie'), CONFIG.i18n.defaultLanguage);
  let page: ContentPage | null;
  try {
    page = await reader.loadPage({ slug: input.slug, language });
  } catch (error) {
    if (error instanceof ContentRefusedError) throw data(null, { status: REFUSED_CONTENT_STATUS });
    throw error;
  }
  if (page === null) throw data(null, { status: 404 });
  return page;
}

/**
 * Whether this instance shows legal pages at all: the imprint exists in the
 * request's language or in English.
 *
 * ONE BOOLEAN on the root loader, read by every surface that links to a legal
 * page (the public footer, the stranger note, the newsletter's privacy line),
 * so an instance with no `CONTENT_DIR` draws no link to a page that 404s.
 * The imprint is the probe because German law wants it on every instance that
 * has any of the others.
 */
export async function hasLegalPages(input: { request: Request; reader?: ContentReader }): Promise<boolean> {
  const reader = input.reader ?? CONTENT_READER;
  const language = resolveRequestLanguage(input.request.headers.get('cookie'), CONFIG.i18n.defaultLanguage);
  return reader.hasPage({ slug: 'imprint', language });
}
