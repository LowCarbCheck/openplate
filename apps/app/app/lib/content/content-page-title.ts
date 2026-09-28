/**
 * A content page's document `<title>`: the file's own title and the app name.
 *
 * The title comes from the file's front matter, in the file's language, so no
 * catalog key is needed per page. `null` is a page that did not load, which
 * only a meta function that runs beside an error can see; it reads as the
 * app name alone.
 */
export function contentPageTitle(title: string | null): string {
  return title === null ? 'openplate' : `${title} · openplate`;
}
