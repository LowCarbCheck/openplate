/**
 * What counts as a link to our own sites, and what its slashless form is.
 *
 * openplate.de names the page address WITHOUT a trailing slash (canonical link, hreflang and
 * sitemap), and nginx answers a slash address with a 301. A link that ends its path in a slash
 * therefore costs a hop and names an address that is not canonical. The one home page that keeps
 * its slash is the German one, `https://openplate.de/`: the bare origin plus `/`.
 *
 * To add a host, add it to {@link OWN_SITE_HOSTS}.
 */
export const OWN_SITE_HOSTS: ReadonlySet<string> = new Set([
  'openplate.de',
  'www.openplate.de',
  'app.openplate.de',
  'api.openplate.de',
]);

/** Stands in for a template expression in the text a message shows. */
const EXPRESSION_MARK = '${...}';

const ABSOLUTE_URL = /^https?:\/\/([^/?#]*)([^?#]*)/iu;

/** Where a link may start, which depends on the place it was found in. */
export type LinkScope = 'own-site-url' | 'own-site-url-or-path';

export interface TrailingSlashFinding {
  /** The link as written, with `${...}` where a template has an expression. */
  readonly written: string;
  /** The same link with its path slashless. */
  readonly fixed: string;
}

function isOwnSiteUrl(text: string): boolean {
  const match = ABSOLUTE_URL.exec(text);
  return match !== null && OWN_SITE_HOSTS.has((match[1] ?? '').toLowerCase());
}

function isRootRelativePath(text: string): boolean {
  return text.startsWith('/') && !text.startsWith('//');
}

/** A path of more than the bare `/` that ends in a slash. */
function endsInSlash(path: string): boolean {
  return path.length > 1 && path.endsWith('/');
}

/** Drops the trailing slashes of a path, keeping a lone `/` when nothing else is left. */
function withoutTrailingSlash(path: string): string {
  const stripped = path.replace(/\/+$/u, '');
  return stripped === '' ? '/' : stripped;
}

function findInStaticText(text: string, scope: LinkScope): TrailingSlashFinding | null {
  const queryStart = text.search(/[?#]/u);
  const beforeQuery = queryStart === -1 ? text : text.slice(0, queryStart);
  const afterPath = queryStart === -1 ? '' : text.slice(queryStart);

  const absolute = ABSOLUTE_URL.exec(beforeQuery);
  if (absolute !== null) {
    if (!isOwnSiteUrl(beforeQuery)) return null;
    const origin = beforeQuery.slice(0, beforeQuery.length - (absolute[2] ?? '').length);
    const path = absolute[2] ?? '';
    if (!endsInSlash(path)) return null;
    return { written: text, fixed: `${origin}${withoutTrailingSlash(path)}${afterPath}` };
  }

  if (scope !== 'own-site-url-or-path') return null;
  if (!isRootRelativePath(beforeQuery) || !endsInSlash(beforeQuery)) return null;
  return { written: text, fixed: `${withoutTrailingSlash(beforeQuery)}${afterPath}` };
}

function startsWithOwnSite(first: string, scope: LinkScope, startsWithSiteExpression: boolean): boolean {
  if (isOwnSiteUrl(first)) return true;
  if (scope !== 'own-site-url-or-path') return false;
  if (first === '') return startsWithSiteExpression;
  return isRootRelativePath(first);
}

function findInTemplate(
  quasis: readonly string[],
  scope: LinkScope,
  startsWithSiteExpression: boolean,
): TrailingSlashFinding | null {
  const first = quasis[0] ?? '';
  const last = quasis.at(-1) ?? '';

  // A query or a fragment before the end means the final slash is not part of the path.
  if (quasis.some((quasi) => /[?#]/u.test(quasi))) return null;
  // The slash must follow a real character of the last piece, so `${origin}/` stays a home link.
  if (last.length < 2 || !last.endsWith('/') || last.endsWith('//')) return null;
  if (!startsWithOwnSite(first, scope, startsWithSiteExpression)) return null;

  const written = quasis.join(EXPRESSION_MARK);
  return { written, fixed: written.slice(0, -1) };
}

/**
 * Finds a trailing slash in the path of a link to one of our own sites.
 *
 * @param quasis - the static text of a link, one piece per template quasi. A plain string is one piece.
 * @param scope - `own-site-url` takes absolute URLs on our hosts only. `own-site-url-or-path` also takes
 * root-relative paths, and a template that begins with a site expression.
 * @param startsWithSiteExpression - true when a template begins with an expression named for our site,
 * such as `PROJECT_SITE_URL`. A template that begins with any other expression has an origin the rule
 * cannot know, a loopback stub for example, so it is left alone.
 * @returns the finding, or null when the link is fine or is not ours.
 */
export function findTrailingSlash(options: {
  readonly quasis: readonly string[];
  readonly scope: LinkScope;
  readonly startsWithSiteExpression: boolean;
}): TrailingSlashFinding | null {
  const { quasis, scope, startsWithSiteExpression } = options;
  if (quasis.length === 1) return findInStaticText(quasis[0] ?? '', scope);
  return findInTemplate(quasis, scope, startsWithSiteExpression);
}

/** Whether the name of a leading template expression says it is our site, as `PROJECT_SITE_URL` does. */
export function isSiteExpressionName(name: string | null): boolean {
  return name !== null && /site/iu.test(name);
}
