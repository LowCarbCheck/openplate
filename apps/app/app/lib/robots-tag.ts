/**
 * The site-wide "do not index this app" rule (release 0.10.2), as a pure value.
 *
 * ## Why every response, on every host
 *
 * From 0.10.2 the hosted app answers on `beta.openplate.de`, and `openplate.de`
 * becomes a separate marketing and documentation site. That site is the
 * canonical place a search engine should send a reader: it describes the
 * product, it is written to be read by somebody who does not have the app yet,
 * and it is the page that should rank.
 *
 * The app is the other thing. On the hosted instance it is a beta, and on a
 * self-hosted instance it is one person's private tool sitting on their own
 * domain. Neither wants a search result. So this rule is unconditional: it is
 * not gated on an environment, not gated on a hostname, and not configurable.
 * A self-hoster who puts openplate on their own domain gets a private
 * application with no setting to find and nothing to get wrong.
 *
 * ## Why a header AND a robots.txt
 *
 * They answer different questions and neither one is enough alone.
 *
 * `public/robots.txt` asks a crawler not to FETCH the pages. A crawler that
 * obeys it never requests a URL, so it never sees any header we send. But a
 * URL that is merely disallowed can still appear in results, listed from
 * inbound links alone, because "do not fetch" is not "do not list".
 *
 * `X-Robots-Tag` answers that second question, and it can only be read by a
 * crawler that DID fetch the page. So the header is what actually removes the
 * app from an index, and the robots.txt is what stops the crawl in the first
 * place. Both, or the rule leaks.
 *
 * A header rather than a `<meta name="robots">` tag because this app renders
 * on the server and also serves plain files, redirects and error responses,
 * and a meta tag only exists inside an HTML body. One header covers every
 * response this server can produce, whatever its content type.
 *
 * ## Why `nofollow` too
 *
 * `noindex` alone still invites a crawler to walk every link it finds, which
 * means crawling a signed-out application shell for no benefit to anybody. The
 * links worth following are on the project site, not in here.
 */

/** The response header that carries indexing directives to a crawler. */
const HEADER_NAME = 'X-Robots-Tag';

/**
 * The directives, in the order they are sent. `noindex` keeps the URL out of
 * results even when it was reached from a link, `nofollow` stops the crawl
 * spreading from it. See the module header for why both.
 */
const DIRECTIVES: readonly string[] = ['noindex', 'nofollow'];

/** A response header, as a name and the value to send with it. */
export interface RobotsTagHeader {
  readonly name: string;
  readonly value: string;
}

/**
 * Returns the indexing header every response carries.
 *
 * A function rather than an exported constant so the Express shell in
 * `robots-tag.server.ts` holds no literal of its own, and so the exact spelling
 * a crawler receives, header name and comma-separated directives alike, is
 * pinned by one test rather than by a string typed twice.
 */
export function robotsTagHeader(): RobotsTagHeader {
  return { name: HEADER_NAME, value: DIRECTIVES.join(', ') };
}
