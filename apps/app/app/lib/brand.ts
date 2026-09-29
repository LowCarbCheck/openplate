import type { LanguageCode } from '#app/i18n/language-prefs';

/**
 * The product name, in one place. Used in PWA copy (install card, manifest
 * title metas) so the app-side wording stays consistent and renameable from a
 * single constant.
 */
export const APP_NAME = 'openplate';

/**
 * The source repository, in ONE place (M146 spec 01).
 *
 * A CONSTANT, deliberately — not an environment variable. An env var would
 * imply the operator is expected to set it, and the honest default for a fork
 * of an MIT project is that the upstream link stays until the forker changes
 * it. Someone running their own copy edits this line; nothing else in `app/`
 * carries the URL, so that edit is complete by construction.
 *
 * `tests/unit/brand.test.ts` pins "exactly one literal", so a second
 * hand-written `github.com/...` in a component fails the local gate.
 */
export const REPO_URL = 'https://github.com/LowCarbCheck/openplate';

/**
 * The licence file in that repository. Derived from {@link REPO_URL} rather
 * than written out, so a fork inherits it from the one edit above.
 *
 * openplate is MIT (see the repo's `LICENSE` and AGENTS.md, "Licensing").
 */
export const REPO_LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/**
 * The project site, in ONE place (M266 design, step 2, owner decision 10).
 *
 * openplate.de is where openplate is explained and priced; every app host is a
 * door and then the app. So the app links back to it: the public footer on a
 * managed instance, the account door's quiet line, and the docs links below.
 *
 * A CONSTANT, for the reason {@link REPO_URL} gives: an environment variable
 * would say an operator is expected to set it, and the honest default for a
 * fork is that the upstream link stays until the forker edits this line. Every
 * site link below is derived from it, so that one edit is complete.
 */
export const PROJECT_SITE_URL = 'https://openplate.de';

/** The site's name as a reader sees it in a link, `openplate.de`. Derived, so the fork edit moves it too. */
export const PROJECT_SITE_HOST = new URL(PROJECT_SITE_URL).host;

/**
 * A path on the project site, written as the site's route table writes it:
 * the canonical (German, unprefixed) path, starting with `/`. A page whose
 * slug is a word in each language (the calculators) is not one of these; the
 * app links to none of them.
 */
export type ProjectSitePath = `/${string}`;

/**
 * The URL prefix of each app language on the project site, mirroring
 * `LANGUAGE_PREFIXES` in `apps/website/app/i18n/language.ts`: German owns the
 * unprefixed paths, every other language lives under its own. `satisfies`
 * makes a seventh app language a compile error here until the site has a
 * prefix for it.
 */
const PROJECT_SITE_PREFIXES = {
  de: '',
  en: '/en',
  fr: '/fr',
  it: '/it',
  es: '/es',
  tr: '/tr',
} satisfies Record<LanguageCode, string>;

/**
 * The same page on the project site, in the reader's language.
 *
 * `path` keeps whatever it ends with. The site is prerendered to one directory
 * per page, so its pages answer at a trailing slash (`/en/docs/app/`) and a
 * path without one costs a 301; pass the slash, as the constants below do.
 *
 * @param language - the language the app is drawn in.
 * @param path - the canonical path, for example `/` or `/docs/app/import-from-yazio/`.
 * @returns the absolute URL, `https://openplate.de/` in German and `https://openplate.de/en/` in English.
 */
export function projectSiteUrl(language: LanguageCode, path: ProjectSitePath): string {
  return `${PROJECT_SITE_URL}${PROJECT_SITE_PREFIXES[language]}${path}`;
}

/**
 * The self-hosting guide on the project site (M250/10), where the plan page's
 * free card sends somebody who would rather run openplate themselves. The
 * site renders `docs/self-hosting.md` from the repository above, translated,
 * and it is the one place that walkthrough is kept. Derived from
 * {@link PROJECT_SITE_URL}, so a fork that keeps its own site moves it with
 * that one edit.
 */
export const SELF_HOSTING_DOCS_URL = `${PROJECT_SITE_URL}/docs/app/self-hosting`;

/**
 * The HTTPS section of the same guide, where the account pages send somebody
 * who opened them over plain http (2026-09-27 install rehearsal), in the
 * reader's language through {@link projectSiteUrl}. `#https` is the anchor the
 * site draws for the guide's `## HTTPS` heading.
 */
export const SELF_HOSTING_HTTPS_DOCS_PATH = '/docs/app/self-hosting/#https' satisfies ProjectSitePath;

/**
 * The guide to bringing a YAZIO diary over (M254/03), linked from the import
 * section on "Data & backup", in the reader's language through
 * {@link projectSiteUrl}. The site publishes `docs/import-from-yazio.md` from
 * this repository at `/docs/app/<slug>` (`apps/website`'s `doc-routes.ts`),
 * German at the root and every other language under its prefix.
 */
export const YAZIO_IMPORT_DOCS_PATH = '/docs/app/import-from-yazio/' satisfies ProjectSitePath;

/*
 * `APP_VERSION` used to live here: a hand-copied mirror of `package.json`'s
 * `version`, with a unit test to stop it drifting. It is gone. The version now
 * arrives from the build itself (`app/lib/build-info.ts`, injected by Vite's
 * `define`), which reads the manifest at build time, so there is no second copy
 * left to drift and nothing left to pin. Import `BUILD` from there.
 */
