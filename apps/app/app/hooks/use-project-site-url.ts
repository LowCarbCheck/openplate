/**
 * A page on the project site, in the language this app is drawn in (M266
 * design, step 2).
 *
 * openplate.de reads its language from the URL, German at the root and every
 * other language under its prefix, and the app reads it from the cookie. This
 * is the one place a component crosses from the second to the first, so every
 * app-to-site link lands on the page the reader can read.
 */
import { useReaderLanguage } from '#app/hooks/use-reader-language';
import { projectSiteUrl, type ProjectSitePath } from '#app/lib/brand';

/**
 * @param path - the canonical site path, for example `/` or a docs page with its trailing slash.
 * @returns the absolute URL in the reader's language.
 */
export function useProjectSiteUrl(path: ProjectSitePath): string {
  return projectSiteUrl(useReaderLanguage(), path);
}
