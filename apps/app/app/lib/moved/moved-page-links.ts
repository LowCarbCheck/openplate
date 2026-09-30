/**
 * The `<link>` tags the moved page borrows from the app: its stylesheets, its font preload and
 * its icons, read out of the React Router server build.
 *
 * ── Why read the build ───────────────────────────────────────────────────
 *
 * The moved page is drawn in the app's own tokens (DESIGN.md §2) and its own fonts, so it links
 * the stylesheets the app's pages link, and those carry a content hash that changes with every
 * build. The server build already knows both lists: `assets.routes.root.css` (the CSS the root
 * route imports, the font faces) and the root module's `links()` (the Tailwind sheet, the preload
 * of the one font file every page needs, the icons). React Router's own `<Links />` renders those
 * two, in that order (`getKeyedLinksForMatches`), and so does this. The web app manifest is left
 * out on purpose: the moved page is not something to install, and a browser that has the app
 * installed keeps the manifest it has.
 */
import type { LinkDescriptor } from 'react-router';

/** One `<link>` the page renders. */
export interface MovedPageLink {
  readonly rel: string;
  readonly href: string;
  readonly as?: string;
  readonly type?: string;
  readonly sizes?: string;
  readonly crossOrigin?: 'anonymous' | 'use-credentials';
}

/**
 * The two parts of a React Router server build this reads, and nothing else of it. A
 * `ServerBuild` is one, which the typecheck of `moved-mode.server.ts` holds; a test fakes one in
 * a few lines.
 */
export interface RootLinkSource {
  /** The client manifest: `css` is what the route's module imports as stylesheets. */
  readonly assets: { readonly routes: Readonly<Record<string, { readonly css?: readonly string[] } | undefined>> };
  /** The server route modules: `links` is the route's own `links` export. */
  readonly routes: Readonly<Record<string, { readonly module: { readonly links?: () => LinkDescriptor[] } } | undefined>>;
}

/** The id React Router gives the root route in every build. */
const ROOT_ROUTE_ID = 'root';

/** The one link the page never renders: see the module doc. */
const MANIFEST_REL = 'manifest';

/** A root module link as a tag here, or `null` for a page prefetch, a link with no address, or the manifest. */
function toMovedPageLink(descriptor: LinkDescriptor): MovedPageLink | null {
  if (!('rel' in descriptor) || descriptor.rel === undefined || descriptor.rel === MANIFEST_REL) return null;
  if (!('href' in descriptor) || descriptor.href === undefined) return null;
  return {
    rel: descriptor.rel,
    href: descriptor.href,
    as: descriptor.as,
    type: descriptor.type,
    sizes: descriptor.sizes,
    crossOrigin: descriptor.crossOrigin,
  };
}

/**
 * Reads the root route's links out of a React Router server build.
 *
 * @param build - the server build `server.ts` hands React Router.
 * @returns the stylesheets first, then the root module's own links, without the manifest.
 * @throws when the build has no root route, which no React Router build lacks.
 */
export function readMovedPageLinks(build: RootLinkSource): MovedPageLink[] {
  const entry = build.assets.routes[ROOT_ROUTE_ID];
  const route = build.routes[ROOT_ROUTE_ID];
  if (entry === undefined || route === undefined) {
    throw new Error('The server build has no root route, so the moved page has no stylesheet to link.');
  }
  const stylesheets = (entry.css ?? []).map((href) => ({ rel: 'stylesheet', href }));
  const declared = (route.module.links?.() ?? []).flatMap((descriptor) => {
    const link = toMovedPageLink(descriptor);
    return link === null ? [] : [link];
  });
  return [...stylesheets, ...declared];
}
