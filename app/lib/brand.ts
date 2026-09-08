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

/*
 * `APP_VERSION` used to live here: a hand-copied mirror of `package.json`'s
 * `version`, with a unit test to stop it drifting. It is gone. The version now
 * arrives from the build itself (`app/lib/build-info.ts`, injected by Vite's
 * `define`), which reads the manifest at build time, so there is no second copy
 * left to drift and nothing left to pin. Import `BUILD` from there.
 */
